import request from '../utils/request.js';

// 开发走 Vite 代理；打包后指向内嵌后端（与 request.js 保持一致）
const API_BASE = import.meta.env.DEV ? '/api' : 'http://127.0.0.1:3200/api';

export const getFolders = (spaceId) => request.get('/folders', { params: { spaceId } });
export const createFolder = (data) => request.post('/folders', data);
export const renameFolder = (id, name) => request.put(`/folders/${id}`, { name });
export const deleteFolder = (id) => request.delete(`/folders/${id}`);

export const getFiles = (params) => request.get('/files', { params });

/** 按标签/全部浏览（跨文件夹聚合） */
export const browseFiles = (params) => request.get('/files/browse', { params });
export const renameFile = (id, name) => request.put(`/files/${id}/rename`, { name });
export const moveFile = (id, folderId) => request.put(`/files/${id}/move`, { folderId });
export const starFile = (id, starred) => request.put(`/files/${id}/star`, { starred });
export const setFileTags = (id, tags) => request.put(`/files/${id}/tags`, { tags });
export const deleteFile = (id) => request.delete(`/files/${id}`);
export const restoreFile = (id) => request.post(`/files/${id}/restore`);
export const permanentDeleteFile = (id) => request.delete(`/files/${id}/permanent`);
export const getRecycleList = () => request.get('/files/recycle/list');

/**
 * 上传文件（带进度回调）
 * @param {File} file
 * @param {string|null} tag 兼容旧调用：当前所在标签分类（无子目录时作为目标目录）
 * @param {(p:number)=>void} [onProgress]
 * @param {{subdir?:string, rootId?:number|null}} [opts] subdir 目标子目录（每级自动转标签），rootId 存储根
 */
export function uploadFile(file, tag, onProgress, opts = {}) {
  const form = new FormData();
  form.append('file', file);
  if (opts.subdir) form.append('subdir', opts.subdir);
  else if (tag) form.append('tag', tag);
  if (opts.rootId !== undefined && opts.rootId !== null) form.append('rootId', String(opts.rootId));
  form.append('originDate', String(file.lastModified || ''));
  return request.post('/files/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
}

/**
 * 批量上传文件（压缩包）
 * @param {File[]} files
 * @param {string} tag 目标分类
 * @param {(p:number)=>void} onProgress
 */
export function batchUploadFiles(files, tag, onProgress, opts = {}) {
  const form = new FormData();
  files.forEach((f) => form.append('files', f));
  if (opts.subdir) form.append('subdir', opts.subdir);
  else if (tag) form.append('tag', tag);
  if (opts.rootId !== undefined && opts.rootId !== null) form.append('rootId', String(opts.rootId));
  form.append('originDates', JSON.stringify(files.map((f) => f.lastModified || 0)));
  return request.post('/files/upload-batch', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
}

/** 批量删除（放入回收站） */
export const batchDeleteFiles = (ids) => request.post('/files/batch-delete', { ids });

/**
 * 批量添加 / 覆盖标签
 * @param {number[]} ids
 * @param {Array<{name:string,color:string}>} addTags
 * @param {'append'|'replace'} mode
 */
export const batchApplyTags = (ids, addTags, mode = 'append') =>
  request.post('/files/batch-tags', { ids, addTags, mode });

/** 文件下载地址（带鉴权头，需用 blob 方式） */
export async function downloadFile(id, filename) {
  // 用原生 fetch 直取二进制，避免 axios 响应拦截器把 blob 当业务 JSON 解析
  const token = localStorage.getItem('fms_token');
  const res = await fetch(`${API_BASE}/files/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('下载失败');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filenameFromDisposition(disposition, fallback = `文件打包_${Date.now()}.zip`) {
  if (!disposition) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8) return decodeURIComponent(utf8[1]);
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1] : fallback;
}

/**
 * 批量打包下载（POST 返回 zip 流，store 不压缩）。
 * 原生 fetch + ReadableStream 以获得真实下载进度；大文件边收边落盘。
 * @param {number[]} ids
 * @param {number} [expectedSize] 所选文件总字节（流式响应无 Content-Length，用它估算进度）
 * @param {(loaded:number,total:number,percent:number)=>void} [onProgress]
 */
export async function batchDownloadFiles(ids, expectedSize = 0, onProgress) {
  const token = localStorage.getItem('fms_token') || '';
  const resp = await fetch(`${API_BASE}/files/batch-download`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify({ ids }),
  });

  if (!resp.ok) {
    let msg = `打包失败（${resp.status}）`;
    try {
      const data = await resp.json();
      msg = data.message || msg;
    } catch { /* 非 JSON 错误体 */ }
    throw new Error(msg);
  }

  const total = Number(resp.headers.get('Content-Length') || 0) || expectedSize || 0;
  const reader = resp.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (onProgress) {
      const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : null;
      onProgress(loaded, total, percent);
    }
  }
  const blob = new Blob(chunks, { type: 'application/zip' });
  const filename = filenameFromDisposition(resp.headers.get('Content-Disposition'));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename, size: blob.size };
}
