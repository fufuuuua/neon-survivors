/**
 * GlowCache.js — 发光精灵缓存。
 * 预渲染「白心 → 颜色 → 透明」的径向渐变光球到离屏 canvas，按颜色缓存。
 * 渲染时用 drawImage 缩放绘制 + 'lighter' 叠加，替代昂贵的逐帧 ctx.shadowBlur，
 * 是本次性能优化中收益最大的一项。
 */
const SIZE = 64;
const cache = new Map();

/** 取得某颜色的标准光球精灵（64×64 离屏 canvas） */
export function getGlow(color) {
  let sprite = cache.get(color);
  if (sprite) return sprite;

  const cv = document.createElement("canvas");
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext("2d");
  const r = SIZE / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0.0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.28, color);
  g.addColorStop(1.0, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);

  cache.set(color, cv);
  return cv;
}

/**
 * 以 (x,y) 为中心绘制一个半径为 radius 的发光球。
 * 调用方需自行管理 globalAlpha / globalCompositeOperation。
 */
export function drawGlow(ctx, color, x, y, radius) {
  const d = radius * 2;
  ctx.drawImage(getGlow(color), x - radius, y - radius, d, d);
}
