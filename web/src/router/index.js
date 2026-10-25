import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router';

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { public: true },
  },
  {
    path: '/share/:code',
    name: 'SharePage',
    component: () => import('../views/SharePage.vue'),
    meta: { public: true, title: '文件分享' },
  },
  {
    path: '/',
    component: () => import('../layouts/MainLayout.vue'),
    redirect: '/files',
    children: [
      { path: 'files', name: 'Files', component: () => import('../views/Files.vue'), meta: { title: '我的文件' } },
      { path: 'starred', name: 'Starred', component: () => import('../views/Starred.vue'), meta: { title: '我的收藏' } },
      { path: 'recycle', name: 'Recycle', component: () => import('../views/Recycle.vue'), meta: { title: '回收站' } },
      { path: 'tags', name: 'Tags', component: () => import('../views/Tags.vue'), meta: { title: '标签管理' } },
      { path: 'storage', name: 'Storage', component: () => import('../views/Storage.vue'), meta: { title: '存储设置' } },
      { path: 'shares', name: 'Shares', component: () => import('../views/Shares.vue'), meta: { title: '我的分享' } },
      { path: 'admin/dashboard', name: 'AdminDashboard', component: () => import('../views/admin/Dashboard.vue'), meta: { title: '管理后台', admin: true } },
      { path: 'admin/users', name: 'AdminUsers', component: () => import('../views/admin/Users.vue'), meta: { title: '用户管理', admin: true } },
      { path: 'admin/logs', name: 'AdminLogs', component: () => import('../views/admin/Logs.vue'), meta: { title: '操作日志', admin: true } },
    ],
  },
];

// 桌面打包后用 hash 历史（file:// 打开必须）；网页开发/部署仍用 history
const router = createRouter({
  history: import.meta.env.DEV ? createWebHistory() : createWebHashHistory(),
  routes,
});

// 全局前置守卫：登录态 + 管理员权限
router.beforeEach((to) => {
  const token = localStorage.getItem('fms_token');
  if (!to.meta.public && !token) return { name: 'Login' };
  if (to.name === 'Login' && token) return { path: '/' };
  if (to.meta.admin) {
    const user = JSON.parse(localStorage.getItem('fms_user') || 'null');
    if (user?.role !== 'admin') return { path: '/files' };
  }
  return true;
});

export default router;
