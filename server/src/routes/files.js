import { Router } from 'express';
import multer from 'multer';
import archiver from 'archiver';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import db from '../db/index.js';
import config from '../config/index.js';
import { success, BizError, withTags } from '../utils/response.js';
import { spaceAccess } from '../middleware/auth.js';
import { writeLog } from '../utils/logger.js';
import { getExt, getFileType } from '../utils/file-type.js';
import { accessibleSpaceIds, getSpaceRole, ensureDefaultSpace } from '../utils/spaces.js';
import { parseTagStr } from '../utils/response.js';
import { tsToLocal } from '../utils/datetime.js';
import { planNewFile, toRel, uniqueFilePath, safeCategory, planNewFileInSubdir, safeName } from '../utils/storage-path.js';
import {
  currentRootId,
  currentRootPath,
  rootPathById,
  resolveFileLocation,
} from '../utils/storage-roots.js';
import { aggregateTagNames } from '../utils/tag-tree.js';

const router = Router();

/**
 * 上传落盘 + 自动标签的统一处理。
 * @param {object} req
 * @returns {{rootId:number|null, rootAbs:string, subdir:string, tagSegs:string[], tagObjs:Array, tagStr:string}}
 * subdir 优先取显式选择；否则用“当前分类 tag”（保持旧行为：上传到当前标签页时落该标签目录）。
 * 目录每一级都自动确保标签存在并收集。
 */
function prepareUploadTarget(req) {
  const explicitSubdir = typeof req.body?.subdir === 'string' ? req.body.subdir.trim() : '';
  const currentTag = typeof req.body?.tag === 'string' ? req.body.tag.trim() : '';
  const subdir = explicitSubdir || currentTag;

  // 指定存储根：默认当前根（不传 rootId 时）
  let rootId = currentRootId();
  if (req.body?.rootId !== undefined && req.body?.rootId !== null && req.body?.rootId !== '') {
    const rid = Number(req.body.rootId);
    // 0 显式表示默认根；其他需存在
    if (rid === 0) rootId = null;
    else {
      const ok = db.prepare('SELECT id FROM storage_roots WHERE id = ?').get(rid);
      if (!ok) throw new BizError('所选存储目录不存在', 400);
      rootId = rid;
    }
  }
  const rootAbs = rootPathById(rootId);

  // 解析目录段并确保每一级标签存在
  const rawSegs = subdir.split(/[\\/]/).map(s => safeName(s)).filter(Boolean);
  const tagSegs = [...new Set(rawSegs)]; // 去重，避免同名层级重复打标签
  const tagObjs = [];
  const insTag = db.prepare('INSERT INTO tags (name, color, created_by) VALUES (?, ?, ?)');
  for (const name of tagSegs) {
    let t = db.prepare('SELECT * FROM tags WHERE name = ?').get(name);
    if (!t) {
      insTag.run(name, '#409eff', req.user.id);
      t = db.prepare('SELECT * FROM tags WHERE name = ?').get(name);
    }
    tagObjs.push(t);
  }
  const tagStr = tagObjs.map(t => `${t.name}::${t.color}`).join(',');
  return { rootId, rootAbs, subdir, tagObjs, tagStr };
}

/* ---------------- 工具函数 ---------------- */

/** 校验当前用户对文件所在空间的访问权，返回 file + space + role */
function ensureFileAccess(req, fileId, requireAdmin = false) {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
  if (!file) throw new BizError('文件不存在', 404);

  let role = null;
  if (req.user.role === 'admin') role = 'admin';
  const space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(file.space_id);
  if (!space) throw new BizError('分区不存在', 404);
  if (space.owner_id === req.user.id) role = 'admin';
  if (!role) {
    const m = db
      .prepare('SELECT role FROM space_members WHERE space_id = ? AND user_id = ?')
      .get(file.space_id, req.user.id);
    if (space.type === 'public') role = 'member';
    else role = m?.role || null;
  }
  if (!role) throw new BizError('无权访问该文件', 403);
  if (requireAdmin && role !== 'admin') throw new BizError('需要分区管理权限', 403);
  return { file, space, role };
}

