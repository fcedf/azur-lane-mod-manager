<template>
  <el-card shadow="never">
    <template #header>
      <span class="title"><el-icon><Star /></el-icon> 我的收藏</span>
    </template>

    <el-table :data="rows" stripe>
      <el-table-column label="文件名" min-width="280">
        <template #default="{ row }">
          <div class="name-cell">
            <el-icon :size="20" :color="typeColor(row.type)"><component :is="typeIcon(row.type)" /></el-icon>
            <span>{{ row.name }}</span>
            <el-icon color="#f7ba2a"><StarFilled /></el-icon>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="所属分类" min-width="180">
        <template #default="{ row }">
          <el-tag
            v-for="(t, i) in row.tags"
            :key="i"
            size="small"
            :color="t.color"
            style="margin-right: 4px; border: none; color: #fff"
          >
            {{ t.name }}
          </el-tag>
          <span v-if="!row.tags?.length" style="color: #c0c4cc">未分类</span>
        </template>
      </el-table-column>
      <el-table-column label="大小" width="110">
        <template #default="{ row }">{{ formatSize(row.size) }}</template>
      </el-table-column>
      <el-table-column prop="updated_at" label="修改时间" width="170" />
      <el-table-column label="操作" width="180">
        <template #default="{ row }">
          <el-button link type="primary" @click="doDownload(row)">下载</el-button>
          <el-button link type="warning" @click="doUnstar(row)">取消收藏</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!rows.length" description="还没有收藏任何文件" />
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { browseFiles, starFile, downloadFile } from '../api/file.js';
import { formatSize, typeIcon, typeColor } from '../utils/format.js';

const rows = ref([]);

async function load() {
  const all = await browseFiles({});
  rows.value = all.filter((f) => f.is_starred);
}

async function doDownload(row) {
  await downloadFile(row.id, row.name);
}

async function doUnstar(row) {
  await ElMessageBox.confirm(`取消收藏“${row.name}”？`, '提示', { type: 'warning' });
  await starFile(row.id, false);
  ElMessage.success('已取消收藏');
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
.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
