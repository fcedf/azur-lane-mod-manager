import { Router } from 'express';
import db from '../db/index.js';
import { success, BizError, parseTagStr } from '../utils/response.js';
import {
  buildTagTree,
  allTagRows,
  validateParent,
  descendantIds,
  ensureTagTreeSchema,
} from '../utils/tag-tree.js';

const router = Router();

ensureTagTreeSchema();

/** 设置父级（校验环/父存在），错误转成 400 友好提示 */
function safeParent(tagId, parentId) {
  try {
    return validateParent(tagId, parentId);
  } catch (e) {
    throw new BizError(e.message, 400);
  }
}

/**
 * 重写文件的 tag_str：把其中某个标签替换/移除
 * @param {number|null} newName 新名称（null 表示删除该标签）
 */
function updateTagInFiles(oldName, { newName = null, newColor = null }) {
  const rows = db.prepare("SELECT id, tag_str FROM files WHERE ',' || tag_str LIKE ?").all(
    `%,${oldName}::%`
  );
  const stmt = db.prepare('UPDATE files SET tag_str = ? WHERE id = ?');

  for (const row of rows) {
    let tags = parseTagStr(row.tag_str);
    if (newName === null) {
      tags = tags.filter((t) => t.name !== oldName);
    } else {
      tags = tags.map((t) =>
        t.name === oldName
          ? { name: newName, color: newColor || t.color }
          : t
      );
    }
    const tagStr = tags.map((t) => `${t.name}::${t.color}`).join(',');
    stmt.run(tagStr, row.id);
  }
}

/** 把树拍平成带层级信息的数组（深度优先，前端可直接展示也可自行组树）*/
function flattenTree(nodes, depth = 0, acc = []) {
  for (const n of nodes) {
    const { children, ...rest } = n;
    acc.push({ ...rest, depth });
    flattenTree(children, depth + 1, acc);
  }
  return acc;
}

/** GET /api/tags?view=tree —— 默认平铺（含 parentId/直接数/聚合数），view=tree 返回树 */
router.get('/', (req, res, next) => {
  try {
    if (String(req.query.view || '') === 'tree') {
      return success(res, buildTagTree(req));
    }
    const tree = buildTagTree(req);
    const flat = flattenTree(tree);
    return success(res, flat);
  } catch (e) {
    next(e);
  }
});

/** POST /api/tags —— 新建标签，可带 parentId 建成子标签 */
router.post('/', (req, res, next) => {
  try {
    const name = req.body.name?.trim();
    const color = normColor(req.body.color, '#409eff');
    if (!name) throw new BizError('标签名称不能为空');

    let parentId = null;
    if (req.body.parentId !== undefined && req.body.parentId !== null && req.body.parentId !== '') {
      parentId = safeParent(null, req.body.parentId);
    }

    const info = db
      .prepare('INSERT INTO tags (name, color, parent_id, created_by) VALUES (?, ?, ?, ?)')
      .run(name, color, parentId, req.user.id);
    return success(res, { id: info.lastInsertRowid, parentId }, '标签创建成功');
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return next(new BizError('标签名称已存在'));
    next(e);
  }
});

