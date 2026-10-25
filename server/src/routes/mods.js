import { Router } from 'express';
import fs from 'node:fs';
import db from '../db/index.js';
import { success, BizError } from '../utils/response.js';
import { authRequired } from '../middleware/auth.js';
import { writeLog } from '../utils/logger.js';
import { applyMod, revertMod, getModState, exportModZip, preparePhoneFiles, resolvePhoneFile } from '../utils/mod-manager.js';
import path from 'node:path';
import { setSetting, getAllSettings, GAME_PACKAGES } from '../utils/mod-settings.js';
import {
  checkAdb,
  listDevices,
  gamePackage,
  gameFiles,
  gameAssets,
  gameInstalled,
  deviceExists,
  getAdbPath,
} from '../utils/mod-adb.js';

const router = Router();

/** 取文件记录，不存在则抛错 */
function needFile(id) {
  const file = db.prepare('SELECT * FROM files WHERE id=? AND deleted=0').get(id);
  if (!file) throw new BizError('文件不存在', 404);
  return file;
}

/** 从请求头/query 取压缩包密码（优先头，避免出现在 URL/日志）*/
function reqPassword(req) {
  return String(req.headers['x-archive-password'] || req.query.password || '') || null;
}

/** 把压缩包密码错误统一转成业务码 4001，交前端弹密码框 */
function sendPasswordRequired(res, e) {
  return res.status(200).json({
    code: 4001,
    message: e?.message || '压缩包已加密，需要密码',
    data: { needPassword: true },
  });
}

/**
 * 注入环境自检：adb / 设备 / 游戏渠道 / 资源目录
 * GET /api/mod/diagnose
 */
router.get('/mod/diagnose', authRequired, async (req, res, next) => {
  try {
    const adb = checkAdb();
    const devices = listDevices();
    const online = devices.filter(d => d.state === 'device');
    const serial = online.length === 1
      ? online[0].serial
      : (online.find(d => d.serial === 'emulator-5554')?.serial || online[0]?.serial || '');

    let installed = false;
    let filesDirExists = false;
    let assetsDirExists = false;
    if (adb.ok && serial) {
      [installed, filesDirExists, assetsDirExists] = await Promise.all([
        gameInstalled(),
        deviceExists(gameFiles()),
        deviceExists(gameAssets()),
      ]);
    }

    const ready = adb.ok && !!serial && installed && assetsDirExists;
    const problems = [];
    if (!adb.ok) problems.push('未找到可用的 adb（请在设置里指定 MuMu 的 adb.exe 路径）');
    else if (!serial) problems.push('没有在线设备，请先启动 MuMu（并开启 adb 调试）');
    if (adb.ok && serial && !installed) problems.push(`设备上未检测到当前渠道游戏（包名 ${gamePackage()}），请在设置里选择正确渠道`);
    if (adb.ok && serial && installed && !assetsDirExists) problems.push('已装游戏但未找到 AssetBundles 目录，先进一次游戏让资源初始化');

    success(res, {
      ready,
      problems,
      adb: { ok: adb.ok, path: adb.path, version: adb.version || null, error: adb.error || null },
      devices,
      targetSerial: serial,
      game: { package: gamePackage(), installed, filesDirExists, assetsDirExists, assetsPath: gameAssets() },
      settings: getAllSettings(),
    });
  } catch (e) {
    next(e);
  }
});

/** 可选渠道列表（供前端下拉）*/
router.get('/mod/packages', authRequired, (req, res) => {
  success(res, GAME_PACKAGES);
});

/** 保存注入配置（仅管理员）：{ gamePackage?, deviceSerial?, adbPath? }，空串=回到自动/默认 */
router.put('/mod/settings', authRequired, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new BizError('仅管理员可修改注入配置', 403);
    const allow = ['gamePackage', 'deviceSerial', 'adbPath'];
    for (const k of allow) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, k)) setSetting(k, req.body[k]);
    }
    writeLog({
      userId: req.user.id,
      username: req.user.username || '',
      action: 'MOD_SETTINGS',
      detail: JSON.stringify(req.body || {}),
      ip: req.ip || '',
    });
    success(res, getAllSettings(), '已保存');
  } catch (e) {
    next(e);
  }
});

