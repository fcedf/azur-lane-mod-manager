<template>
  <el-card shadow="never">
    <template #header>
      <div class="header-bar">
        <span class="panel-title">操作日志</span>
        <div class="filters">
          <el-select v-model="actionFilter" placeholder="操作类型" clearable style="width: 150px" @change="load">
            <el-option v-for="a in ACTIONS" :key="a.value" :label="a.label" :value="a.value" />
          </el-select>
          <el-input v-model="usernameFilter" placeholder="用户名" clearable style="width: 150px" @keyup.enter="load" />
          <el-button type="primary" @click="load">查询</el-button>
        </div>
      </div>
    </template>

    <el-table :data="rows" stripe height="calc(100vh - 220px)">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="username" label="操作用户" width="130" />
      <el-table-column label="操作" width="150">
        <template #default="{ row }">
          <el-tag size="small">{{ actionLabel(row.action) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="target_type" label="对象类型" width="100" />
      <el-table-column prop="detail" label="详情" min-width="240" show-overflow-tooltip />
      <el-table-column prop="ip" label="IP 地址" width="140" />
      <el-table-column prop="created_at" label="时间" width="170" />
    </el-table>
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { getLogs } from '../../api/admin.js';

const ACTIONS = [
  { value: 'login', label: '登录' },
  { value: 'change_password', label: '修改密码' },
  { value: 'upload', label: '上传' },
  { value: 'download', label: '下载' },
  { value: 'delete', label: '删除' },
  { value: 'permanent_delete', label: '彻底删除' },
  { value: 'create_folder', label: '新建文件夹' },
  { value: 'delete_folder', label: '删除文件夹' },
  { value: 'move', label: '移动' },
  { value: 'share', label: '分享' },
];

const rows = ref([]);
const actionFilter = ref('');
const usernameFilter = ref('');

function actionLabel(value) {
  return ACTIONS.find((a) => a.value === value)?.label || value;
}

async function load() {
  rows.value = await getLogs({
    action: actionFilter.value,
    username: usernameFilter.value,
  });
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
.filters {
  display: flex;
  gap: 10px;
}
</style>
