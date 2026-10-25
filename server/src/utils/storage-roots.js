/**
 * 多存储根目录管理
 *
 * - 系统默认根：config.uploadDir（.env UPLOAD_DIR，如 D:/fms-files），id 概念上为 0/NULL。
 * - 用户可在设置里选盘符，系统自建 fms 目录（如 E:/fms-files），写入 storage_roots。
 * - 每个文件记录 storage_root_id；NULL/0 = 默认根。读取时按归属根定位，互不串扰。
 * - “当前根”只影响新上传写入位置；历史文件仍按各自归属根读取。
 */
import path from 'node:path';
import fs from 'node:fs';
import db from '../db/index.js';
import config from '../config/index.js';

const FMS_DIRNAME = 'fms-files';

// 运行时幂等迁移（本项目不依赖 init.js 启动，各模块自建表/字段）
(function migrateStorage() {
  const cols = db.prepare('PRAGMA table_info(files)').all().map((c) => c.name);
  if (!cols.includes('storage_root_id')) {
    db.exec('ALTER TABLE files ADD COLUMN storage_root_id INTEGER');
    console.log('✅ 已添加字段 files.storage_root_id（多存储根支持）');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS storage_roots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    path       TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL DEFAULT '',
    is_current INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );`);
})();

/** 默认根（.env / config），永远可用、不可删除 */
export function defaultRootPath() {
  return config.uploadDir;
}

/** 规范化：统一为正斜杠绝对路径，去掉末尾分隔符，便于比较/去重 */
export function normalizeRoot(p) {
  if (!p || typeof p !== 'string') return '';
  let s = path.resolve(p).replace(/[\\/]+$/, '');
  return s.replace(/\\/g, '/');
}

/** 列出全部存储根：默认根（id=0）+ 数据库自定义根 */
export function listRoots() {
  const defaults = {
    id: 0,
    path: normalizeRoot(defaultRootPath()),
    label: '默认存储',
    isCurrent: true,
    isDefault: true,
    writable: false,
    exists: false,
    fileCount: 0,
  };
  function probeDir(p) {
    let exists = false, writable = false;
    try {
      exists = fs.existsSync(p) && fs.statSync(p).isDirectory();
      if (exists) {
        const probe = path.join(p, '.wprobe');
        fs.writeFileSync(probe, '1');
        fs.unlinkSync(probe);
        writable = true;
      }
    } catch {
      writable = false;
    }
    return { exists, writable };
  }
  Object.assign(defaults, probeDir(normalizeRoot(defaultRootPath())));
  defaults.fileCount = db
    .prepare('SELECT COUNT(*) AS c FROM files WHERE (storage_root_id IS NULL OR storage_root_id = 0) AND deleted = 0')
    .get().c;

  const customs = db.prepare('SELECT * FROM storage_roots ORDER BY id ASC').all();

  const currentCustomId = currentRootId();
  // 若没有任何自定义根被标记为当前，则当前根是默认根
  defaults.isCurrent = currentCustomId == null;

  const list = [defaults];
  for (const r of customs) {
    const p = normalizeRoot(r.path);
    const { exists, writable } = probeDir(p);
    const fileCount = db
      .prepare('SELECT COUNT(*) AS c FROM files WHERE storage_root_id = ? AND deleted = 0')
      .get(r.id).c;
    list.push({
      id: r.id,
      path: p,
      label: r.label || '',
      isCurrent: r.id === currentCustomId,
      isDefault: false,
      writable,
      exists,
      fileCount,
    });
  }
  return list;
}

/** 当前写入根的数据库 id：null/undefined 表示默认根 */
export function currentRootId() {
  const row = db.prepare('SELECT id FROM storage_roots WHERE is_current = 1 ORDER BY id DESC LIMIT 1').get();
  return row ? row.id : null;
}

/** 当前写入根绝对路径 */
export function currentRootPath() {
  const id = currentRootId();
  if (id == null) return normalizeRoot(defaultRootPath());
  const r = db.prepare('SELECT path FROM storage_roots WHERE id = ?').get(id);
  return r ? normalizeRoot(r.path) : normalizeRoot(defaultRootPath());
}

/** 按 id 取根路径；id 为 null/0/undefined → 默认根 */
export function rootPathById(id) {
  if (id == null || Number(id) === 0) return normalizeRoot(defaultRootPath());
  const r = db.prepare('SELECT path FROM storage_roots WHERE id = ?').get(Number(id));
  return r ? normalizeRoot(r.path) : normalizeRoot(defaultRootPath());
}

/**
 * 给定盘符（如 E: / E:\ / E:/），在其下自建 fms-files 目录并登记。
 * 返回新根记录。若同路径已存在则复用。
 */
export function addRootFromDrive(driveInput, label = '') {
  const raw = String(driveInput || '').trim();
  if (!/^[a-zA-Z]:[\\/]?$/.test(raw)) {
    throw new Error('请选择有效的盘符，例如 E: 或 E:\\');
  }
  const drive = raw.slice(0, 2).toUpperCase(); // 如 E:
  if (!fs.existsSync(drive + '/')) {
    throw new Error(`盘符 ${drive} 不存在或不可用`);
  }
  const target = normalizeRoot(path.join(drive + '/', FMS_DIRNAME));
  fs.mkdirSync(target, { recursive: true });
  // 验证可写
  const probe = path.join(target, '.wprobe');
  fs.writeFileSync(probe, '1');
  fs.unlinkSync(probe);

  const exist = db.prepare('SELECT * FROM storage_roots WHERE path = ?').get(target);
  if (exist) {
    if (label) db.prepare('UPDATE storage_roots SET label = ? WHERE id = ?').run(label, exist.id);
    return db.prepare('SELECT * FROM storage_roots WHERE id = ?').get(exist.id);
  }
  const info = db
    .prepare('INSERT INTO storage_roots (path, label, is_current) VALUES (?, ?, 0)')
    .run(target, label || '');
  return db.prepare('SELECT * FROM storage_roots WHERE id = ?').get(info.lastInsertRowid);
}

/** 直接登记一个已存在的绝对目录作为根（高级用法，当前仅按盘符自建，保留扩展） */
export function addRootPath(absPath, label = '') {
  const target = normalizeRoot(absPath);
  fs.mkdirSync(target, { recursive: true });
  const exist = db.prepare('SELECT * FROM storage_roots WHERE path = ?').get(target);
  if (exist) return exist;
  const info = db
    .prepare('INSERT INTO storage_roots (path, label, is_current) VALUES (?, ?, 0)')
    .run(target, label || '');
  return db.prepare('SELECT * FROM storage_roots WHERE id = ?').get(info.lastInsertRowid);
}

/** 设置当前写入根；id=0/null 表示默认根 */
export function setCurrentRoot(id) {
  if (id == null || Number(id) === 0) {
    db.prepare('UPDATE storage_roots SET is_current = 0').run();
    return null;
  }
  const r = db.prepare('SELECT * FROM storage_roots WHERE id = ?').get(Number(id));
  if (!r) throw new Error('存储目录不存在');
  const p = normalizeRoot(r.path);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  db.prepare('UPDATE storage_roots SET is_current = 0').run();
  db.prepare('UPDATE storage_roots SET is_current = 1 WHERE id = ?').run(r.id);
  return r.id;
}

/** 删除自定义根（仅允许无文件、非当前的根；默认根不可删）*/
export function removeRoot(id) {
  const rid = Number(id);
  if (!rid) throw new Error('默认存储不可删除');
  const r = db.prepare('SELECT * FROM storage_roots WHERE id = ?').get(rid);
  if (!r) throw new Error('存储目录不存在');
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM files WHERE storage_root_id = ? AND deleted = 0').get(rid).c;
  if (cnt > 0) throw new Error(`该目录下还有 ${cnt} 个文件，不能删除`);
  if (r.is_current) throw new Error('当前正在使用的存储目录不能删除，请先切换');
  db.prepare('DELETE FROM storage_roots WHERE id = ?').run(rid);
  return true;
}

/**
 * 解析文件实际绝对路径：优先按归属根，找不到再在所有根里按相对路径兜底（换盘/迁移容错）。
 * @param {number|null} rootId files.storage_root_id
 * @param {string} relPath files.storage_path（相对根的正斜杠路径）
 * @returns {{abs:string, rootId:number|null, rootPath:string}}
 */
export function resolveFileLocation(rootId, relPath) {
  const rel = String(relPath || '').replace(/^[\\/]+/, '').replace(/\\/g, '/');
  const primary = rootPathById(rootId);
  const absPrimary = path.join(primary, rel);
  if (fs.existsSync(absPrimary)) {
    return { abs: absPrimary, rootId: rootId == null || Number(rootId) === 0 ? null : Number(rootId), rootPath: primary };
  }
  // 兜底：遍历全部根
  for (const root of listRoots()) {
    if (root.path === primary) continue;
    const cand = path.join(root.path, rel);
    if (fs.existsSync(cand)) {
      return { abs: cand, rootId: root.isDefault ? null : root.id, rootPath: root.path };
    }
  }
  // 都找不到，仍返回主路径（调用方按不存在处理/报错）
  return { abs: absPrimary, rootId: rootId == null || Number(rootId) === 0 ? null : Number(rootId), rootPath: primary };
}

/** 列举某根下的相对子目录树（相对该根，正斜杠）。用于上传时选择目标子目录。 */
export function listSubdirs(rootId = null) {
  const base = rootId == null ? currentRootPath() : rootPathById(rootId);
  const out = [];
  if (!fs.existsSync(base)) return out;
  const walk = (dir, depth) => {
    if (depth > 8) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // 跳过系统/缓存目录
    const skip = new Set([
      'painting-cache', 'dynamic-cache', 'mod-backup', 'fms.db',
      '$RECYCLE.BIN', 'System Volume Information',
    ]);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (skip.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(base, full).replace(/\\/g, '/');
      out.push(rel);
      walk(full, depth + 1);
    }
  };
  walk(base, 0);
  return out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}
