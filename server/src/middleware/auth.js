import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import db from '../db/index.js';
import { fail } from '../utils/response.js';

/** 校验登录态，挂载 req.user */
export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;

  // 支持 query 中的 access_token：<image> 标签无法携带 Authorization 头
  if (!token && req.query.access_token) {
    token = String(req.query.access_token);
  }

  if (!token) return fail(res, '未登录或登录已过期', 401);

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT id, username, nickname, role, status FROM users WHERE id = ?').get(payload.uid);
    if (!user) return fail(res, '用户不存在', 401);
    if (user.status !== 'active') return fail(res, '账号已被禁用', 403);
    req.user = user;
    next();
  } catch {
    return fail(res, '登录态无效，请重新登录', 401);
  }
}

/** 要求管理员角色 */
export function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') {
    return fail(res, '需要管理员权限', 403);
  }
  next();
}

/**
 * 校验当前用户是否可访问指定分区，并挂载 req.space / req.spaceRole
 * 规则：
 *  - public 空间所有人可访问
 *  - 空间成员可访问（owner 视为 admin）
 *  - 系统管理员可访问全部空间
 */
export function spaceAccess(requiredRole = 'member') {
  return (req, res, next) => {
    const spaceId = Number(req.params.spaceId || req.body.spaceId || req.query.spaceId);
    if (!spaceId) return fail(res, '缺少分区参数', 400);

    const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(spaceId);
    if (!space) return fail(res, '分区不存在', 404);

    let role = null;
    if (req.user.role === 'admin') {
      role = 'admin';
    } else if (space.type === 'public') {
      role = 'member';
    } else if (space.owner_id === req.user.id) {
      role = 'admin';
    } else {
      const member = db
        .prepare('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?')
        .get(spaceId, req.user.id);
      role = member?.role || null;
    }

    if (!role) return fail(res, '无权访问该分区', 403);
    if (requiredRole === 'admin' && role !== 'admin') {
      return fail(res, '需要分区管理权限', 403);
    }

    req.space = space;
    req.spaceRole = role;
    next();
  };
}
