import request from '../utils/request.js';

/** 获取压缩包内立绘列表（首次自动提取；refresh=true 强制重提取；可带密码）。
 *  大压缩包首次解密提取较慢，超时放宽到 10 分钟。*/
export const getPaintings = (id, { refresh = false, password = '' } = {}) =>
  request.get(`/files/${id}/paintings`, {
    params: refresh ? { refresh: 1 } : {},
    headers: password ? { 'X-Archive-Password': password } : {},
    timeout: 600000,
  });

/** 当前登录 Token（图片 URL 用 query 携带，<img> 无法加 Authorization 头）*/
function tokenQuery() {
  const token = localStorage.getItem('fms_token');
  return token ? `access_token=${encodeURIComponent(token)}` : '';
}

// 开发走 Vite 代理 /api；桌面打包后由 file:// 加载，需指向内嵌后端 3200
const BASE = import.meta.env.DEV ? '/api' : 'http://127.0.0.1:3200/api';

/** 缩略图 / 原图地址 */
export const paintingThumbUrl = (id, key) =>
  `${BASE}/files/${id}/paintings/image/${encodeURIComponent(key)}?thumb=1&${tokenQuery()}`;
export const paintingFullUrl = (id, key) =>
  `${BASE}/files/${id}/paintings/image/${encodeURIComponent(key)}?${tokenQuery()}`;

/** 压缩包封面缩略图地址（文件列表懒加载用；无封面时后端返回 204）*/
export const archiveCoverUrl = id =>
  `${BASE}/files/${id}/cover?${tokenQuery()}`;
