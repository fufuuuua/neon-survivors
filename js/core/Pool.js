/**
 * Pool.js — 通用对象池。
 * 使用「活跃列表 + 空闲栈 + swap-remove」实现 O(1) 取用与回收，
 * 且迭代时只遍历活跃对象（而非整个池），避免每帧扫描大量闲置槽位。
 */
export class Pool {
  /**
   * @param {() => object} factory 创建实例的工厂；实例需含布尔字段 `active`
   * @param {number} size 池容量
   */
  constructor(factory, size) {
    this._items = Array.from({ length: size }, factory);
    this.active = [];                 // 当前活跃对象（供外部迭代）
    this._free = [...this._items];    // 空闲对象栈
  }

  /** 取出一个空闲对象并标记为活跃；池满返回 null */
  obtain() {
    const o = this._free.pop();
    if (!o) return null;
    o.active = true;
    this.active.push(o);
    return o;
  }

  /** 回收所有 active === false 的对象（swap-remove，O(active)） */
  reclaim() {
    const a = this.active;
    for (let i = a.length - 1; i >= 0; i--) {
      if (!a[i].active) {
        const dead = a[i];
        a[i] = a[a.length - 1];
        a.pop();
        this._free.push(dead);
      }
    }
  }

  /** 全部回收 */
  clear() {
    for (const o of this.active) o.active = false;
    this.reclaim();
  }
}
