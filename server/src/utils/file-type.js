/** 按扩展名归类文件类型 */

const TYPE_MAP = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'heic'],
  doc: ['doc', 'docx', 'pdf', 'txt', 'md', 'rtf', 'wps'],
  sheet: ['xls', 'xlsx', 'csv'],
  slide: ['ppt', 'pptx', 'key'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'webm'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'],
  code: ['js', 'ts', 'vue', 'java', 'py', 'go', 'c', 'cpp', 'html', 'css', 'json', 'sql', 'sh'],
};

export function getExt(filename = '') {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : '';
}

export function getFileType(filename = '') {
  const ext = getExt(filename);
  for (const [type, exts] of Object.entries(TYPE_MAP)) {
    if (exts.includes(ext)) return type;
  }
  return 'other';
}

/** 是否可在浏览器中直接预览 */
export function canPreviewInline(filename = '') {
  const type = getFileType(filename);
  return ['image', 'video', 'audio', 'doc'].includes(type);
}
