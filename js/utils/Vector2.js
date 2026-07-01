/**
 * Vector2.js — 二维向量工具类（不可变风格的链式运算）
 */
export class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  set(x, y) { this.x = x; this.y = y; return this; }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  clone() { return new Vector2(this.x, this.y); }

  add(v) { this.x += v.x; this.y += v.y; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  scale(s) { this.x *= s; this.y *= s; return this; }

  get length() { return Math.hypot(this.x, this.y); }
  get lengthSq() { return this.x * this.x + this.y * this.y; }

  normalize() {
    const len = this.length;
    if (len > 1e-6) { this.x /= len; this.y /= len; }
    return this;
  }

  /** 朝目标方向的单位向量 */
  static dir(from, to) {
    return new Vector2(to.x - from.x, to.y - from.y).normalize();
  }

  static dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  static distSq(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  }
}
