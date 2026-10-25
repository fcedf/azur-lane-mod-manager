import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 加载 server/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(__dirname, '../../uploads');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '../../data/fms.db');

// 确保目录存在
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

// 立绘提取缓存目录（默认 <存储根>/painting-cache）
const paintingCacheDir = process.env.PAINTING_CACHE_DIR
  ? path.resolve(process.env.PAINTING_CACHE_DIR)
  : path.join(uploadDir, 'painting-cache');
fs.mkdirSync(paintingCacheDir, { recursive: true });

// Mod 备份目录（原版文件 + 清单原始行），默认 <存储根>/mod-backup
const modBackupDir = process.env.MOD_BACKUP_DIR
  ? path.resolve(process.env.MOD_BACKUP_DIR)
  : path.join(uploadDir, 'mod-backup');
fs.mkdirSync(modBackupDir, { recursive: true });

// 动态立绘（Spine/Live2D）提取缓存目录，默认 <存储根>/dynamic-cache
const dynamicCacheDir = process.env.DYNAMIC_CACHE_DIR
  ? path.resolve(process.env.DYNAMIC_CACHE_DIR)
  : path.join(uploadDir, 'dynamic-cache');
fs.mkdirSync(dynamicCacheDir, { recursive: true });

// 解析脚本目录：允许 SCRIPTS_DIR 覆盖；否则在候选位置中取存在的一个
// __dirname = server/src/config。开发布局 server/src/config -> server/scripts（上溯两级）
// 打包布局 resources/server/src/config -> resources/server/scripts（上溯两级），两者同构
const scriptCandidates = process.env.SCRIPTS_DIR
  ? [path.resolve(process.env.SCRIPTS_DIR)]
  : [
      path.resolve(__dirname, '../../scripts'),            // 开发 & 打包同构
      path.resolve(__dirname, '../../../server/scripts'),  // 容错
    ];
const scriptsDir = scriptCandidates.find((p) => fs.existsSync(path.join(p, 'mod_files.py')))
  || scriptCandidates[0];

// 解析 Python：环境变量 > 打包内嵌 runtime/python/python.exe > 系统 python
function resolvePythonPath() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  // 打包：resources/server/src/config -> resources/runtime/python（上溯三级）
  // 开发：file-management-system/server/src/config -> file-management-system/runtime/python（上溯三级），同构
  const pyCandidates = [
    path.resolve(__dirname, '../../../runtime/python/python.exe'),
    path.resolve(__dirname, '../../runtime/python/python.exe'),
  ];
  const found = pyCandidates.find((p) => fs.existsSync(p));
  return found || 'python';
}

const config = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'fms-dev-secret',
  jwtExpires: process.env.JWT_EXPIRES || '7d',
  uploadDir,
  dbPath,
  paintingCacheDir,
  dynamicCacheDir,
  modBackupDir,
  // Python 可执行路径：优先环境变量；否则用打包内嵌运行时；再退回系统 python
  pythonPath: resolvePythonPath(),
  // 脚本目录：开发/源码为 server/scripts；打包后为 resources/server/scripts
  paintingScript: path.join(scriptsDir, 'extract_painting.py'),
  dynamicScript: path.join(scriptsDir, 'extract_dynamic.py'),
  modScript: path.join(scriptsDir, 'mod_files.py'),
  // adb（MuMu 自带）；默认值在 mod-adb 工具中动态探测，这里允许 .env 覆盖
  adbPath: process.env.ADB_PATH || '',
  // 目标游戏（4399 国服，MuMu）
  gamePackage: process.env.GAME_PACKAGE || 'com.bilibili.blhx.m4399',
  gameDeviceSerial: process.env.GAME_DEVICE_SERIAL || '', // 空 = 唯一设备
  maxFileSize: Number(process.env.MAX_FILE_SIZE) || 2 * 1024 * 1024 * 1024,
  recycleKeepDays: 30, // 回收站保留天数
};

export default config;
