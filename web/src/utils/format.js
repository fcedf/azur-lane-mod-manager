const ARCHIVE_EXTS = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'];

/** 判断是否为压缩包 */
export function isArchive(filename = '') {
  const idx = filename.lastIndexOf('.');
  if (idx < 0) return false;
  return ARCHIVE_EXTS.includes(filename.slice(idx + 1).toLowerCase());
}

/**
 * 文件列表排序
 * @param {Array} rows
 * @param {'name'|'size'|'date'} field 排序字段
 * @param {'asc'|'desc'} order 升序 / 降序
 * 规则：收藏文件始终置顶，其内部再按所选字段排序
 */
export function sortFileList(rows, field, order) {
  return [...rows].sort((a, b) => {
    // 收藏置顶
    const sa = a.is_starred ? 1 : 0;
    const sb = b.is_starred ? 1 : 0;
    if (sa !== sb) return sb - sa;

    let cmp;
    if (field === 'name') {
      // numeric: 让 “文件2” 排在 “文件10” 前面；中文按拼音
      cmp = String(a.name).localeCompare(String(b.name), 'zh-CN', {
        numeric: true,
        sensitivity: 'base',
      });
    } else if (field === 'size') {
      cmp = (a.size || 0) - (b.size || 0);
    } else if (field === 'origin') {
      // 原始日期（缺失时回退到上传日期）
      cmp = String(a.origin_date || a.updated_at || '').localeCompare(
        String(b.origin_date || b.updated_at || '')
      );
    } else {
      // 上传日期字符串格式固定 YYYY-MM-DD HH:MM:SS，可直接比较
      cmp = String(a.updated_at || '').localeCompare(String(b.updated_at || ''));
    }
    return order === 'asc' ? cmp : -cmp;
  });
}

/** 文件大小格式化 */
export function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

/** 文件类型 -> Element Plus 图标名 */
const ICON_MAP = {
  image: 'Picture',
  doc: 'Document',
  sheet: 'Grid',
  slide: 'DataBoard',
  video: 'VideoCamera',
  audio: 'Headset',
  archive: 'Files',
  code: 'Tickets',
  other: 'Document',
};

export function typeIcon(type) {
  return ICON_MAP[type] || 'Document';
}

/** 文件类型 -> 图标颜色 */
const COLOR_MAP = {
  image: '#67c23a',
  doc: '#409eff',
  sheet: '#95d475',
  slide: '#f56c6c',
  video: '#e6a23c',
  audio: '#9b59b6',
  archive: '#909399',
  code: '#1abc9c',
  other: '#909399',
};

export function typeColor(type) {
  return COLOR_MAP[type] || '#909399';
}
