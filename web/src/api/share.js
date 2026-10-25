import request from '../utils/request.js';

export const createShare = (data) => request.post('/shares', data);
export const getMyShares = () => request.get('/shares/mine');
export const cancelShare = (id) => request.delete(`/shares/${id}`);
