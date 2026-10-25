<template>
  <div class="spine-wrap">
    <div ref="host" class="spine-host"></div>
    <button type="button" class="scene-toggle" :title="showScene ? '仅看人物' : '显示完整场景（背景/舰装）'" @click="toggleScene">
      {{ showScene ? '👤 仅看人物' : '🌃 完整场景' }}
    </button>
    <div v-if="canSwitch" class="tap-hint">点击画面切换动画</div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import * as PIXI from 'pixi.js';
import { Spine, AtlasAttachmentLoader, SkeletonBinary } from '@pixi-spine/runtime-3.8';
import { TextureAtlas } from '@pixi-spine/base';
import { dynamicAssetUrl } from '../../api/dynamic.js';
import { grabFrame, composeCover } from './coverCapture.js';

const props = defineProps({
  fileId: { type: [Number, String], required: true },
  item: { type: Object, required: true },
});
const emit = defineEmits(['cover']);

const host = ref(null);
// 是否显示完整场景（背景 + 舰装占位层）。碧蓝立绘特写默认只看人物。
const showScene = ref(false);
const canSwitch = ref(false);
let app = null;
let spine = null;
let textures = [];
let onPostCover = null;
// >0：倒计时到 0 后重算一次适配（初始给 20 帧等出场动画稳定；切换场景只等 2 帧避免闪现）
let pendingFrames = 0;
let applySceneFilter = null;

// 待机/常态动画优先级（碧蓝 Spine 常见：normal / idle / login / touch_*）
const PREFER_IDLE = ['normal', 'idle', 'stand', 'login', 'main', ''];

function url(name) {
  return dynamicAssetUrl(props.fileId, name);
}

async function fetchBuf(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error('骨骼加载失败 ' + r.status);
  return r.arrayBuffer();
}
async function fetchText(u) {
  const r = await fetch(u);
  if (!r.ok) throw new Error('图集加载失败 ' + r.status);
  return r.text();
}
async function fetchTexture(u) {
  const tex = await PIXI.Texture.fromURL(u, { crossOrigin: 'anonymous' });
  textures.push(tex);
  return tex;
}

// 背景层命名：
//  - background / beijing
//  - bj：兼容云龙的 “xxx_bj / yc2_bj / yc2_bj_qian”（bj 在中间或结尾）
//        与 2b_2 的 “bj_1”（bj 在开头），统一匹配独立的 bj 段；
//  - 2_00006_q 这类以 “2_数字” 开头的夜景碎片。
function isBackgroundSlot(name) {
  const n = String(name || '').toLowerCase();
  if (n === 'background' || n === 'beijing') return true;
  if (/(^|_)bj(_|$|\d)/.test(n)) return true;
  if (/^2_\d+(_q)?$/.test(n)) return true;
  // 安土等拼音命名场景层：1heidi/1heidi2(黑底全屏图)、1heixian/1heixian2(黑线/门框)、
  // 1hei(黑)、1yanwu*(烟雾)、mohu*(模糊)。这些会把整体 bounds 撑到上万像素，
  // 导致人物被缩成蚂蚁。注意不能误伤 1_zhayan(眨眼)。
  // 黑底/黑线类：hei、heidi、heidi2、heixian、heixian2（可带前导 1）
  if (/^1?hei(xian|di)?\d*$/.test(n)) return true;
  if (/^1?yanwu\d*$/.test(n)) return true;
  if (/^mohu\d*$/.test(n)) return true;
  return false;
}

// 前景框架层（qj=前景）：如 2b_2 的 qj_1/qj_2 为左上角、右上角垂落的藤蔓树叶，
// qj_3/qj_4 为前景框架。特写只看人物时一并隐藏。
function isForegroundSlot(name) {
  return /(^|_)qj(_|$|\d)/.test(String(name || '').toLowerCase());
}

// 舰装/武器占位层（slot 或附件名含 wuqi / kkkkk）。
function isRigSlot(name) {
  return /wuqi|kkkkk/i.test(String(name || ''));
}

