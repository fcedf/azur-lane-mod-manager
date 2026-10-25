import path from 'node:path';
import fs from 'node:fs';

/**
 * 分类物理存储工具
 * 规则：
 *  - 物理路径 = <分类名>/<真实文件名>
 *  - 多分类：放入第一个分类（tags[0]）
 *  - 未分类：放入「未分类」文件夹
 *  - 同名：自动加 (1)(2)
 *  - 物理文件只存一份
 */

const UNCATEGORIZED = '未分类';

/** Windows 非法文件名字符替换为下划线 */
export function safeName(name = '') {
  return String(name)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+$/g, '')
    .trim() || '未命名';
}

/** 分类名同样做安全处理 */
export function safeCategory(name = '') {
  const n = String(name).trim();
  return n ? safeName(n) : UNCATEGORIZED;
}

/**
 * 在目标目录生成不冲突的完整路径
 * @param {string} dir 绝对目录
 * @param {string} filename 期望文件名
 * @returns {string} 可直接使用的绝对路径
 */
export function uniqueFilePath(dir, filename) {
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);

  let candidate = path.join(dir, filename);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}(${i})${ext}`);
    i += 1;
  }
  return candidate;
}

/**
 * 根据标签数组决定"主分类"目录名
 * @param {Array<{name:string}>} tags
 */
export function primaryCategory(tags = []) {
  const first = tags.find((t) => t?.name);
  return safeCategory(first?.name || '');
}

/**
 * 计算新文件应存放的物理绝对路径
 * @param {string} uploadDir 根目录
 * @param {Array} tags
 * @param {string} originalName
 */
export function planNewFile(uploadDir, tags, originalName) {
  const category = primaryCategory(tags);
  const dir = path.join(uploadDir, category);
  return uniqueFilePath(dir, safeName(originalName));
}

/**
 * 按“根目录 + 子目录”计算新文件物理路径（上传时显式选目录用）。
 * @param {string} rootAbs 存储根绝对路径
 * @param {string} subdir  相对子目录（正斜杠，可多级，如 德芙/2026/立绘）；非法段被净化
 * @param {string} originalName
 * @returns {{abs:string, rel:string, segments:string[]}} 落盘绝对路径、相对路径、有效目录段
 */
export function planNewFileInSubdir(rootAbs, subdir, originalName) {
  const segments = String(subdir || '')
    .split(/[\\/]/)
    .map(s => safeName(s))
    .filter(s => s && s !== UNCATEGORIZED && s !== '.')
    // 防止路径穿越
    .filter(s => s !== '..');
  const dir = segments.length
    ? path.join(rootAbs, ...segments)
    : path.join(rootAbs, UNCATEGORIZED);
  const abs = uniqueFilePath(dir, safeName(originalName));
  const rel = path.relative(rootAbs, abs).replace(/\\/g, '/');
  return { abs, rel, segments: segments.length ? segments : [UNCATEGORIZED] };
}

/**
 * 把存储路径转为相对 uploadDir 的正斜杠形式
 */
export function toRel(uploadDir, absPath) {
  return path.relative(uploadDir, absPath).replace(/\\/g, '/');
}
