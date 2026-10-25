<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="v => emit('update:modelValue', v)"
    :title="`动态立绘预览 — ${file?.name || ''}`"
    width="900px"
    top="5vh"
    @open="onOpen"
    @closed="activeKey = ''"
  >
    <div v-loading="loading" class="dyn-body" :style="{ height: viewportH + 'px' }">
      <template v-if="!loading && items.length">
        <div class="dyn-tabs">
          <div
            v-for="it in items"
            :key="it.key"
            class="dyn-tab"
            :class="{ on: it.key === activeKey }"
            @click="selectItem(it.key)"
          >
            <span class="badge" :class="it.kind">{{ it.kind === 'spine' ? '动' : 'L2D' }}</span>
            <span class="t-name" :title="it.source ? it.source + '/' + it.name : it.name">{{ tabLabel(it) }}</span>
            <el-tooltip v-if="hasWarn(it)" placement="top" :content="warnText(it)">
              <el-icon class="t-warn"><WarningFilled /></el-icon>
            </el-tooltip>
          </div>
        </div>
        <el-alert
          v-if="activeItem && hasWarn(activeItem)"
          class="dyn-warn"
          type="warning"
          :closable="false"
          show-icon
          :title="warnText(activeItem)"
        />
        <div class="dyn-stage">
          <SpinePlayer
            v-if="activeItem?.kind === 'spine'"
            :key="'s-' + activeItem.key"
            :file-id="file.id"
            :item="activeItem"
            @cover="onCover"
          />
          <Live2dPlayer
            v-else-if="activeItem?.kind === 'live2d'"
            :key="'l-' + activeItem.key"
            :file-id="file.id"
            :item="activeItem"
            @cover="onCover"
          />
        </div>
      </template>

      <!-- 压缩包本身加密（WinZip AES 等）：输入密码，成功后记住 -->
      <div v-else-if="needPassword" class="pw-panel">
        <el-icon :size="40" color="#e6a23c"><Lock /></el-icon>
        <p class="pw-title">该压缩包已加密</p>
        <p class="pw-sub">输入压缩包密码以提取并预览动态立绘，成功后会自动记住。</p>
        <el-input
          v-model="password"
          type="password"
          show-password
          placeholder="压缩包密码"
          class="pw-input"
          @keyup.enter="submitPassword"
        />
        <p v-if="pwError" class="pw-err">{{ pwError }}</p>
        <el-button type="primary" :loading="loading" @click="submitPassword">解密并预览</el-button>
      </div>

      <div v-else-if="!loading" class="dyn-empty">
        <el-empty :image-size="80" :description="encrypted.length ? '该包内的动态资源为加密格式，暂不支持动态预览' : '未在包内找到可动态预览的 Spine / Live2D 资源'" />
        <div v-if="encrypted.length" class="enc-list">
          <div v-for="(e, i) in encrypted" :key="i" class="enc-item">
            <el-tag size="small" :type="e.kind === 'unknown' ? 'danger' : 'warning'">
              {{ e.kind === 'spine' ? 'Spine' : e.kind === 'live2d' ? 'Live2D' : '加密' }}
            </el-tag>
            <span class="enc-name">{{ e.name }}</span>
            <span v-if="e.source && e.source !== e.name" class="enc-src">{{ e.source }}</span>
            <span v-if="e.error" class="enc-err" :title="e.error">（提取异常）</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button :loading="loading" @click="load(true)">刷新重新提取</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch, defineAsyncComponent, h } from 'vue';
import { ElMessage } from 'element-plus';
import { Lock, WarningFilled } from '@element-plus/icons-vue';
import { getDynamic, uploadComposedCover } from '../api/dynamic.js';

// pixi / pixi-spine / pixi-live2d-display 体积较大，按需异步加载：仅打开动态弹窗时才拉取
const SpinePlayer = defineAsyncComponent(() => import('./dyn/SpinePlayer.vue'));
const Live2dPlayer = defineAsyncComponent({
  loader: () => import('./dyn/Live2dPlayer.vue'),
  errorComponent: { render: () => h('div', { style: 'color:var(--el-color-danger);padding:16px;font-size:13px;' }, 'Live2D 播放器加载失败') },
  delay: 0,
});

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  file: { type: Object, default: null },
});
const emit = defineEmits(['update:modelValue']);

const loading = ref(false);
const items = ref([]);
const encrypted = ref([]);
const activeKey = ref('');
const activeItem = ref(null);
const viewportH = 560;
const needPassword = ref(false);
const password = ref('');
const pwError = ref('');

function selectItem(key) {
  activeKey.value = key;
  activeItem.value = items.value.find(i => i.key === key) || null;
}

// 本次会话内已为某文件生成过合成封面，避免反复上传
const composedDone = new Set();
let uploading = false;

