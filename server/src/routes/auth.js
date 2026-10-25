import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db/index.js';
import config from '../config/index.js';
import { success, fail, BizError } from '../utils/response.js';
import { writeLog } from '../utils/logger.js';
import { authRequired } from '../middleware/auth.js';

const router = Router();

/** POST /api/auth/login 登录 */
router.post('/login', (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) throw new BizError('请输入用户名和密码');

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new BizError('用户名或密码错误', 401);
    }
    if (user.status !== 'active') throw new BizError('账号已被禁用', 403);

    const token = jwt.sign({ uid: user.id, role: user.role }, config.jwtSecret, {
      expiresIn: config.jwtExpires,
    });

    writeLog({
      userId: user.id,
      username: user.username,
      action: 'login',
      targetType: 'system',
      ip: req.ip,
    });

    return success(res, {
      token,
      user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role },
    });
  } catch (e) {
    next(e);
  }
});

/** GET /api/auth/profile 当前登录用户信息 */
router.get('/profile', authRequired, (req, res, next) => {
  try {
    const user = db
      .prepare(
        `SELECT u.id, u.username, u.nickname, u.role, u.storage_quota,
                (SELECT COALESCE(SUM(f.size),0) FROM files f
                 WHERE f.created_by = u.id AND f.deleted = 0) AS used_size
         FROM users u WHERE u.id = ?`
      )
      .get(req.user.id);
    return success(res, user);
  } catch (e) {
    next(e);
  }
});

/** PUT /api/auth/password 修改密码 */
router.put('/password', authRequired, (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) throw new BizError('新密码至少 6 位');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(oldPassword || '', user.password_hash)) {
      throw new BizError('原密码不正确');
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(newPassword, 10),
      req.user.id
    );
    writeLog({ userId: user.id, username: user.username, action: 'change_password', targetType: 'system', ip: req.ip });
    return success(res, null, '密码修改成功');
  } catch (e) {
    next(e);
  }
});

export default router;
