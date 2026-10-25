import request from '../utils/request.js';

export const getSpaces = () => request.get('/spaces');
export const createSpace = (data) => request.post('/spaces', data);
export const updateSpace = (id, data) => request.put(`/spaces/${id}`, data);
export const deleteSpace = (id) => request.delete(`/spaces/${id}`);
export const getMembers = (id) => request.get(`/spaces/${id}/members`);
export const addMember = (id, username) => request.post(`/spaces/${id}/members`, { username });
export const removeMember = (id, userId) => request.delete(`/spaces/${id}/members/${userId}`);
