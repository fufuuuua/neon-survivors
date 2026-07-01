/**
 * Game.js — 游戏核心控制器（外观/中介者）。
 * 职责：
 *  - 持有所有子系统与对象池，协调它们的 update / render。
 *  - 维护游戏状态机（菜单/进行/升级/暂停/结束）。
 *  - 对外暴露供实体调用的服务方法（spawnProjectile / damageEnemy / findNearestEnemy 等），
 *    以实现实体与系统的解耦。
 *
 * 性能设计：
 *  - 敌人/子弹/掉落物均由 Pool 管理，spawn 为 O(1)，迭代只遍历活跃对象。
 *  - 每帧重建敌人空间网格 SpatialGrid，碰撞与范围武器经网格做近邻查询。
 */
import { CONFIG, GameState } from "../config.js";
import { Vector2 } from "../utils/Vector2.js";

import { Input } from "./Input.js";
import { AudioFx } from "./AudioFx.js";
import { Camera } from "./Camera.js";
import { ParticleSystem } from "./ParticleSystem.js";
import { Pool } from "./Pool.js";
import { SpatialGrid } from "./SpatialGrid.js";
import { SaveData } from "./SaveData.js";

import { Player } from "../entities/Player.js";
import { Enemy } from "../entities/Enemy.js";
import { Projectile } from "../entities/Projectile.js";
import { XPGem, DropType } from "../entities/XPGem.js";

import { SpawnSystem } from "../systems/SpawnSystem.js";
import { CollisionSystem } from "../systems/CollisionSystem.js";
import { UpgradeSystem } from "../systems/UpgradeSystem.js";
import { MetaProgression } from "../systems/MetaProgression.js";

import { HUD } from "../ui/HUD.js";
import { Screens } from "../ui/Screens.js";

