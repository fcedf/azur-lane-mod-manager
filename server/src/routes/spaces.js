import { Router } from 'express';
import db from '../db/index.js';
import { success, BizError } from '../utils/response.js';
import { spaceAccess } from '../middleware/auth.js';

const router = Router();

/**
 * 空间统计信息（附带使用量）
 */
function withUsage(space, userId) {
  const usage = db
    .prepare(`SELECT COALESCE(SUM(size),0) AS used, COUNT(*) AS files
              FROM files WHERE space_id = ? AND deleted = 0`)
    .get(space.id);
  const member = db
    .prepare('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?')
    .get(space.id, userId);
  return {
    ...space,
    used_size: usage.used,
    file_count: usage.files,
    my_role: space.owner_id === userId ? 'admin' : member?.role || null,
  };
}

/** GET /api/spaces —— 列出我可访问的分区 */
router.get('/', (req, res, next) => {
  try {
    const rows = db
      .prepare(
        `SELECT DISTINCT s.* FROM spaces s
         LEFT JOIN space_members m ON m.space_id = s.id
         WHERE s.owner_id = ? OR m.user_id = ? OR s.type = 'public'
               OR ? = (SELECT role FROM users WHERE id = ?)
         ORDER BY s.type DESC, s.id ASC`
      )
      .all(req.user.id, req.user.id, 'admin', req.user.id);
    return success(res, rows.map((s) => withUsage(s, req.user.id)));
  } catch (e) {
    next(e);
  }
});

/** POST /api/spaces —— 创建分区（管理员可建任意类型；普通用户仅 personal） */
router.post('/', (req, res, next) => {
  try {
    const { name, type = 'personal', description = '', color = '#409eff', quota = 0 } = req.body;
    if (!name?.trim()) throw new BizError('分区名称不能为空');

    let realType = type;
    if (req.user.role !== 'admin') realType = 'personal';

    const info = db
      .prepare('INSERT INTO spaces (name, type, description, color, quota, owner_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name.trim(), realType, description, color, Number(quota) || 0, req.user.id);

    db.prepare('INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)').run(
      info.lastInsertRowid,
      req.user.id,
      'admin'
    );
    return success(res, { id: info.lastInsertRowid }, '分区创建成功');
  } catch (e) {
    next(e);
  }
});

/** PUT /api/spaces/:spaceId —— 更新分区信息（需分区管理员） */
router.put('/:spaceId', spaceAccess('admin'), (req, res, next) => {
  try {
    const { name, description, color, quota } = req.body;
    db.prepare(
      `UPDATE spaces SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         color = COALESCE(?, color),
         quota = COALESCE(?, quota)
       WHERE id = ?`
    ).run(name, description, color, quota !== undefined ? Number(quota) : null, req.space.id);
    return success(res, null, '分区更新成功');
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/spaces/:spaceId —— 删除分区（owner 或系统管理员） */
router.delete('/:spaceId', spaceAccess('admin'), (req, res, next) => {
  try {
    if (req.space.owner_id !== req.user.id && req.user.role !== 'admin') {
      throw new BizError('仅分区创建者或系统管理员可删除', 403);
    }
    db.prepare('DELETE FROM spaces WHERE id = ?').run(req.space.id);
    return success(res, null, '分区已删除');
  } catch (e) {
    next(e);
  }
});

/** GET /api/spaces/:spaceId/members —— 分区成员列表 */
router.get('/:spaceId/members', spaceAccess(), (req, res, next) => {
  try {
    const members = db
      .prepare(
        `SELECT u.id, u.username, u.nickname, m.role,
                CASE WHEN s.owner_id = u.id THEN 1 ELSE 0 END AS is_owner
         FROM space_members m
         JOIN users u ON u.id = m.user_id
         JOIN spaces s ON s.id = m.space_id
         WHERE m.space_id = ?
         ORDER BY is_owner DESC, u.id ASC`
      )
      .all(req.space.id);
    return success(res, members);
  } catch (e) {
    next(e);
  }
});

/** POST /api/spaces/:spaceId/members —— 添加成员（分区管理员） */
router.post('/:spaceId/members', spaceAccess('admin'), (req, res, next) => {
  try {
    const { username } = req.body;
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (!user) throw new BizError('用户不存在');

    db.prepare('INSERT OR IGNORE INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)').run(
      req.space.id,
      user.id,
      'member'
    );
    return success(res, null, '成员添加成功');
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/spaces/:spaceId/members/:userId —— 移除成员（分区管理员） */
router.delete('/:spaceId/members/:userId', spaceAccess('admin'), (req, res, next) => {
  try {
    const targetUserId = Number(req.params.userId);
    if (targetUserId === req.space.owner_id) throw new BizError('不能移除分区所有者');
    db.prepare('DELETE FROM space_members WHERE space_id = ? AND user_id = ?').run(
      req.space.id,
      targetUserId
    );
    return success(res, null, '成员已移除');
  } catch (e) {
    next(e);
  }
});

export default router;
