/**
 * Mod 管理器（安全版）
 *
 * 铁律：只操作 AssetBundle 文件，任何情况下都【不读取 / 不 push / 不改写 / 不删除】
 *       设备上的 hashes*.csv。
 *
 * 流程：原样解压 → 备份设备现存原 AssetBundle → push mod 文件 → MD5 校验；支持还原 / 重新应用
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/index.js';
import config from '../config/index.js';
import {
  gameAssets,
  adbPush,
  adbPull,
  adbShell,
  deviceExists,
  deviceMd5,
} from './mod-adb.js';
import { getArchivePassword, saveArchivePassword } from './archive-password.js';
import { resolveFileLocation } from './storage-roots.js';

// ---- 建表 ----
db.exec(`
CREATE TABLE IF NOT EXISTS file_mods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  files_json TEXT NOT NULL DEFAULT '[]',
  applied_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

function nowLocal() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function shQuote(p) {
  return `'${String(p).replace(/'/g, "'\\''")}'`;
}

/**
 * 调 Python 原样解压，返回 {sources:[], files:[{rel,file,size,md5,source}]}
 * @param {string} onlySource 可选：只导出指定来源（多版本嵌套包二选一）
 */
function runStage(archiveAbs, stageDir, onlySource = null, password = null) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    if (onlySource != null) env.MOD_SOURCE = onlySource;
    if (password) env.ARCHIVE_PASSWORD = password;
    const child = spawn(config.pythonPath, [config.modScript, archiveAbs, stageDir], {
      windowsHide: true,
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d.toString('utf-8')));
    child.stderr.on('data', d => (stderr += d.toString('utf-8')));
    child.on('error', reject);
    child.on('close', code => {
      const line = stdout.trim().split('\n').pop() || '';
      let body;
      try {
        body = JSON.parse(line);
      } catch (e) {
        return reject(new Error('mod 解压响应解析失败: ' + (stderr || line)));
      }
      if (code !== 0 || !body.ok) {
        if (body.code === 'ARCHIVE_PASSWORD_REQUIRED' || body.needPassword) {
          const err = new Error(body.error || '压缩包已加密，需要密码');
          err.code = 'ARCHIVE_PASSWORD_REQUIRED';
          err.needPassword = true;
          return reject(err);
        }
        return reject(new Error(body.error || 'mod 解压失败'));
      }
      resolve({ sources: body.sources || [], files: body.files || [] });
    });
  });
}

/**
 * 调 Python 把 mod 按设备 AssetBundles 相对路径打成一个 zip（供手机端下载 / MT 管理器粘贴）。
 * @param {string} zipAbsPath 输出 zip 绝对路径
 * @param {string|null} onlySource 多版本时指定来源
 * 返回 {sources, files}
 */
function runZipExport(archiveAbs, zipAbsPath, onlySource = null, password = null) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
    if (onlySource != null) env.MOD_SOURCE = onlySource;
    if (password) env.ARCHIVE_PASSWORD = password;
    const child = spawn(config.pythonPath, [config.modScript, archiveAbs, zipAbsPath], {
      windowsHide: true,
      env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d.toString('utf-8')));
    child.stderr.on('data', d => (stderr += d.toString('utf-8')));
    child.on('error', reject);
    child.on('close', code => {
      const line = stdout.trim().split('\n').pop() || '';
      let body;
      try {
        body = JSON.parse(line);
      } catch (e) {
        return reject(new Error('mod zip 导出响应解析失败: ' + (stderr || line)));
      }
      if (code !== 0 || !body.ok) {
        if (body.code === 'ARCHIVE_PASSWORD_REQUIRED' || body.needPassword) {
          const err = new Error(body.error || '压缩包已加密，需要密码');
          err.code = 'ARCHIVE_PASSWORD_REQUIRED';
          err.needPassword = true;
          return reject(err);
        }
        return reject(new Error(body.error || 'mod zip 导出失败'));
      }
      resolve({ sources: body.sources || [], files: body.files || [] });
    });
  });
}

