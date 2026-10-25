/**
 * adb 工具：与 MuMu / 安卓设备传输文件、执行 shell（免 root）
 * 支持运行时配置：自定义 adb 路径、目标设备 serial、游戏渠道包名（存 mod_settings）
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config/index.js';
import { getSetting } from './mod-settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 定位 adb：界面配置 > .env 配置 > 已知候选路径（同步探测）> 扫盘符 > PATH
 */
function detectAdbPath() {
  const custom = getSetting('adbPath');
  if (custom && fs.existsSync(custom)) return custom;
  if (config.adbPath && fs.existsSync(config.adbPath)) return config.adbPath;

  if (process.platform === 'win32') {
    const candidates = [
      'D:\\碧蓝航线\\MuMu Player 12\\nx_main\\adb.exe',
      'D:\\安卓模拟器\\MuMu Player 12\\nx_main\\adb.exe',
      'D:\\MuMu Player 12\\nx_main\\adb.exe',
      'C:\\Program Files\\MuMu Player 12\\nx_main\\adb.exe',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    // 动态兜底：扫盘符下含 MuMu 的目录
    for (const r of ['D:', 'C:', 'E:']) {
      try {
        for (const ent of fs.readdirSync(r + '/')) {
          if (/mumu/i.test(ent)) {
            const cand = path.join(r + '/', ent, 'MuMu Player 12', 'nx_main', 'adb.exe');
            if (fs.existsSync(cand)) return cand;
            const cand2 = path.join(r + '/', ent, 'nx_main', 'adb.exe');
            if (fs.existsSync(cand2)) return cand2;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return 'adb'; // 交给 PATH
}

/** 当前生效的 adb 路径（每次调用都解析，保证界面改配置后立即生效）*/
function adbPath() {
  return detectAdbPath();
}

/** adb 是否可执行：返回 {ok,version} */
export function checkAdb() {
  const exe = adbPath();
  if (exe !== 'adb' && !fs.existsSync(exe)) {
    return { ok: false, path: exe, error: 'adb 文件不存在' };
  }
  try {
    const out = execFileSync(exe, ['version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    const m = out.match(/version\s+([\w.\-]+)/i);
    return { ok: true, path: exe, version: m ? m[1] : out.split('\n')[0]?.trim() };
  } catch (e) {
    return { ok: false, path: exe, error: e.message };
  }
}

/** 同步列出在线设备：[{serial, state}] */
export function listDevices() {
  let exe = adbPath();
  if (exe !== 'adb' && !fs.existsSync(exe)) return [];
  try {
    const out = execFileSync(exe, ['devices'], { encoding: 'utf-8' }).toString();
    return out
      .split('\n')
      .map(l => l.trim())
      .filter(l => /\t(device|offline|unauthorized)$/.test(l))
      .map(l => {
        const [serial, state] = l.split(/\s+/);
        return { serial, state };
      });
  } catch {
    return [];
  }
}

/** 当前目标渠道包名：界面配置优先，否则 .env/默认 */
export function gamePackage() {
  return getSetting('gamePackage') || config.gamePackage;
}

/** 设备上游戏 files 根目录 / AssetBundles 目录 */
export function gameFiles() {
  return `/sdcard/Android/data/${gamePackage()}/files`;
}
export function gameAssets() {
  return `${gameFiles()}/AssetBundles`;
}

/**
 * 选择目标设备：界面指定 > .env 指定 > 唯一在线 > 多设备优先 emulator-5554
 */
function pickSerial() {
  const custom = getSetting('deviceSerial');
  if (custom) return custom;
  if (config.gameDeviceSerial) return config.gameDeviceSerial;
  const devices = listDevices().filter(d => d.state === 'device');
  const serials = devices.map(d => d.serial);
  if (serials.length === 1) return serials[0];
  if (serials.includes('emulator-5554')) return 'emulator-5554';
  return serials[0] || '';
}

function run(args) {
  const serial = pickSerial();
  const finalArgs = serial ? ['-s', serial, ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(adbPath(), finalArgs, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d.toString()));
    child.stderr.on('data', d => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`adb ${args[0]} 失败(code=${code}): ${stderr || stdout}`));
    });
  });
}

export function adbPush(localPath, devicePath) {
  return run(['push', localPath, devicePath]);
}
export function adbPull(devicePath, localPath) {
  return run(['pull', devicePath, localPath]);
}
export function adbShell(cmd) {
  return run(['shell', cmd]);
}

/** 设备上文件是否存在 */
export async function deviceExists(devicePath) {
  try {
    await adbShell(`ls ${q(devicePath)}`);
    return true;
  } catch {
    return false;
  }
}

/** 设备上文件 MD5（md5sum），不存在返回 null */
export async function deviceMd5(devicePath) {
  try {
    const { stdout } = await adbShell(`md5sum ${q(devicePath)}`);
    const m = stdout.trim().match(/^([0-9a-fA-F]{32})/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/** 设备上是否已安装目标渠道游戏（pm path 查包名）*/
export async function gameInstalled() {
  try {
    const { stdout } = await adbShell(`pm path ${gamePackage()}`);
    return /package:/.test(stdout);
  } catch {
    return false;
  }
}

function q(p) {
  return `'${String(p).replace(/'/g, "'\\''")}'`;
}

export function getAdbPath() {
  return adbPath();
}
