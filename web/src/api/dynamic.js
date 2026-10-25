import request from '../utils/request.js';

/** 获取压缩包内动态立绘清单（Spine/Live2D，首次自动提取）。
 *  大压缩包首次解密提取较慢，超时放宽到 10 分钟；可带密码。*/
export const getDynamic = (id, { refresh = false, password = '' } = {}) =>
  request.get(`/files/${id}/dynamic`, {
    params: refresh ? { refresh: 1 } : {},
    headers: password ? { 'X-Archive-Password': password } : {},
    timeout: 600000,
  });

function tokenQuery() {
  const token = localStorage.getItem('fms_token');
  return token ? `access_token=${encodeURIComponent(token)}` : '';
}

// 开发走 Vite 代理 /api；桌面打包后由 file:// 加载，需指向内嵌后端 3200
const BASE = import.meta.env.DEV ? '/api' : 'http://127.0.0.1:3200/api';

/** 上报“渲染合成首帧”封面（打开预览、人物稳定后调用一次）*/
export const uploadComposedCover = (id, dataUrl) =>
  request.post(`/files/${id}/dynamic/composed-cover`, { dataUrl }, { timeout: 60000 });

/** 动态资源文件地址（skel/atlas/png/moc3/model3 等）*/
export const dynamicAssetUrl = (id, name) =>
  `${BASE}/files/${id}/dynamic/asset?name=${encodeURIComponent(name)}&${tokenQuery()}`;