// 把当前可见内容适配到舞台。关键：getBounds() 返回的是【带当前变换的世界坐标】，
// 若直接拿已缩放过的包围盒再算 scale，会每次累除 → 来回切换越来越小、越靠下，最终移出画面白屏。
// 因此测量前先把 spine 自身变换归一成单位值，量到的就是原始包围盒，重算任意次结果都一致。
function refitNow(pad = 20) {
  if (!spine) return;
  spine.scale.set(1);
  spine.position.set(0, 0);
  const bounds = spine.getBounds();
  const w = bounds.width;
  const h = bounds.height;
  if (!isFinite(w) || !isFinite(h) || w < 1 || h < 1) return;
  const scale = Math.min(
    (app.screen.width - pad * 2) / w,
    (app.screen.height - pad * 2) / h,
    3,
  );
  spine.scale.set(scale);
  spine.x = app.screen.width / 2 - (bounds.x + w / 2) * scale;
  spine.y = app.screen.height / 2 - (bounds.y + h / 2) * scale;
}

function showError(msg) {
  if (!host.value) return;
  host.value.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'dyn-err';
  d.textContent = msg;
  host.value.appendChild(d);
}

onMounted(async () => {
  const f = props.item.files;
  try {
    app = new PIXI.Application({
      resizeTo: host.value,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    host.value.appendChild(app.view);

    // 多页 spine（如安土 antu_3：眼睛在 p0、背景/身体在 p1）：按 files.pages 逐页加载，
    // 再用 atlas 里的页名映射到对应贴图；旧单页数据退化为只有 texture。
    const pageFiles = Array.isArray(f.pages) && f.pages.length ? f.pages : [f.texture];
    const [skelBuf, atlasText, pageTextures] = await Promise.all([
      fetchBuf(url(f.skel)),
      f.atlas ? fetchText(url(f.atlas)) : Promise.resolve(null),
      Promise.all(pageFiles.map(p => fetchTexture(url(p)))),
    ]);

    // Unity Spine 纹理为预乘 alpha（PMA）。透明像素 RGB=0，必须开启 PMA 混合。
    pageTextures.forEach(t => { t.baseTexture.alphaMode = PIXI.ALPHA_MODES.PMA; });
    // 页名（atlas 里已改写为导出文件名）→ BaseTexture；查不到时回退第一页
    const baseByName = new Map();
    pageFiles.forEach((pf, i) => baseByName.set(pf, pageTextures[i].baseTexture));
    const resolveBase = pageName => {
      const key = String(pageName || '').split(/[\\/]/).pop();
      return baseByName.get(key) || baseByName.get(pageName) || pageTextures[0].baseTexture;
    };
    const atlas = new TextureAtlas(atlasText, (pageName, cb) => cb(resolveBase(pageName)));
    const binary = new SkeletonBinary(new AtlasAttachmentLoader(atlas));
    const skeletonData = binary.readSkeletonData(new Uint8Array(skelBuf));
    spine = new Spine(skeletonData);
    spine.update(0);

    app.stage.addChild(spine);

    // 关键：包裹 Spine 自身的 updateTransform（pixi-spine 每帧渲染时调用，
    // 内部完成 state.apply / updateWorldTransform / 附件→slotContainers 同步）。
    // 等它同步完（会把有附件的容器 visible 重置为 true），再把背景/舰装容器隐藏。
    // 不能去包裹 skeleton.updateWorldTransform，也不能直接清空 attachment，
    // 那样会干扰 pixi-spine 的内部同步导致整模不显示。
    const skel = spine.skeleton;
    const slotContainers = spine.slotContainers;
    applySceneFilter = () => {
      if (showScene.value) return;
      for (let i = 0; i < skel.slots.length; i++) {
        const s = skel.slots[i];
        const a = s.attachment;
        if (!a) continue;
        if (
          isBackgroundSlot(s.data.name) || isBackgroundSlot(a.name) ||
          isForegroundSlot(s.data.name) || isForegroundSlot(a.name) ||
          isRigSlot(s.data.name) || isRigSlot(a.name)
        ) {
          if (slotContainers[i]) slotContainers[i].visible = false;
        }
      }
    };
    const origUpdateTransform = spine.updateTransform.bind(spine);
    spine.updateTransform = function wrappedUpdateTransform() {
      origUpdateTransform();
      applySceneFilter();
    };

    // 只保留“真正有时长”的动画（部分皮肤带 1/2/3… 等 dur=0 空动画，
    // 切到它们画面会停住/消失）。
    const anims = (skeletonData.animations || [])
      .filter(a => (a.duration || 0) > 0.001)
      .map(a => a.name);
    const idle = PREFER_IDLE.find(n => n && anims.includes(n)) || anims[0];
    if (idle) spine.state.setAnimation(0, idle, true);
    canSwitch.value = anims.length >= 2;

    // 初始适配；再等若干帧常态姿态稳定后重算一次，避免出场特效把角色缩很小。
    refitNow();
    pendingFrames = 20;
    // 适配完成后再渲染几帧让人物画出来，然后一次性通知外层可截封面
    // stable 后挂一次 postrender 钩子：在该帧 GL 缓冲仍有效时 extract 取帧
    let wantCapture = false;
    let stableSent = false;
    let stableDelay = -1;
    onPostCover = () => {
      if (!wantCapture) return;
      wantCapture = false;
      try {
        const frame = grabFrame(app);
        const dataUrl = composeCover(frame);
        if (dataUrl) emit('cover', dataUrl);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[cover] spine grab failed', e?.message || e);
      }
    };
    app.renderer.on('postrender', onPostCover);
    app.ticker.add(() => {
      if (pendingFrames > 0) {
        pendingFrames--;
        if (pendingFrames === 0) {
          refitNow();
          stableDelay = 3;
        }
      } else if (stableDelay > 0) {
        stableDelay--;
        if (stableDelay === 0 && !stableSent) {
          stableSent = true;
          wantCapture = true; // 下一帧渲染后取帧
        }
      }
    });

    // 点击切换动画（仅在有效动画之间）
    let idx = anims.indexOf(idle);
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointertap', () => {
      if (anims.length < 2) return;
      idx = (idx + 1) % anims.length;
      spine.state.setAnimation(0, anims[idx], true);
      pendingFrames = 6; // 动画切了，等几帧新姿态稳定后重新适配
    });
  } catch (e) {
    showError('Spine 渲染失败：' + (e?.message || e));
    // eslint-disable-next-line no-console
    console.error(e);
  }
});

