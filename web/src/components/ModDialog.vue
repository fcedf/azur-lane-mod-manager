<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="v => emit('update:modelValue', v)"
    :title="`注入游戏 — ${file?.name || ''}`"
    width="520px"
    @open="onOpen"
  >
    <div v-loading="loading">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom: 14px">
        <template #title>
          将包内立绘替换进 MuMu 中的碧蓝航线，<b>重启游戏生效</b>。只替换立绘 AssetBundle，不改动游戏更新清单；被热更覆盖后重新应用即可。
        </template>
      </el-alert>

      <div v-if="state" class="mod-status">
        <el-tag :type="state.enabled ? 'success' : 'info'" size="large">
          {{ state.enabled ? '已启用' : '未启用' }}
        </el-tag>
        <el-tag v-if="state.enabled && state.source" type="warning" size="large" effect="plain">
          版本：{{ state.source }}
        </el-tag>
        <span class="mod-meta">注入文件 {{ state.count }} 个</span>
        <span v-if="state.appliedAt" class="mod-meta">时间：{{ state.appliedAt }}</span>
      </div>

      <el-alert
        v-if="multiSources.length"
        type="warning"
        :closable="false"
        show-icon
        title="该压缩包含多个版本，注入目标相同，请二选一"
        style="margin-top: 12px"
      >
        <div class="source-row">
          <el-radio-group v-model="pickedSource">
            <el-radio v-for="s in multiSources" :key="s" :value="s">
              {{ s === '' ? '默认' : s }}
            </el-radio>
          </el-radio-group>
        </div>
      </el-alert>

      <div v-if="needPassword" class="pw-box">
        <el-input
          v-model="password"
          type="password"
          placeholder="请输入压缩包密码"
          show-password
          clearable
          @keyup.enter="onApply"
        >
          <template #prefix><el-icon><Lock /></el-icon></template>
        </el-input>
        <p v-if="passwordError" class="pw-error">{{ passwordError }}</p>
        <p v-else class="pw-hint">该压缩包已加密，输入密码后将记住，下次无需再填</p>
      </div>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-popconfirm
        v-if="state?.enabled"
        title="确定还原为游戏原版资源吗？"
        confirm-button-text="确定还原"
        cancel-button-text="取消"
        @confirm="onRevert"
      >
        <template #reference>
          <el-button type="danger" plain :loading="busy">还原原版</el-button>
        </template>
      </el-popconfirm>
      <el-button type="primary" :loading="busy" @click="onApply">
        {{ state?.enabled ? '重新应用' : '一键应用' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Lock } from '@element-plus/icons-vue';
import { getModState, applyMod, revertMod } from '../api/mod.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  file: { type: Object, default: null },
});
const emit = defineEmits(['update:modelValue', 'changed']);

const loading = ref(false);
const busy = ref(false);
const state = ref(null);
const multiSources = ref([]);
const pickedSource = ref('');
const needPassword = ref(false);
const password = ref('');
const passwordError = ref('');

async function loadState() {
  if (!props.file) return;
  loading.value = true;
  try {
    state.value = await getModState(props.file.id);
    // 已注入某版本时默认选中它
    pickedSource.value = state.value.source || '';
  } catch (e) {
    // 错误已由拦截器提示
  } finally {
    loading.value = false;
  }
}

function onOpen() {
  multiSources.value = [];
  needPassword.value = false;
  password.value = '';
  passwordError.value = '';
  loadState();
}

watch(
  () => props.modelValue,
  v => {
    if (v) onOpen();
  }
);

async function onApply() {
  if (busy.value) return;
  if (needPassword.value && !password.value) {
    passwordError.value = '请输入压缩包密码';
    return;
  }
  busy.value = true;
  passwordError.value = '';
  try {
    await applyMod(
      props.file.id,
      multiSources.value.length ? pickedSource.value : undefined,
      needPassword.value ? password.value : undefined
    );
    multiSources.value = [];
    needPassword.value = false;
    password.value = '';
    ElMessage.success('应用成功，重启游戏生效');
    await loadState();
    emit('changed');
  } catch (e) {
    // 4001：需要密码 / 密码错误（与动态预览同一业务码）
    if (e.code === 4001 || e.data?.needPassword) {
      needPassword.value = true;
      if (password.value) passwordError.value = '密码错误，请重新输入';
      else passwordError.value = '该压缩包已加密，请输入密码';
      return;
    }
    if (e.code === 409 && e.data?.multiSource) {
      multiSources.value = e.data.sources || [];
      if (!multiSources.value.includes(pickedSource.value)) {
        pickedSource.value = multiSources.value[0] || '';
      }
      // 多版本时如果也需要密码，保留密码框
      ElMessage.info('该包含多个版本，请选择后再次点击应用');
    }
  } finally {
    busy.value = false;
  }
}

async function onRevert() {
  if (busy.value) return;
  busy.value = true;
  try {
    await revertMod(props.file.id);
    ElMessage.success('已还原');
    await loadState();
    emit('changed');
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.mod-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.mod-meta {
  color: #909399;
  font-size: 13px;
}
.source-row {
  margin-top: 8px;
}
.pw-box {
  margin-top: 14px;
}
.pw-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
}
.pw-error {
  margin: 6px 0 0;
  font-size: 12px;
  color: #f56c6c;
}
</style>