// 播放器在稳定后的渲染帧内取好“白底仅人物”首帧 dataUrl，直接上报为列表封面（每文件一次）
async function onCover(dataUrl) {
  const fileId = props.file?.id;
  if (!fileId || uploading || composedDone.has(fileId) || !dataUrl) return;
  uploading = true;
  try {
    const res = await uploadComposedCover(fileId, dataUrl);
    if (res?.ok) {
      composedDone.add(fileId);
      // 通知文件列表即时刷新该文件封面（若服务端跳过表示已有静态封面，则不刷新）
      if (!res.skipped) {
        window.dispatchEvent(new CustomEvent('fms:cover-updated', { detail: { id: fileId } }));
      }
    }
  } catch {
    /* 静默失败，不影响预览 */
  } finally {
    uploading = false;
  }
}

// tab 短标签：只取“形态前缀（一/二形态…） + 版本末段（A加强版…）”，
// 去掉重复的资源名与 spinepainting 目录，避免多版本时标签超长挤掉舞台。
// 提取阶段产出的健壮性告警（如多页 Spine 某页贴图缺失、atlas 页数不符）
function hasWarn(it) {
  return Array.isArray(it?.warnings) && it.warnings.length > 0;
}
function warnText(it) {
  return hasWarn(it) ? String(it.warnings[0]) : '';
}

function tabLabel(it) {
  const src = String(it.source || '');
  const segs = src.split('/').filter(Boolean);
  if (!segs.length) return it.name;
  const form = segs.find(s => /形态/.test(s));
  const ver = segs[segs.length - 1] === '放spinepainting' ? segs[segs.length - 2] : segs[segs.length - 1];
  if (form && ver && ver !== form) return form.replace(/【.*?】/g, '') + '·' + ver;
  return ver || it.name;
}

async function load(refresh = false, passwordOverride = '') {
  if (!props.file?.id) return;
  loading.value = true;
  pwError.value = '';
  try {
    const data = await getDynamic(props.file.id, { refresh, password: passwordOverride });
    needPassword.value = false;
    items.value = data?.items || [];
    encrypted.value = data?.encrypted || [];
    if (items.value.length && !items.value.some(i => i.key === activeKey.value)) {
      selectItem(items.value[0].key);
    }
  } catch (e) {
    if (e?.code === 4001) {
      needPassword.value = true;
      // 区分“需要密码”与“密码错误”
      pwError.value = /错误|bad password/i.test(e?.message || '') ? '密码错误，请重新输入' : '';
      items.value = [];
      encrypted.value = [];
    } else {
      ElMessage.error(e?.response?.data?.message || e?.message || '动态资源加载失败');
      items.value = [];
      encrypted.value = [];
    }
  } finally {
    loading.value = false;
  }
}

function submitPassword() {
  if (!password.value) {
    pwError.value = '请输入密码';
    return;
  }
  load(false, password.value);
}

function onOpen() {
  needPassword.value = false;
  password.value = '';
  pwError.value = '';
  load(false);
}

// 兼容初始即为打开状态（@open 可能不触发）：modelValue 变 true 且已有文件时加载
watch(
  () => [props.modelValue, props.file?.id],
  ([open]) => {
    if (open && props.file?.id && items.value.length === 0 && !loading.value) load(false);
  },
);
</script>

<style scoped>
.dyn-body {
  display: flex;
  flex-direction: column;
}
.dyn-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 2px 10px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  margin-bottom: 10px;
  max-height: 108px;
  overflow-y: auto;
  flex: 0 0 auto;
}
.dyn-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
}
.dyn-tab.on {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.badge {
  display: inline-block;
  min-width: 26px;
  text-align: center;
  font-size: 11px;
  line-height: 16px;
  border-radius: 4px;
  color: #fff;
  padding: 0 4px;
}
.badge.spine { background: #409eff; }
.badge.live2d { background: #e672c9; }
.t-src {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.dyn-warn {
  flex: 0 0 auto;
  margin-bottom: 8px;
  padding: 4px 10px;
}
.t-warn {
  color: var(--el-color-warning);
  font-size: 15px;
  margin-left: 2px;
}
.dyn-stage {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  border-radius: 10px;
  background:
    linear-gradient(45deg, #f3f4f6 25%, transparent 25%, transparent 75%, #f3f4f6 75%),
    linear-gradient(45deg, #f3f4f6 25%, transparent 25%, transparent 75%, #f3f4f6 75%);
  background-size: 20px 20px;
  background-position: 0 0, 10px 10px;
  overflow: hidden;
}
.pw-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
}
.pw-title {
  margin: 6px 0 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.pw-sub {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.pw-input {
  width: 260px;
}
.pw-err {
  margin: 0;
  font-size: 12px;
  color: var(--el-color-danger);
}
.dyn-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.enc-list {
  width: 100%;
  max-width: 520px;
  margin-top: 4px;
}
.enc-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 13px;
}
.enc-src,
.enc-err {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
