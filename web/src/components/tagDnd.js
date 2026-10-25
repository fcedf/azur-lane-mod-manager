/**
 * 主页左侧分类标签的“长按拖拽同级排序”控制器（单例）。
 * - 按住约 LONG_PRESS_MS 后进入拖动（防误触，区分普通点击）
 * - 只允许同一父级内部排序，跨层级不改父子关系
 * - 拖动经过同级节点的上/下半区显示插入指示线；松手提交并持久化
 */
import { reactive } from 'vue';
import { reorderTags } from '../api/tag.js';
import { ElMessage } from 'element-plus';

export const LONG_PRESS_MS = 300;

export const dndState = reactive({
  dragging: null,   // { id, parentId }
  overNode: null,   // 树节点
  position: '',     // 'before' | 'after'
  valid: false,
  started: false,
});

let longPressTimer = null;
let onDragMoveBound = null;
let onDragEndBound = null;
let preMove = null;
let preUp = null;
let deps = null;     // { tree, parentOf, onReordered }

function parentOf(node) {
  if (!node) return null;
  return deps.parentOf(node.id) ?? null;
}
function isSibling(a, b) {
  return parentOf(a) === parentOf(b) && a.id !== b.id;
}

/** 在当前树中定位节点所在兄弟数组与索引 */
function locate(node) {
  const pid = parentOf(node);
  const roots = deps.tree.value;
  if (pid === null) return { list: roots, index: roots.findIndex((n) => n.id === node.id) };
  let target = null;
  const find = (nodes) => {
    for (const n of nodes) {
      if (n.id === pid) { target = n; return true; }
      if (n.children?.length && find(n.children)) return true;
    }
    return false;
  };
  find(roots);
  const list = target?.children || [];
  return { list, index: list.findIndex((n) => n.id === node.id), parent: target };
}

function flatFind(id) {
  let found = null;
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.id === id) { found = n; return; }
      if (n.children?.length) walk(n.children);
    }
  };
  walk(deps.tree.value);
  return found;
}

function clearLongPress() {
  if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
}
function removeGhost() {
  document.querySelectorAll('.tag-drag-ghost').forEach((el) => el.remove());
  document.getElementById('tag-drop-indicator')?.remove();
}
function moveGhost(event) {
  const ghost = document.querySelector('.tag-drag-ghost');
  if (ghost) {
    ghost.style.left = `${event.clientX + 12}px`;
    ghost.style.top = `${event.clientY + 8}px`;
  }
}

function beginDrag(node, el, event) {
  dndState.dragging = { id: node.id, parentId: parentOf(node) };
  dndState.started = true;
  const ghost = el.cloneNode(true);
  ghost.className = `${ghost.className || ''} tag-drag-ghost`;
  ghost.style.width = `${el.offsetWidth}px`;
  document.body.appendChild(ghost);
  moveGhost(event);
  document.addEventListener('mousemove', onDragMoveBound);
  document.addEventListener('mouseup', onDragEndBound);
  document.body.classList.add('tag-dragging');
}

function updateHover(event) {
  const el = document.elementFromPoint(event.clientX, event.clientY);
  const row = el?.closest?.('[data-tag-id]');
  let line = document.getElementById('tag-drop-indicator');
  if (!row) {
    dndState.overNode = null; dndState.position = ''; dndState.valid = false;
    line?.remove();
    return;
  }
  const id = Number(row.getAttribute('data-tag-id'));
  const over = flatFind(id);
  if (!over) return;
  const drag = dndState.dragging;
  const same = drag ? isSibling(drag, over) : false;
  dndState.overNode = over;
  dndState.valid = same;
  const rect = row.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height / 2;
  dndState.position = before ? 'before' : 'after';

  if (same) {
    if (!line) {
      line = document.createElement('div');
      line.id = 'tag-drop-indicator';
      document.body.appendChild(line);
    }
    line.style.display = 'block';
    line.style.left = `${rect.left + 6}px`;
    line.style.width = `${rect.width - 12}px`;
    line.style.top = `${(before ? rect.top : rect.bottom) - 1}px`;
  } else if (line) {
    line.style.display = 'none';
  }
}

async function finishDrag() {
  const drag = dndState.dragging;
  const over = dndState.overNode;
  const pos = dndState.position;
  const valid = dndState.valid;

  clearLongPress();
  removeGhost();
  document.removeEventListener('mousemove', onDragMoveBound);
  document.removeEventListener('mouseup', onDragEndBound);
  if (preMove) document.removeEventListener('mousemove', preMove);
  if (preUp) document.removeEventListener('mouseup', preUp);
  preMove = null; preUp = null;
  document.body.classList.remove('tag-dragging');
  dndState.dragging = null; dndState.overNode = null;
  dndState.position = ''; dndState.valid = false; dndState.started = false;

  if (!drag || !over || !valid || !pos) return;

  const { list } = locate(drag);
  const from = list.findIndex((n) => n.id === drag.id);
  if (from < 0) return;
  const [moved] = list.splice(from, 1);
  let to = list.findIndex((n) => n.id === over.id);
  if (to < 0) to = list.length;
  if (pos === 'after') to += 1;
  list.splice(to, 0, moved);

  const orderedIds = list.map((n) => n.id);
  deps.onReordered(false); // 乐观刷新
  try {
    await reorderTags(orderedIds);
  } catch (e) {
    ElMessage.error(e?.message || '排序保存失败');
    deps.onReordered(true); // 失败重拉还原
  }
}

/** 节点组件 mousedown 时调用 */
export function bindTagDrag(node, el, event, depsArg) {
  deps = depsArg;
  if (event.button !== 0) return;
  if (!onDragMoveBound) {
    onDragMoveBound = (e) => {
      if (!dndState.started) return;
      e.preventDefault();
      moveGhost(e);
      updateHover(e);
    };
    onDragEndBound = () => finishDrag();
  }

  // 清理上一次的长按前监听
  if (preMove) document.removeEventListener('mousemove', preMove);
  if (preUp) document.removeEventListener('mouseup', preUp);
  clearLongPress();

  longPressTimer = setTimeout(() => beginDrag(node, el, event), LONG_PRESS_MS);

  const startX = event.clientX;
  const startY = event.clientY;
  preMove = (ev) => {
    if (dndState.started) return;
    if (Math.abs(ev.clientX - startX) > 6 || Math.abs(ev.clientY - startY) > 6) {
      clearLongPress();
    }
  };
  preUp = () => clearLongPress();
  document.addEventListener('mousemove', preMove);
  document.addEventListener('mouseup', preUp);
}
