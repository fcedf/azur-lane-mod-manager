<template>
  <div>
    <!-- 统计卡片 -->
    <el-row :gutter="16">
      <el-col :span="6" v-for="card in cards" :key="card.label">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-label">{{ card.label }}</div>
          <div class="stat-value" :style="{ color: card.color }">{{ card.value }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" style="margin-top: 16px">
      <el-col :span="14">
        <el-card shadow="never">
          <template #header><span class="panel-title">分区存储用量排行</span></template>
          <el-table :data="stats.spaceRanking" stripe>
            <el-table-column label="分区" min-width="140">
              <template #default="{ row }">
                <el-icon :color="row.color"><Folder /></el-icon>
                {{ row.name }}
              </template>
            </el-table-column>
            <el-table-column label="文件数" width="90" prop="file_count" />
            <el-table-column label="已用空间" width="130">
              <template #default="{ row }">{{ formatSize(row.used_size) }}</template>
            </el-table-column>
            <el-table-column label="占比">
              <template #default="{ row }">
                <el-progress :percentage="percent(row.used_size)" />
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card shadow="never" class="summary-card">
          <template #header><span class="panel-title">存储总览</span></template>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="活跃用户">{{ stats.userCount }} 人</el-descriptions-item>
            <el-descriptions-item label="分区数量">{{ stats.spaceCount }} 个</el-descriptions-item>
            <el-descriptions-item label="有效文件">{{ stats.fileCount }} 个</el-descriptions-item>
            <el-descriptions-item label="文件总大小">{{ formatSize(stats.totalSize) }}</el-descriptions-item>
            <el-descriptions-item label="回收站文件">{{ stats.recycleCount }} 个</el-descriptions-item>
            <el-descriptions-item label="回收站占用">{{ formatSize(stats.recycleSize) }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { getStats } from '../../api/admin.js';
import { formatSize } from '../../utils/format.js';

const stats = ref({ spaceRanking: [] });

const cards = computed(() => [
  { label: '活跃用户', value: `${stats.value.userCount || 0} 人`, color: '#409eff' },
  { label: '文件总数', value: `${stats.value.fileCount || 0} 个`, color: '#67c23a' },
  { label: '存储总量', value: formatSize(stats.value.totalSize || 0), color: '#e6a23c' },
  { label: '回收站', value: `${stats.value.recycleCount || 0} 个`, color: '#f56c6c' },
]);

function percent(size) {
  const max = Math.max(...(stats.value.spaceRanking || []).map((s) => s.used_size), 1);
  return Math.round(((size || 0) / max) * 100);
}

onMounted(async () => {
  stats.value = await getStats();
});
</script>

<style scoped>
.stat-card {
  text-align: center;
}
.stat-label {
  color: #909399;
  font-size: 14px;
}
.stat-value {
  font-size: 28px;
  font-weight: 700;
  margin-top: 8px;
}
.panel-title {
  font-weight: 600;
}
.summary-card {
  height: 100%;
}
</style>
