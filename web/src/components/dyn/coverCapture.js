/**
 * 把动态预览当前画面合成为“白底仅人物”的封面 JPEG。
 *
 * 关键点：WebGL canvas 默认不保留绘制缓冲，渲染结束后再 drawImage 会得到空画面，
 * 必须在 PIXI「刚渲染完的同一帧」用 renderer.extract 取出像素。
 * 因此由播放器在稳定后的下一帧 render 回调里调用 grabFrame() 传入 renderer，
 * 这里同步 extract 出带 alpha 的 canvas，再扫描包围盒、裁人物、铺白底。
 */

const MAX_COVER_WIDTH = 720;
const PAD = 12;

/** 扫描 RGBA 数据里 alpha 超过阈值的像素包围盒 */
function alphaBounds(data, w, h, alphaThreshold = 8) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (data[row + x * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * 在渲染帧内同步抓取当前合成画面（含透明），返回普通 2D canvas。
 * @param {PIXI.Application} app
 */
export function grabFrame(app) {
  // v7：renderer.extract.canvas(target)；不传 target 时取整个 stage
  const c = app.renderer.extract.canvas(app.stage);
  // extract.canvas 可能返回 OffscreenCanvas，统一转回普通 canvas
  if (typeof HTMLCanvasElement !== 'undefined' && c instanceof HTMLCanvasElement) return c;
  const out = document.createElement('canvas');
  out.width = c.width;
  out.height = c.height;
  out.getContext('2d').drawImage(c, 0, 0);
  return out;
}

/**
 * 从一张含 alpha 的画面 canvas 裁出人物并铺白底，输出 jpeg dataURL；失败返回 null。
 * @param {HTMLCanvasElement} frame
 */
export function composeCover(frame) {
  try {
    const W = frame.width;
    const H = frame.height;
    if (!W || !H) return null;
    const ctx = frame.getContext('2d', { willReadFrequently: true });
    const b = alphaBounds(ctx.getImageData(0, 0, W, H).data, W, H);
    if (!b) return null;

    const x = Math.max(0, b.x - PAD);
    const y = Math.max(0, b.y - PAD);
    const cw = Math.min(W - x, b.w + PAD * 2);
    const ch = Math.min(H - y, b.h + PAD * 2);
    if (cw < 8 || ch < 8) return null;

    const out = document.createElement('canvas');
    let ow = cw;
    let oh = ch;
    if (ow > MAX_COVER_WIDTH) {
      oh = Math.round((ch * MAX_COVER_WIDTH) / cw);
      ow = MAX_COVER_WIDTH;
    }
    out.width = ow;
    out.height = oh;
    const octx = out.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, ow, oh);
    octx.drawImage(frame, x, y, cw, ch, 0, 0, ow, oh);
    return out.toDataURL('image/jpeg', 0.88);
  } catch {
    return null;
  }
}
