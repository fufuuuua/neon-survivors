/**
 * SpatialGrid.js — 均匀空间网格哈希，用于近邻查询，将碰撞从 O(n·m) 降到近似 O(n)。
 * 每帧调用 rebuild() 重新装填，再用 queryCircle() 查询某点邻域内的对象。
 */
export class SpatialGrid {
  constructor(cellSize = 96) {
    this.cellSize = cellSize;
    this.cells = new Map();   // key "cx,cy" -> object[]
    this._epoch = 0;          // 用于 queryCircle 去重
  }

  _key(cx, cy) { return cx * 100003 + cy; }

  rebuild(objects) {
    this.cells.clear();
    const cs = this.cellSize;
    for (const o of objects) {
      const k = this._key(Math.floor(o.x / cs), Math.floor(o.y / cs));
      let arr = this.cells.get(k);
      if (!arr) { arr = []; this.cells.set(k, arr); }
      arr.push(o);
    }
  }

  /**
   * 遍历以 (x,y) 为圆心、半径 r 覆盖到的所有格子内的对象。
   * 通过 epoch 标记保证同一对象在一次查询中只回调一次。
   * @param {(obj:object)=>(boolean|void)} cb 返回 true 可提前终止
   */
  queryCircle(x, y, r, cb) {
    const cs = this.cellSize;
    const minX = Math.floor((x - r) / cs), maxX = Math.floor((x + r) / cs);
    const minY = Math.floor((y - r) / cs), maxY = Math.floor((y + r) / cs);
    const epoch = ++this._epoch;
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const arr = this.cells.get(this._key(cx, cy));
        if (!arr) continue;
        for (const o of arr) {
          if (o._epoch === epoch) continue;
          o._epoch = epoch;
          if (cb(o) === true) return;
        }
      }
    }
  }
}
