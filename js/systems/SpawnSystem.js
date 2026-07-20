/**
 * SpawnSystem.js — 敌人生成系统。
 * 随时间提升难度（缩短间隔、增加数量、提高血量、加入更强敌人），
 * 并按固定周期生成 Boss。
 */
import { CONFIG } from "../config.js";
import { rand, randInt, weightedChoice, TAU } from "../utils/math.js";

export class SpawnSystem {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.timer = 0;
    this.interval = CONFIG.spawn.interval;
    this.batch = CONFIG.spawn.batch;
    this.hpScale = 1;
    this.elapsed = 0;
    this.nextBoss = CONFIG.spawn.bossEvery;
    this.rampTimer = 0;
    this.bossCount = 0;      // 已降临 Boss 数（决定变体与增强轮次）
  }

  /** 根据存活时长决定可生成的敌人种类与权重 */
  _enemyPool() {
    const t = this.elapsed;
    const pool = [{ value: "chaser", weight: 10 }];
    if (t > 20) pool.push({ value: "rusher", weight: 7 });
    if (t > 45) pool.push({ value: "splitter", weight: 5 });
    if (t > 70) pool.push({ value: "tank", weight: 4 });
    return pool;
  }

  update(dt) {
    this.elapsed += dt;
    this.rampTimer += dt;

    // 难度爬升
    if (this.rampTimer >= CONFIG.spawn.rampEvery) {
      this.rampTimer -= CONFIG.spawn.rampEvery;
      this.interval = Math.max(CONFIG.spawn.minInterval, this.interval * 0.88);
      this.hpScale += 0.18;
      if (this.elapsed > 60 && this.batch < 6) this.batch++;
    }

    // Boss 生成
    if (this.elapsed >= this.nextBoss) {
      this.nextBoss += CONFIG.spawn.bossEvery;
      const order = CONFIG.bossOrder;
      const type = order[this.bossCount % order.length];
      const cycle = Math.floor(this.bossCount / order.length); // 每轮完整轮换后进一步增强
      const bossScale = this.hpScale * (1 + cycle * 0.6);
      const boss = this._spawnAt(type, bossScale);
      this.bossCount++;
      this.game.onBossSpawn(boss);
    }

    // 常规生成
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = this.interval;
      const pool = this._enemyPool();
      for (let i = 0; i < this.batch; i++) {
        this._spawnAt(weightedChoice(pool), this.hpScale);
      }
    }
  }

  /** 在玩家可视区域外的随机位置生成敌人 */
  _spawnAt(type, hpScale) {
    const cam = this.game.camera;
    const pad = CONFIG.spawn.spawnPad;
    const angle = rand(0, TAU);
    // 用 camera 世界坐标可视区 (兼容 worldZoom 缩放): 保证敌人真正生成在玩家看不到的地方
    const vw = cam.worldViewW, vh = cam.worldViewH;
    const dist = Math.hypot(vw, vh) / 2 + pad;
    const cx = cam.x + vw / 2;
    const cy = cam.y + vh / 2;
    let x = cx + Math.cos(angle) * dist;
    let y = cy + Math.sin(angle) * dist;
    x = Math.max(20, Math.min(CONFIG.world.width - 20, x));
    y = Math.max(20, Math.min(CONFIG.world.height - 20, y));
    return this.game.spawnEnemy(type, x, y, hpScale);
  }

  /** 裂解体死亡时分裂出小型追逐者 */
  spawnSplit(x, y, hpScale) {
    const n = randInt(2, 3);
    for (let i = 0; i < n; i++) {
      const e = this.game.spawnEnemy("chaser", x + rand(-20, 20), y + rand(-20, 20), hpScale * 0.4);
      if (e) { e.radius *= 0.8; e.speed *= 1.2; }
    }
  }
}
