import { Router } from 'express';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import db from '../db/index.js';
import config from '../config/index.js';
import { resolveFileLocation } from '../utils/storage-roots.js';
import { success, BizError } from '../utils/response.js';
import { accessibleSpaceIds } from '../utils/spaces.js';
import { getArchivePassword, saveArchivePassword, isPasswordResult } from '../utils/archive-password.js';

const router = Router();

/** 取出可访问的文件记录 */
function getAccessibleFile(req, id) {
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND deleted = 0').get(id);
  if (!file) throw new BizError('文件不存在', 404);
  const spaceIds = accessibleSpaceIds(req.user);
  if (!spaceIds.includes(file.space_id)) throw new BizError('无权访问该文件', 403);
  return file;
}

const SUPPORTED_ARCHIVE = new Set(['zip', 'rar', '7z']);
function isSupportedArchive(file) {
  return SUPPORTED_ARCHIVE.has(String(file.ext || '').toLowerCase());
}

// 裸 UnityFS bundle（无扩展名或非压缩包扩展名）也允许走动态提取：读文件头判定
function sniffUnityFS(absPath) {
  try {
    const fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(7);
    fs.readSync(fd, buf, 0, 7, 0);
    fs.closeSync(fd);
    return buf.equals(Buffer.from('UnityFS'));
  } catch {
    return false;
  }
}
function canProcessDynamic(file, absPath) {
  return isSupportedArchive(file) || sniffUnityFS(absPath);
}

function readManifest(cacheDir) {
  const p = path.join(cacheDir, 'dynamic.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 调用 Python worker 提取动态立绘。
 * @param password 显式传入的压缩包密码；不传则用已记住的密码。
 * @returns 成功 resolve(result)；若压缩包需要/密码错误则 reject(带 needPassword 的 Error)。
 */
function runExtractor(zipAbsPath, cacheDir, password = '') {
  return new Promise((resolve, reject) => {
    const args = [config.dynamicScript, zipAbsPath, cacheDir];
    if (password) args.push(password);
    const child = spawn(config.pythonPath, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d.toString()));
    child.stderr.on('data', d => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', code => {
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      try {
        const result = JSON.parse(last);
        if (result.ok) resolve(result);
        else if (isPasswordResult(result)) {
          const e = new Error(result.error || '压缩包已加密，需要密码');
          e.needPassword = true;
          reject(e);
        } else reject(new BizError(result.error || '动态资源提取失败'));
      } catch {
        reject(new BizError(stderr || `提取进程异常退出(${code})`));
      }
    });
  });
}

/**
 * 确保已提取，返回 manifest（带缓存）。
 * @param explicitPassword 用户本次输入的密码（验证成功会记住）。
 */
