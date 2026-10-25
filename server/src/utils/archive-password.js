import db from '../db/index.js';

/**
 * 加密压缩包（WinZip AES / ZipCrypto / rar / 7z）密码存取。
 * 按文件记住，成功后落盘到 archive_passwords 表。
 * 运行时用 node:sqlite，init.js 不参与启动，这里幂等自建表（与 mod_settings 同做法）。
 */
try {
  db.exec(`CREATE TABLE IF NOT EXISTS archive_passwords (
    file_id    INTEGER PRIMARY KEY,
    password   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
} catch (e) {
  console.error('初始化 archive_passwords 表失败:', e?.message);
}

export function getArchivePassword(fileId) {
  try {
    const row = db.prepare('SELECT password FROM archive_passwords WHERE file_id = ?').get(fileId);
    return row?.password || '';
  } catch {
    return '';
  }
}

export function saveArchivePassword(fileId, password) {
  db.prepare(
    `INSERT INTO archive_passwords (file_id, password) VALUES (?, ?)
     ON CONFLICT(file_id) DO UPDATE SET password = excluded.password, created_at = datetime('now','localtime')`
  ).run(fileId, password);
}

export function deleteArchivePassword(fileId) {
  db.prepare('DELETE FROM archive_passwords WHERE file_id = ?').run(fileId);
}

/** 判断 Python worker 输出是否为“压缩包需要/密码错误” */
export class ArchivePasswordError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArchivePasswordError';
    this.needPassword = true;
  }
}

/** 从 worker 的 JSON 结果识别密码错误 */
export function isPasswordResult(result) {
  return result && result.ok === false && result.code === 'ARCHIVE_PASSWORD_REQUIRED';
}