/** 把数据库行转成前端友好的结构 */
function formatFile(row) {
  const folderName = row.folder_name ?? null;
  const cleaned = { ...row };
  delete cleaned.folder_name;
  return {
    ...withTags(cleaned),
    type: getFileType(row.name),
    folder_name: folderName,
  };
}

/** 标签数组 -> 存储串 */
function serializeTags(tags = []) {
  return tags
    .filter((t) => t?.name)
    .map((t) => `${t.name}::${t.color || '#909399'}`)
    .join(',');
}

/**
 * 核心：给某个文件应用最终标签集合
 *  - 同步标签到独立 tags 表（不存在则创建），采用库内权威颜色
 *  - 物理文件迁移到新主分类目录（主分类=第一个标签）
 *  - 更新数据库，返回新的文件行
 */
function applyTagsToFile(req, file, incoming) {
  const upsertTag = db.prepare('INSERT OR IGNORE INTO tags (name, color, created_by) VALUES (?, ?, ?)');
  const getTag = db.prepare('SELECT * FROM tags WHERE name = ?');

  const normalized = incoming
    .filter((t) => t?.name)
    .map((t) => {
      upsertTag.run(t.name, t.color || '#409eff', req.user.id);
      return getTag.get(t.name);
    });

  const tagStr = normalized.map((t) => `${t.name}::${t.color}`).join(',');

  // 物理文件迁移（在该文件所属存储根内按首标签目录移动）
  const { abs: oldAbs } = resolveFileLocation(file.storage_root_id ?? null, file.storage_path);
  const rootAbs = rootPathById(file.storage_root_id ?? null);
  const category = safeCategory(normalized[0]?.name || '');
  const targetDir = path.join(rootAbs, category);
  const newAbs = uniqueFilePath(targetDir, path.basename(file.name) || file.name);

  if (fs.existsSync(oldAbs)) {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.renameSync(oldAbs, newAbs);
  }
  const newRelPath = toRel(rootAbs, newAbs);

  db.prepare(
    "UPDATE files SET tag_str = ?, storage_path = ?, updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(tagStr, newRelPath, file.id);

  return db
    .prepare(
      `SELECT f.*, s.name AS space_name
       FROM files f JOIN spaces s ON s.id = f.space_id WHERE f.id = ?`
    )
    .get(file.id);
}

/* ---------------- 上传配置 ---------------- */

// 内存暂存：拿到标签后直接写入 <分类>/<真实文件名>，避免先落临时目录再移动
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileSize },
  defParamCharset: 'utf-8', // 中文文件名按 UTF-8 解析，防乱码
});

/* ---------------- 回收站（静态路径必须放在 /:id 之前） ---------------- */

/** GET /api/files/recycle/list —— 回收站 */
router.get('/recycle/list', (req, res, next) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      rows = db
        .prepare(
          `SELECT f.*, s.name AS space_name, u.nickname AS creator_name
           FROM files f JOIN spaces s ON s.id = f.space_id LEFT JOIN users u ON u.id = f.created_by
           WHERE f.deleted = 1 ORDER BY f.deleted_at DESC`
        )
        .all();
    } else {
      rows = db
        .prepare(
          `SELECT f.*, s.name AS space_name, u.nickname AS creator_name
           FROM files f JOIN spaces s ON s.id = f.space_id LEFT JOIN users u ON u.id = f.created_by
           WHERE f.deleted = 1 AND f.created_by = ?
           ORDER BY f.deleted_at DESC`
        )
        .all(req.user.id);
    }
    return success(res, rows.map(formatFile));
  } catch (e) {
    next(e);
  }
});

/* ---------------- 按标签 / 全部 浏览 ---------------- */

/**
 * GET /api/files/browse?tag=&type=
 * tag 为空：用户可见空间中的全部文件
 * tag 指定：所有带该标签的文件（跨文件夹/空间聚合）
 */
