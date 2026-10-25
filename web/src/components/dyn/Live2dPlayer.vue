<template>
  <div class="l2d-wrap">
    <div ref="host" class="l2d-host"></div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import * as PIXI from 'pixi.js';
import { dynamicAssetUrl } from '../../api/dynamic.js';
import { grabFrame, composeCover } from './coverCapture.js';
// Cubism 5 Core（支持 moc3 rev1–5；Emscripten 异步 WASM 模块，加载后需 await 就绪）
import coreUrl from '../../assets/vendor/live2dcubismcore5.min.js?url';

const props = defineProps({
  fileId: { type: [Number, String], required: true },
  item: { type: Object, required: true },
});
const emit = defineEmits(['cover']);

const host = ref(null);
let app = null;
let model = null;
let coreReady = null;
let stableTickerFn = null;
let onPostCover = null;

// Cubism 5 Core 以 <script> 注入；它是 PromiseLike（Emscripten），需 await 后才完整。
// ready 后把解析出的模块对象写回 window.Live2DCubismCore，供 pixi-live2d-display 读取。
function loadCoreOnce() {
  if (window.__fmsCubism5Ready) return Promise.resolve(window.Live2DCubismCore);
  if (coreReady) return coreReady;
  coreReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = coreUrl;
    s.onload = async () => {
      try {
        let mod = window.Live2DCubismCore;
        if (mod && typeof mod.then === 'function') mod = await mod;
        window.Live2DCubismCore = mod;
        window.__fmsCubism5Ready = true;
        resolve(mod);
      } catch (e) {
        reject(e);
      }
    };
    s.onerror = () => reject(new Error('Cubism 5 Core 脚本加载失败'));
    document.head.appendChild(s);
  });
  return coreReady;
}

function showError(msg) {
  if (!host.value) return;
  host.value.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'dyn-err';
  d.textContent = msg;
  host.value.appendChild(d);
}

function waitForSize(el, timeout = 3000) {
  const t0 = Date.now();
  return new Promise(resolve => {
    (function tick() {
      if ((el.clientWidth > 0 && el.clientHeight > 0) || Date.now() - t0 > timeout) {
        resolve();
      } else {
        requestAnimationFrame(() => tick());
      }
    })();
  });
}

onMounted(async () => {
  try {
    await waitForSize(host.value);
    await loadCoreOnce();
    // lipsyncpatch 0.5（兼容 pixi7）import 时立即读取 window.Live2DCubismCore，
    // 必须在 Core 就绪后再动态 import。它内部仍用 @pixi/utils 的 url.resolve，
    // 由 vite 的 url 垫片处理 access_token 拼接。
    const { Live2DModel } = await import('pixi-live2d-display-lipsyncpatch/cubism4');

    app = new PIXI.Application({
      resizeTo: host.value,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    host.value.appendChild(app.view);

    const modelUrl = dynamicAssetUrl(props.fileId, props.item.files.model3);
    // lipsyncpatch 0.5 不再自动挂全局 PIXI Ticker，必须显式传入，否则模型只显示
    // 静止首帧、不会逐帧更新（呼吸/眨眼/物理/交互全部失效）。
    // autoInteract 在 0.5 已废弃，拆为 autoHitTest（点中热区触发动作）与 autoFocus（视线跟随）。
    model = await Live2DModel.from(modelUrl, {
      ticker: app.ticker,
      autoHitTest: true,
      autoFocus: true,
    });

    app.stage.addChild(model);

    const fit = () => {
      const w = model.internalModel.originalWidth || 1;
      const h = model.internalModel.originalHeight || 1;
      const scale = Math.min((app.screen.width - 24) / w, (app.screen.height - 24) / h);
      model.scale.set(scale);
      model.anchor.set(0.5, 0.5);
      model.position.set(app.screen.width / 2, app.screen.height / 2);
    };
    fit();

    // 模型适配完成后，再渲染若干帧让首帧画出来，然后一次性通知外层可截封面
    let stableDelay = 8;
    let stableSent = false;
    let wantCapture = false;
    onPostCover = () => {
      if (!wantCapture) return;
      wantCapture = false;
      try {
        const frame = grabFrame(app);
        const dataUrl = composeCover(frame);
        if (dataUrl) emit('cover', dataUrl);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[cover] l2d grab failed', e?.message || e);
      }
    };
    app.renderer.on('postrender', onPostCover);
    stableTickerFn = () => {
      if (stableDelay > 0) {
        stableDelay--;
        if (stableDelay === 0 && !stableSent) {
          stableSent = true;
          wantCapture = true;
        }
      }
    };
    app.ticker.add(stableTickerFn);

    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointertap', () => {
      try {
        const groups = model.internalModel.motionManager?.getMotionGroups?.(0) || [];
        if (groups?.length) model.motion?.(groups[Math.floor(Math.random() * groups.length)]);
      } catch { /* 无动作集，静态+物理即可 */ }
    });
  } catch (e) {
    showError('Live2D 渲染失败：' + (e?.message || e));
    // eslint-disable-next-line no-console
    console.error(e);
  }
});

onBeforeUnmount(() => {
  try { model?.destroy?.({ destroyTexture: true }); } catch { /* ignore */ }
  model = null;
  if (app && stableTickerFn) { try { app.ticker.remove(stableTickerFn); } catch { /* ignore */ } }
  stableTickerFn = null;
  if (app && onPostCover) { try { app.renderer.off('postrender', onPostCover); } catch { /* ignore */ } }
  onPostCover = null;
  if (app) {
    try { app.destroy(true, { children: true, texture: false }); } catch { /* ignore */ }
    app = null;
  }
});
</script>

<style scoped>
.l2d-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}
.l2d-host {
  width: 100%;
  height: 100%;
  position: relative;
}
.l2d-host :deep(canvas) {
  display: block;
}
.dyn-err {
  color: var(--el-color-danger);
  padding: 16px;
  font-size: 13px;
}
</style>
