import request from '../utils/request.js';

export const getStats = () => request.get('/admin/stats');
export const getUsers = () => request.get('/admin/users');
export const createUser = (data) => request.post('/admin/users', data);
export const updateUser = (id, data) => request.put(`/admin/users/${id}`, data);
export const resetPassword = (id, password) =>
  request.put(`/admin/users/${id}/reset-password`, { password });
export const getLogs = (params) => request.get('/admin/logs', { params });