/** 取本次使用的密码：优先调用方传入，其次已记住的密码 */
function resolvePassword(fileId, provided) {
  if (typeof provided === 'string' && provided) return provided;
  return getArchivePassword(fileId) || null;
}

/** 解压成功后记住密码（幂等）*/
function rememberPassword(fileId, password) {
  if (password) {
    try { saveArchivePassword(fileId, password); } catch { /* 记忆失败不影响注入 */ }
  }
}

/**
 * 为真机 SAF 注入准备文件：解压到稳定目录 export/stage_<id>，返回文件清单。
 * 手机端据此逐文件下载（不依赖手机解 zip）。
 * @param {{source?:string,password?:string}} opts
 * @returns {Promise<{dir:string, files:Array<{rel,file,size,md5,source}>, source:string}>}
 * 多版本未指定来源时抛 MULTI_SOURCE（同 apply）。
 */
export async function preparePhoneFiles(file, opts = {}) {
  const { abs: archiveAbs } = resolveFileLocation(file.storage_root_id ?? null, file.storage_path);
  if (!fs.existsSync(archiveAbs)) throw new Error('mod 源文件不存在: ' + archiveAbs);

  const dir = path.join(config.modBackupDir, 'export', `stage_${file.id}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const password = resolvePassword(file.id, opts.password);
  const probe = await runStage(archiveAbs, dir, null, password);
  const sources = [...new Set((probe.files || []).map(f => f.source || ''))];
  if (sources.length > 1) {
    const want = opts.source ?? null;
    if (want == null || !sources.includes(want)) {
      fs.rmSync(dir, { recursive: true, force: true });
      const err = new Error('该压缩包含多个版本，请选择一个来源');
      err.code = 'MULTI_SOURCE';
      err.sources = sources;
      throw err;
    }
    const files = probe.files.filter(f => (f.source || '') === want);
    writePhoneMap(dir, files);
    rememberPassword(file.id, password);
    return { dir, files, source: want };
  }
  writePhoneMap(dir, probe.files);
  rememberPassword(file.id, password);
  return { dir, files: probe.files, source: '' };
}

/** 落 rel -> 暂存文件名 映射，供单文件下载定位 */
function writePhoneMap(dir, files) {
  const map = {};
  for (const f of files) map[f.rel.replace(/\\/g, '/').replace(/^\/+/, '')] = f.file;
  fs.writeFileSync(path.join(dir, '_map.json'), JSON.stringify(map), 'utf-8');
}

/** 取已准备好的真机文件所在目录（若存在）*/
export function phoneStageDir(fileId) {
  const dir = path.join(config.modBackupDir, 'export', `stage_${fileId}`);
  return fs.existsSync(dir) ? dir : null;
}

/** 按设备相对路径读取已准备好的真机文件绝对路径；不存在返回 null */
export function resolvePhoneFile(fileId, rel) {
  const dir = phoneStageDir(fileId);
  if (!dir) return null;
  const mapPath = path.join(dir, '_map.json');
  if (!fs.existsSync(mapPath)) return null;
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
  const key = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  const unique = map[key];
  if (!unique) return null;
  const abs = path.join(dir, unique);
  if (!abs.startsWith(dir) || !fs.existsSync(abs)) return null;
  return abs;
}

/** 探测压缩包：是否含多个来源版本（嵌套包）。不注入，仅解压扫描。*/
export async function inspectMod(file, opts = {}) {
  const { abs: archiveAbs } = resolveFileLocation(file.storage_root_id ?? null, file.storage_path);
  if (!fs.existsSync(archiveAbs)) throw new Error('mod 源文件不存在: ' + archiveAbs);
  const stageDir = path.join(config.modBackupDir, 'stage', `inspect_${file.id}`);
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  const password = resolvePassword(file.id, opts.password);
  try {
    const { sources, files } = await runStage(archiveAbs, stageDir, null, password);
    rememberPassword(file.id, password);
    return { sources: sources.map(s => s || ''), fileCount: files.length };
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

/**
 * 应用（首次 / 热更后重新应用，同一逻辑）
 * @param {{id:number, storage_path:string}} file
 * @param {{source?:string, defaultSource?:boolean, password?:string}} opts
 *   source 显式指定多版本来源；defaultSource=true 时多版本包自动取第一个来源（用于批量）
 *   password 压缩包密码（加密 zip）
 */
export async function applyMod(file, opts = {}) {
  const { abs: archiveAbs } = resolveFileLocation(file.storage_root_id ?? null, file.storage_path);
  if (!fs.existsSync(archiveAbs)) throw new Error('mod 源文件不存在: ' + archiveAbs);

  const password = resolvePassword(file.id, opts.password);
  const stageDir = path.join(config.modBackupDir, 'stage', String(file.id));
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  // 多版本检测：先解压看来源，多于一个且未指定 → 报错让前端选择
  const probe = await runStage(archiveAbs, stageDir, null, password);
  const sources = [...new Set((probe.files || []).map(f => f.source || ''))];
  let files;
  let sourceUsed = '';
  if (sources.length > 1) {
    let want = opts.source ?? null;
    if ((want == null || !sources.includes(want)) && opts.defaultSource) {
      want = sources[0]; // 批量注入：默认选第一个版本
    }
    if (want == null || !sources.includes(want)) {
      fs.rmSync(stageDir, { recursive: true, force: true });
      const err = new Error('该压缩包含多个版本，请选择一个来源');
      err.code = 'MULTI_SOURCE';
      err.sources = sources;
      throw err;
    }
    // probe 已解压全部版本，直接按来源过滤（每个版本暂存文件名唯一）
    files = probe.files.filter(f => (f.source || '') === want);
    sourceUsed = want;
  } else {
    files = probe.files;
  }

  if (!files.length) {
    throw new Error('压缩包内没有可注入的文件（painting/paintingface/herohrzicon/shipyardicon/squareicon/spinepainting）');
  }

  // 解压成功，记住密码
  rememberPassword(file.id, password);

  const backupRoot = path.join(config.modBackupDir, String(file.id));
  fs.mkdirSync(backupRoot, { recursive: true });

  for (const f of files) {
    const devPath = `${gameAssets()}/${f.rel}`;
    const fileBak = path.join(backupRoot, 'files', f.rel);

    // 1) 备份设备上现存的原 AssetBundle（仅当本地还没备份过，保留最初官方版）
    if (!fs.existsSync(fileBak) && (await deviceExists(devPath))) {
      fs.mkdirSync(path.dirname(fileBak), { recursive: true });
      await adbPull(devPath, fileBak);
    }

    // 2) 确保设备目录存在并 push mod 文件（暂存内文件名为 f.file）
    await adbShell(`mkdir -p ${shQuote(path.posix.dirname(devPath))}`);
    await adbPush(path.join(stageDir, f.file), devPath);

    // 3) 校验设备 MD5，防止传输损坏
    const got = await deviceMd5(devPath);
    if (got && got !== f.md5.toLowerCase()) {
      throw new Error(`文件校验不一致: ${f.rel}`);
    }
  }

  // 写状态（files 仅存设备路径/MD5，不存暂存文件名）
  const stateFiles = files.map(f => ({ rel: f.rel, size: f.size, md5: f.md5, source: f.source || '' }));
  const existing = db.prepare('SELECT id FROM file_mods WHERE file_id=?').get(file.id);
  if (existing) {
    db.prepare("UPDATE file_mods SET enabled=1, files_json=?, applied_at=?, updated_at=datetime('now','localtime') WHERE file_id=?")
      .run(JSON.stringify(stateFiles), nowLocal(), file.id);
  } else {
    db.prepare("INSERT INTO file_mods (file_id, enabled, files_json, applied_at) VALUES (?,?,?,?)")
      .run(file.id, 1, JSON.stringify(stateFiles), nowLocal());
  }

  fs.rmSync(stageDir, { recursive: true, force: true });
  return { fileId: file.id, count: files.length, source: sourceUsed, files: stateFiles };
}

/**
 * 还原：用备份的官方 AssetBundle 覆盖回去；无备份则删除 mod 文件（游戏热更会自动补回）
 * 全程不碰清单。
 */
export async function revertMod(file) {
  const backupRoot = path.join(config.modBackupDir, String(file.id));
  const rec = getModState(file.id);
  const files = rec ? JSON.parse(rec.files_json) : [];
  if (!fs.existsSync(backupRoot) && !files.length) {
    throw new Error('没有该 mod 的记录或备份，无法还原');
  }

  for (const f of files) {
    const devPath = `${gameAssets()}/${f.rel}`;
    const fileBak = path.join(backupRoot, 'files', f.rel);
    if (fs.existsSync(fileBak)) {
      await adbPush(fileBak, devPath);
    } else {
      // 无官方原版备份：删除 mod 文件，让游戏在检查更新时自动补回官方版
      await adbShell(`rm -f ${shQuote(devPath)}`);
    }
  }

  db.prepare("UPDATE file_mods SET enabled=0, updated_at=datetime('now','localtime') WHERE file_id=?").run(file.id);
  return { fileId: file.id };
}

export function getModState(fileId) {
  return db.prepare('SELECT * FROM file_mods WHERE file_id=?').get(fileId) || null;
}

export function listModStates() {
  return db.prepare('SELECT * FROM file_mods ORDER BY updated_at DESC').all();
}

/**
 * 导出“设备目录结构”的 mod zip（手机端下载后用 MT 管理器解压到 AssetBundles）。
 * @returns {Promise<{zipPath:string, files:Array, source:string}>}
 * 多版本包未指定 source 时抛 code=MULTI_SOURCE（带 sources），由路由返回 409。
 */
export async function exportModZip(file, opts = {}) {
  const { abs: archiveAbs } = resolveFileLocation(file.storage_root_id ?? null, file.storage_path);
  if (!fs.existsSync(archiveAbs)) throw new Error('mod 源文件不存在: ' + archiveAbs);

  const exportDir = path.join(config.modBackupDir, 'export');
  fs.mkdirSync(exportDir, { recursive: true });
  const password = resolvePassword(file.id, opts.password);

  // 先不指定来源导一次，只为探测 sources（多版本时该 zip 会被丢弃重来）
  const probeZip = path.join(exportDir, `_probe_${file.id}.zip`);
  fs.rmSync(probeZip, { force: true });
  const probe = await runZipExport(archiveAbs, probeZip, null, password);
  const sources = [...new Set((probe.files || []).map(f => f.source || ''))];

  let source = '';
  if (sources.length > 1) {
    const want = opts.source ?? null;
    fs.rmSync(probeZip, { force: true });
    if (want == null || !sources.includes(want)) {
      const err = new Error('该压缩包含多个版本，请选择一个来源');
      err.code = 'MULTI_SOURCE';
      err.sources = sources;
      throw err;
    }
    source = want;
    const zipPath = path.join(exportDir, `file_${file.id}.zip`);
    fs.rmSync(zipPath, { force: true });
    const r = await runZipExport(archiveAbs, zipPath, want, password);
    rememberPassword(file.id, password);
    return { zipPath, files: r.files, source };
  }

  // 单版本：把探测包改名为正式包
  const zipPath = path.join(exportDir, `file_${file.id}.zip`);
  fs.rmSync(zipPath, { force: true });
  fs.renameSync(probeZip, zipPath);
  rememberPassword(file.id, password);
  return { zipPath, files: probe.files, source };
}
