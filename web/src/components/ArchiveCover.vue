<template>
  <div
    ref="refBox"
    class="archive-cover"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <!-- 占位：始终渲染原类型图标，封面加载成功后被图片盖住 -->
    <el-icon :size="20" :color="typeColor(type)" class="ph-icon">
      <component :is="typeIcon(type)" />
    </el-icon>
    <img
      v-if="!failed"
      :src="coverUrl"
      :alt="name"
      loading="lazy"
      decoding="async"
      class="cover-img"
      :class="{ ready }"
      @load="onLoad"
      @error="onError"
    />

    <!-- 悬浮放大：页面正中大预览（Teleport 到 body，避免被表格/弹层裁切） -->
    <Teleport to="body">
      <div v-if="show && ready" class="cover-center-mask" @mouseenter.prevent @mouseenter.stop>
        <img :src="coverUrl" :alt="name" class="center-img" />
        <div class="center-name" :title="name">{{ name }}</div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, onBeforeUnmount, onMounted } from 'vue';
import { typeIcon, typeColor } from '../utils/format.js';
import { archiveCoverUrl } from '../api/painting.js';

const props = defineProps({
  id: { type: [Number, String], required: true },
  type: { type: String, default: 'archive' },
  name: { type: String, default: '' },
});

// 每次 id 变化都视为未加载（列表复用 DOM 时能重新拉对应封面）
const coverUrl = ref(archiveCoverUrl(props.id));
const ready = ref(false);
const failed = ref(false);
const show = ref(false);
const refBox = ref(null);
let showTimer = null;
let hideTimer = null;
// 悬停停留多久才弹出大预览（快速划过不弹，避免连续移动时晃眼）
const SHOW_DELAY = 350;

function onLoad(e) {
  // 后端无封面时返回 204，个别浏览器会触发 load 但 naturalWidth=0
  if (e.target && e.target.naturalWidth > 0) {
    ready.value = true;
  } else {
    failed.value = true;
  }
}
function onError() {
  failed.value = true;
}

function onEnter() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (showTimer) clearTimeout(showTimer);
  // 停留达阈值才弹；未加载好封面则不弹
  showTimer = setTimeout(() => {
    showTimer = null;
    if (ready.value) show.value = true;
  }, SHOW_DELAY);
}
function onLeave() {
  // 还没弹出就取消；已弹出则轻微延迟关闭，边缘抖动不闪烁
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { show.value = false; }, 60);
}

// 动态预览合成首帧封面成功后，即时刷新本文件封面（无需重开页面）
function onCoverUpdated(e) {
  if (String(e.detail?.id) !== String(props.id)) return;
  ready.value = false;
  failed.value = false;
  coverUrl.value = archiveCoverUrl(props.id) + '&_t=' + Date.now();
}
onMounted(() => window.addEventListener('fms:cover-updated', onCoverUpdated));

onBeforeUnmount(() => {
  window.removeEventListener('fms:cover-updated', onCoverUpdated);
  if (showTimer) clearTimeout(showTimer);
  if (hideTimer) clearTimeout(hideTimer);
  show.value = false;
});
</script>

<style scoped>
.archive-cover {
  position: relative;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  overflow: hidden;
  background: #f5f7fa;
  cursor: zoom-in;
}
.ph-icon {
  position: absolute;
  inset: 0;
  margin: auto;
}
.cover-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.18s ease;
}
.cover-img.ready {
  opacity: 1;
}
</style>

<style>
/* Teleport 到 body，不能用 scoped */
.cover-center-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none; /* 仅展示，不挡操作 */
  animation: cover-fade 0.12s ease;
}
.cover-center-mask .center-img {
  max-width: 82vw;
  max-height: 78vh;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.45);
}
.cover-center-mask .center-name {
  max-width: 82vw;
  font-size: 14px;
  color: #fff;
  text-align: center;
  padding: 0 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}
@keyframes cover-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
