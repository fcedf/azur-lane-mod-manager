/**
 * Mod 注入相关可配置项（持久化在 SQLite，分发后可在界面调整）
 *  - gamePackage：游戏渠道包名
 *  - deviceSerial：目标设备 serial（空 = 自动）
 *  - adbPath：自定义 adb 路径（空 = 自动探测）
 */
import db from '../db/index.js';

db.exec(`
CREATE TABLE IF NOT EXISTS mod_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

const stmtGet = db.prepare('SELECT value FROM mod_settings WHERE key = ?');
const stmtSet = db.prepare(
  `INSERT INTO mod_settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);

/** 读取一项配置（字符串） */
export function getSetting(key) {
  const row = stmtGet.get(key);
  return row ? row.value : null;
}

/** 写入一项配置（空串/ null 视为清空，回到自动/默认）*/
export function setSetting(key, value) {
  stmtSet.run(key, value == null ? '' : String(value));
}

/** 一次读取多项，返回 {key: value} */
export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM mod_settings').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

/** 已知碧蓝航线渠道包名（界面下拉用）*/
export const GAME_PACKAGES = [
  { value: 'com.bilibili.blhx.m4399', label: '4399 国服' },
  { value: 'com.bilibili.blhx', label: 'B 站官服' },
];
