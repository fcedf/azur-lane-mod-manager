import request from '../utils/request.js';

/** 查询某文件的 mod 状态 */
export const getModState = (id) => request.get(`/files/${id}/mod`);

/** 一键应用（注入游戏；热更覆盖后再点也走这里）
 *  多版本包（如普通版/遮眼版）需带 source 指定来源
 *  @param {string} [password] 加密压缩包密码（走 X-Archive-Password 头，不进 URL/日志） */
export const applyMod = (id, source, password) => {
  const data = source ? { source } : {};
  const config = password
    ? { headers: { 'X-Archive-Password': password } }
    : undefined;
  return request.post(`/files/${id}/mod/apply`, data, config);
};

/** 一键还原（关闭 mod）*/
export const revertMod = (id) => request.post(`/files/${id}/mod/revert`);

/** 批量一键注入（勾选多个压缩包）；多版本包默认选第一个版本 */
export const batchApplyMod = (ids) => request.post('/mod/batch-apply', { ids });

/** 注入环境自检 */
export const diagnoseMod = () => request.get('/mod/diagnose');

/** 可选游戏渠道列表 */
export const getGamePackages = () => request.get('/mod/packages');

/** 保存注入配置（管理员）：{ gamePackage?, deviceSerial?, adbPath? }，空串=自动/默认 */
export const saveModSettings = (data) => request.put('/mod/settings', data);
