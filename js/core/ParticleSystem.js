/**
 * ParticleSystem.js — 轻量粒子系统 + 浮动文字。
 * 性能要点：
 *  - 使用「活跃列表」迭代，避免每帧扫描整个对象池。
 *  - 粒子渲染用缓存的发光精灵 + 'lighter' 叠加（一次批量设置），不使用逐粒子 shadowBlur。
 */
import { CONFIG } from "../config.js";
import { rand, TAU } from "../utils/math.js";
import { drawGlow } from "./GlowCache.js";

class Particle {
  constructor() { this.active = false; }
  spawn(x, y, vx, vy, life, color, size) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.life = life; this.maxLife = life;
    this.color = color; this.size = size;
    this.active = true;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.active = false; return; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.94;
    this.vy *= 0.94;
  }
}

class FloatText {
  constructor() { this.active = false; }
  spawn(x, y, text, color, size) {
    this.x = x; this.y = y; this.text = text; this.color = color;
    this.size = size; this.life = 0.8; this.maxLife = 0.8; this.active = true;
  }
  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.active = false; return; }
    this.y -= 38 * dt;
  }
}

export class ParticleSystem {
  constructor() {
    this._items = Array.from({ length: CONFIG.fx.maxParticles }, () => new Particle());
    this._free = [...this._items];
    this.active = [];

    this._textItems = Array.from({ length: 80 }, () => new FloatText());
    this._textFree = [...this._textItems];
    this.activeTexts = [];
  }

  _obtain() {
    const p = this._free.pop();
    if (!p) return null;
    this.active.push(p);
    return p;
  }
  _obtainText() {
    const t = this._textFree.pop();
    if (!t) return null;
    this.activeTexts.push(t);
    return t;
  }

  /** 爆发：以某点为中心向四周抛射粒子 */
  burst(x, y, color, count = 12, speed = 200, size = 3, life = 0.5) {
    for (let i = 0; i < count; i++) {
      const p = this._obtain();
      if (!p) break;
      const a = rand(0, TAU);
      const s = rand(speed * 0.3, speed);
      p.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(life * 0.5, life), color, size);
    }
  }

  /** 单个拖尾粒子 */
  trail(x, y, color, size = 2.5, life = 0.35) {
    const p = this._obtain();
    if (p) p.spawn(x, y, rand(-20, 20), rand(-20, 20), life, color, size);
  }

  damageText(x, y, amount, crit = false) {
    const t = this._obtainText();
    if (t) t.spawn(x + rand(-8, 8), y, Math.round(amount), crit ? "#ffd23f" : "#ffffff", crit ? 22 : 15);
  }

  text(x, y, str, color = "#aaff00", size = 18) {
    const t = this._obtainText();
    if (t) t.spawn(x, y, str, color, size);
  }

  update(dt) {
    for (const p of this.active) p.update(dt);
    for (const t of this.activeTexts) t.update(dt);
    this._reclaim();
  }

  _reclaim() {
    let a = this.active;
    for (let i = a.length - 1; i >= 0; i--) {
      if (!a[i].active) { const d = a[i]; a[i] = a[a.length - 1]; a.pop(); this._free.push(d); }
    }
    a = this.activeTexts;
    for (let i = a.length - 1; i >= 0; i--) {
      if (!a[i].active) { const d = a[i]; a[i] = a[a.length - 1]; a.pop(); this._textFree.push(d); }
    }
  }

  render(ctx) {
    // 粒子：发光精灵 + 叠加混合（一次性设置，批量绘制）
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.active) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      drawGlow(ctx, p.color, p.x, p.y, p.size * 2.4);
    }
    ctx.restore();

    // 浮动文字
    ctx.save();
    ctx.textAlign = "center";
    for (const t of this.activeTexts) {
      ctx.globalAlpha = Math.min(1, t.life / t.maxLife + 0.2);
      ctx.font = `700 ${t.size}px 'JetBrains Mono', monospace`;
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }

  clear() {
    for (const p of this.active) p.active = false;
    for (const t of this.activeTexts) t.active = false;
    this._reclaim();
  }
}
