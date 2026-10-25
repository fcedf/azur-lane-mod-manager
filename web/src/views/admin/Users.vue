<template>
  <el-card shadow="never">
    <template #header>
      <div class="header-bar">
        <span class="panel-title">用户管理</span>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建用户</el-button>
      </div>
    </template>

    <el-table :data="rows" stripe>
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="username" label="用户名" width="140" />
      <el-table-column prop="nickname" label="昵称" width="140" />
      <el-table-column label="角色" width="110">
        <template #default="{ row }">
          <el-tag :type="row.role === 'admin' ? 'danger' : 'info'">
            {{ row.role === 'admin' ? '管理员' : '普通用户' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-switch
            :model-value="row.status === 'active'"
            @change="(v) => toggleStatus(row, v)"
            active-text="正常"
            inactive-text="禁用"
          />
        </template>
      </el-table-column>
      <el-table-column label="已用空间" width="120">
        <template #default="{ row }">{{ formatSize(row.used_size) }}</template>
      </el-table-column>
      <el-table-column prop="created_at" label="注册时间" width="170" />
      <el-table-column label="操作" width="220">
        <template #default="{ row }">
          <el-button link type="primary" @click="toggleRole(row)">
            {{ row.role === 'admin' ? '设为普通' : '设为管理员' }}
          </el-button>
          <el-button link type="warning" @click="openReset(row)">重置密码</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <!-- 新建用户 -->
  <el-dialog v-model="createVisible" title="新建用户" width="440px">
    <el-form :model="createForm" label-width="80px">
      <el-form-item label="用户名"><el-input v-model="createForm.username" /></el-form-item>
      <el-form-item label="昵称"><el-input v-model="createForm.nickname" /></el-form-item>
      <el-form-item label="密码"><el-input v-model="createForm.password" type="password" show-password /></el-form-item>
      <el-form-item label="角色">
        <el-select v-model="createForm.role">
          <el-option label="普通用户" value="user" />
          <el-option label="管理员" value="admin" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="createVisible = false">取消</el-button>
      <el-button type="primary" @click="submitCreate">创建</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { Plus } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getUsers, createUser, updateUser, resetPassword } from '../../api/admin.js';
import { formatSize } from '../../utils/format.js';

const rows = ref([]);

async function load() {
  rows.value = await getUsers();
}

async function toggleStatus(row, active) {
  await updateUser(row.id, { status: active ? 'active' : 'disabled' });
  ElMessage.success(active ? '已启用' : '已禁用');
  load();
}

async function toggleRole(row) {
  const role = row.role === 'admin' ? 'user' : 'admin';
  await updateUser(row.id, { role });
  ElMessage.success('角色已更新');
  load();
}

/* 新建 */
const createVisible = ref(false);
const createForm = reactive({ username: '', nickname: '', password: '', role: 'user' });

function openCreate() {
  createForm.username = '';
  createForm.nickname = '';
  createForm.password = '';
  createForm.role = 'user';
  createVisible.value = true;
}

async function submitCreate() {
  await createUser({ ...createForm });
  ElMessage.success('用户创建成功');
  createVisible.value = false;
  load();
}

/* 重置密码 */
async function openReset(row) {
  const { value } = await ElMessageBox.prompt(`为“${row.username}”设置新密码`, '重置密码', {
    inputType: 'password',
    inputValidator: (v) => (v?.length >= 6 ? true : '密码至少 6 位'),
  });
  await resetPassword(row.id, value);
  ElMessage.success('密码已重置');
}

onMounted(load);
</script>

<style scoped>
.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-title {
  font-weight: 600;
}
</style>