router.get('/browse', (req, res, next) => {
  try {
    const tag = req.query.tag ? String(req.query.tag) : '';
    const type = req.query.type ? String(req.query.type) : '';

    // 动态排序：白名单校验，防止 SQL 注入
    const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const SORT_COLUMNS = {
      name: 'f.name COLLATE NOCASE',
      size: 'f.size',
      created_at: 'f.created_at',
      // 无原始日期时回退到上传时间
      origin_date: 'COALESCE(f.origin_date, f.created_at)',
    };
    const sortColumn = SORT_COLUMNS[String(req.query.sortBy)] || SORT_COLUMNS.created_at;

    const spaceIds = accessibleSpaceIds(req.user);
    if (!spaceIds.length) return success(res, []);

    const ph = spaceIds.map(() => '?').join(',');
    let rows = db
      .prepare(
        `SELECT f.*, s.name AS space_name, fo.name AS folder_name, u.nickname AS creator_name,
                COALESCE(fm.enabled, 0) AS mod_enabled
         FROM files f
         JOIN spaces s ON s.id = f.space_id
         LEFT JOIN folders fo ON fo.id = f.folder_id
         LEFT JOIN users u ON u.id = f.created_by
         LEFT JOIN file_mods fm ON fm.file_id = f.id
         WHERE f.deleted = 0 AND f.space_id IN (${ph})
         ORDER BY f.is_starred DESC, ${sortColumn} ${order}, f.id DESC`
      )
      .all(...spaceIds);

    rows = rows.map(formatFile);
    if (tag) {
      // 聚合：点父标签时，包含其下所有子标签的文件
      const nameSet = aggregateTagNames(tag);
      rows = rows.filter((f) => (f.tags || []).some((t) => nameSet.has(t.name)));
    }
    if (type) rows = rows.filter((f) => f.type === type);

    return success(res, rows);
  } catch (e) {
    next(e);
  }
});

/* ---------------- 文件列表（按空间/文件夹，保留兼容） ---------------- */

/** GET /api/files?spaceId=&folderId=&type=&starred= */
router.get('/', spaceAccess(), (req, res, next) => {
  try {
    const { folderId = '', type = '', starred = '' } = req.query;
    const conditions = ['f.space_id = ?', 'f.deleted = 0'];
    const params = [req.space.id];

    if (folderId === 'root') {
      conditions.push('f.folder_id IS NULL');
    } else if (folderId) {
      conditions.push('f.folder_id = ?');
      params.push(Number(folderId));
    }
    if (starred === '1') conditions.push('f.is_starred = 1');

    let rows = db
      .prepare(
        `SELECT f.*, u.nickname AS creator_name
         FROM files f LEFT JOIN users u ON u.id = f.created_by
         WHERE ${conditions.join(' AND ')}
         ORDER BY f.is_starred DESC, f.updated_at DESC, f.id DESC`
      )
      .all(...params);

    rows = rows.map(formatFile);
    if (type) rows = rows.filter((f) => f.type === type);

    return success(res, rows);
  } catch (e) {
    next(e);
  }
});

/* ---------------- 上传 ---------------- */

/**
 * POST /api/files/upload?spaceId=  (form-data: file, tag)
 * spaceId 缺省：自动存入当前用户的默认个人空间
 * tag：上传后自动附加的初始标签（即所属分类）
 */
