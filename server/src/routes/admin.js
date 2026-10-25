import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db/index.js';
import { success, BizError } from '../utils/response.js';
import { adminRequired } from '../middleware/auth.js';

const router = Router();

// 以下全部接口需要管理员
router.use(adminRequired);

/* ---------- 存储统计 ---------- */

/** GET /api/admin/stats —— 仪表盘统计 */
router.get('/stats', (req, res, next) => {
  try {
    const userCount = db.prepare("SELECT COUNT(*) c FROM users WHERE status='active'").get().c;
    const fileStat = db.prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(size),0) s FROM files WHERE deleted = 0"
    ).get();
    const spaceCount = db.prepare('SELECT COUNT(*) c FROM spaces').get().c;
    const recycleStat = db.prepare(
      "SELECT COUNT(*) c, COALESCE(SUM(size),0) s FROM files WHERE deleted = 1"
    ).get();

    const spaceRanking = db
      .prepare(
        `SELECT s.id, s.name, s.color, COUNT(f.id) AS file_count, COALESCE(SUM(f.size),0) AS used_size
         FROM spaces s LEFT JOIN files f ON f.space_id = s.id AND f.deleted = 0
         GROUP BY s.id ORDER BY used_size DESC LIMIT 10`
      )
      .all();

    return success(res, {
      userCount,
      spaceCount,
      fileCount: fileStat.c,
      totalSize: fileStat.s,
      recycleCount: recycleStat.c,
      recycleSize: recycleStat.s,
      spaceRanking,
    });
  } catch (e) {
    next(e);
  }
});

/* ---------- 用户管理 ---------- */

/** GET /api/admin/users */
router.get('/users', (req, res, next) => {
  try {
    const rows = db
      .prepare(
        `SELECT u.id, u.username, u.nickname, u.role, u.status, u.created_at,
                (SELECT COALESCE(SUM(f.size),0) FROM files f
                 WHERE f.created_by = u.id AND f.deleted = 0) AS used_size
         FROM users u ORDER BY u.id ASC`
      )
      .all();
    return success(res, rows);
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/users —— 新建用户 */
router.post('/users', (req, res, next) => {
  try {
    const { username, password, nickname, role = 'user' } = req.body;
    if (!username || !password || password.length < 6) throw new BizError('用户名必填，密码至少6位');

    const info = db
      .prepare('INSERT INTO users (username, password_hash, nickname, role) VALUES (?, ?, ?, ?)')
      .run(username, bcrypt.hashSync(password, 10), nickname || username, role);
    return success(res, { id: info.lastInsertRowid }, '用户创建成功');
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return next(new BizError('用户名已存在'));
    next(e);
  }
});

/** PUT /api/admin/users/:id —— 修改角色/状态 */
router.put('/users/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { role, status, nickname } = req.body;
    db.prepare(
      `UPDATE users SET
         role = COALESCE(?, role),
         status = COALESCE(?, status),
         nickname = COALESCE(?, nickname)
       WHERE id = ?`
    ).run(role, status, nickname, id);
    return success(res, null, '更新成功');
  } catch (e) {
    next(e);
  }
});

/** PUT /api/admin/users/:id/reset-password */
router.put('/users/:id/reset-password', (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) throw new BizError('密码至少6位');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(password, 10),
      Number(req.params.id)
    );
    return success(res, null, '密码已重置');
  } catch (e) {
    next(e);
  }
});

/* ---------- 操作日志 ---------- */

/** GET /api/admin/logs?action=&username= */
router.get('/logs', (req, res, next) => {
  try {
    const { action = '', username = '' } = req.query;
    const conditions = [];
    const params = [];
    if (action) {
      conditions.push('action = ?');
      params.push(action);
    }
    if (username) {
      conditions.push('username LIKE ?');
      params.push(`%${username}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(`SELECT * FROM operation_logs ${where} ORDER BY id DESC LIMIT 500`)
      .all(...params);
    return success(res, rows);
  } catch (e) {
    next(e);
  }
});

export default router;
