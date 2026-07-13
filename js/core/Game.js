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
import { Account } from "./Account.js";

import { Player } from "../entities/Player.js";
import { Enemy } from "../entities/Enemy.js";
import { Projectile } from "../entities/Projectile.js";
import { XPGem, DropType } from "../entities/XPGem.js";

import { SpawnSystem } from "../systems/SpawnSystem.js";
import { CollisionSystem } from "../systems/CollisionSystem.js";
import { UpgradeSystem } from "../systems/UpgradeSystem.js";
import { MetaProgression } from "../systems/MetaProgression.js";
import { Skins } from "../systems/Skins.js";
import { Codex } from "../systems/Codex.js";

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
    this.bosses = [];        // 当前存活的 Boss 列表（可能同时存在多个，用于顶部血条）
    this.timeScale = 1;      // 时间缩放（慢动作演出）
    this.flash = 0;          // 全屏白闪强度 0..1
    this.beams = [];         // 瞬时电弧光束（电弧链武器）
    this._runSaveTimer = 0;  // 对局快照自动保存节流计时

    // 元进度存档（跨局永久成长）
    // Account 负责账号库 + 迁移旧无后缀存档; 每位玩家有独立分区 save/run。
    const { current } = Account.init();
    this.user = current;
    this.save = SaveData.load(this.user.id);

    // 触摸设备：创建屏上暂停按钮（电脑端用 P/ESC）
    this.isTouch = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    if (this.isTouch) { this._createPauseButton(); this._createSkillButton(); }

    this._bindGlobalKeys();
    this._bindAutoSave();
    this._setupCanvas();
    window.addEventListener("resize", () => this._setupCanvas());

    this._showMenu();
  }

  /** 创建移动端屏上暂停按钮，挂在 #app（不受 screens.clear 影响） */
  _createPauseButton() {
    const btn = document.createElement("button");
    btn.className = "pause-fab";
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
      '<rect x="6" y="5" width="4" height="14" rx="1.5" fill="currentColor"></rect>' +
      '<rect x="14" y="5" width="4" height="14" rx="1.5" fill="currentColor"></rect>' +
      "</svg>";
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
    // 主动技能按钮显隐与暂停按钮同步（都仅在 PLAYING 显示）
    this._syncSkillBtn(visible);
  }

  /** 创建移动端主动技能按钮（仅装备了含主动技能皮肤时可见） */
  _createSkillButton() {
    const btn = document.createElement("button");
    btn.className = "skill-fab";
    btn.setAttribute("aria-label", "主动技能");
    btn.innerHTML = `<span class="sf-ic">◎</span><span class="sf-cd">READY</span>`;
    btn.addEventListener("click", () => {
      if (this.state === GameState.PLAYING) this.player.releaseActiveSkill(this);
    });
    (this.canvas.parentElement || document.body).appendChild(btn);
    this.skillBtn = btn;
  }

  /** 每帧同步主动技能按钮显隐 + 冷却文本（PLAYING 且装备了含主动技能皮肤时才显示） */
  _syncSkillBtn(visibleOverride) {
    if (!this.skillBtn) return;
    const sk = this.player && this.player.activeSkill;
    const canShow = !!sk && (visibleOverride !== undefined ? visibleOverride : this.state === GameState.PLAYING);
    if (!canShow) { this.skillBtn.style.display = "none"; return; }
    this.skillBtn.style.display = "flex";
    const ready = sk.timer <= 0;
    this.skillBtn.classList.toggle("cooldown", !ready);
    const cdEl = this.skillBtn.querySelector(".sf-cd");
    if (cdEl) cdEl.textContent = ready ? "READY" : `${sk.timer.toFixed(1)}s`;
    const icEl = this.skillBtn.querySelector(".sf-ic");
    if (icEl && sk.icon) icEl.textContent = sk.icon;
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
      // 空格: 释放当前皮肤附带的主动技能（若已装备且冷却就绪）
      if (k === " " && this.state === GameState.PLAYING) {
        this.player.releaseActiveSkill(this);
      }
    });
  }

  /** 页面隐藏/关闭时立即落盘对局快照，避免刷新或切走后丢失当前进度 */
  _bindAutoSave() {
    const flush = () => {
      if (this.state === GameState.PLAYING || this.state === GameState.PAUSED || this.state === GameState.LEVELUP) {
        this._captureRun();
      }
    };
    document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
    window.addEventListener("pagehide", flush);
  }

  // ---------------- 对局快照（localStorage 续玩） ----------------

  /** 将当前对局的玩家状态、统计与生成系统进度打包为纯 JSON 快照 */
  _snapshotRun() {
    const p = this.player;
    const s = this.spawnSystem;
    return {
      player: {
        hp: p.hp, maxHp: p.maxHp, speed: p.speed, pickupRange: p.pickupRange, regen: p.regen,
        damageMul: p.damageMul, critChance: p.critChance, critMult: p.critMult,
        cooldownMul: p.cooldownMul, damageReduction: p.damageReduction, xpMul: p.xpMul,
        lifesteal: p.lifesteal, revives: p.revives, pendingLevels: p.pendingLevels,
        level: p.level, xp: p.xp, xpToNext: p.xpToNext, x: p.x, y: p.y,
        weapons: p.weapons, acquired: p.acquired, skin: p.skin,
      },
      stats: { ...this.stats },
      spawn: {
        timer: s.timer, interval: s.interval, batch: s.batch, hpScale: s.hpScale,
        elapsed: s.elapsed, nextBoss: s.nextBoss, rampTimer: s.rampTimer, bossCount: s.bossCount,
      },
    };
  }

  /** 落盘当前对局快照 */
  _captureRun() {
    if (!this.player.alive) return;
    SaveData.saveRun(this.user.id, this._snapshotRun());
  }

  /** 从快照恢复对局并进入游戏（场上敌人重置，难度按存活时长延续） */
  _resumeRun() {
    const rs = SaveData.loadRun(this.user.id);
    if (!rs) { this.start(); return; }
    this.audio.init();
    this.player.reset();

    // 套用快照中的玩家数值（逐字段校验，避免损坏数据污染状态）
    const p = this.player, sp = rs.player;
    const numKeys = ["hp", "maxHp", "speed", "pickupRange", "regen", "damageMul", "critChance",
      "critMult", "cooldownMul", "damageReduction", "xpMul", "lifesteal", "revives",
      "pendingLevels", "level", "xp", "xpToNext", "x", "y"];
    for (const k of numKeys) {
      const v = Number(sp[k]);
      if (Number.isFinite(v)) p[k] = v;
    }
    if (sp.weapons && typeof sp.weapons === "object") p.weapons = JSON.parse(JSON.stringify(sp.weapons));
    if (sp.acquired && typeof sp.acquired === "object") p.acquired = JSON.parse(JSON.stringify(sp.acquired));
    if (sp.skin && typeof sp.skin === "object") p.skin = { ...p.skin, ...sp.skin };
    // 快照不保存主动技能状态, 依当前选中皮肤重新推导（保证续玩仍有主动技能可用）
    p.activeSkill = null;
    const curSkin = Skins.get(Skins.selected(this.save));
    if (curSkin && curSkin.perk) {
      // 只重放主动技能相关字段, 不重复注入数值加成（数值加成已在快照 player.* 中恢复）
      // 通过临时对象跑一遍 perk, 再把 activeSkill 挑出来
      const probe = { activeSkill: null, damageMul: 1, critChance: 0, cooldownMul: 1, lifesteal: 0, speed: 1, maxHp: 0, hp: 0, damageReduction: 0, pickupRange: 1 };
      try { curSkin.perk(probe, Math.max(1, Skins.starOf(this.save, curSkin.id))); } catch (_e) { /* ignore */ }
      if (probe.activeSkill) p.activeSkill = { ...probe.activeSkill, timer: 0 };
    }
    p.invuln = 0;

    // 清空场上实体（重开一片战场），难度进度由 spawnSystem 延续
    this._enemyPool.clear();
    this._projPool.clear();
    this._ebPool.clear();
    this._gemPool.clear();
    this.particles.clear();
    this.spawnSystem.reset();
    Object.assign(this.spawnSystem, rs.spawn);

    this.stats = {
      time: Number(rs.stats.time) || 0,
      kills: Math.max(0, Math.floor(Number(rs.stats.kills) || 0)),
      level: Math.max(1, Math.floor(Number(rs.stats.level) || 1)),
      bossKills: Math.max(0, Math.floor(Number(rs.stats.bossKills) || 0)),
    };
    this.bosses = [];
    this.timeScale = 1;
    this.flash = 0;
    this.beams.length = 0;
    this._runSaveTimer = 0;
    this.camera.update(this.player, 1);
    this.screens.clear();
    this.state = GameState.PLAYING;
    this._showPauseBtn(true);
  }

  start() {
    this.audio.init();
    // 开新的一局：丢弃旧的续玩快照
    SaveData.clearRun(this.user.id);
    // 重置全部状态
    this.player.reset();
    MetaProgression.applyTo(this.player, this.save); // 注入永久加成
    Skins.applyTo(this.player, this.save);           // 注入选中外观造型与专属特性
    this._enemyPool.clear();
    this._projPool.clear();
    this._ebPool.clear();
    this._gemPool.clear();
    this.particles.clear();
    this.spawnSystem.reset();
    this.stats = { time: 0, kills: 0, level: 1, bossKills: 0 };
    this.bosses = [];
    this.timeScale = 1;
    this.flash = 0;
    this.beams.length = 0;
    this.camera.update(this.player, 1); // 立即对齐
    this.screens.clear();
    this.state = GameState.PLAYING;
    this._showPauseBtn(true);
    this._runSaveTimer = 0;

    // 战术预载：开局立即领取额外强化选择
    if (this.player.pendingLevels > 0) this.onLevelUp();
    // 图鉴: 开局默认拥有脉冲枪, 视为已发掘
    Codex.discover(this.save, "weapons", "blaster");
  }

  /** 显示主菜单 */
  _showMenu() {
    this.state = GameState.MENU;
    this._showPauseBtn(false);
    const hasRun = !!SaveData.loadRun(this.user.id); // 存在有效续玩快照时展示「继续上局」
    this.screens.showMenu(this.save, this.user, {
      onStart: () => this.start(),
      onResume: hasRun ? () => this._resumeRun() : null,
      onShop: () => this._openShop(),
      onHangar: () => this._openHangar(),
      onCodex: () => this._openCodex(),
      onAccount: () => this._openAccount(),
    });
  }

  /** 打开图鉴（收集情报 + 里程碑奖励） */
  _openCodex() {
    this.audio.init();
    this.state = GameState.CODEX;
    this._showPauseBtn(false);
    this.screens.showCodex(this.save, {
      // 领取回调只做数据变更 + 落盘, 不重建整页; 界面的按钮/样式由 showCodex 内部局部更新
      onClaim: (id) => {
        const res = Codex.claim(this.save, id);
        if (res) {
          SaveData.save(this.user.id, this.save);
          this.audio.levelup();
        }
        return res;
      },
      onBack: () => this._showMenu(),
    });
  }

  /**
   * 打开玩家管理界面：切换 / 创建 / 重命名 / 删除。
   * 切换或删除当前用户后会重载存档并回到主菜单。
   */
  _openAccount() {
    this.audio.init();
    this.state = GameState.MENU; // 复用 MENU 状态即可, 不需要单独的 state
    this._showPauseBtn(false);
    const render = () => {
      this.screens.showAccount(this.user.id, {
        onSwitch: (id) => {
          if (Account.switchTo(id)) {
            this._reloadForUser(id);
          }
        },
        onCreate: ({ name }) => {
          const res = Account.create({ name });
          if (!res.ok) return res.error;
          this._reloadForUser(res.user.id);
          return null;
        },
        onRename: (id, name) => {
          const err = Account.rename(id, name);
          if (!err && id === this.user.id) this.user = Account.current();
          if (!err) render(); // 刷新界面显示新昵称
          return err;
        },
        onDelete: (id) => {
          const nextId = Account.remove(id);
          this._reloadForUser(nextId);
        },
        onBack: () => this._showMenu(),
      });
    };
    render();
  }

  /** 切换到指定用户: 重载 save/run, 场上实体清空, 返回菜单 */
  _reloadForUser(userId) {
    // 若在游戏中切换用户, 先落盘并清理场上状态
    this._enemyPool.clear();
    this._projPool.clear();
    this._ebPool.clear();
    this._gemPool.clear();
    this.particles.clear();
    this.bosses = [];
    this.beams.length = 0;

    Account.switchTo(userId); // 幂等: 已是当前则忽略
    this.user = Account.current();
    this.save = SaveData.load(this.user.id);
    this._showMenu();
  }

  /** 打开机库（外观选择 + 抽卡） */
  _openHangar() {
    this.audio.init();
    this.state = GameState.HANGAR;
    this._showPauseBtn(false);
    this.screens.showHangar(this.save, {
      onSelect: (id) => {
        if (Skins.select(this.save, id)) {
          SaveData.save(this.user.id, this.save);
          this.audio.pickup();
        }
        // 无需重建机库: showHangar 内部已做局部 DOM 切换, 避免整页重绘的闪动
      },
      onDraw: (count) => {
        const results = this._drawGacha(count);
        if (results) {
          SaveData.save(this.user.id, this.save);
          this.audio.levelup();
          this.screens.showGachaResult(this.save, results, () => this._openHangar());
        }
      },
      onFreeDraw: () => {
        const res = Skins.freeDraw(this.save);
        if (res) {
          SaveData.save(this.user.id, this.save);
          this.audio.levelup();
          this.screens.showGachaResult(this.save, [res], () => this._openHangar());
        }
      },
      onBack: () => this._showMenu(),
    });
  }

  /**
   * 执行 count 连抽（1 或 10）。校验并扣除棱牌后逐次抽取。
   * 棱牌不足时返回 null（不扣费）。
   */
  _drawGacha(count) {
    const price = count >= 10 ? Skins.priceTen() : Skins.priceSingle();
    if (this.save.skins.shards < price) return null;
    this.save.skins.shards -= price;
    const results = [];
    for (let i = 0; i < count; i++) results.push(Skins.drawOne(this.save));
    return results;
  }

  /** 打开强化实验室（永久升级商店） */
  _openShop() {
    this.audio.init();
    this.state = GameState.SHOP;
    this._showPauseBtn(false);
    this.screens.showShop(this.save, {
      onBuy: (id) => {
        if (MetaProgression.buy(this.save, id)) {
          SaveData.save(this.user.id, this.save);
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

  _pause() { this.state = GameState.PAUSED; this._showPauseBtn(false); this._captureRun(); this.screens.showPause(this.player, () => this._resume(), () => this._quitRun()); }
  _resume() { this.screens.clear(); this.state = GameState.PLAYING; this._showPauseBtn(true); }

  /** 主动结束本局：不做奖励结算，清除续玩快照后返回主菜单 */
  _quitRun() {
    this.state = GameState.MENU;
    this._showPauseBtn(false);
    SaveData.clearRun(this.user.id);
    this._showMenu();
  }

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
    // 图鉴: 武器解锁项 (id 形如 unlock_xxx) -> 记录到 weapons 分类
    if (u && u.unlock && typeof u.id === "string" && u.id.startsWith("unlock_")) {
      Codex.discover(this.save, "weapons", u.id.slice("unlock_".length));
    }
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
      if (e.isBoss) this.bosses.push(e); // 记录当前 Boss 供血条显示（支持并存多个）
      // 图鉴埋点: 首次遭遇即记录. Boss / 普通分开归类, 界面分区展示.
      Codex.discover(this.save, e.isBoss ? "bosses" : "enemies", type);
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
    // 图鉴埋点: 记录道具类型（经验晶体除外, 不作为收集条目）
    if (type !== DropType.XP) Codex.discover(this.save, "items", type);
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
    const bi = this.bosses.indexOf(boss);
    if (bi !== -1) this.bosses.splice(bi, 1);
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

    // 移动端主动技能按钮冷却文本同步（低成本, 每帧调用即可）
    if (this.skillBtn) this._syncSkillBtn();

    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    this.stats.time += dt;
    this.stats.level = this.player.level;

    // 周期性落盘对局快照（每 4 秒），保证意外关闭也能续玩
    this._runSaveTimer += dt;
    if (this._runSaveTimer >= 4) { this._runSaveTimer = 0; this._captureRun(); }

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
    SaveData.clearRun(this.user.id); // 本局结束，清除续玩快照
    this.audio.gameover();
    this.camera.shake(30);
    this.particles.burst(this.player.x, this.player.y, "#00f0ff", 60, 500, 5, 1.2);

    // 结算货币并刷新历史记录，持久化存档
    const reward = MetaProgression.reward(this.save, this.stats);
    const shardReward = Skins.reward(this.stats); // 本局产出的棱牌 ✦
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
    this.save.skins.shards += shardReward;
    this.save.totals.runs++;
    this.save.totals.kills += this.stats.kills;
    this.save.totals.bossKills += this.stats.bossKills;
    this.save.totals.cores += reward;
    SaveData.save(this.user.id, this.save);

    setTimeout(() => this.screens.showGameOver(this.stats, { reward, shardReward, records, save: this.save }, {
      onRestart: () => this.start(),
      onShop: () => this._openShop(),
      onHangar: () => this._openHangar(),
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

    // 玩家子弹 / 光束：叠加混合获得霓虹能量质感（批量一次性设置）
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.projectiles) p.render(ctx);
    this._drawBeams(ctx);
    ctx.restore();

    // 敌方弹幕：普通混合下绘制实心敌意光球，与玩家能量弹形成鲜明区分
    for (const b of this.enemyProjectiles) b.render(ctx);

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
