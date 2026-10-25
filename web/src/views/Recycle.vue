<template>
  <el-card shadow="never">
    <template #header>
      <div class="header-bar">
        <span class="title"><el-icon><Delete /></el-icon> 回收站（保留 30 天）</span>
        <el-button type="danger" plain @click="emptyAll">清空回收站</el-button>
      </div>
    </template>

    <el-table :data="rows" stripe>
      <el-table-column label="文件名" min-width="260">
        <template #default="{ row }">
          <div class="name-cell">
            <el-icon :size="20" :color="typeColor(row.type)"><component :is="typeIcon(row.type)" /></el-icon>
            <span>{{ row.name }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="space_name" label="原分区" width="130" />
      <el-table-column label="大小" width="110">
        <template #default="{ row }">{{ formatSize(row.size) }}</template>
      </el-table-column>
      <el-table-column prop="creator_name" label="上传人" width="110" />
      <el-table-column prop="deleted_at" label="删除时间" width="170" />
      <el-table-column label="操作" width="180">
        <template #default="{ row }">
          <el-button link type="primary" @click="doRestore(row)">还原</el-button>
          <el-button link type="danger" @click="doPermanent(row)">彻底删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!rows.length" description="回收站是空的" />
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getRecycleList, restoreFile, permanentDeleteFile } from '../api/file.js';
import { formatSize, typeIcon, typeColor } from '../utils/format.js';

const rows = ref([]);

async function load() {
  rows.value = await getRecycleList();
}

async function doRestore(row) {
  await restoreFile(row.id);
  ElMessage.success('还原成功');
  load();
}

async function doPermanent(row) {
  await ElMessageBox.confirm(`彻底删除“${row.name}”？此操作不可恢复！`, '危险操作', {
    type: 'error',
    confirmButtonText: '彻底删除',
  });
  await permanentDeleteFile(row.id);
  ElMessage.success('已彻底删除');
  load();
}

async function emptyAll() {
  if (!rows.value.length) return ElMessage.info('回收站已空');
  await ElMessageBox.confirm(`确定清空全部 ${rows.value.length} 个文件？不可恢复！`, '危险操作', {
    type: 'error',
    confirmButtonText: '全部彻底删除',
  });
  for (const row of rows.value) {
    await permanentDeleteFile(row.id);
  }
  ElMessage.success('回收站已清空');
  load();
}

onMounted(load);
</script>

<style scoped>
.header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