/** PUT /api/tags/:id —— 重命名 / 改色（同步更新所有关联文件） */
router.put('/:id', (req, res, next) => {
  try {
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!tag) throw new BizError('标签不存在', 404);

    const newName = req.body.name !== undefined ? String(req.body.name).trim() : tag.name;
    const newColor = normColor(req.body.color || tag.color);
    if (!newName) throw new BizError('标签名称不能为空');

    if (newName !== tag.name) {
      const dup = db.prepare('SELECT id FROM tags WHERE name = ? AND id <> ?').get(newName, tag.id);
      if (dup) throw new BizError('已存在同名标签');
      updateTagInFiles(tag.name, { newName, newColor });
    } else if (newColor !== tag.color) {
      updateTagInFiles(tag.name, { newName, newColor });
    }

    db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?').run(newName, newColor, tag.id);
    return success(res, null, '标签已更新');
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/tags/reorder —— 同级排序
 * body: { orderedIds: number[] }（同一父级下的全部子标签，按新顺序排列；顶级传顶级全部）
 * 校验全部标签同父后，按序号写 sort。
 */
router.post('/reorder', (req, res, next) => {
  try {
    const orderedIds = [...new Set((req.body.orderedIds || []).map(Number).filter(Boolean))];
    if (orderedIds.length < 2) throw new BizError('排序至少需要两个标签', 400);

    const rows = orderedIds.map((id) => {
      const t = db.prepare('SELECT id, parent_id FROM tags WHERE id = ?').get(id);
      if (!t) throw new BizError(`标签 ${id} 不存在`, 404);
      return t;
    });
    const parentKey = (v) => (v == null ? 0 : v);
    const firstParent = parentKey(rows[0].parent_id);
    if (!rows.every((r) => parentKey(r.parent_id) === firstParent)) {
      throw new BizError('只能对同一个父级下的标签排序', 400);
    }
    // 必须包含该父级下全部兄弟，避免漏传导致顺序歧义
    const siblings = db
      .prepare('SELECT id FROM tags WHERE COALESCE(parent_id,0) = ?')
      .all(firstParent)
      .map((r) => r.id)
      .sort((a, b) => a - b);
    const got = [...orderedIds].sort((a, b) => a - b);
    if (siblings.length !== got.length || siblings.some((v, i) => v !== got[i])) {
      throw new BizError('排序数据不完整，请提交该层级下的全部标签', 400);
    }

    const upd = db.prepare('UPDATE tags SET sort = ? WHERE id = ?');
    db.exec('BEGIN');
    try {
      orderedIds.forEach((id, i) => upd.run(i, id));
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
    return success(res, { orderedIds }, '顺序已保存');
  } catch (e) {
    next(e);
  }
});

/** PUT /api/tags/:id/parent —— 设置/移动父级（顶级传 null/0），自动防环 */
router.put('/:id/parent', (req, res, next) => {
  try {
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!tag) throw new BizError('标签不存在', 404);
    const parentId = safeParent(tag.id, req.body.parentId);
    db.prepare('UPDATE tags SET parent_id = ? WHERE id = ?').run(parentId, tag.id);
    return success(res, { id: tag.id, parentId }, '层级已更新');
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/tags/:id —— 删除标签：从文件移除，其直接子标签提升到上一级（不丢层级信息） */
router.delete('/:id', (req, res, next) => {
  try {
    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(req.params.id);
    if (!tag) throw new BizError('标签不存在', 404);

    db.exec('BEGIN');
    try {
      // 子标签提升到被删标签的父级
      db.prepare('UPDATE tags SET parent_id = ? WHERE parent_id = ?').run(tag.parent_id ?? null, tag.id);
      updateTagInFiles(tag.name, { newName: null });
      db.prepare('DELETE FROM tags WHERE id = ?').run(tag.id);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
    return success(res, null, '标签已删除，子标签已上移');
  } catch (e) {
    next(e);
  }
});

/** 校验颜色值（#rrggbb），不合法回退默认色 */
function normColor(c, fallback = '#409eff') {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.trim()) ? c.trim() : fallback;
}

/**
 * POST /api/tags/merge —— 合并多个标签到一个目标标签
 * body: { sourceIds, targetId? | targetName?/targetColor? }
 * 被合并源标签的直接子标签，挂到目标标签下；自动防环。
 */
router.post('/merge', (req, res, next) => {
  try {
    const sourceIds = [...new Set((req.body.sourceIds || []).map(Number).filter(Boolean))];
    if (sourceIds.length < 1) throw new BizError('请选择至少一个要合并的标签', 400);

    const sources = sourceIds
      .map((id) => db.prepare('SELECT * FROM tags WHERE id = ?').get(id))
      .filter(Boolean);
    if (!sources.length) throw new BizError('所选标签不存在', 404);

    let target = null;
    if (req.body.targetId) {
      target = db.prepare('SELECT * FROM tags WHERE id = ?').get(Number(req.body.targetId));
      if (!target) throw new BizError('目标标签不存在', 404);
      if (req.body.targetColor) target = { ...target, color: normColor(req.body.targetColor, target.color) };
    } else {
      const name = String(req.body.targetName || '').trim();
      if (!name) throw new BizError('请填写合并后的标签名称', 400);
      const color = normColor(req.body.targetColor || '#409eff');
      const existing = db.prepare('SELECT * FROM tags WHERE name = ?').get(name);
      if (existing) {
        target = existing;
      } else {
        const info = db
          .prepare('INSERT INTO tags (name, color, parent_id, created_by) VALUES (?, ?, ?, ?)')
          .run(name, color, null, req.user.id);
        target = { id: info.lastInsertRowid, name, color, parent_id: null };
      }
    }

    // 防环：目标不能是任一被合并源的后代
    const descOfSources = new Set();
    for (const s of sources) descendantIds(s.id).forEach((x) => descOfSources.add(x));
    if (descOfSources.has(target.id)) throw new BizError('不能合并到自己的子标签下', 400);

    const sourceNames = sources.map((t) => t.name).filter((n) => n !== target.name);
    const absorbNames = [...new Set([...sourceNames, target.name])];

    db.exec('BEGIN');
    try {
      const cond = absorbNames.map(() => "',' || tag_str LIKE ?").join(' OR ');
      const params = absorbNames.map((n) => `%,${n}::%`);
      const rows = db.prepare(`SELECT id, tag_str FROM files WHERE ${cond}`).all(...params);
      const upd = db.prepare('UPDATE files SET tag_str = ? WHERE id = ?');

      for (const row of rows) {
        const tags = parseTagStr(row.tag_str);
        const out = [];
        let emitted = false;
        for (const t of tags) {
          if (absorbNames.includes(t.name)) {
            if (!emitted) {
              out.push({ name: target.name, color: target.color });
              emitted = true;
            }
          } else {
            out.push(t);
          }
        }
        upd.run(out.map((t) => `${t.name}::${t.color}`).join(','), row.id);
      }

      // 被删源标签的直接子标签挂到目标下
      const reparent = db.prepare('UPDATE tags SET parent_id = ? WHERE parent_id = ?');
      const del = db.prepare('DELETE FROM tags WHERE id = ?');
      for (const s of sources) {
        if (s.id !== target.id) {
          reparent.run(target.id, s.id);
          del.run(s.id);
        }
      }
      if (req.body.targetColor) {
        db.prepare('UPDATE tags SET color = ? WHERE id = ?').run(target.color, target.id);
      }
      db.exec('COMMIT');
      return success(
        res,
        { target: { id: target.id, name: target.name, color: target.color }, affectedFiles: rows.length, merged: sourceNames.length },
        `已合并 ${sourceNames.length} 个标签到「${target.name}」`
      );
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

export default router;