async function ensureDynamic(file, absPath, refresh = false, explicitPassword = '') {
  const cacheDir = path.join(config.dynamicCacheDir, String(file.id));
  fs.mkdirSync(cacheDir, { recursive: true });
  if (!refresh && !explicitPassword) {
    const cached = readManifest(cacheDir);
    if (cached) return cached;
  }
  const password = explicitPassword || getArchivePassword(file.id);
  const result = await runExtractor(absPath, cacheDir, password);
  // 提取成功：若本次用了显式密码（可能是新输入或与已存一致），记住它
  if (explicitPassword) saveArchivePassword(file.id, explicitPassword);
  const manifest = {
    fileId: file.id,
    updatedAt: new Date().toISOString(),
    items: result.items || [],
    encrypted: result.encrypted || [],
  };
  fs.writeFileSync(path.join(cacheDir, 'dynamic.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}

/**
 * GET /api/files/:id/dynamic
 * 返回该压缩包内可预览的动态立绘清单（spine/live2d）
 * encrypted 列表里是“检测到但暂不支持预览”的加密 bundle
 */
router.get('/:id/dynamic', async (req, res, next) => {
  try {
    const file = getAccessibleFile(req, Number(req.params.id));
    const { abs: absPath } = resolveFileLocation(file.storage_root_id ?? null, file.storage_path);
    if (!fs.existsSync(absPath)) throw new BizError('物理文件不存在', 404);
    if (!canProcessDynamic(file, absPath)) {
      return success(res, { supported: false, items: [], encrypted: [] });
    }
    // 优先用请求头传密码（不进 URL / 访问日志），兼容 query
    const explicitPassword = String(req.headers['x-archive-password'] || req.query.password || '');
    const manifest = await ensureDynamic(file, absPath, req.query.refresh === '1', explicitPassword);
    return success(res, {
      supported: true,
      cached: readManifest(path.join(config.dynamicCacheDir, String(file.id))) !== null && req.query.refresh !== '1',
      items: manifest.items,
      encrypted: manifest.encrypted,
    });
  } catch (e) {
    if (e?.needPassword) {
      // 401 风格业务码，前端据此弹密码框
      return res.status(200).json({ code: 4001, message: e.message || '压缩包已加密，需要密码', data: { needPassword: true } });
    }
    next(e);
  }
});

/**
 * GET /api/files/:id/dynamic/asset
 * 分发动态资源文件：?name=<缓存内文件名>
 * 支持 ?access_token=（fetch / <img> 都能用）
 */
router.get('/:id/dynamic/asset', (req, res, next) => {
  try {
    const file = getAccessibleFile(req, Number(req.params.id));
    const name = path.basename(String(req.query.name || ''));
    if (!name) throw new BizError('缺少 name 参数', 400);
    // 防止路径穿越：只允许文件名，不含目录/分隔符
    if (name !== req.query.name || name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new BizError('非法文件名', 400);
    }
    const cacheDir = path.join(config.dynamicCacheDir, String(file.id));
    const filePath = path.join(cacheDir, name);
    if (!fs.existsSync(filePath)) throw new BizError('动态资源不存在或尚未提取', 404);
    res.sendFile(filePath);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/files/:id/dynamic/composed-cover
 * 前端打开动态预览、立绘渲染稳定后，截一张“白底仅人物”首帧上报为列表封面。
 * body: { dataUrl }（data:image/jpeg;base64,....）。仅接受 jpeg/png，限制大小。
 */
router.post('/:id/dynamic/composed-cover', (req, res, next) => {
  try {
    const file = getAccessibleFile(req, Number(req.params.id));

    // 若已有“静态立绘封面”（五类资源），优先静态图，不写动态合成图。
    try {
      const pdir = path.join(config.paintingCacheDir, String(file.id));
      const mf = path.join(pdir, 'manifest.json');
      if (fs.existsSync(mf)) {
        const images = JSON.parse(fs.readFileSync(mf, 'utf-8')).images;
        const hasStatic = Array.isArray(images) && images.some(
          im => im && im.groupKey !== 'dynamic' && im.thumb &&
            fs.existsSync(path.join(pdir, path.basename(im.thumb)))
        );
        if (hasStatic) return success(res, { ok: true, skipped: true, reason: 'static-cover-exists' });
      }
    } catch { /* 检测失败不阻塞 */ }

    const dataUrl = String(req.body?.dataUrl || '');
    const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
    if (!m) throw new BizError('封面数据格式不正确', 400);
    let buf;
    try {
      buf = Buffer.from(m[2], 'base64');
    } catch {
      throw new BizError('封面解码失败', 400);
    }
    if (buf.length < 256 || buf.length > 8 * 1024 * 1024) {
      throw new BizError('封面大小超出允许范围', 400);
    }
    const cacheDir = path.join(config.dynamicCacheDir, String(file.id));
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'composed-cover.jpg'), buf);
    success(res, { ok: true, size: buf.length });
    // eslint-disable-next-line no-console
    console.log(`[composed-cover] file=${file.id} saved ${buf.length}B`);
  } catch (e) {
    next(e);
  }
});

export default router;
