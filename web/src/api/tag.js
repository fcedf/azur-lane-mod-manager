import request from '../utils/request.js';

/** 平铺标签（含 parentId/depth/ownCount/fileCount）*/
export const getTags = () => request.get('/tags');

/** 树形标签（节点带 children / ownCount / fileCount）*/
export const getTagTree = () => request.get('/tags', { params: { view: 'tree' } });

export const createTag = (data) => request.post('/tags', data);
export const updateTag = (id, data) => request.put(`/tags/${id}`, data);
export const deleteTag = (id) => request.delete(`/tags/${id}`);

/** 设置父级（parentId 传 null/0 表示顶级）*/
export const setTagParent = (id, parentId) =>
  request.put(`/tags/${id}/parent`, { parentId: parentId ?? 0 });

/** 同级排序：orderedIds 为同一父级下的全部标签，按新顺序 */
export const reorderTags = (orderedIds) => request.post('/tags/reorder', { orderedIds });

/**
 * 合并多个标签到一个目标标签。
 * @param {{sourceIds:number[], targetId?:number, targetName?:string, targetColor?:string}} payload
 */
export const mergeTags = (payload) => request.post('/tags/merge', payload);
