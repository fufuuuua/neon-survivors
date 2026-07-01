/**
 * XPGem.js — 经验宝石与道具掉落物，带磁吸效果。
 */
import { Vector2 } from "../utils/Vector2.js";
import { TAU } from "../utils/math.js";
import { drawGlow } from "../core/GlowCache.js";

export const DropType = Object.freeze({ XP: "XP", HEAL: "HEAL", BOMB: "BOMB", MAGNET: "MAGNET" });

export class XPGem {
  constructor() { this.active = false; }

  spawn(x, y, value, type = DropType.XP) {
    this.x = x; this.y = y;
    this.value = value;
    this.type = type;
    this.attracted = false;
    this.radius = type === DropType.XP ? 6 : 11;
    this.active = true;
    this.t = Math.random() * TAU;
    // 未拾取的掉落物会超时消失：经验较短，珍贵道具较长
    this.life = type === DropType.XP ? 11 : 16;
    this.maxLife = this.life;
  }

  get color() {
    return {
      [DropType.XP]: "#00f0ff",
      [DropType.HEAL]: "#aaff00",
      [DropType.BOMB]: "#ff2bd6",
      [DropType.MAGNET]: "#ffd23f",
    }[this.type];
  }

  update(dt, player, pickupRange) {
    this.t += dt * 3;
    const d = Vector2.dist(this, player);
    if (this.attracted || d < pickupRange) {
      // 已进入磁吸范围：飞向玩家，不再计算过期
      this.attracted = true;
      const dir = Vector2.dir(this, player);
      const speed = 420;
      this.x += dir.x * speed * dt;
      this.y += dir.y * speed * dt;
    } else {
      // 未拾取则倒计时，超时消失
      this.life -= dt;
      if (this.life <= 0) { this.active = false; }
    }
  }

  /** 临期（剩余 < 3 秒）开始闪烁，提示即将消失 */
  get _alpha() {
    if (this.attracted || this.life >= 3) return 1;
    return 0.3 + 0.7 * Math.abs(Math.sin(this.life * 9));
  }

  render(ctx) {
    const pulse = 1 + Math.sin(this.t) * 0.15;
    ctx.save();
    ctx.globalAlpha = this._alpha;
    // 发光光晕（缓存精灵，无 shadowBlur）
    drawGlow(ctx, this.color, this.x, this.y, this.radius * 2.2 * pulse);

    ctx.translate(this.x, this.y);
    ctx.fillStyle = this.color;
    if (this.type === DropType.XP) {
      // 菱形晶体
      const r = this.radius * pulse;
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(r * 0.7, 0);
      ctx.lineTo(0, r); ctx.lineTo(-r * 0.7, 0);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, this.radius * pulse, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#05060e";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const sym = { [DropType.HEAL]: "+", [DropType.BOMB]: "✸", [DropType.MAGNET]: "⬇" }[this.type];
      ctx.fillText(sym, 0, 1);
    }
    ctx.restore();
  }
}