router.post('/upload', upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) throw new BizError('未接收到文件');

    // 确定目标空间
    let space;
    const rawSpaceId = Number(req.query.spaceId || req.body.spaceId);
    if (rawSpaceId) {
      space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(rawSpaceId);
      if (!space) throw new BizError('分区不存在', 404);
      if (getSpaceRole(req.user, space) === null) throw new BizError('无权在该分区上传', 403);
    } else {
      space = ensureDefaultSpace(req.user.id);
    }

    const folderId = null;
    const { originalname, size, mimetype, buffer } = req.file;

    /* 解析目标根 + 子目录，并确保每一级目录标签都存在 */
    const target = prepareUploadTarget(req);

    // 用户配额校验（quota = 0 表示不限）
    const used = db
      .prepare('SELECT COALESCE(SUM(size),0) AS s FROM files WHERE created_by = ? AND deleted = 0')
      .get(req.user.id).s;
    const quota = req.user.role === 'admin' ? 0 : 5 * 1024 * 1024 * 1024; // 默认 5GB
    if (quota > 0 && used + size > quota) {
      throw new BizError('存储空间不足，已超出个人配额');
    }

    // 空间配额校验
    if (space.quota > 0) {
      const spaceUsed = db
        .prepare('SELECT COALESCE(SUM(size),0) AS s FROM files WHERE space_id = ? AND deleted = 0')
        .get(space.id).s;
      if (spaceUsed + size > space.quota) {
        throw new BizError('分区存储空间不足');
      }
    }

    // 物理路径 = <目标根>/<子目录各级>/<真实文件名>，同名自动加序号
    const planned = planNewFileInSubdir(target.rootAbs, target.subdir, originalname);
    fs.writeFileSync(planned.abs, buffer);

    const originDate = tsToLocal(req.body.originDate);
    const info = db
      .prepare(
        `INSERT INTO files (space_id, folder_id, name, ext, mime_type, size, storage_path, created_by, origin_date, tag_str, storage_root_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        space.id, null, originalname, getExt(originalname), mimetype, size, planned.rel,
        req.user.id, originDate, target.tagStr, target.rootId
      );

    writeLog({
      userId: req.user.id, username: req.user.username, action: 'upload',
      targetType: 'file', targetId: info.lastInsertRowid, detail: `${originalname} -> ${target.rootAbs}/${planned.rel}`, ip: req.ip,
    });

    const row = db
      .prepare(
        `SELECT f.*, s.name AS space_name
         FROM files f JOIN spaces s ON s.id = f.space_id WHERE f.id = ?`
      )
      .get(info.lastInsertRowid);
    return success(res, formatFile(row), '上传成功');
  } catch (e) {
    next(e);
  }
});

/* ---------------- 批量上传 ---------------- */

/**
 * POST /api/files/upload-batch  (form-data: files[多个], tag, spaceId)
 * 用于“扫描文件夹内所有压缩包”后批量上传
 */
router.post('/upload-batch', upload.array('files', 500), (req, res, next) => {
  try {
    const picked = req.files || [];
    if (!picked.length) throw new BizError('未接收到文件');
    const target = prepareUploadTarget(req);

    // 确定目标空间
    let space;
    const rawSpaceId = Number(req.body.spaceId);
    if (rawSpaceId) {
      space = db.prepare('SELECT * FROM spaces WHERE id = ?').get(rawSpaceId);
      if (!space) throw new BizError('分区不存在', 404);
      if (getSpaceRole(req.user, space) === null) throw new BizError('无权在该分区上传', 403);
    } else {
      space = ensureDefaultSpace(req.user.id);
    }

    const batchSize = picked.reduce((s, f) => s + f.size, 0);

    // 内存存储，无需清理临时文件
    // 用户配额
    const used = db
      .prepare('SELECT COALESCE(SUM(size),0) AS s FROM files WHERE created_by = ? AND deleted = 0')
      .get(req.user.id).s;
    const userQuota = req.user.role === 'admin' ? 0 : 5 * 1024 * 1024 * 1024;
    if (userQuota > 0 && used + batchSize > userQuota) {
      throw new BizError('存储空间不足，已超出个人配额');
    }
    // 空间配额
    if (space.quota > 0) {
      const spaceUsed = db
        .prepare('SELECT COALESCE(SUM(size),0) AS s FROM files WHERE space_id = ? AND deleted = 0')
        .get(space.id).s;
      if (spaceUsed + batchSize > space.quota) {
        throw new BizError('分区存储空间不足');
      }
    }


    // 每个文件对应的原始修改日期（前端以 JSON 数组传入毫秒值）
    let originDates = [];
    try {
      originDates = JSON.parse(req.body.originDates || '[]');
    } catch {
      originDates = [];
    }

    const insertStmt = db.prepare(
      `INSERT INTO files (space_id, folder_id, name, ext, mime_type, size, storage_path, created_by, origin_date, tag_str, storage_root_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const results = [];
    let successCount = 0;
    for (let i = 0; i < picked.length; i++) {
      const f = picked[i];
      try {
        const planned = planNewFileInSubdir(target.rootAbs, target.subdir, f.originalname);
        fs.writeFileSync(planned.abs, f.buffer);
        const originDate = tsToLocal(originDates[i]);
        const info = insertStmt.run(
          space.id, null, f.originalname, getExt(f.originalname), f.mimetype, f.size, planned.rel,
          req.user.id, originDate, target.tagStr, target.rootId
        );
        successCount += 1;
        results.push({
          id: info.lastInsertRowid,
          name: f.originalname,
          size: f.size,
          origin_date: originDate,
          ok: true,
        });
      } catch (e) {
        results.push({ name: f.originalname, ok: false, error: e.message });
      }
    }

    writeLog({
      userId: req.user.id, username: req.user.username, action: 'upload_batch',
      targetType: 'file', detail: `批量上传 ${successCount}/${picked.length} 个，共 ${batchSize}B`, ip: req.ip,
    });

    return success(
      res,
      { successCount, failCount: picked.length - successCount, totalSize: batchSize, files: results },
      `成功上传 ${successCount} 个压缩包`
    );
  } catch (e) {
    next(e);
  }
});

