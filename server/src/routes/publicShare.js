import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import db from '../db/index.js';
import config from '../config/index.js';
import { resolveFileLocation } from '../utils/storage-roots.js';
import { success, BizError } from '../utils/response.js';

const router = Router();

/** 校验分享链接是否有效 */
function resolveValidShare(code) {
  const share = db.prepare('SELECT * FROM shares WHERE code = ?').get(code);
  if (!share) throw new BizError('分享链接不存在', 404);
  if (share.expire_at) {
    const expire = new Date(`${share.expire_at.replace(' ', 'T')}`);
    if (Number.isFinite(expire.getTime()) && expire.getTime() < Date.now()) {
      throw new BizError('分享链接已过期', 410);
    }
  }
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND deleted = 0').get(share.file_id);
  if (!file) throw new BizError('文件已被删除', 410);
  return { share, file };
}

/** GET /api/public/share/:code?password= —— 查看分享信息（无需登录） */
router.get('/:code', (req, res, next) => {
  try {
    const { share, file } = resolveValidShare(req.params.code);
    if (share.password && share.password !== (req.query.password || '')) {
      return success(res, { needPassword: true });
    }
    db.prepare('UPDATE shares SET view_count = view_count + 1 WHERE id = ?').run(share.id);
    return success(res, {
      needPassword: false,
      file: { id: file.id, name: file.name, size: file.size, ext: file.ext },
      permission: share.permission,
    });
  } catch (e) {
    next(e);
  }
});

/** GET /api/public/share/:code/download?password= */
router.get('/:code/download', (req, res, next) => {
  try {
    const { share, file } = resolveValidShare(req.params.code);
    if (share.password && share.password !== (req.query.password || '')) {
      throw new BizError('提取密码不正确', 403);
    }
    if (share.permission !== 'download') throw new BizError('该分享仅支持预览', 403);

    const { abs } = resolveFileLocation(file.storage_root_id ?? null, file.storage_path);
    if (!fs.existsSync(abs)) throw new BizError('物理文件已丢失', 404);
    return res.download(abs, file.name);
  } catch (e) {
    next(e);
  }
});

export default router;
