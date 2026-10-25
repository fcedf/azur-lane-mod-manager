<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="v => emit('update:modelValue', v)"
    :title="`包内立绘 — ${file?.name || ''}`"
    width="860px"
    top="6vh"
    @open="onOpen"
  >
    <div class="painting-wrap" v-loading="loading">
      <template v-if="!loading && paintings.length">
        <div v-for="g in groups" :key="g.key" class="p-group">
          <div class="p-group-head">
            <span class="p-group-name">{{ g.name }}（{{ g.list.length }}）</span>
          </div>
          <div class="p-grid" :class="g.key === 'painting' ? 'grid-main' : 'grid-icon'">
            <div v-for="p in g.list" :key="p.key" class="p-item">
              <el-image
                :src="thumb(p.key)"
                :preview-src-list="allFullUrls"
                :initial-index="globalIndex(p.key)"
                preview-teleported
                fit="contain"
                class="p-img"
              >
                <template #placeholder>
                  <div class="p-ph">加载中…</div>
                </template>
              </el-image>
              <span v-if="p.source" class="p-source">{{ p.source }}</span>
            </div>
          </div>
        </div>
      </template>

      <!-- 压缩包本身加密：输入密码，成功后记住 -->
      <div v-else-if="needPassword" class="pw-panel">
        <el-icon :size="40" color="#e6a23c"><Lock /></el-icon>
        <p class="pw-title">该压缩包已加密</p>
        <p class="pw-sub">输入压缩包密码以提取立绘，成功后会自动记住。</p>
        <el-input
          v-model="password"
          type="password"
          show-password
          placeholder="压缩包密码"
          class="pw-input"
          @keyup.enter="submitPassword"
        />
        <p v-if="pwError" class="pw-err">{{ pwError }}</p>
        <el-button type="primary" :loading="loading" @click="submitPassword">解密并提取</el-button>
      </div>

      <el-empty v-else-if="!loading" description="未在包内找到可预览的立绘" :image-size="90" />
    </div>

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button :loading="loading" @click="load(true)">刷新重新提取</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Lock } from '@element-plus/icons-vue';
import { getPaintings, paintingThumbUrl, paintingFullUrl } from '../api/painting.js';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  file: { type: Object, default: null },
});
const emit = defineEmits(['update:modelValue']);

const loading = ref(false);
const paintings = ref([]);
const needPassword = ref(false);
const password = ref('');
const pwError = ref('');

const GROUP_FALLBACK = {
  painting: '主立绘',
  paintingface: '表情差分',
  herohrzicon: '横版头像',
  shipyardicon: '船舵头像',
  squareicon: '方形头像',
};

// 按分组聚合（主立绘 / 横版头像 / 船舵头像），保持原顺序
const groups = computed(() => {
  const map = new Map();
  for (const p of paintings.value) {
    const prefix = String(p.key || '').replace(/_\d+$/, '');
    const key = p.groupKey || (prefix in GROUP_FALLBACK ? prefix : 'other');
    const name = p.group || GROUP_FALLBACK[key] || '其他';
    if (!map.has(key)) map.set(key, { key, name, list: [] });
    map.get(key).list.push(p);
  }
  return [...map.values()];
});

const allFullUrls = computed(() =>
  paintings.value.map(p => paintingFullUrl(props.file?.id, p.key))
);

function globalIndex(key) {
  return paintings.value.findIndex(p => p.key === key);
}

function thumb(key) {
  return paintingThumbUrl(props.file?.id, key);
}

async function load(force = false, passwordOverride = '') {
  if (!props.file) return;
  loading.value = true;
  pwError.value = '';
  try {
    const data = await getPaintings(props.file.id, { refresh: force, password: passwordOverride });
    needPassword.value = false;
    paintings.value = data.images || [];
    if (force) ElMessage.success('已重新提取');
  } catch (e) {
    paintings.value = [];
    if (e?.code === 4001) {
      needPassword.value = true;
      pwError.value = /错误|bad password/i.test(e?.message || '') ? '密码错误，请重新输入' : '';
    }
  } finally {
    loading.value = false;
  }
}

function submitPassword() {
  if (!password.value) { pwError.value = '请输入密码'; return; }
  load(false, password.value);
}

function onOpen() {
  paintings.value = [];
  needPassword.value = false;
  password.value = '';
  pwError.value = '';
  load(false);
}

watch(
  () => props.modelValue,
  v => {
    if (v) onOpen();
  }
);
</script>

<style scoped>
.painting-wrap {
  min-height: 200px;
  max-height: 68vh;
  overflow-y: auto;
}
.pw-panel {
  min-height: 320px;
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
.p-group {
  margin-bottom: 22px;
}
.p-group-head {
  margin-bottom: 10px;
}
.p-group-name {
  font-weight: 600;
  font-size: 14px;
  color: #303133;
}
.p-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.p-item {
  position: relative;
  border-radius: 8px;
  background: #f5f6f8;
  overflow: hidden;
}
/* 主立绘：大格 */
.grid-main .p-item {
  width: calc(50% - 6px);
  height: 300px;
}
/* 头像：小格 */
.grid-icon .p-item {
  width: calc(33.333% - 8px);
  height: 150px;
}
.p-img {
  width: 100%;
  height: 100%;
  display: block;
  cursor: zoom-in;
}
.p-ph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #c0c4cc;
  font-size: 13px;
}
.p-source {
  position: absolute;
  left: 6px;
  bottom: 6px;
  font-size: 12px;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 4px;
  padding: 1px 8px;
  max-width: 92%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
