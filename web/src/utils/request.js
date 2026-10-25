import axios from 'axios';
import { ElMessage } from 'element-plus';
import router from '../router/index.js';
import { useUserStore } from '../stores/user.js';

// 开发模式：走 Vite 代理（/api）；桌面打包后：指向程序内嵌的后端服务
const DESKTOP_API = 'http://127.0.0.1:3200/api';
const isDesktop = !import.meta.env.DEV;

const request = axios.create({
  baseURL: isDesktop ? DESKTOP_API : '/api',
  timeout: 30000,
});

// 请求拦截：自动带上 token
request.interceptors.request.use((config) => {
  const token = localStorage.getItem('fms_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 响应拦截：统一处理业务码
request.interceptors.response.use(
  (response) => {
    const res = response.data;
    // 4001：压缩包需要密码，交由调用方弹密码框，不统一报错
    if (res.code === 4001) {
      const err = new Error(res.message || '压缩包已加密，需要密码');
      err.code = 4001;
      err.data = res.data || { needPassword: true };
      return Promise.reject(err);
    }
    if (res.code !== 0) {
      ElMessage.error(res.message || '请求失败');
      return Promise.reject(new Error(res.message || 'Error'));
    }
    return res.data;
  },
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;

    // 409：需要调用方处理（如 mod 多版本选择），不统一弹 toast
    if (status === 409 && error.response?.data?.data) {
      error.code = 409;
      error.data = error.response.data.data;
      return Promise.reject(error);
    }

    if (status === 401) {
      ElMessage.error('登录已过期，请重新登录');
      const userStore = useUserStore();
      userStore.logout();
      router.push('/login');
    } else if (status === 403) {
      ElMessage.error(message || '没有权限');
    } else {
      ElMessage.error(message || '网络错误');
    }
    return Promise.reject(error);
  }
);

export default request;
