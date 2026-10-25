import { defineStore } from 'pinia';
import { login as loginApi } from '../api/auth.js';

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('fms_token') || '',
    userInfo: JSON.parse(localStorage.getItem('fms_user') || 'null'),
  }),
  getters: {
    isLogin: (state) => !!state.token,
    isAdmin: (state) => state.userInfo?.role === 'admin',
  },
  actions: {
    async login(username, password) {
      const data = await loginApi(username, password);
      this.token = data.token;
      this.userInfo = data.user;
      localStorage.setItem('fms_token', data.token);
      localStorage.setItem('fms_user', JSON.stringify(data.user));
    },
    logout() {
      this.token = '';
      this.userInfo = null;
      localStorage.removeItem('fms_token');
      localStorage.removeItem('fms_user');
    },
  },
});
