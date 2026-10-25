<template>
  <div class="file-table-wrap">
    <!-- 子文件夹区 -->
    <slot name="folder-row" />

    <el-table
      ref="tableRef"
      :data="rows"
      row-key="id"
      @row-contextmenu="openContextMenu"
      @row-click="previewRow"
      @selection-change="onSelectionChange"
      stripe
    >
      <el-table-column v-if="selectable" type="selection" width="46" reserve-selection />
      <el-table-column min-width="260">
        <template #label>
          <span>文件名</span>
        </template>
        <template #default="{ row }">
          <div class="name-cell">
            <ArchiveCover v-if="isArchive(row.name)" :id="row.id" :type="row.type" :name="row.name" />
            <el-icon v-else :size="20" :color="typeColor(row.type)"><component :is="typeIcon(row.type)" /></el-icon>
            <span class="file-name" :title="row.name">{{ row.name }}</span>
            <el-icon v-if="row.is_starred" color="#f7ba2a"><StarFilled /></el-icon>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="所属分类（标签）" min-width="200">
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
          <span v-if="!row.tags?.length" class="muted">未分类</span>
        </template>
      </el-table-column>
      <el-table-column label="大小" width="100">
        <template #default="{ row }">{{ formatSize(row.size) }}</template>
      </el-table-column>
      <el-table-column v-if="col.showOriginDate" label="原始日期" width="160">
        <template #default="{ row }">{{ row.origin_date || '—' }}</template>
      </el-table-column>
      <el-table-column v-if="col.showUploader" prop="creator_name" label="上传人" width="110" show-overflow-tooltip />
      <el-table-column v-if="col.showUploadTime" prop="updated_at" label="上传时间" width="160" />
      <el-table-column label="操作" width="256" align="center" fixed="right">
        <template #default="{ row }">
          <div class="row-actions">
            <el-button v-if="isArchive(row.name)" link type="success" @click.stop="emit('action', { action: 'painting', row })">立绘</el-button>
            <el-button v-if="isArchive(row.name)" link type="success" @click.stop="emit('action', { action: 'dynamic', row })">动态</el-button>
            <el-button
              v-if="isArchive(row.name)"
              link
              :type="row.mod_enabled ? 'info' : 'warning'"
              @click.stop="emit('action', { action: 'mod', row })"
            >{{ row.mod_enabled ? '已注入' : '注入' }}</el-button>
            <el-button link type="primary" @click.stop="emit('action', { action: 'share', row })">分享</el-button>
            <el-button link type="primary" @click.stop="emit('action', { action: 'tags', row })">标签</el-button>
            <el-button link type="danger" @click.stop="emit('action', { action: 'delete', row })">删除</el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <!-- 右键菜单 -->
    <div
      v-if="menu.visible"
      class="context-menu"
      :style="{ top: menu.y + 'px', left: menu.x + 'px' }"
      @click.stop
    >
      <div class="menu-item" @click="run('download')">⬇️ 下载</div>
      <div class="menu-item" @click="run('rename')">✏️ 重命名</div>
      <div class="menu-item" @click="run('tags')">🏷️ 归类（编辑标签）</div>
      <div class="menu-item" @click="run('star')">{{ menu.row?.is_starred ? '☆ 取消收藏' : '★ 收藏' }}</div>
      <div class="menu-item" @click="run('share')">🔗 分享</div>
      <div v-if="isArchive(menu.row?.name)" class="menu-item paint" @click="run('painting')">🖼️ 查看包内立绘</div>
      <div v-if="isArchive(menu.row?.name)" class="menu-item paint" @click="run('dynamic')">✨ 动态立绘预览</div>
      <div v-if="isArchive(menu.row?.name)" class="menu-item mod" @click="run('mod')">
        {{ menu.row?.mod_enabled ? '✅ 已注入（管理/还原）' : '🎮 注入游戏（Mod）' }}
      </div>
      <div class="menu-item danger" @click="run('delete')">🗑️ 删除</div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { formatSize, typeIcon, typeColor, isArchive } from '../utils/format.js';
import ArchiveCover from './ArchiveCover.vue';
import { useTableSettingsStore } from '../stores/tableSettings.js';

const col = useTableSettingsStore();

const props = defineProps({
  rows: { type: Array, default: () => [] },
  selectable: { type: Boolean, default: false }, // 是否显示复选框（用于批量删除）
});
const emit = defineEmits(['action', 'selection-change']);

const tableRef = ref();

function onSelectionChange(rows) {
  emit('selection-change', rows);
}

/** 清空选中项（供父组件调用） */
function clearSelection() {
  tableRef.value?.clearSelection();
}

defineExpose({ clearSelection });

const menu = reactive({ visible: false, x: 0, y: 0, row: null });

function openContextMenu(row, _col, event) {
  menu.row = row;
  menu.x = event.clientX;
  menu.y = event.clientY;
  menu.visible = true;
}

function closeMenu() {
  menu.visible = false;
}

function run(action) {
  emit('action', { action, row: menu.row });
  closeMenu();
}

function previewRow() {
  /* 标签模式下不做单击预览，避免误触下载 */
}

onMounted(() => document.addEventListener('click', closeMenu));
onUnmounted(() => document.removeEventListener('click', closeMenu));
</script>

<style scoped>
/* 操作列按钮平铺：等宽、不换行、间距均匀 */
.row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
  gap: 2px;
}
.row-actions :deep(.el-button) {
  margin: 0;
  padding: 2px 4px;
  flex: 0 0 auto;
  height: auto;
  min-height: 24px;
}
.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}
.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.muted {
  color: #c0c4cc;
}
.context-menu {
  position: fixed;
  z-index: 3000;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  padding: 6px 0;
  min-width: 150px;
}
.menu-item {
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
}
.menu-item:hover {
  background: #f5f7fa;
  color: #409eff;
}
.menu-item.danger:hover {
  color: #f56c6c;
}
.menu-item.mod:hover {
  color: #e6a23c;
}
.menu-item.paint:hover {
  color: #67c23a;
}
</style>
