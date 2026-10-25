<template>
  <el-card shadow="never">
    <template #header>
      <span class="title"><el-icon><Share /></el-icon> 我的分享</span>
    </template>

    <el-table :data="rows" stripe>
      <el-table-column prop="file_name" label="文件名" min-width="220" />
      <el-table-column label="分享链接" min-width="280">
        <template #default="{ row }">
          <el-link :href="`/share/${row.code}`" target="_blank" type="primary">
            {{ `${window.location.origin}/share/${row.code}` }}
          </el-link>
        </template>
      </el-table-column>
      <el-table-column label="密码" width="80">
        <template #default="{ row }">{{ row.password || '无' }}</template>
      </el-table-column>
      <el-table-column label="权限" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="row.permission === 'download' ? 'success' : 'info'">
            {{ row.permission === 'download' ? '可下载' : '仅预览' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="有效期" width="170">
        <template #default="{ row }">{{ row.expire_at || '永久有效' }}</template>
      </el-table-column>
      <el-table-column prop="view_count" label="访问次数" width="90" />
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <el-button link type="danger" @click="doCancel(row)">取消分享</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!rows.length" description="还没有分享过文件" />
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getMyShares, cancelShare } from '../api/share.js';

const rows = ref([]);

async function load() {
  rows.value = await getMyShares();
}

async function doCancel(row) {
  await ElMessageBox.confirm('确定取消该分享？链接将立即失效', '提示', { type: 'warning' });
  await cancelShare(row.id);
  ElMessage.success('分享已取消');
  load();
}

onMounted(load);
</script>

<style scoped>
.title {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
