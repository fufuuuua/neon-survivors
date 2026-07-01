/**
 * Projectile.js — 抛射物实体（玩家子弹 / 新星弹幕）。
 */
import { TAU } from "../utils/math.js";
import { drawGlow } from "../core/GlowCache.js";

export class Projectile {
  constructor() { this.active = false; }

  spawn(x, y, vx, vy, { damage, pierce = 0, radius = 5, color = "#00f0ff", life = 2.4 }) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.pierce = pierce;          // 可穿透敌人数
    this.radius = radius;
    this.color = color;
    this.life = life;
    this.hitSet = new Set();        // 已命中敌人，避免重复结算
    this.active = true;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.active = false; return; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  /** 渲染需在 'lighter' 叠加模式下进行（由 Game 统一批量设置） */
  render(ctx) {
    // 缓存发光光晕（替代 shadowBlur）
    drawGlow(ctx, this.color, this.x, this.y, this.radius * 2.6);
    // 白色实心核心
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 0.6, 0, TAU);
    ctx.fill();
  }
}
