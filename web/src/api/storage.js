import request from '../utils/request.js';

/** 全部存储根 + 当前根 */
export const getStorageRoots = () => request.get('/storage/roots');

/** 当前/指定根下的子目录树（上传选目录用）*/
export const getStorageSubdirs = (rootId) =>
  request.get('/storage/subdirs', { params: rootId == null ? {} : { rootId } });

/** 在盘符下自建 fms-files 存储根 */
export const addStorageRoot = (drive, label) =>
  request.post('/storage/roots', { drive, label });

/** 切换当前写入根（0=默认根）*/
export const setCurrentRoot = (rootId) =>
  request.put('/storage/current', { rootId });

/** 删除空的自定义存储根 */
export const removeStorageRoot = (id) => request.delete(`/storage/roots/${id}`);
