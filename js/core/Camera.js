/**
 * Camera.js — 跟随玩家的摄像机，含屏幕震动与坐标换算。
 */
import { clamp } from "../utils/math.js";
import { CONFIG } from "../config.js";

export class Camera {
  constructor(viewW, viewH) {
    this.x = 0;
    this.y = 0;
    this.viewW = viewW;
    this.viewH = viewH;
    this.shakeMag = 0;
    this._shakeX = 0;
    this._shakeY = 0;
  }

  resize(w, h) { this.viewW = w; this.viewH = h; }

  /** 触发屏幕震动 */
  shake(mag) { this.shakeMag = Math.max(this.shakeMag, mag); }

  update(target, dt) {
    // 平滑跟随
    const tx = target.x - this.viewW / 2;
    const ty = target.y - this.viewH / 2;
    this.x += (tx - this.x) * Math.min(1, dt * 8);
    this.y += (ty - this.y) * Math.min(1, dt * 8);

    // 限制在世界边界内
    this.x = clamp(this.x, 0, CONFIG.world.width - this.viewW);
    this.y = clamp(this.y, 0, CONFIG.world.height - this.viewH);

    // 震动衰减
    if (this.shakeMag > 0.1) {
      this._shakeX = (Math.random() * 2 - 1) * this.shakeMag;
      this._shakeY = (Math.random() * 2 - 1) * this.shakeMag;
      this.shakeMag -= this.shakeMag * CONFIG.fx.shakeDecay * dt;
    } else {
      this.shakeMag = this._shakeX = this._shakeY = 0;
    }
  }

  /** 在渲染前应用变换 */
  begin(ctx) {
    ctx.save();
    ctx.translate(-this.x + this._shakeX, -this.y + this._shakeY);
  }
  end(ctx) { ctx.restore(); }

  /** 世界坐标 -> 屏幕坐标 */
  toScreen(wx, wy) { return { x: wx - this.x, y: wy - this.y }; }

  /** 某点是否在可视范围内（含外扩边距，用于裁剪渲染） */
  inView(x, y, pad = 60) {
    return x > this.x - pad && x < this.x + this.viewW + pad &&
           y > this.y - pad && y < this.y + this.viewH + pad;
  }
}
