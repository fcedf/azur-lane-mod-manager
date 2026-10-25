import { Router } from 'express';
import db from '../db/index.js';
import { success, BizError } from '../utils/response.js';
import { spaceAccess } from '../middleware/auth.js';
import { writeLog } from '../utils/logger.js';

const router = Router();

/** GET /api/folders?spaceId= —— 获取分区的文件夹平铺列表（前端自行组树） */
router.get('/', spaceAccess(), (req, res, next) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, space_id AS spaceId, parent_id AS parentId, name, created_at AS createdAt
         FROM folders WHERE space_id = ? ORDER BY name ASC`
      )
      .all(req.space.id);
    return success(res, rows);
  } catch (e) {
    next(e);
  }
});

/** POST /api/folders —— 新建文件夹 */
router.post('/', spaceAccess('admin'), (req, res, next) => {
  try {
    const { spaceId, parentId = null, name } = req.body;
    if (!name?.trim()) throw new BizError('文件夹名称不能为空');

    const exists = db
      .prepare('SELECT id FROM folders WHERE space_id = ? AND COALESCE(parent_id,0) = COALESCE(?,0) AND name = ?')
      .get(spaceId, parentId, name.trim());
    if (exists) throw new BizError('同级目录下已存在同名文件夹');

    const info = db
      .prepare('INSERT INTO folders (space_id, parent_id, name, created_by) VALUES (?, ?, ?, ?)')
      .run(spaceId, parentId, name.trim(), req.user.id);
    writeLog({ userId: req.user.id, username: req.user.username, action: 'create_folder', targetType: 'folder', targetId: info.lastInsertRowid, detail: name, ip: req.ip });
    return success(res, { id: info.lastInsertRowid }, '文件夹创建成功');
  } catch (e) {
    next(e);
  }
});

/** PUT /api/folders/:id —— 重命名 */
router.put('/:id', (req, res, next) => {
  try {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
    if (!folder) throw new BizError('文件夹不存在', 404);

    const member = db
      .prepare('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?')
      .get(folder.space_id, req.user.id);
    if (req.user.role !== 'admin' && folder.created_by !== req.user.id && member?.role !== 'admin') {
      throw new BizError('无权操作', 403);
    }
    const { name } = req.body;
    if (!name?.trim()) throw new BizError('名称不能为空');

    db.prepare("UPDATE folders SET name = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(
      name.trim(),
      folder.id
    );
    return success(res, null, '重命名成功');
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/folders/:id —— 删除文件夹（其中文件全部进入回收站） */
router.delete('/:id', (req, res, next) => {
  try {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(req.params.id);
    if (!folder) throw new BizError('文件夹不存在', 404);

    const member = db
      .prepare('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?')
      .get(folder.space_id, req.user.id);
    if (req.user.role !== 'admin' && folder.created_by !== req.user.id && member?.role !== 'admin') {
      throw new BizError('无权操作', 403);
    }

    // 收集该文件夹及其所有子文件夹 id
    const folderIds = [folder.id];
    let frontier = [folder.id];
    while (frontier.length) {
      const placeholders = frontier.map(() => '?').join(',');
      const children = db
        .prepare(`SELECT id FROM folders WHERE parent_id IN (${placeholders})`)
        .all(...frontier);
      const ids = children.map((c) => c.id);
      folderIds.push(...ids);
      frontier = ids;
    }

    const ph = folderIds.map(() => '?').join(',');
    const result = db
      .prepare(
        `UPDATE files SET deleted = 1, deleted_at = datetime('now','localtime')
         WHERE folder_id IN (${ph}) AND deleted = 0`
      )
      .run(...folderIds);

    db.prepare(`DELETE FROM folders WHERE id IN (${ph})`).run(...folderIds);

    writeLog({
      userId: req.user.id, username: req.user.username, action: 'delete_folder',
      targetType: 'folder', targetId: folder.id, detail: `${folder.name}（${result.changes} 个文件入回收站）`, ip: req.ip,
    });
    return success(res, null, `文件夹已删除，${result.changes} 个文件进入回收站`);
  } catch (e) {
    next(e);
  }
});

export default router;
