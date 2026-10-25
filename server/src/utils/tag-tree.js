/**
 * 父子标签（标签树）工具
 * - tags.parent_id 自引用：NULL/0 = 顶级
 * - 文件仍可多标签（tag_str 不变），树只用于分类组织与聚合筛选
 * - 运行时幂等迁移（本项目不依赖 init.js 启动）
 */
import db from '../db/index.js';
import { parseTagStr } from './response.js';
import { accessibleSpaceIds } from './spaces.js';

let migrated = false;

/** 确保 tags 表有 parent_id / sort 字段（幂等）*/
export function ensureTagTreeSchema() {
  if (migrated) return;
  const cols = db.prepare('PRAGMA table_info(tags)').all().map((c) => c.name);
  if (!cols.includes('parent_id')) {
    db.exec('ALTER TABLE tags ADD COLUMN parent_id INTEGER');
    console.log('✅ 已添加字段 tags.parent_id（父子标签）');
  }
  if (!cols.includes('sort')) {
    db.exec('ALTER TABLE tags ADD COLUMN sort INTEGER NOT NULL DEFAULT 0');
    console.log('✅ 已添加字段 tags.sort（标签排序）');
  }
  migrated = true;
}

ensureTagTreeSchema();

/** 取全部标签（行），parent_id 为 0 统一视为 null */
export function allTagRows() {
  return db
    .prepare('SELECT * FROM tags ORDER BY sort ASC, id ASC')
    .all()
    .map((t) => ({ ...t, parent_id: t.parent_id ?? null }));
}

/**
 * 校验 newParentId 不会让 tagId 形成环（不能把自己挂到自己或自己的后代下）。
 * 返回规范化后的 parentId（null 表示顶级）。
 */
export function validateParent(tagId, newParentId) {
  let pid = newParentId === undefined || newParentId === null || Number(newParentId) === 0
    ? null
    : Number(newParentId);
  if (pid === null) return null;
  if (pid === Number(tagId)) throw new Error('不能把标签放到自己下面');
  const parent = db.prepare('SELECT id, parent_id FROM tags WHERE id = ?').get(pid);
  if (!parent) throw new Error('父标签不存在');
  // 沿父链向上走，若遇到 tagId 则成环
  let cur = parent;
  const seen = new Set();
  while (cur) {
    if (cur.id === Number(tagId)) throw new Error('不能把标签放到自己的子标签下面');
    if (seen.has(cur.id)) break; // 数据异常自环保护
    seen.add(cur.id);
    cur = cur.parent_id ? db.prepare('SELECT id, parent_id FROM tags WHERE id = ?').get(cur.parent_id) : null;
  }
  return pid;
}

/** 返回某标签的全部后代 id（不含自身），按 parent_id 逐层展开 */
export function descendantIds(tagId) {
  const rows = allTagRows();
  const byParent = new Map();
  for (const t of rows) {
    const p = t.parent_id ?? 0;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(t.id);
  }
  const out = [];
  const stack = [...(byParent.get(Number(tagId)) || [])];
  while (stack.length) {
    const id = stack.pop();
    out.push(id);
    const kids = byParent.get(id) || [];
    stack.push(...kids);
  }
  return out;
}

/** 返回某标签自身 + 全部后代 id（用于聚合筛选）*/
export function selfAndDescendantIds(tagId) {
  return [Number(tagId), ...descendantIds(tagId)];
}

/** id -> name 映射 */
const nameById = new Map();
function refreshNameIndex() {
  nameById.clear();
  for (const t of allTagRows()) nameById.set(t.id, t.name);
}

/**
 * 给定标签名，返回“其自身 + 所有后代标签名”集合（供 browse 聚合过滤）。
 * 用名字而不是 id 过滤，是因为 files 里只存 tag_str（名称::颜色）。
 */
export function aggregateTagNames(tagName) {
  refreshNameIndex();
  const target = allTagRows().find((t) => t.name === tagName);
  if (!target) return new Set([tagName]);
  const ids = selfAndDescendantIds(target.id);
  const names = new Set();
  for (const id of ids) {
    const n = nameById.get(id);
    if (n) names.add(n);
  }
  return names;
}

/**
 * 构造标签树（供前端），节点附带：
 *  - ownCount：直接打了该标签的可见文件数
 *  - fileCount：自身 + 全部后代的聚合文件数
 *  - children
 */
export function buildTagTree(req) {
  const rows = allTagRows();
  const spaceIds = accessibleSpaceIds(req.user);

  const byId = new Map(rows.map((t) => [t.id, {
    id: t.id,
    name: t.name,
    color: t.color,
    parentId: t.parent_id,
    sort: t.sort,
    createdAt: t.created_at,
    ownCount: 0,
    uniq: new Set(), // 自身或任意后代标签命中的【不重复文件】
    children: [],
  }]));
  const byName = new Map();
  for (const n of byId.values()) byName.set(n.name, n);

  const roots = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  // 逐文件：直接命中的标签 ownCount+1；同时沿父链向上，把该文件 id 计入祖先 uniq（去重）
  if (spaceIds.length) {
    const ph = spaceIds.map(() => '?').join(',');
    const files = db
      .prepare(`SELECT id, tag_str FROM files WHERE deleted = 0 AND space_id IN (${ph})`)
      .all(...spaceIds);
    for (const f of files) {
      const ancestors = new Set();
      for (const t of parseTagStr(f.tag_str)) {
        const direct = byName.get(t.name);
        if (direct) direct.ownCount += 1;
        let node = direct;
        while (node) {
          ancestors.add(node.id);
          node = node.parentId ? byId.get(node.parentId) : null;
        }
      }
      for (const id of ancestors) byId.get(id).uniq.add(f.id);
    }
  }

  // fileCount = 分支内不重复文件数；ownCount = 直接打该标签的文件数
  const finalize = (node) => {
    for (const c of node.children) finalize(c);
    node.fileCount = node.uniq.size;
    delete node.uniq;
  };
  roots.forEach(finalize);
  return roots;
}
