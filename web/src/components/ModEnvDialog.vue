<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="v => emit('update:modelValue', v)"
    title="注入环境自检 / 设置"
    width="600px"
    @open="onOpen"
  >
    <div v-loading="loading">
      <!-- 总体状态 -->
      <el-result
        v-if="diag"
        :icon="diag.ready ? 'success' : 'error'"
        :title="diag.ready ? '环境就绪，可以注入' : '环境未就绪'"
        :sub-title="diag.ready ? `目标设备 ${diag.targetSerial} · ${currentChannelLabel}` : ''"
        style="padding: 8px 0"
      />

      <!-- 问题清单 -->
      <el-alert
        v-for="(p, i) in diag?.problems || []"
        :key="i"
        :title="p"
        type="error"
        :closable="false"
        show-icon
        style="margin-bottom: 8px"
      />

      <!-- 逐项检查结果 -->
      <el-descriptions v-if="diag" :column="1" border size="small" style="margin-top: 6px">
        <el-descriptions-item label="adb">
          <el-tag :type="diag.adb.ok ? 'success' : 'danger'" size="small">
            {{ diag.adb.ok ? '可用' : '不可用' }}
          </el-tag>
          <span class="mono">{{ diag.adb.path }}</span>
          <span v-if="diag.adb.version" class="dim">（{{ diag.adb.version }}）</span>
        </el-descriptions-item>
        <el-descriptions-item label="在线设备">
          <template v-if="diag.devices.length">
            <el-tag
              v-for="d in diag.devices"
              :key="d.serial"
              size="small"
              :type="d.state === 'device' ? 'success' : 'info'"
              style="margin-right: 6px"
            >
              {{ d.serial }}（{{ d.state === 'device' ? '在线' : d.state }}）
            </el-tag>
            <span v-if="diag.targetSerial" class="dim">目标：{{ diag.targetSerial }}</span>
          </template>
          <span v-else class="danger-text">无在线设备</span>
        </el-descriptions-item>
        <el-descriptions-item label="游戏渠道">
          <el-tag :type="diag.game.installed ? 'success' : 'danger'" size="small">
            {{ diag.game.installed ? '已安装' : '未安装' }}
          </el-tag>
          <span class="mono">{{ diag.game.package }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="资源目录">
          <el-tag :type="diag.game.assetsDirExists ? 'success' : 'danger'" size="small">
            {{ diag.game.assetsDirExists ? '存在' : '缺失' }}
          </el-tag>
          <span class="mono dim">{{ diag.game.assetsPath }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <!-- 设置（仅管理员可编辑）-->
      <template v-if="isAdmin">
        <el-divider content-position="left">注入设置</el-divider>
        <el-form label-width="92px" size="small">
          <el-form-item label="游戏渠道">
            <el-select v-model="form.gamePackage" clearable placeholder="默认 4399 国服" style="width: 100%">
              <el-option v-for="p in packages" :key="p.value" :label="p.label" :value="p.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="目标设备">
            <el-select v-model="form.deviceSerial" clearable placeholder="自动选择（唯一设备 / emulator-5554）" style="width: 100%">
              <el-option v-for="d in diag?.devices || []" :key="d.serial" :label="`${d.serial}（${d.state}）`" :value="d.serial" />
            </el-select>
          </el-form-item>
          <el-form-item label="adb 路径">
            <el-input v-model="form.adbPath" placeholder="留空自动探测 MuMu，或手动填 adb.exe 完整路径" />
          </el-form-item>
        </el-form>
      </template>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button :loading="loading" @click="runDiagnose">重新检测</el-button>
      <el-button v-if="isAdmin" type="primary" :loading="saving" @click="onSave">保存设置</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { useUserStore } from '../stores/user.js';
import { diagnoseMod, getGamePackages, saveModSettings } from '../api/mod.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
});
const emit = defineEmits(['update:modelValue', 'saved']);

const userStore = useUserStore();
const isAdmin = computed(() => userStore.isAdmin);

const loading = ref(false);
const saving = ref(false);
const diag = ref(null);
const packages = ref([]);
const form = reactive({ gamePackage: '', deviceSerial: '', adbPath: '' });

const currentChannelLabel = computed(() => {
  const p = packages.value.find(x => x.value === diag.value?.game?.package);
  return p ? p.label : diag.value?.game?.package || '';
});

async function runDiagnose() {
  loading.value = true;
  try {
    diag.value = await diagnoseMod();
  } finally {
    loading.value = false;
  }
}

function fillForm(settings) {
  form.gamePackage = settings?.gamePackage || '';
  form.deviceSerial = settings?.deviceSerial || '';
  form.adbPath = settings?.adbPath || '';
}

async function onOpen() {
  loading.value = true;
  try {
    const [d, pkgs] = await Promise.all([diagnoseMod(), getGamePackages()]);
    diag.value = d;
    packages.value = pkgs;
    fillForm(d.settings);
  } finally {
    loading.value = false;
  }
}

async function onSave() {
  saving.value = true;
  try {
    const settings = await saveModSettings({ ...form });
    ElMessage.success('设置已保存');
    fillForm(settings);
    emit('saved');
    await runDiagnose();
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.mono {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
  margin-left: 8px;
}
.dim {
  color: #909399;
}
.danger-text {
  color: #f56c6c;
  font-size: 13px;
}
</style>
