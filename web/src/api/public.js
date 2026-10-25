import request from '../utils/request.js';

/** 查看公开分享信息（可能返回 needPassword） */
export const getPublicShare = (code, password = '') =>
  request.get(`/public/share/${code}`, { params: password ? { password } : {} });

/** 公开分享下载地址（带密码），用于直接跳转下载 */
export function publicDownloadUrl(code, password = '') {
  const qs = password ? `?password=${encodeURIComponent(password)}` : '';
  return `/api/public/share/${encodeURIComponent(code)}/download${qs}`;
}

/** 获取电脑局域网 IP（用于生成手机可访问链接） */
export const getLanIp = () => request.get('/system/lan-ip');