/** 查询某文件的 mod 状态 */
router.get('/files/:id/mod', authRequired, (req, res) => {
  const id = Number(req.params.id);
  needFile(id);
  const state = getModState(id);
  const files = state ? JSON.parse(state.files_json) : [];
  success(res, {
    fileId: id,
    enabled: state ? !!state.enabled : false,
    appliedAt: state?.applied_at || null,
    count: files.length,
    source: files[0]?.source || '',
  });
});

/**
 * 应用（一键注入；热更后再点也走这里）
 * body: { source?: string } 多版本嵌套包（如普通版/遮眼版）需指定来源
 */
router.post('/files/:id/mod/apply', authRequired, async (req, res, next) => {
  try {
    const file = needFile(Number(req.params.id));
    const source = typeof req.body?.source === 'string' ? req.body.source : null;
    const password = reqPassword(req);
    let result;
    try {
      const opts = {};
      if (source != null) opts.source = source;
      if (password) opts.password = password;
      result = await applyMod(file, opts);
    } catch (e) {
      if (e.code === 'ARCHIVE_PASSWORD_REQUIRED' || e.needPassword) {
        return sendPasswordRequired(res, e);
      }
      if (e.code === 'MULTI_SOURCE') {
        // 409：含多个版本，前端弹版本选择后带 source 重试
        return res.status(409).json({
          code: 409,
          message: e.message,
          data: { multiSource: true, sources: e.sources },
        });
      }
      throw e;
    }
    writeLog({
      userId: req.user.id,
      username: req.user.username || '',
      action: 'MOD_APPLY',
      detail: `file:${file.id} ${file.name} (${result.count}项${result.source ? ' ' + result.source : ''})`,
      ip: req.ip || '',
    });
    success(res, result);
  } catch (e) {
    next(e);
  }
});

/**
 * 批量应用（勾选多个压缩包一次注入）
 * body: { ids:number[] }
 * 串行处理，逐个返回成功/失败；多版本包默认选第一个版本。
 * 任何一个失败都不影响其余项，全部结果返回前端。
 */
router.post('/mod/batch-apply', authRequired, async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(n => Number.isInteger(n)) : [];
    if (!ids.length) throw new BizError('请选择要注入的压缩包', 400);

    const results = [];
    for (const id of ids) {
      const file = db.prepare('SELECT * FROM files WHERE id=? AND deleted=0').get(id);
      if (!file) {
        results.push({ id, name: `#${id}`, ok: false, error: '文件不存在' });
        continue;
      }
      try {
        const r = await applyMod(file, { defaultSource: true });
        results.push({ id, name: file.name, ok: true, count: r.count, source: r.source || '' });
      } catch (e) {
        results.push({ id, name: file.name, ok: false, error: e.message || '注入失败' });
      }
    }

    const success = results.filter(r => r.ok).length;
    const failed = results.length - success;
    writeLog({
      userId: req.user.id,
      username: req.user.username || '',
      action: 'MOD_BATCH_APPLY',
      detail: `批量注入 ${success} 成功 / ${failed} 失败（共 ${results.length}）`,
      ip: req.ip || '',
    });
    success(res, { total: results.length, success, failed, results });
  } catch (e) {
    next(e);
  }
});

/**
 * 真机 SAF 注入：获取文件清单（并在后端准备解压目录）。
 * GET /api/files/:id/mod/phone-manifest?source=...
 * 返回 {source, files:[{rel,size,md5}]}；多版本未选 → 409。
 */