/* ---------------- 批量删除 ---------------- */

/**
 * POST /api/files/batch-delete  body: { ids: number[] }
 * 把多个文件一次性放入回收站（逐个做权限校验）
 */
router.post('/batch-delete', (req, res, next) => {
  try {
    const ids = [
      ...new Set(
        (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean)
      ),
    ];
    if (!ids.length) throw new BizError('请选择要删除的文件');

    const update = db.prepare(
      "UPDATE files SET deleted = 1, deleted_at = datetime('now','localtime') WHERE id = ? AND deleted = 0"
    );

    let successCount = 0;
    const fails = [];
    ids.forEach((id) => {
      try {
        ensureFileAccess(req, id); // 权限校验，无权会抛错
        const r = update.run(id);
        if (r.changes > 0) successCount += 1;
      } catch (e) {
        fails.push({ id, error: e.message });
      }
    });

    writeLog({
      userId: req.user.id, username: req.user.username, action: 'batch_delete',
      targetType: 'file', detail: `批量删除 ${successCount}/${ids.length} 个`, ip: req.ip,
    });

    return success(
      res,
      { successCount, failCount: fails.length, fails },
      `已将 ${successCount} 个文件放入回收站`
    );
  } catch (e) {
    next(e);
  }
});

/* ---------------- 下载 ---------------- */

/** 生成 zip 内不冲突、不含路径分隔符的安全文件名 */
function uniqueZipName(original, used) {
  const baseName = path.basename(String(original || 'file')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length) || 'file';
  let candidate = baseName;
  let i = 1;
  const keyOf = n => n.normalize('NFC').toLowerCase();
  while (used.has(keyOf(candidate))) {
    candidate = `${stem}_${i}${ext}`;
    i += 1;
  }
  used.add(keyOf(candidate));
  return candidate;
}

/**
 * POST /api/files/batch-download  body: { ids: number[] }
 * 流式打包多个文件：zip store（仅打包不压缩），平铺在根目录；同名自动加 _1/_2。
 * 用于图片/视频/已有压缩包等已压缩内容，避免无谓 CPU 开销；不落临时文件。
 */
