<template>
  <div class="storage-page">
    <!-- 注入环境自检 / 设置 -->
    <el-card shadow="never" class="env-card">
      <div class="env-row">
        <div class="env-info">
          <el-icon :size="22" color="#409eff"><Monitor /></el-icon>
          <div>
            <div class="env-title">Mod 注入环境</div>
            <div class="env-desc">检测 ADB / MuMu 模拟器连接与注入通道，手机真机通道等设置。</div>
          </div>
        </div>
        <el-button type="primary" plain :icon="Monitor" @click="modEnvVisible = true">注入环境</el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="storage-card">
      <template #header>
        <div class="card-head">
          <span class="title">存储位置设置</span>
          <el-button type="primary" :icon="Plus" @click="addVisible = true">添加存储盘</el-button>
        </div>
      </template>

      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px">
        <template #title>
          文件统一保存在各盘的 <b>fms-files</b> 目录（如 D:\fms-files、E:\fms-files），避免散落在各处。
          “当前存储”只决定<b>新上传</b>存到哪个盘；已在别的盘的文件仍按原位置读取、预览和注入，互不影响。
        </template>
      </el-alert>

      <el-table :data="roots" v-loading="loading" stripe>
        <el-table-column label="存储位置" min-width="260">
          <template #default="{ row }">
            <div class="root-path">
              <el-icon class="drive-ico"><FolderOpened /></el-icon>
              <span>{{ row.path }}</span>
              <el-tag v-if="row.isDefault" size="small" type="info" effect="plain">默认</el-tag>
              <el-tag v-if="row.isCurrent" size="small" type="success">当前使用</el-tag>
            </div>
            <div v-if="row.label" class="root-label">{{ row.label }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="150">
          <template #default="{ row }">
            <el-tag v-if="!row.exists" type="danger" size="small">目录不存在</el-tag>
            <el-tag v-else-if="!row.writable" type="warning" size="small">不可写</el-tag>
            <el-tag v-else type="success" size="small" effect="plain">可用</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="文件数" width="90" prop="fileCount" />
        <el-table-column label="操作" width="180" align="right">
          <template #default="{ row }">
            <el-button
              v-if="!row.isCurrent"
              type="primary" link
              :disabled="!row.exists || !row.writable"
              @click="onSwitch(row)"
            >设为当前</el-button>
            <el-button
              v-if="!row.isDefault"
              type="danger" link
              :disabled="row.fileCount > 0 || row.isCurrent"
              @click="onRemove(row)"
            >移除</el-button>
            <span v-if="!row.isDefault && row.fileCount > 0" class="muted">有文件不可删</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 界面显示（隐藏功能） -->
    <el-card shadow="never" class="hide-card">
      <template #header>
        <div class="card-head">
          <span class="title">界面显示</span>
          <el-button link type="primary" @click="resetColumns">恢复默认</el-button>
        </div>
      </template>
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 14px">
        <template #title>关闭开关可在文件列表中隐藏对应列，设置在本机自动保存，对所有列表页生效。</template>
      </el-alert>
      <div class="switch-row">
        <span class="switch-label">原始日期</span>
        <el-switch :model-value="col.showOriginDate" @change="v => col.toggle('originDate', v)" />
      </div>
      <div class="switch-row">
        <span class="switch-label">上传人</span>
        <el-switch :model-value="col.showUploader" @change="v => col.toggle('uploader', v)" />
      </div>
      <div class="switch-row">
        <span class="switch-label">上传时间</span>
        <el-switch :model-value="col.showUploadTime" @change="v => col.toggle('uploadTime', v)" />
      </div>
    </el-card>

    <!-- 添加存储盘 -->
    <el-dialog v-model="addVisible" title="添加存储盘" width="420px">
      <el-form label-width="72px">
        <el-form-item label="盘符">
          <el-select v-model="drive" placeholder="选择盘符" style="width: 100%">
            <el-option
              v-for="d in availableDrives"
              :key="d"
              :label="`${d} 盘（系统自动建 fms-files）`"
              :value="d"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="备注名">
          <el-input v-model="label" placeholder="可选，如：移动硬盘、大盘" maxlength="20" />
        </el-form-item>
      </el-form>
      <el-alert type="warning" :closable="false" show-icon>
        <template #title>系统会在所选盘根目录自动创建 <b>fms-files</b> 文件夹，不会动其他任何文件。</template>
      </el-alert>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onAdd">添加</el-button>
      </template>
    </el-dialog>

    <!-- 注入环境自检 / 设置 -->
    <mod-env-dialog v-model="modEnvVisible" />
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, FolderOpened } from '@element-plus/icons-vue';
import {
  getStorageRoots, addStorageRoot, setCurrentRoot, removeStorageRoot,
} from '../api/storage.js';
import ModEnvDialog from '../components/ModEnvDialog.vue';
import { Monitor } from '@element-plus/icons-vue';

const modEnvVisible = ref(false);
import { useTableSettingsStore } from '../stores/tableSettings.js';

const col = useTableSettingsStore();
function resetColumns() {
  col.reset();
}

const loading = ref(false);
const roots = ref([]);
const addVisible = ref(false);
const saving = ref(false);
const drive = ref('');
const label = ref('');

// 常见盘符候选；浏览器无法直接列盘，给常用 C-Z，由后端校验是否存在
const availableDrives = computed(() => {
  const used = new Set(roots.value.map((r) => (r.path || '').slice(0, 2).toUpperCase()));
  return ['C', 'D', 'E', 'F', 'G', 'H'].filter((d) => !used.has(`${d}:`));
});

async function load() {
  loading.value = true;
  try {
    roots.value = (await getStorageRoots()).roots || [];
  } finally {
    loading.value = false;
  }
}

async function onAdd() {
  if (!drive.value) {
    ElMessage.warning('请选择盘符');
    return;
  }
  saving.value = true;
  try {
    roots.value = await addStorageRoot(`${drive.value}:`, label.value.trim());
    ElMessage.success(`已添加 ${drive.value}: 盘存储`);
    addVisible.value = false;
    drive.value = '';
    label.value = '';
  } finally {
    saving.value = false;
  }
}

async function onSwitch(row) {
  try {
    await ElMessageBox.confirm(
      `切换后，新上传的文件将保存到 ${row.path}。旧文件不受影响。确认切换？`,
      '切换当前存储',
      { type: 'warning', confirmButtonText: '设为当前', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  await setCurrentRoot(row.id);
  ElMessage.success('当前存储已切换');
  load();
}

async function onRemove(row) {
  try {
    await ElMessageBox.confirm(
      `移除存储位置 ${row.path}？仅删除登记记录，不会删除磁盘上的文件夹。`,
      '移除存储',
      { type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消' }
    );
  } catch {
    return;
  }
  roots.value = await removeStorageRoot(row.id);
  ElMessage.success('已移除');
}

onMounted(load);
</script>

<style scoped>
.env-card {
  margin-bottom: 16px;
}
.env-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.env-info {
  display: flex;
  align-items: center;
  gap: 12px;
}
.env-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}
.env-desc {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-size: 16px;
  font-weight: 600;
}
.root-path {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}
.drive-ico {
  color: #409eff;
}
.root-label {
  color: #909399;
  font-size: 12px;
  margin-top: 2px;
}
.muted {
  color: #c0c4cc;
  font-size: 12px;
}
.hide-card {
  margin-top: 16px;
}
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 360px;
  padding: 10px 4px;
  border-bottom: 1px dashed #ebeef5;
}
.switch-row:last-child {
  border-bottom: none;
}
.switch-label {
  font-size: 14px;
  color: #303133;
}
</style>