const POOL = { enemies: 500, projectiles: 800, enemyBullets: 600, gems: 1000 };

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    // 核心服务
    this.input = new Input(canvas);
    this.audio = new AudioFx();
    this.camera = new Camera(canvas.width, canvas.height);
    this.particles = new ParticleSystem();
    this.grid = new SpatialGrid(96);

    // 实体（对象池）
    this.player = new Player();
    this._enemyPool = new Pool(() => new Enemy(), POOL.enemies);
    this._projPool = new Pool(() => new Projectile(), POOL.projectiles);
    this._ebPool = new Pool(() => new Projectile(), POOL.enemyBullets); // 敌方弹幕
    this._gemPool = new Pool(() => new XPGem(), POOL.gems);

    // 系统
    this.spawnSystem = new SpawnSystem(this);
    this.collisionSystem = new CollisionSystem(this);

    // UI
    this.hud = new HUD();
    this.screens = new Screens(uiRoot);

    // 状态
    this.state = GameState.MENU;
    this.stats = { time: 0, kills: 0, level: 1, bossKills: 0 };
    this._lastTime = 0;
    this.boss = null;        // 当前存活的 Boss 引用（用于顶部血条）
    this.timeScale = 1;      // 时间缩放（慢动作演出）
    this.flash = 0;          // 全屏白闪强度 0..1
    this.beams = [];         // 瞬时电弧光束（电弧链武器）

    // 元进度存档（跨局永久成长）
    this.save = SaveData.load();

    // 触摸设备：创建屏上暂停按钮（电脑端用 P/ESC）
    this.isTouch = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    if (this.isTouch) this._createPauseButton();

    this._bindGlobalKeys();
    this._setupCanvas();
    window.addEventListener("resize", () => this._setupCanvas());

    this._showMenu();
  }

  /** 创建移动端屏上暂停按钮，挂在 #app（不受 screens.clear 影响） */
  _createPauseButton() {
    const btn = document.createElement("button");
    btn.className = "pause-fab";
    btn.textContent = "⏸";
    btn.setAttribute("aria-label", "暂停");
    btn.addEventListener("click", () => {
      if (this.state === GameState.PLAYING) this._pause();
    });
    (this.canvas.parentElement || document.body).appendChild(btn);
    this.pauseBtn = btn;
  }

  /** 显隐暂停按钮 */
  _showPauseBtn(visible) {
    if (this.pauseBtn) this.pauseBtn.style.display = visible ? "flex" : "none";
  }

  // 活跃实体列表（只读视图，供系统/实体迭代）
  get enemies() { return this._enemyPool.active; }
  get projectiles() { return this._projPool.active; }
  get enemyProjectiles() { return this._ebPool.active; }
  get gems() { return this._gemPool.active; }

  // ---------------- 生命周期 ----------------
  _setupCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.camera.resize(this.viewW, this.viewH);
  }

  _bindGlobalKeys() {
    this.input.onKey((k) => {
      if (k === "p" || k === "escape") {
        if (this.state === GameState.PLAYING) this._pause();
        else if (this.state === GameState.PAUSED) this._resume();
      }
      // 升级界面数字快捷键
      if (this.state === GameState.LEVELUP && ["1", "2", "3"].includes(k)) {
        const idx = parseInt(k, 10) - 1;
        if (this._levelChoices && this._levelChoices[idx]) {
          this._applyUpgrade(this._levelChoices[idx]);
        }
      }
    });
  }

  start() {
    this.audio.init();
    // 重置全部状态
    this.player.reset();
    MetaProgression.applyTo(this.player, this.save); // 注入永久加成
    this._enemyPool.clear();
    this._projPool.clear();
    this._ebPool.clear();
    this._gemPool.clear();
    this.particles.clear();
    this.spawnSystem.reset();
    this.stats = { time: 0, kills: 0, level: 1, bossKills: 0 };
    this.boss = null;
    this.timeScale = 1;
    this.flash = 0;
    this.beams.length = 0;
    this.camera.update(this.player, 1); // 立即对齐
    this.screens.clear();
    this.state = GameState.PLAYING;
    this._showPauseBtn(true);

    // 战术预载：开局立即领取额外强化选择
    if (this.player.pendingLevels > 0) this.onLevelUp();
  }

  /** 显示主菜单 */
  _showMenu() {
    this.state = GameState.MENU;
    this._showPauseBtn(false);
    this.screens.showMenu(this.save, {
      onStart: () => this.start(),
      onShop: () => this._openShop(),
    });
  }

  /** 打开强化实验室（永久升级商店） */
  _openShop() {
    this.audio.init();
    this.state = GameState.SHOP;
    this._showPauseBtn(false);
    this.screens.showShop(this.save, {
      onBuy: (id) => {
        if (MetaProgression.buy(this.save, id)) {
          SaveData.save(this.save);
          this.audio.pickup();
        }
        this._openShop(); // 刷新界面
      },
      onBack: () => this._showMenu(),
    });
  }

  /** 触发全屏白闪（演出用） */
  screenFlash(intensity = 0.6) { this.flash = Math.max(this.flash, intensity); }

  /** 触发短暂慢动作 */
  slowmo(scale = 0.35) { this.timeScale = Math.min(this.timeScale, scale); }

  _pause() { this.state = GameState.PAUSED; this._showPauseBtn(false); this.screens.showPause(this.player, () => this._resume()); }
  _resume() { this.screens.clear(); this.state = GameState.PLAYING; this._showPauseBtn(true); }

  // ---------------- 升级流程 ----------------
  onLevelUp() {
    this.state = GameState.LEVELUP;
    this._showPauseBtn(false);
    this.audio.levelup();
    this._levelChoices = UpgradeSystem.roll(this.player, 3);
    this.screens.showLevelUp(this.player, this._levelChoices, (u) => this._applyUpgrade(u));
  }

  _applyUpgrade(u) {
    UpgradeSystem.apply(u, this.player);
    this.particles.text(this.player.x, this.player.y - 40, u.name, u.accent, 20);
    this.screens.clear();
    // 优先消耗“战术预载”额外次数，其次是常规经验溢出
    if (this.player.pendingLevels > 0) { this.player.pendingLevels--; this.onLevelUp(); }
    else if (this.player.xp >= this.player.xpToNext) this.onLevelUp();
    else { this.state = GameState.PLAYING; this._showPauseBtn(true); }
  }

  onBossSpawn(boss) {
    const name = (boss && boss.def && boss.def.name) || "母核";
    this.particles.text(this.camera.x + this.viewW / 2, this.camera.y + 80, `⚠ ${name}降临`, (boss && boss.color) || "#ff2bd6", 30);
    this.camera.shake(18);
  }

  // ---------------- 供实体调用的服务方法 ----------------
  spawnEnemy(type, x, y, hpScale) {
    const e = this._enemyPool.obtain();
    if (e) {
      e.spawn(type, x, y, hpScale);
      if (e.isBoss) this.boss = e; // 记录当前 Boss 供血条显示
    }
    return e;
  }

  spawnProjectile(x, y, vx, vy, opts) {
    const p = this._projPool.obtain();
    if (p) p.spawn(x, y, vx, vy, opts);
  }

  /** 生成敌方弹幕（Boss 攻击用），命中玩家造成伤害 */
  spawnEnemyProjectile(x, y, vx, vy, opts) {
    const b = this._ebPool.obtain();
    if (b) b.spawn(x, y, vx, vy, opts);
  }

  spawnGem(x, y, value, type = DropType.XP) {
    const g = this._gemPool.obtain();
    if (g) g.spawn(x, y, value, type);
  }

  /** 记录一条瞬时电弧光束（电弧链武器用），由主循环衰减、render 绘制 */
  addBeam(x1, y1, x2, y2, color, life = 0.16) {
    this.beams.push({ x1, y1, x2, y2, color, life, maxLife: life });
  }

  /** 对敌人造成伤害，处理暴击、击杀、掉落、特效 */
  damageEnemy(enemy, amount, showText = true, hx = enemy.x, hy = enemy.y) {
    let crit = false;
    const p = this.player;
    if (p.critChance > 0 && Math.random() < p.critChance) {
      amount *= p.critMult;
      crit = true;
    }
    const dead = enemy.hurt(amount);
    if (showText) this.particles.damageText(hx, hy, amount, amount > 40 || crit);
    this.particles.burst(hx, hy, crit ? "#ff8a3d" : enemy.color, crit ? 7 : 4, crit ? 180 : 120, 2, 0.3);
    if (dead) this._killEnemy(enemy);
    else this.audio.hit();
  }

  _killEnemy(enemy) {
    enemy.active = false;
    this.stats.kills++;
    if (this.player.lifesteal > 0) this.player.heal(this.player.lifesteal);

    if (enemy.isBoss) { this._killBoss(enemy); return; }

    this.audio.kill();
    this.particles.burst(enemy.x, enemy.y, enemy.color, 14, 240, 3, 0.6);

    // 裂解体分裂
    if (enemy.type === "splitter") {
      this.spawnSystem.spawnSplit(enemy.x, enemy.y, this.spawnSystem.hpScale);
    }

    // 掉落经验
    this.spawnGem(enemy.x, enemy.y, enemy.xp, DropType.XP);

    // 概率掉落道具
    const roll = Math.random();
    if (roll < 0.015) {
      this.spawnGem(enemy.x, enemy.y, 0, DropType.HEAL);
    } else if (roll < 0.025) {
      this.spawnGem(enemy.x, enemy.y, 0, DropType.MAGNET);
    } else if (roll < 0.03) {
      this.spawnGem(enemy.x, enemy.y, 0, DropType.BOMB);
    }
  }

  /** Boss 击杀演出：全屏闪白 + 慢动作 + 多波爆发 + 丰厚掉落 + 专属音效 */
  _killBoss(boss) {
    if (this.boss === boss) this.boss = null;
    this.stats.bossKills++;

    // 演出
    this.audio.bossKill();
    this.screenFlash(0.85);
    this.slowmo(0.3);
    this.camera.shake(46);
    this.player.heal(this.player.maxHp * 0.3); // 击杀回血奖励

    // 多波霓虹爆发（以 Boss 本体色主导）
    const colors = [boss.color, "#00f0ff", "#aaff00", "#ffd23f"];
    for (let w = 0; w < 4; w++) {
      const c = colors[w % colors.length];
      this.particles.burst(boss.x, boss.y, c, 36, 200 + w * 160, 5, 1.0 + w * 0.15);
    }
    const bossName = (boss.def && boss.def.name) || "母核";
    this.particles.text(boss.x, boss.y - 40, `${bossName} 净化`, boss.color, 34);
    this.particles.text(boss.x, boss.y + 20, "+30% HP", "#aaff00", 20);

    // 丰厚掉落：环形散布的经验雨 + 必掉强力道具
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 36;
      this.spawnGem(boss.x + Math.cos(a) * r, boss.y + Math.sin(a) * r, Math.ceil(boss.xp / n), DropType.XP);
    }
    this.spawnGem(boss.x - 30, boss.y, 0, DropType.HEAL);
    this.spawnGem(boss.x + 30, boss.y, 0, DropType.BOMB);
    this.spawnGem(boss.x, boss.y - 30, 0, DropType.MAGNET);
  }

  findNearestEnemy(x, y) {
    let best = null, bestD = Infinity;
    for (const e of this.enemies) {
      const d = Vector2.distSq(e, { x, y });
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** 查找最近敌人，排除已命中集合并限制最大距离（电弧链跳跃用） */
  findNearestEnemyExcept(x, y, exclude, maxRange) {
    let best = null, bestD = maxRange * maxRange;
    for (const e of this.enemies) {
      if (!e.active || exclude.has(e)) continue;
      const d = Vector2.distSq(e, { x, y });
      if (d <= bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // ---------------- 主循环 ----------------
  loop(now) {
    const rawDt = Math.min(0.05, (now - this._lastTime) / 1000 || 0);
    this._lastTime = now;

    // 游戏逻辑使用缩放后的时间（慢动作演出）
    if (this.state === GameState.PLAYING) this.update(rawDt * this.timeScale);

    // 演出量用真实时间衰减/回归，不受慢动作影响
    if (this.flash > 0) this.flash = Math.max(0, this.flash - rawDt * 2.4);
    if (this.timeScale < 1) this.timeScale = Math.min(1, this.timeScale + rawDt * 1.6);

    // 电弧光束衰减（真实时间）
    if (this.beams.length) {
      for (const b of this.beams) b.life -= rawDt;
      this.beams = this.beams.filter((b) => b.life > 0);
    }

    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    this.stats.time += dt;
    this.stats.level = this.player.level;

    // 0) 生成敌人（含难度爬升与 Boss）
    this.spawnSystem.update(dt);
    // 1) 敌人移动与 AI（Boss 攻击需要 game 上下文）
    for (const e of this.enemies) e.update(dt, this.player, this);
    // 2) 重建空间网格（基于本帧敌人位置）
    this.grid.rebuild(this.enemies);
    // 3) 玩家移动与武器（范围武器经网格查询）
    this.player.update(dt, this.input, this);
    // 4) 子弹推进 + 离屏回收
    for (const p of this.projectiles) {
      p.update(dt);
      if (p.active && !this.camera.inView(p.x, p.y, 200)) p.active = false;
    }
    // 4b) 敌方弹幕推进 + 离屏回收
    for (const b of this.enemyProjectiles) {
      b.update(dt);
      if (b.active && !this.camera.inView(b.x, b.y, 200)) b.active = false;
    }
    // 5) 掉落物磁吸
    for (const g of this.gems) g.update(dt, this.player, this.player.pickupRange);
    // 6) 碰撞结算
    this.collisionSystem.update(dt);
    // 7) 特效与相机
    this.particles.update(dt);
    this.camera.update(this.player, dt);

    // 8) 回收失活对象（紧凑活跃列表）
    this._enemyPool.reclaim();
    this._projPool.reclaim();
    this._ebPool.reclaim();
    this._gemPool.reclaim();

    if (!this.player.alive) {
      if (this.player.revives > 0) this._revive();
      else this._gameOver();
    }
  }

  /** 应急重构（局外强化）：阵亡后原地复活一次，清场并短暂无敌 */
  _revive() {
    this.player.revives--;
    this.player.hp = this.player.maxHp;
    this.player.invuln = 3;
    this.screenFlash(0.9);
    this.slowmo(0.35);
    this.camera.shake(40);
    // 净化屏内敌人与弹幕，给玩家喘息
    for (const e of this.enemies) if (e.active && !e.isBoss) this.damageEnemy(e, 99999, false);
    for (const b of this.enemyProjectiles) b.active = false;
    const colors = ["#aaff00", "#00f0ff", "#ffd23f"];
    for (let w = 0; w < 3; w++) this.particles.burst(this.player.x, this.player.y, colors[w], 40, 260 + w * 160, 5, 1.0);
    this.particles.text(this.player.x, this.player.y - 40, "重构完成", "#aaff00", 30);
    this.audio.bossKill();
  }

  _gameOver() {
    this.state = GameState.GAMEOVER;
    this._showPauseBtn(false);
    this.audio.gameover();
    this.camera.shake(30);
    this.particles.burst(this.player.x, this.player.y, "#00f0ff", 60, 500, 5, 1.2);

    // 结算货币并刷新历史记录，持久化存档
    const reward = MetaProgression.reward(this.save, this.stats);
    const best = this.save.best;
    const records = {
      time: this.stats.time > best.time,
      kills: this.stats.kills > best.kills,
      level: this.stats.level > best.level,
      bossKills: this.stats.bossKills > best.bossKills,
    };
    best.time = Math.max(best.time, this.stats.time);
    best.kills = Math.max(best.kills, this.stats.kills);
    best.level = Math.max(best.level, this.stats.level);
    best.bossKills = Math.max(best.bossKills, this.stats.bossKills);

    this.save.cores += reward;
    this.save.totals.runs++;
    this.save.totals.kills += this.stats.kills;
    this.save.totals.bossKills += this.stats.bossKills;
    this.save.totals.cores += reward;
    SaveData.save(this.save);

    setTimeout(() => this.screens.showGameOver(this.stats, { reward, records, save: this.save }, {
      onRestart: () => this.start(),
      onShop: () => this._openShop(),
      onMenu: () => this._showMenu(),
    }), 700);
  }

  // ---------------- 渲染 ----------------
  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    this.camera.begin(ctx);
    this._drawBackground(ctx);

    for (const g of this.gems) if (this.camera.inView(g.x, g.y)) g.render(ctx);
    for (const e of this.enemies) if (this.camera.inView(e.x, e.y)) e.render(ctx);

    // 子弹用叠加混合获得霓虹质感（批量一次性设置）
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.projectiles) p.render(ctx);
    for (const b of this.enemyProjectiles) b.render(ctx);
    this._drawBeams(ctx);
    ctx.restore();

    if (this.state !== GameState.MENU) this.player.render(ctx);
    this.particles.render(ctx);
    this.camera.end(ctx);

    // 暗角（屏幕空间，绘制在游戏世界之上、HUD 之下，因此不会压住血条/经验条）
    this._drawVignette(ctx);

    // HUD（屏幕空间）
    if ([GameState.PLAYING, GameState.LEVELUP, GameState.PAUSED].includes(this.state)) {
      this.hud.render(ctx, this);
    }

    // 全屏白闪（演出，屏幕空间，叠加在最上层）
    if (this.flash > 0.001) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.flash);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, this.viewW, this.viewH);
      ctx.restore();
    }
  }

  /** 绘制电弧链光束：抖动折线 + 发光，短暂存在 */
  _drawBeams(ctx) {
    for (const b of this.beams) {
      const a = Math.max(0, b.life / b.maxLife);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = b.color;
      ctx.shadowBlur = 14; ctx.shadowColor = b.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      // 沿路径加入几段随机抖动，模拟电弧
      const segs = 5;
      for (let i = 1; i < segs; i++) {
        const t = i / segs;
        const mx = b.x1 + (b.x2 - b.x1) * t;
        const my = b.y1 + (b.y2 - b.y1) * t;
        const j = 9 * a;
        ctx.lineTo(mx + (Math.random() - 0.5) * j, my + (Math.random() - 0.5) * j);
      }
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** 屏幕空间暗角（径向渐变），在 HUD 之下绘制 */
  _drawVignette(ctx) {
    const W = this.viewW, H = this.viewH;
    const cx = W / 2, cy = H / 2;
    const inner = Math.min(W, H) * 0.52;
    const outer = Math.hypot(W, H) / 2;
    const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    g.addColorStop(0, "rgba(5,6,14,0)");
    g.addColorStop(1, "rgba(5,6,14,0.82)");
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  /** 视差网格背景 + 世界边界霓虹墙 */
  _drawBackground(ctx) {
    const g = CONFIG.world.gridSize;
    const cam = this.camera;
    const startX = Math.floor(cam.x / g) * g;
    const startY = Math.floor(cam.y / g) * g;
    const endX = cam.x + this.viewW;
    const endY = cam.y + this.viewH;

    ctx.save();
    ctx.strokeStyle = "rgba(0,240,255,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x < endX; x += g) {
      ctx.moveTo(x, cam.y); ctx.lineTo(x, endY);
    }
    for (let y = startY; y < endY; y += g) {
      ctx.moveTo(cam.x, y); ctx.lineTo(endX, y);
    }
    ctx.stroke();

    // 世界边界
    ctx.strokeStyle = "rgba(255,43,214,0.5)";
    ctx.lineWidth = 4;
    ctx.shadowBlur = 20; ctx.shadowColor = "#ff2bd6";
    ctx.strokeRect(0, 0, CONFIG.world.width, CONFIG.world.height);
    ctx.restore();
  }
}
