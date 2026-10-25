import request from '../utils/request.js';

export const searchFiles = (params) => request.get('/search', { params });
export const getAllTags = () => request.get('/search/tags');
