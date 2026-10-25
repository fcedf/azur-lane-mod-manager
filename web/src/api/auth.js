import request from '../utils/request.js';

export function login(username, password) {
  return request.post('/auth/login', { username, password });
}

export function getProfile() {
  return request.get('/auth/profile');
}

export function changePassword(oldPassword, newPassword) {
  return request.put('/auth/password', { oldPassword, newPassword });
}
