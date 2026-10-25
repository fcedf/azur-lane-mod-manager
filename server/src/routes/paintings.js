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

/** 支持的压缩包格式 */
const SUPPORTED_ARCHIVE = new Set(['zip', 'rar', '7z']);
function isSupportedArchive(file) {
  const ext = String(file.ext || '').toLowerCase();
  return SUPPORTED_ARCHIVE.has(ext);
}

/** 读取已缓存的 manifest */
function readManifest(cacheDir) {
  const p = path.join(cacheDir, 'manifest.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

/** 调用 Python worker 提取立绘；密码错误/需要密码时 reject(needPassword) */
function runExtractor(zipAbsPath, cacheDir, password = '') {
  return new Promise((resolve, reject) => {
    const args = [config.paintingScript, zipAbsPath, cacheDir];
    if (password) args.push(password);
    const child = spawn(config.pythonPath, args, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d.toString()));
    child.stderr.on('data', d => (stderr += d.toString()));

    child.on('error', reject);
    child.on('close', code => {
      // 取最后一行 JSON
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      try {
        const result = JSON.parse(last);
        if (result.ok) resolve(result.images);
        else if (isPasswordResult(result)) {
          const e = new Error(result.error || '压缩包已加密，需要密码');
          e.needPassword = true;
          reject(e);
        } else reject(new BizError(result.error || '提取失败'));
      } catch {
        reject(new BizError(stderr || `提取进程异常退出(${code})`));
      }
    });
  });
}

/**
 * GET /api/files/:id/paintings
 * 返回压缩包内主立绘列表（首次自动提取，带缓存）
 * query: refresh=1 强制重新提取
 */
router.get('/:id/paintings', async (req, res, next) => {
  try {
    const file = getAccessibleFile(req, Number(req.params.id));
    if (!isSupportedArchive(file)) {
      return success(res, { supported: false, images: [] });
    }

    const cacheDir = path.join(config.paintingCacheDir, String(file.id));
    fs.mkdirSync(cacheDir, { recursive: true });

    // 命中缓存
    if (req.query.refresh !== '1') {
      const cached = readManifest(cacheDir);
      if (cached) {
        return success(res, { supported: true, cached: true, images: cached.images || [] });
      }
    }

    // 物理 zip 绝对路径（按文件所属存储根解析）
    const { abs: zipAbsPath } = resolveFileLocation(file.storage_root_id ?? null, file.storage_path);
    if (!fs.existsSync(zipAbsPath)) throw new BizError('物理文件不存在', 404);

    const explicitPassword = String(req.headers['x-archive-password'] || req.query.password || '');
    const password = explicitPassword || getArchivePassword(file.id);
    const images = await runExtractor(zipAbsPath, cacheDir, password);
    if (explicitPassword) saveArchivePassword(file.id, explicitPassword);
    fs.writeFileSync(
      path.join(cacheDir, 'manifest.json'),
      JSON.stringify({ fileId: file.id, updatedAt: new Date().toISOString(), images })
    );

    return success(res, { supported: true, cached: false, images });
  } catch (e) {
    if (e?.needPassword) {
      return res.status(200).json({ code: 4001, message: e.message || '压缩包已加密，需要密码', data: { needPassword: true } });
    }
    next(e);
  }
});

/**
 * 从立绘列表中挑一张作为压缩包封面。
 * 规则（用户偏好：内容更全优先）：
 *   1) 首选 painting 主立绘（多张时取面积最大的，通常是完整立绘/龙骨 body 贴图）；
 *      注意：Live2D 皮肤的 painting 是“无脸打包贴图”，极个别会缺头部，属可接受现象。
 *   2) painting 不存在时回退 shipyardicon（官方渲染好的带脸竖图）。
 *   3) 其余 squareicon / herohrzicon / paintingface 不作为封面。
 * 返回图片项或 null。
 */
function pickCoverImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const byGroup = g => images.filter(it => it && it.groupKey === g);
  const largest = list =>
    list.reduce((a, b) => ((b.width || 0) * (b.height || 0) > (a.width || 0) * (a.height || 0) ? b : a));
  const painting = byGroup('painting');
  if (painting.length) return largest(painting);
  const shipyard = byGroup('shipyardicon');
  if (shipyard.length) return largest(shipyard);
  return null;
}

/**
 * 纯动态包封面回退：只用“渲染合成首帧”图（composed-cover.jpg）。
 * 动态缓存里的 *_thumb.jpg 是未经骨骼变形的原始贴图片（尸块），不能当封面。
 */
function pickDynamicThumb(fileId) {
  try {
    const full = path.join(config.dynamicCacheDir, fileId, 'composed-cover.jpg');
    return fs.existsSync(full) ? full : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/files/:id/cover
 * 压缩包封面缩略图（供文件列表懒加载）。
 * 复用立绘缓存；无缓存时自动提取一次。非压缩包 / 无立绘返回 204。
 * 支持 ?access_token= 供 <img> 使用。
 */
router.get('/:id/cover', async (req, res, next) => {
  try {
    const file = getAccessibleFile(req, Number(req.params.id));
    if (!isSupportedArchive(file)) return res.status(204).end();

    const cacheDir = path.join(config.paintingCacheDir, String(file.id));
    fs.mkdirSync(cacheDir, { recursive: true });

    let manifest = readManifest(cacheDir);
    if (!manifest) {
      const { abs: zipAbsPath } = resolveFileLocation(file.storage_root_id ?? null, file.storage_path);
      if (!fs.existsSync(zipAbsPath)) throw new BizError('物理文件不存在', 404);
      // 封面是 <img>，无法弹密码框：只用“已记住”的密码；未记住则返回 204，
      // 用户在动态/立绘弹窗输入密码成功后，封面会随缓存生成自动出现。
      const remembered = getArchivePassword(file.id);
      try {
        const images = await runExtractor(zipAbsPath, cacheDir, remembered);
        manifest = { fileId: file.id, updatedAt: new Date().toISOString(), images };
        fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify(manifest));
      } catch (e) {
        if (e?.needPassword) return res.status(204).end();
        throw e;
      }
    }

    let cover = pickCoverImage(manifest.images);
    let thumbPath = cover && cover.thumb ? path.join(cacheDir, cover.thumb) : null;

    // 回退：包内没有静态五类资源（纯动态包，如安土）时，用动态提取缓存的缩略图。
    if (!thumbPath || !fs.existsSync(thumbPath)) {
      const dynFallback = pickDynamicThumb(String(file.id));
      if (dynFallback) return res.sendFile(dynFallback);
      return res.status(204).end();
    }

    // 不显式设长缓存：res.sendFile 默认带 ETag/Last-Modified，
    // 文件未变走 304（本地几乎零开销），重新提取后 mtime 变化会自动下发新图，
    // 避免浏览器一直用旧的黑底封面缓存。
    res.sendFile(thumbPath);
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/files/:id/paintings/image/:key
 * 提供缓存图片；?thumb=1 返回缩略图
 */
router.get('/:id/paintings/image/:key', (req, res, next) => {
  try {
    const file = getAccessibleFile(req, Number(req.params.id));
    const key = path.basename(req.params.key);
    const cacheDir = path.join(config.paintingCacheDir, String(file.id));

    const fileName = req.query.thumb === '1' ? `${key}_thumb.jpg` : `${key}.png`;
    const filePath = path.join(cacheDir, fileName);

    if (!fs.existsSync(filePath)) throw new BizError('图片不存在或已清理', 404);
    res.sendFile(filePath);
  } catch (e) {
    next(e);
  }
});

export default router;
