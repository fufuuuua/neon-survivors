/**
 * Camera.js — 跟随玩家的摄像机，含屏幕震动、缩放与坐标换算。
 *
 * 坐标系约定:
 *  - viewW/viewH: CSS 像素的屏幕逻辑宽高 (对 UI/HUD 便于直接使用).
 *  - zoom: world 层的整体缩放因子 (Game 在 render 时 ctx.scale(zoom)).
 *          zoom < 1 => 可视世界更大 (角色/敌人显得更小); zoom > 1 => 拉近.
 *  - 世界坐标可视区宽高 = viewW / zoom, viewH / zoom.
 *    该值用于 camera 跟随、边界裁剪、inView 剔除、屏外生成范围.
 */
import { clamp } from "../utils/math.js";
import { CONFIG } from "../config.js";

export class Camera {
  constructor(viewW, viewH) {
    this.x = 0;
    this.y = 0;
    this.viewW = viewW;
    this.viewH = viewH;
    this.zoom = 1;
    this.shakeMag = 0;
    this._shakeX = 0;
    this._shakeY = 0;
  }

  resize(w, h) { this.viewW = w; this.viewH = h; }

  /** 设置世界缩放; 值越小可视范围越大 (默认 1) */
  setZoom(z) { this.zoom = Math.max(0.1, z || 1); }

  /** 世界坐标下的可视宽度 (= 屏幕像素 / zoom) */
  get worldViewW() { return this.viewW / this.zoom; }
  get worldViewH() { return this.viewH / this.zoom; }

  /** 触发屏幕震动 */
  shake(mag) { this.shakeMag = Math.max(this.shakeMag, mag); }

  update(target, dt) {
    // 平滑跟随: 让目标落在"世界可视区"的中心, 而非屏幕像素中心 (二者在缩放下不等)
    const vw = this.worldViewW;
    const vh = this.worldViewH;
    const tx = target.x - vw / 2;
    const ty = target.y - vh / 2;
    this.x += (tx - this.x) * Math.min(1, dt * 8);
    this.y += (ty - this.y) * Math.min(1, dt * 8);

    // 限制在世界边界内 (按世界可视区尺寸夹紧, 保证边缘不越过世界)
    this.x = clamp(this.x, 0, CONFIG.world.width - vw);
    this.y = clamp(this.y, 0, CONFIG.world.height - vh);

    // 震动衰减
    if (this.shakeMag > 0.1) {
      this._shakeX = (Math.random() * 2 - 1) * this.shakeMag;
      this._shakeY = (Math.random() * 2 - 1) * this.shakeMag;
      this.shakeMag -= this.shakeMag * CONFIG.fx.shakeDecay * dt;
    } else {
      this.shakeMag = this._shakeX = this._shakeY = 0;
    }
  }

  /** 在渲染前应用变换 (调用方需先 ctx.scale(zoom) 才让世界层缩放生效) */
  begin(ctx) {
    ctx.save();
    ctx.translate(-this.x + this._shakeX, -this.y + this._shakeY);
  }
  end(ctx) { ctx.restore(); }

  /** 世界坐标 -> 屏幕坐标 (含缩放, 便于屏幕空间 UI 使用) */
  toScreen(wx, wy) { return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom }; }

  /** 某点是否在可视范围内 (含外扩边距, 用于裁剪渲染); 走世界可视区尺寸 */
  inView(x, y, pad = 60) {
    return x > this.x - pad && x < this.x + this.worldViewW + pad &&
           y > this.y - pad && y < this.y + this.worldViewH + pad;
  }
}
