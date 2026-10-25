<template>
  <el-container class="layout">
    <!-- 侧边栏 -->
    <el-aside width="190px" class="aside">
      <div class="logo">
        <el-icon :size="22"><FolderOpened /></el-icon>
        <span>文件管理系统</span>
      </div>

      <el-menu :default-active="activeMenu" router class="menu" background-color="#001529" text-color="#b7c0cd" active-text-color="#fff">
        <el-menu-item index="/files">
          <el-icon><Files /></el-icon><span>我的文件</span>
        </el-menu-item>
        <el-menu-item index="/starred">
          <el-icon><Star /></el-icon><span>我的收藏</span>
        </el-menu-item>
        <el-menu-item index="/shares">
          <el-icon><Share /></el-icon><span>我的分享</span>
        </el-menu-item>
        <el-menu-item index="/recycle">
          <el-icon><Delete /></el-icon><span>回收站</span>
        </el-menu-item>
        <el-menu-item index="/storage">
          <el-icon><Setting /></el-icon><span>设置</span>
        </el-menu-item>

        <template v-if="userStore.isAdmin">
          <div class="menu-group-title">系统管理</div>
          <el-menu-item index="/admin/dashboard">
            <el-icon><DataAnalysis /></el-icon><span>数据看板</span>
          </el-menu-item>
          <el-menu-item index="/admin/users">
            <el-icon><User /></el-icon><span>用户管理</span>
          </el-menu-item>
          <el-menu-item index="/admin/logs">
            <el-icon><Document /></el-icon><span>操作日志</span>
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>

    <el-container>
      <!-- 顶栏 -->
      <el-header class="header">
        <div class="header-left">
          <el-input
            v-model="searchKey"
            placeholder="搜索文件名 / 标签，回车全局搜索"
            class="global-search"
            clearable
            @keyup.enter="doGlobalSearch"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
        </div>
        <div class="header-right">
          <el-dropdown @command="onCommand">
            <span class="user-info">
              <el-avatar :size="30" class="avatar">{{ userStore.userInfo?.nickname?.[0] || 'U' }}</el-avatar>
              <span class="nickname">{{ userStore.userInfo?.nickname }}</span>
              <el-tag v-if="userStore.isAdmin" size="small" type="danger" effect="dark">管理员</el-tag>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="password">修改密码</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- 内容区 -->
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>

  <!-- 修改密码弹窗 -->
  <el-dialog v-model="pwdVisible" title="修改密码" width="420px">
    <el-form label-width="80px">
      <el-form-item label="原密码">
        <el-input v-model="pwdForm.oldPassword" type="password" show-password />
      </el-form-item>
      <el-form-item label="新密码">
        <el-input v-model="pwdForm.newPassword" type="password" show-password />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="pwdVisible = false">取消</el-button>
      <el-button type="primary" @click="submitPassword">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, reactive } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox, ElMessage } from 'element-plus';
import { useUserStore } from '../stores/user.js';
import { changePassword } from '../api/auth.js';

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const activeMenu = computed(() => route.path);
const searchKey = ref('');

function doGlobalSearch() {
  router.push({ path: '/files', query: { q: searchKey.value } });
}

/* 修改密码 */
const pwdVisible = ref(false);
const pwdForm = reactive({ oldPassword: '', newPassword: '' });

async function onCommand(command) {
  if (command === 'logout') {
    await ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' });
    userStore.logout();
    router.push('/login');
  } else if (command === 'password') {
    pwdForm.oldPassword = '';
    pwdForm.newPassword = '';
    pwdVisible.value = true;
  }
}

async function submitPassword() {
  if (pwdForm.newPassword.length < 6) return ElMessage.warning('新密码至少 6 位');
  await changePassword(pwdForm.oldPassword, pwdForm.newPassword);
  ElMessage.success('密码修改成功，请重新登录');
  pwdVisible.value = false;
  userStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.layout {
  height: 100%;
}
.aside {
  background: #001529;
  overflow-y: auto;
}
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  padding: 0 14px;
  white-space: nowrap;
}
/* 收窄后的导航菜单项，避免文字被挤压换行 */
.aside :deep(.el-menu-item) {
  padding-left: 16px !important;
  gap: 6px;
}
.menu {
  border-right: none;
}
.menu-group-title {
  margin: 14px 16px 6px;
  font-size: 12px;
  color: #7a8699;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.header {
  background: #fff;
  border-bottom: 1px solid #eee;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.global-search {
  width: 420px;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.avatar {
  background: #409eff;
}
.nickname {
  font-size: 14px;
  color: #333;
}
.main {
  background: #f5f7fa;
  padding: 16px;
}
</style>