router.get('/files/:id/mod/phone-manifest', authRequired, async (req, res, next) => {
  try {
    const file = needFile(Number(req.params.id));
    const source = typeof req.query.source === 'string' ? req.query.source : null;
    const opts = {};
    if (source != null) opts.source = source;
    if (reqPassword(req)) opts.password = reqPassword(req);
    const r = await preparePhoneFiles(file, opts);
    if (!r.files.length) throw new Error('压缩包内没有可注入的文件');
    res.json({ code: 0, message: 'ok', data: {
      source: r.source,
      files: r.files.map(f => ({ rel: f.rel, size: f.size, md5: f.md5 })),
    } });
  } catch (e) {
    if (e.code === 'ARCHIVE_PASSWORD_REQUIRED' || e.needPassword) return sendPasswordRequired(res, e);
    if (e.code === 'MULTI_SOURCE') {
      return res.status(409).json({ code: 409, message: e.message, data: { multiSource: true, sources: e.sources } });
    }
    next(e);
  }
});

/**
 * 真机 SAF 注入：下载单个已解压 AssetBundle。
 * 需先调 phone-manifest 准备。rel 为设备相对路径（经白名单校验防目录穿越）。
 * GET /api/files/:id/mod/phone-file?rel=painting/xxx
 */
const SAFE_REL = /^\/?(paintingface|squareicon|painting|herohrzicon|shipyardicon|spinepainting)\/[^<>:"|?*\u0000-\u001f]+$/;
router.get('/files/:id/mod/phone-file', authRequired, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    needFile(id);
    const rel = String(req.query.rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!SAFE_REL.test('/' + rel)) throw new BizError('非法文件路径');
    const abs = resolvePhoneFile(id, rel);
    if (!abs) throw new BizError('文件不存在或清单已失效，请重新获取: ' + rel);
    res.setHeader('Content-Type', 'application/octet-stream');
    const base = path.basename(rel);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(base)}`);
    res.download(abs, base);
  } catch (e) {
    next(e);
  }
});

/**
 * 导出 mod 文件包（zip，内含 painting/paintingface/herohrzicon/shipyardicon/squareicon 设备相对路径）
 * 手机端下载后用 MT 管理器解压到
 *   /sdcard/Android/data/<包名>/files/AssetBundles/
 * query: source= 多版本时指定来源
 * GET /api/files/:id/mod/export
 */
router.get('/files/:id/mod/export', authRequired, async (req, res, next) => {
  let zipPath;
  try {
    const file = needFile(Number(req.params.id));
    const source = typeof req.query.source === 'string' ? req.query.source : null;
    const opts = {};
    if (source != null) opts.source = source;
    if (reqPassword(req)) opts.password = reqPassword(req);
    const result = await exportModZip(file, opts);
    zipPath = result.zipPath;
    const safeBase = (file.name || 'mod').replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
    const downloadName = encodeURIComponent(`${safeBase}-mod.zip`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${downloadName}`);
    res.download(result.zipPath, `${safeBase}-mod.zip`, err => {
      // 下载结束后删除临时包
      try { fs.existsSync(result.zipPath) && fs.unlinkSync(result.zipPath); } catch {}
      if (err && !res.headersSent) next(err);
    });
  } catch (e) {
    try { zipPath && fs.existsSync(zipPath) && fs.unlinkSync(zipPath); } catch {}
    if (e.code === 'ARCHIVE_PASSWORD_REQUIRED' || e.needPassword) return sendPasswordRequired(res, e);
    if (e.code === 'MULTI_SOURCE') {
      return res.status(409).json({
        code: 409, message: e.message, data: { multiSource: true, sources: e.sources },
      });
    }
    next(e);
  }
});

/** 还原（一键关闭）*/
router.post('/files/:id/mod/revert', authRequired, async (req, res, next) => {
  try {
    const file = needFile(Number(req.params.id));
    const result = await revertMod(file);
    writeLog({
      userId: req.user.id,
      username: req.user.username || '',
      action: 'MOD_REVERT',
      detail: `file:${file.id} ${file.name}`,
      ip: req.ip || '',
    });
    success(res, result);
  } catch (e) {
    next(e);
  }
});

export default router;