router.post('/batch-download', (req, res, next) => {
  let archive = null;
  try {
    const ids = [...new Set(
      (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean)
    )];
    if (!ids.length) throw new BizError('请选择要下载的文件');
    if (ids.length > 1000) throw new BizError('单次最多打包 1000 个文件，请分批下载');

    const items = [];
    let totalSize = 0;
    for (const id of ids) {
      const { file } = ensureFileAccess(req, id);
      if (file.deleted) continue;
      const { abs } = resolveFileLocation(file.storage_root_id ?? null, file.storage_path);
      if (!fs.existsSync(abs)) throw new BizError(`文件已丢失：${file.name}`, 404);
      const stat = fs.statSync(abs);
      totalSize += stat.size;
      items.push({ file, abs, size: stat.size });
    }
    if (!items.length) throw new BizError('没有可下载的有效文件');
    if (totalSize > 20 * 1024 ** 3) throw new BizError('打包总大小超过 20GB，请分批下载');

    const stamp = new Date().toISOString().slice(0, 10);
    const zipName = `文件打包_${items.length}个_${stamp}.zip`;
    const encoded = encodeURIComponent(zipName);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="batch.zip"; filename*=UTF-8''${encoded}`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-File-Count', String(items.length));

    archive = archiver('zip', { store: true, forceUTC: true });
    const usedNames = new Set();
    const usedAbs = new Set();

    archive.on('warning', err => {
      if (err.code === 'ENOENT') console.warn('[batch-download]', err.message);
      else next(err);
    });
    archive.on('error', err => {
      console.error('[batch-download] archive error:', err);
      if (!res.headersSent) next(err);
      else res.destroy(err);
    });
    res.on('close', () => {
      // 用户取消下载时停止读盘/打包
      try { archive?.abort(); } catch { /* ignore */ }
    });

    for (const item of items) {
      // 同一物理文件被重复选择时只写入一次，避免 zip 重复体积
      if (usedAbs.has(item.abs)) continue;
      usedAbs.add(item.abs);
      const entryName = uniqueZipName(item.file.name, usedNames);
      archive.file(item.abs, { name: entryName, stats: undefined, date: new Date() });
    }

    writeLog({
      userId: req.user.id,
      username: req.user.username,
      action: 'batch_download',
      targetType: 'file',
      detail: `打包下载 ${items.length} 个，${(totalSize / 1024 / 1024).toFixed(1)}MB`,
      ip: req.ip,
    });

    archive.pipe(res);
    archive.finalize();
  } catch (e) {
    try { archive?.abort(); } catch { /* ignore */ }
    next(e);
  }
});

/** GET /api/files/:id/download */
router.get('/:id/download', (req, res, next) => {
  try {
    const { file } = ensureFileAccess(req, Number(req.params.id));
    const { abs } = resolveFileLocation(file.storage_root_id ?? null, file.storage_path);
    if (!fs.existsSync(abs)) throw new BizError('物理文件已丢失', 404);

    writeLog({
      userId: req.user.id, username: req.user.username, action: 'download',
      targetType: 'file', targetId: file.id, detail: file.name, ip: req.ip,
    });
    return res.download(abs, file.name);
  } catch (e) {
    next(e);
  }
});

/* ---------------- 重命名 / 移动 ---------------- */

/** PUT /api/files/:id/rename */
router.put('/:id/rename', (req, res, next) => {
  try {
    const { file } = ensureFileAccess(req, Number(req.params.id));
    const { name } = req.body;
    if (!name?.trim()) throw new BizError('文件名不能为空');

    db.prepare("UPDATE files SET name = ?, ext = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(
      name.trim(),
      getExt(name),
      file.id
    );
    return success(res, null, '重命名成功');
  } catch (e) {
    next(e);
  }
});

/** PUT /api/files/:id/move  body: { folderId } */
router.put('/:id/move', (req, res, next) => {
  try {
    const { file } = ensureFileAccess(req, Number(req.params.id));
    const folderId = req.body.folderId === 'root' || !req.body.folderId ? null : Number(req.body.folderId);

    if (folderId) {
      const target = db.prepare('SELECT * FROM folders WHERE id = ? AND space_id = ?').get(folderId, file.space_id);
      if (!target) throw new BizError('目标文件夹不存在');
    }
    db.prepare("UPDATE files SET folder_id = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(
      folderId,
      file.id
    );
    writeLog({ userId: req.user.id, username: req.user.username, action: 'move', targetType: 'file', targetId: file.id, ip: req.ip });
    return success(res, null, '移动成功');
  } catch (e) {
    next(e);
  }
});

/* ---------------- 收藏 / 标签 ---------------- */

/** PUT /api/files/:id/star  body: { starred: true|false } */
router.put('/:id/star', (req, res, next) => {
  try {
    const { file } = ensureFileAccess(req, Number(req.params.id));
    const starred = req.body.starred ? 1 : 0;
    db.prepare('UPDATE files SET is_starred = ? WHERE id = ?').run(starred, file.id);
    return success(res, { is_starred: starred }, '操作成功');
  } catch (e) {
    next(e);
  }
});

/** PUT /api/files/:id/tags  body: { tags: [{name, color}] } */
router.put('/:id/tags', (req, res, next) => {
  try {
    const { file } = ensureFileAccess(req, Number(req.params.id));
    const row = applyTagsToFile(req, file, req.body.tags || []);
    return success(res, formatFile(row), '标签已更新');
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/files/batch-tags
 * body: { ids: number[], addTags: [{name,color}], mode: 'append' | 'replace' }
 *  - append（默认）：在每个文件原标签基础上追加所选标签（去重）
 *  - replace：直接覆盖为所选标签
 */
router.post('/batch-tags', (req, res, next) => {
  try {
    const ids = [...new Set(
      (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean)
    )];
    const mode = req.body.mode === 'replace' ? 'replace' : 'append';
    const addTags = (req.body.addTags || []).filter((t) => t?.name);

    if (!ids.length) throw new BizError('请选择文件');
    if (!addTags.length) throw new BizError('请选择要添加的标签');

    let successCount = 0;
    const fails = [];
    const updatedFiles = [];

    for (const id of ids) {
      try {
        const { file } = ensureFileAccess(req, id);
        const current = parseTagStr(file.tag_str);

        let finalTags;
        if (mode === 'replace') {
          finalTags = addTags;
        } else {
          // 追加：以原标签为基础，跳过已存在的同名标签（新标签拼在后面）
          const existingNames = new Set(current.map((t) => t.name));
          finalTags = [...current];
          for (const t of addTags) {
            if (!existingNames.has(t.name)) {
              finalTags.push(t);
              existingNames.add(t.name);
            }
          }
        }

        const row = applyTagsToFile(req, file, finalTags);
        updatedFiles.push(formatFile(row));
        successCount += 1;
      } catch (e) {
        fails.push({ id, error: e.message });
      }
    }

    writeLog({
      userId: req.user.id, username: req.user.username, action: 'batch_tags',
      targetType: 'file',
      detail: `批量${mode === 'replace' ? '覆盖' : '添加'}标签 ${successCount}/${ids.length}：${addTags.map((t) => t.name).join('、')}`,
      ip: req.ip,
    });

    return success(
      res,
      { successCount, failCount: fails.length, mode, fails, files: updatedFiles },
      `已${mode === 'replace' ? '覆盖' : '添加'}标签（${successCount} 个文件）`
    );
  } catch (e) {
    next(e);
  }
});

/* ---------------- 删除 / 还原 / 彻底删除 ---------------- */

/** DELETE /api/files/:id —— 放入回收站 */
router.delete('/:id', (req, res, next) => {
  try {
    const { file } = ensureFileAccess(req, Number(req.params.id));
    if (file.deleted) throw new BizError('文件已在回收站中');
    db.prepare(
      "UPDATE files SET deleted = 1, deleted_at = datetime('now','localtime') WHERE id = ?"
    ).run(file.id);
    writeLog({ userId: req.user.id, username: req.user.username, action: 'delete', targetType: 'file', targetId: file.id, detail: file.name, ip: req.ip });
    return success(res, null, '已放入回收站');
  } catch (e) {
    next(e);
  }
});

/** POST /api/files/:id/restore */
router.post('/:id/restore', (req, res, next) => {
  try {
    const { file } = ensureFileAccess(req, Number(req.params.id));
    if (!file.deleted) throw new BizError('文件不在回收站中');

    // 若原文件夹已被删除，则还原到分区根目录
    let folderId = file.folder_id;
    if (folderId) {
      const exists = db.prepare('SELECT id FROM folders WHERE id = ?').get(folderId);
      if (!exists) folderId = null;
    }
    db.prepare('UPDATE files SET deleted = 0, deleted_at = NULL, folder_id = ? WHERE id = ?').run(folderId, file.id);
    return success(res, null, '还原成功');
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/files/:id/permanent —— 彻底删除（含物理文件） */
router.delete('/:id/permanent', (req, res, next) => {
  try {
    const { file } = ensureFileAccess(req, Number(req.params.id));
    const { abs } = resolveFileLocation(file.storage_root_id ?? null, file.storage_path);
    if (fs.existsSync(abs)) {
      try { fs.unlinkSync(abs); } catch { /* ignore */ }
    }
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
    writeLog({ userId: req.user.id, username: req.user.username, action: 'permanent_delete', targetType: 'file', targetId: file.id, detail: file.name, ip: req.ip });
    return success(res, null, '已彻底删除');
  } catch (e) {
    next(e);
  }
});

export default router;
