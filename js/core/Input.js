/**
 * Input.js — 输入管理器（键盘 + 触摸虚拟摇杆）。
 * 提供归一化的移动向量与按键状态查询，解耦具体输入设备与游戏逻辑。
 *
 * 触摸支持：在画布上按下即生成「浮动摇杆」，按下点为摇杆中心，拖动方向即移动方向，
 * 武器自动开火，因此移动端无需额外的开火操作。
 */
import { Vector2 } from "../utils/Vector2.js";

const JOY_RADIUS = 60;     // 摇杆最大半径（CSS 像素）
const JOY_DEADZONE = 0.18; // 死区，避免轻微触碰误移动

export class Input {
  constructor(canvas = null) {
    this.keys = new Set();
    this._listeners = [];

    // 触摸摇杆状态（cx,cy 基座中心；kx,ky 摇杆头；nx,ny 方向；mag 推动强度 0..1）
    this.joy = { active: false, id: null, cx: 0, cy: 0, kx: 0, ky: 0, nx: 0, ny: 0, mag: 0 };

    this._onDown = (e) => {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        e.preventDefault();
      }
      this._listeners.forEach((fn) => fn(k));
    };
    this._onUp = (e) => this.keys.delete(e.key.toLowerCase());

    window.addEventListener("keydown", this._onDown);
    window.addEventListener("keyup", this._onUp);
    window.addEventListener("blur", () => this.keys.clear());

    if (canvas) this._bindTouch(canvas);
  }

  // ---------------- 触摸 ----------------
  _bindTouch(canvas) {
    const start = (e) => {
      if (this.joy.active) return;
      const t = e.changedTouches[0];
      this.joy.active = true;
      this.joy.id = t.identifier;
      this.joy.cx = t.clientX; this.joy.cy = t.clientY;
      this.joy.kx = t.clientX; this.joy.ky = t.clientY;
      this.joy.nx = this.joy.ny = this.joy.mag = 0;
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.joy.active) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joy.id) continue;
        const dx = t.clientX - this.joy.cx;
        const dy = t.clientY - this.joy.cy;
        const len = Math.hypot(dx, dy);
        const r = Math.min(len, JOY_RADIUS);
        const ang = Math.atan2(dy, dx);
        this.joy.kx = this.joy.cx + Math.cos(ang) * r;
        this.joy.ky = this.joy.cy + Math.sin(ang) * r;
        this.joy.mag = r / JOY_RADIUS;
        this.joy.nx = len > 0 ? dx / len : 0;
        this.joy.ny = len > 0 ? dy / len : 0;
        e.preventDefault();
      }
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          this.joy.active = false;
          this.joy.id = null;
          this.joy.mag = this.joy.nx = this.joy.ny = 0;
        }
      }
    };
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
    canvas.addEventListener("touchcancel", end);
  }

  /** 注册一次性按键回调（用于菜单/暂停切换） */
  onKey(fn) { this._listeners.push(fn); }

  isDown(...ks) { return ks.some((k) => this.keys.has(k)); }

  /** 返回归一化的移动方向（键盘优先，否则用触摸摇杆） */
  getMoveVector() {
    const v = new Vector2();
    if (this.isDown("w", "arrowup")) v.y -= 1;
    if (this.isDown("s", "arrowdown")) v.y += 1;
    if (this.isDown("a", "arrowleft")) v.x -= 1;
    if (this.isDown("d", "arrowright")) v.x += 1;
    if (v.lengthSq > 0) return v.normalize();

    // 触摸摇杆（超过死区才生效）
    if (this.joy.active && this.joy.mag > JOY_DEADZONE) {
      return v.set(this.joy.nx, this.joy.ny);
    }
    return v;
  }

  destroy() {
    window.removeEventListener("keydown", this._onDown);
    window.removeEventListener("keyup", this._onUp);
  }
}
