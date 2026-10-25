import { Router } from 'express';
import { success, BizError } from '../utils/response.js';
import { authRequired } from '../middleware/auth.js';
import { writeLog } from '../utils/logger.js';
import {
  listRoots,
  addRootFromDrive,
  setCurrentRoot,
  removeRoot,
  currentRootId,
  currentRootPath,
  listSubdirs,
  normalizeRoot,
  defaultRootPath,
} from '../utils/storage-roots.js';

const router = Router();

/** GET /api/storage/roots —— 全部存储根 + 当前根 */
router.get('/roots', authRequired, (req, res) => {
  const roots = listRoots();
  success(res, {
    roots,
    currentId: currentRootId() ?? 0,
    currentPath: currentRootPath(),
    defaultPath: normalizeRoot(defaultRootPath()),
  });
});

/** GET /api/storage/subdirs?rootId= —— 当前/指定根下的子目录树（上传选目录用）*/
router.get('/subdirs', authRequired, (req, res) => {
  const rootId = req.query.rootId === undefined || req.query.rootId === ''
    ? null
    : Number(req.query.rootId);
  success(res, { subdirs: listSubdirs(Number.isFinite(rootId) ? rootId : null) });
});

/** POST /api/storage/roots  body: { drive:'E:', label? } —— 在盘符下自建 fms-files */
router.post('/roots', authRequired, (req, res, next) => {
  try {
    const drive = String(req.body?.drive || '').trim();
    const label = String(req.body?.label || '').trim();
    if (!drive) throw new BizError('请选择盘符');
    const rec = addRootFromDrive(drive, label);
    writeLog({
      userId: req.user.id, username: req.user.username,
      action: 'storage_add_root', targetType: 'storage_root', targetId: rec.id,
      detail: rec.path, ip: req.ip,
    });
    success(res, listRoots(), '存储目录已添加');
  } catch (e) {
    next(e);
  }
});

/** PUT /api/storage/current  body: { rootId } —— 切换当前写入根（0=默认）*/
router.put('/current', authRequired, (req, res, next) => {
  try {
    const raw = req.body?.rootId;
    const rootId = raw === null || raw === undefined || raw === '' ? 0 : Number(raw);
    setCurrentRoot(rootId);
    writeLog({
      userId: req.user.id, username: req.user.username,
      action: 'storage_set_current', detail: `rootId=${rootId} -> ${currentRootPath()}`, ip: req.ip,
    });
    success(res, { currentId: currentRootId() ?? 0, currentPath: currentRootPath() }, '当前存储目录已切换');
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/storage/roots/:id —— 仅无文件的自定义根可删 */
router.delete('/roots/:id', authRequired, (req, res, next) => {
  try {
    removeRoot(req.params.id);
    success(res, listRoots(), '存储目录已移除');
  } catch (e) {
    next(e);
  }
});

export default router;
