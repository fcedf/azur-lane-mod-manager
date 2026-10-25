import db from '../db/index.js';

/** 记录操作日志 */
export function writeLog({ userId, username, action, targetType = 'file', targetId = null, detail = '', ip = '' }) {
  try {
    db.prepare(
      `INSERT INTO operation_logs (user_id, username, action, target_type, target_id, detail, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(userId ?? null, username || '', action, targetType, targetId, detail, ip);
  } catch (e) {
    console.error('写日志失败:', e.message);
  }
}

/** 格式化文件大小 */
export function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}