function toggleScene() {
  showScene.value = !showScene.value;
  // 场景显隐在下一帧的同步后生效，仅等 2 帧就重新适配（避免旧画面明显闪现）
  pendingFrames = 2;
}

onBeforeUnmount(() => {
  if (app && onPostCover) { try { app.renderer.off('postrender', onPostCover); } catch { /* ignore */ } }
  onPostCover = null;
  if (app) {
    try { app.destroy(true, { children: true, texture: false }); } catch { /* ignore */ }
    app = null;
  }
  textures.forEach(t => { try { t.destroy(true); } catch { /* ignore */ } });
  textures = [];
  spine = null;
  applySceneFilter = null;
});
</script>

<style scoped>
.spine-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}
.spine-host {
  width: 100%;
  height: 100%;
  position: relative;
  cursor: pointer;
}
.scene-toggle {
  position: absolute;
  right: 10px;
  top: 10px;
  z-index: 3;
  padding: 4px 10px;
  font-size: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.82);
  color: var(--el-text-color-primary);
  cursor: pointer;
  user-select: none;
}
.scene-toggle:hover {
  background: #fff;
}
.tap-hint {
  position: absolute;
  right: 12px;
  bottom: 10px;
  z-index: 3;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: rgba(255, 255, 255, 0.7);
  padding: 2px 8px;
  border-radius: 6px;
  pointer-events: none;
}
.spine-host :deep(canvas) {
  display: block;
}
.dyn-err {
  color: var(--el-color-danger);
  padding: 16px;
  font-size: 13px;
}
</style>
