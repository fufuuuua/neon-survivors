/**
 * Projectile.js — 抛射物实体（玩家子弹 / 新星弹幕）。
 */
import { TAU } from "../utils/math.js";
import { drawGlow } from "../core/GlowCache.js";

export class Projectile {
  constructor() { this.active = false; }

  spawn(x, y, vx, vy, { damage, pierce = 0, radius = 5, color = "#00f0ff", life = 2.4, hostile = false }) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.pierce = pierce;          // 可穿透敌人数
    this.radius = radius;
    this.color = color;
    this.life = life;
    this.hostile = hostile;         // 敌方弹幕：采用截然不同的视觉语言
    this.hitSet = new Set();        // 已命中敌人，避免重复结算
    this.active = true;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.active = false; return; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  /**
   * 渲染。两套视觉语言，避免玩家技能与敌方弹幕混淆：
   *  - 玩家弹（叠加混合，由 Game 统一设置 'lighter'）：彗尾流光 + 白热核心，像“能量”。
   *  - 敌方弹（普通混合，由 Game 单独绘制）：不透明实心球 + 暗色瞳孔 + 白描边，像“实体威胁”。
   */
  render(ctx) {
    if (this.hostile) { this._renderHostile(ctx); return; }

    // 玩家能量弹：沿运动方向拖出彗尾
    const sp = Math.hypot(this.vx, this.vy) || 1;
    const ux = this.vx / sp, uy = this.vy / sp;
    const tail = this.radius * 2.4;
    ctx.globalAlpha = 0.45;
    drawGlow(ctx, this.color, this.x - ux * tail, this.y - uy * tail, this.radius * 1.5);
    ctx.globalAlpha = 0.8;
    drawGlow(ctx, this.color, this.x - ux * tail * 0.5, this.y - uy * tail * 0.5, this.radius * 2.0);
    ctx.globalAlpha = 1;
    drawGlow(ctx, this.color, this.x, this.y, this.radius * 2.6);
    // 白色实心核心
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 0.6, 0, TAU);
    ctx.fill();
  }

  /** 敌方弹幕：实心敌意光球（普通混合下绘制） */
  _renderHostile(ctx) {
    const r = this.radius;
    // 柔和敌意光晕
    ctx.globalAlpha = 0.5;
    drawGlow(ctx, this.color, this.x, this.y, r * 2.6);
    ctx.globalAlpha = 1;
    // 不透明实心色球（营造“实体威胁”，区别于玩家的能量流光）
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.82, 0, TAU); ctx.fill();
    // 暗色瞳孔（危险信号）
    ctx.fillStyle = "#0a0410";
    ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.42, 0, TAU); ctx.fill();
    // 高亮描边
    ctx.strokeStyle = "#ffffff";
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(this.x, this.y, r * 0.82, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}
