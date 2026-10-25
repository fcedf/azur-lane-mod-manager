import { Router } from 'express';
import crypto from 'node:crypto';
import db from '../db/index.js';
import { success, BizError } from '../utils/response.js';
import { writeLog } from '../utils/logger.js';

const router = Router();

/** POST /api/shares —— 创建分享 body: { fileId, password, expireDays, permission } */
router.post('/', (req, res, next) => {
  try {
    const { fileId, password = '', expireDays = 7, permission = 'preview' } = req.body;
    const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
    if (!file) throw new BizError('文件不存在', 404);
    if (file.created_by !== req.user.id && req.user.role !== 'admin') {
      throw new BizError('只能分享自己上传的文件', 403);
    }

    const code = crypto.randomBytes(8).toString('base64url');
    const days = Number(expireDays) || 0;
    const expireAt = days > 0
      ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ')
      : null;

    db.prepare(
      `INSERT INTO shares (file_id, created_by, code, password, permission, expire_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(fileId, req.user.id, code, password, permission, expireAt);

    writeLog({ userId: req.user.id, username: req.user.username, action: 'share', targetType: 'file', targetId: fileId, detail: file.name, ip: req.ip });
    return success(res, { code, expireAt, url: `/share/${code}` }, '分享链接已生成');
  } catch (e) {
    next(e);
  }
});

/** GET /api/shares/mine —— 我创建的分享 */
router.get('/mine', (req, res, next) => {
  try {
    const rows = db
      .prepare(
        `SELECT sh.*, f.name AS file_name, f.size AS file_size, f.ext AS file_ext
         FROM shares sh JOIN files f ON f.id = sh.file_id
         WHERE sh.created_by = ? ORDER BY sh.created_at DESC`
      )
      .all(req.user.id);
    return success(res, rows);
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/shares/:id —— 取消分享 */
router.delete('/:id', (req, res, next) => {
  try {
    const share = db.prepare('SELECT * FROM shares WHERE id = ?').get(req.params.id);
    if (!share) throw new BizError('分享不存在', 404);
    if (share.created_by !== req.user.id && req.user.role !== 'admin') {
      throw new BizError('无权取消该分享', 403);
    }
    db.prepare('DELETE FROM shares WHERE id = ?').run(share.id);
    return success(res, null, '分享已取消');
  } catch (e) {
    next(e);
  }
});

export default router;
