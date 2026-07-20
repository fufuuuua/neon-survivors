/**
 * LevelRunner.js — 闯关模式「路线走廊(path)」关卡引擎。
 *
 * 玩法(第一章):
 *  - 战机从世界下方出发, 沿一条带转折的霓虹通道向上突进, 抵达顶端终点即通关。
 *  - 生命值 3 点(心形 HUD): 触碰墙壁 -1, 被敌人/敌方弹幕击中 -1, 归零即失败。
 *  - 玩家武器与敌人类型完全复用无限模式(chaser/rusher/splitter/tank + blaster 主武器),
 *    差别只在: 不生成 Boss、不掉经验/道具、无升级选择。
 *  - 通道沿途散布 3 颗能量星, 拾取数量决定本关星级(0..3)。
 *  - 有时间限制: 倒计时归零仍未抵达终点判定失败, 可重试。
 *
 * 与生存模式的接线:
 *   移动/墙壁扣血/星星/终点/HUD 由本引擎驱动;
 *   敌人池/玩家武器/子弹/敌方弹幕/网格 直接复用 game 的对象池与 Player._updateWeapons.
 *   接触/弹幕命中玩家时不走 Player.takeDamage(会扣 Player.hp), 改为触发本引擎的 3 心扣减.
 *   击杀敌人默认会掉经验晶体, 本引擎每帧末清 gems 池以避免触发升级界面.
 */
import { CONFIG } from "../config.js";
import { Vector2 } from "../utils/Vector2.js";
import { TAU, clamp, rand, weightedChoice } from "../utils/math.js";
import { Skins } from "../systems/Skins.js";

const SPEED = 300;         // 闯关固定移速(不受皮肤/局外强化影响, 保证关卡平衡)
const STAR_R = 30;         // 能量星拾取半径
const FINISH_PAD = 10;     // 抵达终点的纵向判定余量

// 生命值 / 受伤反馈
const HP_MAX = 3;
const INVULN_TIME = 1.1;   // 受击后的无敌帧, 避免贴墙/贴怪连续掉血

// 敌人生成节奏默认值(每关可通过 level.spawn 覆盖: 更小 interval / 更大 batch = 更激烈)
const DEFAULT_SPAWN_INTERVAL = 1.5;
const DEFAULT_SPAWN_BATCH = 2;
const HP_SCALE = 1;           // 敌人血量倍率(闯关关卡内固定)

export class LevelRunner {
  constructor(game) {
    this.game = game;
    this.active = false;
    this._onEnd = null;
  }

  /**
   * 开始一关。level 为 Campaign 的关卡定义(type: "path"), theme 为章节主题配色。
   * 关卡可选携带 finale = { arena, bosses, interval, hpMul, spawn }: 抵达路径终点后触发的最终决战阶段.
   * onEnd({ result: "clear"|"fail"|"abort", stars }) 在关卡结束时回调。
   */
  start(level, theme, onEnd) {
    this.level = level;
    this.theme = theme || { wall: "#00f0ff", floor: "rgba(0,54,74,0.42)", glow: "#00f0ff", grid: "rgba(0,240,255,0.06)" };
    this._onEnd = onEnd;
    this.active = true;

    const g = this.game;
    g.player.reset();
    const sk = Skins.get(Skins.selected(g.save));
    if (sk) g.player.skin = { id: sk.id, shape: sk.shape, accent: sk.accent, star: Math.max(1, Skins.starOf(g.save, sk.id)) };

    const start = level.path[0];
    this.finish = level.path[level.path.length - 1];
    g.player.x = start.x;
    g.player.y = start.y;
    g.player.facing.set(0, -1);
    g.player.moveDir.set(0, 0);
    g.player.hp = g.player.maxHp;
    g.player.invuln = 0;

    this.stars = level.stars.map((s) => ({ x: s.x, y: s.y, got: false }));
    this.timeLeft = level.timeLimit;
    this.elapsed = 0;
    this.done = false;
    this._flameT = 0;

    // 3 心 / 无敌帧 / 生成计时
    this.hp = HP_MAX;
    this.invuln = 0;
    this._wallHit = false;
    this._spawnT = 1.2;

    // 通道关卡参数(段宽 + 敌种 + 生成节奏 + 数值倍率)
    this._spawnInterval = (level.spawn && level.spawn.interval) || DEFAULT_SPAWN_INTERVAL;
    this._spawnBatch = (level.spawn && level.spawn.batch) || DEFAULT_SPAWN_BATCH;
    this._spawnTiers = (level.spawn && level.spawn.tiers) || level.enemyTiers || null;
    this._segWidths = Array.isArray(level.widths) && level.widths.length === level.path.length - 1
      ? level.widths.slice()
      : null;
    this._speedMul = level.speedMul || 1;
    this._hpMul = level.hpMul || 1;

    // 阶段: "corridor"(通道)  → 到达终点后, 若关卡有 finale, 切到 "finale"(竞技场 Boss 战)
    this.phase = "corridor";
    this.hasFinale = !!level.finale;
    this.finale = null; // finale 状态在触发时初始化

    // 清场
    g._enemyPool.clear();
    g._projPool.clear();
    g._ebPool.clear();
    g._gemPool.clear();
    g.particles.clear();
    g.beams.length = 0;
    g.bosses = [];
    g.spawnSystem.reset();
    g.timeScale = 1;
    g.flash = 0;
    g.camera.update(g.player, 1);
  }

  /** 通道通关时的处理: 若有 finale, 切入 Boss 决战阶段; 否则直接结算 */
  _enterFinaleOrClear() {
    const g = this.game;
    const p = g.player;
    const gotStars = this.stars.filter((s) => s.got).length;
    if (!this.hasFinale) {
      g.audio.bossKill && g.audio.bossKill();
      g.screenFlash(0.7);
      g.camera.shake(24);
      g.particles.burst(p.x, p.y, this.theme.glow, 40, 320, 5, 1.0);
      this._finish("clear", gotStars);
      return;
    }
    // 进入 Boss 决战: 清空通道敌人/子弹, 保留玩家状态与已得星数.
    const f = this.level.finale;
    this.phase = "finale";
    this.finale = {
      arena: f.arena,
      queue: (f.bosses || []).slice(),
      interval: f.interval || 3.0,
      hpMul: f.hpMul || 1,
      spawnCfg: f.spawn || null,
      spawnT: 1.5,
      bossT: 1.2,
      active: null,
      killed: 0,
      total: (f.bosses || []).length,
      corridorStars: gotStars,      // 通道段拿到的星数, 决定 Boss 战失败时能保底的星数
    };
    // 玩家 dash 到竞技场中心, 通道结束的仪式感
    g.particles.burst(p.x, p.y, this.theme.glow, 40, 320, 5, 1.0);
    g.screenFlash(0.6);
    g.camera.shake(20);
    p.x = f.arena.x;
    p.y = f.arena.y + f.arena.r * 0.55;
    g.audio.bossAttack && g.audio.bossAttack();
    // 清空场上残余
    g._enemyPool.clear();
    g._ebPool.clear();
    g.bosses = [];
    g.particles.text(f.arena.x, f.arena.y - 60, "母核降临", "#ff2bd6", 40);
  }

  /** 主动退出(返回选关) */
  abort() {
    if (!this.active) return;
    this._finish("abort", 0);
  }

  _finish(result, stars) {
    if (this.done) return;
    this.done = true;
    this.active = false;
    // 关卡结束把 game 的池清干净, 避免残留敌人/子弹影响下一次进关或菜单
    const g = this.game;
    g._enemyPool.clear();
    g._projPool.clear();
    g._ebPool.clear();
    g._gemPool.clear();
    g.beams.length = 0;
    g.bosses = [];
    const cb = this._onEnd;
    this._onEnd = null;
    if (cb) cb({ result, stars });
  }

  // ---------------- 几何: 通道中心线最近点 ----------------
  /** 返回玩家点到折线(通道中心线)的最近点, 附带所在段索引 seg 与该段上的 t 参数 */
  _closestOnPath(px, py) {
    const path = this.level.path;
    let bx = path[0].x, by = path[0].y, bestD = Infinity, bestSeg = 0, bestT = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const abx = b.x - a.x, aby = b.y - a.y;
      const len2 = abx * abx + aby * aby || 1;
      const t = clamp(((px - a.x) * abx + (py - a.y) * aby) / len2, 0, 1);
      const cx = a.x + abx * t, cy = a.y + aby * t;
      const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d < bestD) { bestD = d; bx = cx; by = cy; bestSeg = i; bestT = t; }
    }
    return { x: bx, y: by, dist: Math.sqrt(bestD), seg: bestSeg, t: bestT };
  }

  /** 段 i 的通道半宽: 有 widths 用段独立值, 否则退化为 level.radius */
  _segRadius(i) {
    return this._segWidths ? this._segWidths[i] : this.level.radius;
  }

  /**
   * 变宽通道的**几何并集**判定: 通道 = 所有段矩形 ∪ 所有拐点圆盘.
   * 玩家只要落在任意一段的矩形内, 或任意拐点的圆盘内, 即视为在通道内(与视觉一致).
   * 越界时挑"最容易滑回"的形体(excess 最小)把玩家推回边界.
   *
   * 边界宽容度: allowD = segR - playerR * 0.5.
   *   - 视觉墙内沿在 segR 处; 玩家 sprite 半径 = playerR.
   *   - 用 segR - 0.5*playerR 意味着「玩家 sprite 外沿刚碰到视觉墙内沿」时判越界, 最符合直觉.
   *   - (旧写法 segR - playerR 过于严格, 玩家离墙还有一整个 sprite 宽的空隙就被误判扣血)
   */
  _insideCorridor(px, py, playerR) {
    const path = this.level.path;
    const margin = playerR * 0.5;
    let inside = false;
    let bestExcess = Infinity;
    let bestClose = { x: path[0].x, y: path[0].y };
    let bestAllowD = this._segRadius(0) - margin;
    // 1) 段矩形: 用点到线段最近点判定
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const abx = b.x - a.x, aby = b.y - a.y;
      const len2 = abx * abx + aby * aby || 1;
      const t = clamp(((px - a.x) * abx + (py - a.y) * aby) / len2, 0, 1);
      const cx = a.x + abx * t, cy = a.y + aby * t;
      const d = Math.hypot(px - cx, py - cy);
      const allowD = this._segRadius(i) - margin;
      if (d <= allowD) inside = true;
      const excess = d - allowD;
      if (excess < bestExcess) {
        bestExcess = excess; bestClose = { x: cx, y: cy }; bestAllowD = allowD;
      }
    }
    // 2) 拐点圆盘: 半径取相邻两段较大宽, 与渲染时的 disc 半径一致
    for (let i = 0; i < path.length; i++) {
      const rPrev = i > 0 ? this._segRadius(i - 1) : this._segRadius(0);
      const rNext = i < path.length - 1 ? this._segRadius(i) : this._segRadius(path.length - 2);
      const cornerR = Math.max(rPrev, rNext);
      const d = Math.hypot(px - path[i].x, py - path[i].y);
      const allowD = cornerR - margin;
      if (d <= allowD) inside = true;
      const excess = d - allowD;
      if (excess < bestExcess) {
        bestExcess = excess; bestClose = { x: path[i].x, y: path[i].y }; bestAllowD = allowD;
      }
    }
    return { inside, close: bestClose, allowD: bestAllowD };
  }

  /** 玩家受伤统一入口(3 心系统): 处理无敌帧/演出/死亡判定. 不走 Player.takeDamage */
  _hurtPlayer(reason) {
    if (this.invuln > 0 || this.done) return;
    this.hp -= 1;
    this.invuln = INVULN_TIME;
    const g = this.game;
    g.camera.shake(reason === "wall" ? 12 : 16);
    g.screenFlash(reason === "wall" ? 0.35 : 0.5);
    g.audio.hurt && g.audio.hurt();
    g.particles.burst(g.player.x, g.player.y, "#ff6b7d", 22, 260, 3, 0.6);
    g.particles.text(g.player.x, g.player.y - 32, "-1", "#ff6b7d", 22);
    if (this.hp <= 0) {
      g.audio.gameover && g.audio.gameover();
      g.camera.shake(24);
      this._finish("fail", 0);
    }
  }

  /**
   * 敌人权重表.
   *  - 有 level.enemyTiers / spawn.tiers 时, 严格用该列表(等权重), 保证每关"能出什么怪"稳定可控.
   *  - 否则退回按 elapsed 递进解锁(与无限模式一致).
   */
  _enemyTypePool() {
    if (this._spawnTiers && this._spawnTiers.length) {
      return this._spawnTiers.map((v) => ({ value: v, weight: 1 }));
    }
    const t = this.elapsed;
    const pool = [{ value: "chaser", weight: 10 }];
    if (t > 8)  pool.push({ value: "rusher",   weight: 7 });
    if (t > 20) pool.push({ value: "splitter", weight: 5 });
    if (t > 32) pool.push({ value: "tank",     weight: 4 });
    return pool;
  }

  /**
   * 全屏边缘生成一波敌人. 关卡的 speedMul/hpMul 用于:
   *  - hpMul: 通过 hpScale 参数传给 spawnEnemy(直接乘到 maxHp).
   *  - speedMul: 敌人 spawn 之后, 手动缩放 e.speed(基础速度乘倍率), 保证追击型能追上玩家(300 px/s).
   */
  _spawnWave() {
    const g = this.game;
    const cam = g.camera;
    const W = g.viewW, H = g.viewH;
    const margin = 60;
    const pool = this._enemyTypePool();
    for (let i = 0; i < this._spawnBatch; i++) {
      const type = weightedChoice(pool);
      const edge = Math.floor(rand(0, 4));
      let ex, ey;
      if (edge === 0)      { ex = cam.x + rand(-margin, W + margin); ey = cam.y - margin; }
      else if (edge === 1) { ex = cam.x + W + margin;                ey = cam.y + rand(-margin, H + margin); }
      else if (edge === 2) { ex = cam.x + rand(-margin, W + margin); ey = cam.y + H + margin; }
      else                 { ex = cam.x - margin;                    ey = cam.y + rand(-margin, H + margin); }
      ex = clamp(ex, 24, CONFIG.world.width - 24);
      ey = clamp(ey, 24, CONFIG.world.height - 24);
      const e = g.spawnEnemy(type, ex, ey, this._hpMul);
      if (e && this._speedMul !== 1) e.speed *= this._speedMul;
    }
  }

  /**
   * Boss 决战阶段(finale)推进:
   *  - 玩家被约束在圆形竞技场 arena 内(墙壁不扣血, 只滑回);
   *  - 同一时刻只有 1 个 Boss 存活, 前一个死后 interval 秒登场下一个;
   *  - 骚扰性小怪可选(f.spawn), 与生存模式敌人共用池;
   *  - 全部 Boss 击败 = 3 星通关; 时间耗尽 = fail 但保留通道段的星数(保底).
   */
  _updateFinale(dt) {
    const g = this.game;
    const f = this.finale;
    // Boss 死亡检查(注意 Boss 死后会被 _killBoss 从 game.bosses 移除, e.active=false)
    if (f.active && !f.active.active) {
      f.active = null;
      f.killed += 1;
      f.bossT = f.interval;
    }
    // 全部击败 → 3 星通关
    if (!f.active && f.queue.length === 0 && f.killed >= f.total) {
      const p = g.player;
      g.audio.bossKill && g.audio.bossKill();
      g.screenFlash(0.9);
      g.camera.shake(32);
      g.particles.burst(p.x, p.y, this.theme.glow, 60, 500, 6, 1.4);
      g.particles.text(p.x, p.y - 60, "净化完成", "#aaff00", 40);
      this._finish("clear", 3);
      return;
    }
    // 下一个 Boss 登场
    if (!f.active && f.queue.length > 0) {
      f.bossT -= dt;
      if (f.bossT <= 0) {
        const type = f.queue.shift();
        const boss = g.spawnEnemy(type, f.arena.x, f.arena.y - f.arena.r * 0.55, f.hpMul);
        if (boss) {
          f.active = boss;
          g.audio.bossAttack && g.audio.bossAttack();
          g.camera.shake(24);
          g.particles.burst(boss.x, boss.y, boss.color, 30, 260, 4, 0.9);
          const bname = (boss.def && boss.def.name) || "母核";
          g.particles.text(boss.x, boss.y - 40, `⚠ ${bname}`, boss.color, 30);
        }
      }
    }
    // 骚扰性小怪(可选): 用 finale 独立节奏, 不复用通道段的 _spawnT
    if (f.spawnCfg) {
      f.spawnT -= dt;
      if (f.spawnT <= 0) {
        f.spawnT += f.spawnCfg.interval || 3.0;
        const batch = f.spawnCfg.batch || 1;
        const tiers = f.spawnCfg.tiers || ["chaser"];
        for (let i = 0; i < batch; i++) {
          const type = tiers[Math.floor(rand(0, tiers.length))];
          // 在竞技场边缘生成, 让玩家从各方向感受威胁
          const ang = rand(0, TAU);
          const ex = f.arena.x + Math.cos(ang) * (f.arena.r + 40);
          const ey = f.arena.y + Math.sin(ang) * (f.arena.r + 40);
          const e = g.spawnEnemy(type, ex, ey, this._hpMul);
          if (e && this._speedMul !== 1) e.speed *= this._speedMul;
        }
      }
    }
  }

  // ---------------- 更新 ----------------
  update(dt) {
    if (!this.active || this.done) return;
    const g = this.game;
    const p = g.player;
    this.elapsed += dt;
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);

    // ---- 1) 移动: 键盘/摇杆, 用闯关固定移速, 不走 Player.update ----
    const mv = g.input.getMoveVector();
    if (mv.lengthSq > 0) {
      p.x += mv.x * SPEED * dt;
      p.y += mv.y * SPEED * dt;
      p.facing.copy(mv);
      p.moveDir.copy(mv);
      // 引擎尾焰(方向性拖尾), 复刻 Player.update 的观感
      this._flameT += dt;
      const c = p.skin.accent || this.theme.wall;
      const rx = p.x - p.facing.x * p.radius;
      const ry = p.y - p.facing.y * p.radius;
      for (let i = 0; i < 2; i++) {
        g.particles.spark(rx, ry,
          -p.facing.x * 70 + rand(-30, 30), -p.facing.y * 70 + rand(-30, 30),
          rand(0.22, 0.4), c, rand(2, 3.4));
      }
    } else {
      p.moveDir.set(0, 0);
    }
    p.animT += dt;
    p.x = clamp(p.x, p.radius, CONFIG.world.width - p.radius);
    p.y = clamp(p.y, p.radius, CONFIG.world.height - p.radius);

    // ---- 2) 空间约束:
    //   corridor 阶段: 段矩形 ∪ 拐点圆盘, 越界扣血;
    //   finale   阶段: 圆形竞技场, 越界只滑回, 不扣血(伤害只来自 Boss/小怪).
    if (this.phase === "finale") {
      const a = this.finale.arena;
      const dx = p.x - a.x, dy = p.y - a.y;
      const d = Math.hypot(dx, dy);
      const rmax = a.r - p.radius;
      if (d > rmax) {
        const nx = dx / (d || 1), ny = dy / (d || 1);
        p.x = a.x + nx * rmax;
        p.y = a.y + ny * rmax;
      }
    } else {
      const box = this._insideCorridor(p.x, p.y, p.radius);
      if (!box.inside) {
        const dx = p.x - box.close.x, dy = p.y - box.close.y;
        const dist = Math.hypot(dx, dy) || 1;
        p.x = box.close.x + (dx / dist) * box.allowD;
        p.y = box.close.y + (dy / dist) * box.allowD;
        if (!this._wallHit) {
          this._wallHit = true;
          this._hurtPlayer("wall");
        }
        if (Math.floor(this.elapsed * 30) % 3 === 0) {
          g.particles.spark(p.x, p.y, rand(-40, 40), rand(-40, 40), 0.25, this.theme.wall, 2.2);
        }
      } else {
        this._wallHit = false;
      }
    }

    // ---- 3) 玩家武器 ----
    p._updateWeapons(dt, g);

    // ---- 4) 阶段专属调度: 通道刷杂兵, finale 推 Boss 战 ----
    if (this.phase === "finale") {
      this._updateFinale(dt);
    } else {
      this._spawnT -= dt;
      if (this._spawnT <= 0) {
        this._spawnT += this._spawnInterval;
        this._spawnWave();
      }
    }

    // ---- 5) 敌人 AI + 网格重建 (复用无限模式 Enemy.update) ----
    for (const e of g.enemies) e.update(dt, p, g);
    g.grid.rebuild(g.enemies);

    // ---- 6) 子弹推进 + 离屏回收 (与 Game.update 保持一致) ----
    for (const b of g.projectiles) {
      b.update(dt);
      if (b.active && !g.camera.inView(b.x, b.y, 200)) b.active = false;
    }
    for (const b of g.enemyProjectiles) {
      b.update(dt);
      if (b.active && !g.camera.inView(b.x, b.y, 200)) b.active = false;
    }

    // ---- 7) 碰撞 ----
    // 7a) 玩家子弹 vs 敌人: 复用 CollisionSystem 的实现, 逻辑与无限模式完全一致.
    g.collisionSystem._projectilesVsEnemies();
    // 7b) 敌人 vs 玩家: 用 3 心系统, 不调 player.takeDamage.
    for (const e of g.enemies) {
      if (!e.active) continue;
      const rr = e.radius + p.radius;
      const dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy <= rr * rr) { this._hurtPlayer("enemy"); break; }
    }
    // 7c) 敌方弹幕 vs 玩家: 3 心, 命中即销毁弹幕
    for (const b of g.enemyProjectiles) {
      if (!b.active) continue;
      const rr = b.radius + p.radius;
      const dx = b.x - p.x, dy = b.y - p.y;
      if (dx * dx + dy * dy <= rr * rr) {
        this._hurtPlayer("bullet");
        b.active = false;
      }
    }

    // ---- 8) 每帧清 gems 池: 击杀敌人默认会掉经验, 闯关不使用经验/升级 ----
    g._gemPool.clear();

    // ---- 9) 星星拾取 ----
    for (const s of this.stars) {
      if (s.got) continue;
      if (Vector2.distSq(p, s) < (p.radius + STAR_R) ** 2) {
        s.got = true;
        g.audio.pickup();
        g.particles.burst(s.x, s.y, "#ffd23f", 18, 240, 3, 0.6);
        g.particles.text(s.x, s.y - 30, "★", "#ffd23f", 26);
      }
    }

    // ---- 10) 粒子/相机 + 池回收 ----
    g.particles.update(dt);
    g.camera.update(p, dt);
    g._enemyPool.reclaim();
    g._projPool.reclaim();
    g._ebPool.reclaim();

    // ---- 11) 通关判定:
    //  corridor 阶段抵达路径终点 → 若有 finale 切入 Boss 战, 否则直接结算 clear.
    //  finale 阶段的通关在 _updateFinale 内触发 _finish("clear", 3).
    if (this.phase === "corridor" && p.y <= this.finish.y + FINISH_PAD) {
      this._enterFinaleOrClear();
      return;
    }

    // ---- 12) 超时失败: finale 段时间用尽也算失败, 但保留通道段获得的星数作保底 ----
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      g.audio.gameover && g.audio.gameover();
      g.camera.shake(20);
      const savedStars = this.phase === "finale" ? this.finale.corridorStars : 0;
      this._finish("fail", savedStars);
    }
  }

  // ---------------- 渲染 ----------------
  render(ctx) {
    if (!this.level) return;
    const g = this.game;
    const cam = g.camera;

    cam.begin(ctx);
    this._drawBackground(ctx);
    if (this.phase === "finale") {
      this._drawArena(ctx);
    } else {
      this._drawCorridor(ctx);
      this._drawMarkers(ctx);
      this._drawStars(ctx);
    }

    // 敌人(在通道之上, 玩家之下), 完全复用 Enemy.render 的霓虹几何造型
    for (const e of g.enemies) if (cam.inView(e.x, e.y)) e.render(ctx);

    // 玩家子弹 / 光束: lighter 混合出霓虹能量质感, 与无限模式一致
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const b of g.projectiles) b.render(ctx);
    ctx.restore();

    // 敌方弹幕: 普通混合, 敌意光球
    for (const b of g.enemyProjectiles) b.render(ctx);

    this._drawPlayer(ctx);
    g.particles.render(ctx);
    cam.end(ctx);

    this._drawHud(ctx);

    // 通关/受击瞬间的全屏白闪(演出)
    if (g.flash > 0.001) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, g.flash);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, g.viewW, g.viewH);
      ctx.restore();
    }
  }

  _drawBackground(ctx) {
    const gsz = CONFIG.world.gridSize;
    const cam = this.game.camera;
    const startX = Math.floor(cam.x / gsz) * gsz;
    const startY = Math.floor(cam.y / gsz) * gsz;
    const endX = cam.x + this.game.viewW;
    const endY = cam.y + this.game.viewH;
    ctx.save();
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x < endX; x += gsz) { ctx.moveTo(x, cam.y); ctx.lineTo(x, endY); }
    for (let y = startY; y < endY; y += gsz) { ctx.moveTo(cam.x, y); ctx.lineTo(endX, y); }
    ctx.stroke();
    ctx.restore();
  }

  /** 用同一条折线分层描边, 得到带发光墙壁的等宽通道 */
  _tracePath(ctx) {
    const path = this.level.path;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  }

  /**
   * 构造整条通道形体为单个 Path2D: 所有段矩形 + 所有拐点圆盘的**几何并集**.
   * expand 为整体外扩量, 用于分层同心带(外发光墙 / 深色地面 / 主题地面).
   *
   * 绕向坑(重要): Canvas y 轴向下, 屏幕坐标里
   *  - 段矩形按 a+n→b+n→b-n→a-n 是「逆时针」;
   *  - arc(0, TAU) 默认 anticlockwise=false, 屏幕上是「顺时针」.
   * 两者相反, nonzero 规则下重叠区域绕数=0 会变成「洞」——即通道内部露出背景, 视觉与判定都对不上.
   * 解决: 圆盘用 anticlockwise=true, 与段矩形同为逆时针; 重叠区域绕数=2, 仍算内部, 视觉纯并集.
   */
  _buildCorridorPath(expand) {
    const p = new Path2D();
    const path = this.level.path;
    // 段矩形: 屏幕坐标下为逆时针
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len; // 单位法线
      const r = this._segRadius(i) + expand;
      p.moveTo(a.x + nx * r, a.y + ny * r);
      p.lineTo(b.x + nx * r, b.y + ny * r);
      p.lineTo(b.x - nx * r, b.y - ny * r);
      p.lineTo(a.x - nx * r, a.y - ny * r);
      p.closePath();
    }
    // 拐点圆盘(与段矩形同向): 半径取相邻段较大 r, 兼作首尾端点
    for (let i = 0; i < path.length; i++) {
      const rPrev = i > 0 ? this._segRadius(i - 1) : this._segRadius(0);
      const rNext = i < path.length - 1 ? this._segRadius(i) : this._segRadius(path.length - 2);
      const r = Math.max(rPrev, rNext) + expand;
      p.moveTo(path[i].x + r, path[i].y);
      p.arc(path[i].x, path[i].y, r, 0, TAU, true); // 逆时针, 与段矩形同向
    }
    return p;
  }

  _drawCorridor(ctx) {
    ctx.save();
    if (this._segWidths) {
      // 分段变宽: 三层同心带都用整条 Path2D 一次 fill, shadow 只作用一次.
      // 外层: 发光墙(扩 7)
      const outer = this._buildCorridorPath(7);
      ctx.shadowBlur = 26;
      ctx.shadowColor = this.theme.wall;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = this.theme.wall;
      ctx.fill(outer, "nonzero");
      // 中层: 深色地面(原尺寸), 去 shadow
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#05070f";
      ctx.fill(this._buildCorridorPath(1), "nonzero");
      // 内层: 主题地面色(轻微收缩), 只有内部无外发光, 段间无套圈斑
      ctx.fillStyle = this.theme.floor;
      ctx.fill(this._buildCorridorPath(0), "nonzero");
    } else {
      // 等宽通道: 保持原来的整条 stroke 写法, 转折处衔接最平滑, 性能最佳.
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      const r = this.level.radius;
      this._tracePath(ctx);
      ctx.strokeStyle = this.theme.wall;
      ctx.globalAlpha = 0.9;
      ctx.shadowBlur = 26;
      ctx.shadowColor = this.theme.wall;
      ctx.lineWidth = 2 * r + 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      this._tracePath(ctx);
      ctx.strokeStyle = "#05070f";
      ctx.lineWidth = 2 * r + 2;
      ctx.stroke();
      this._tracePath(ctx);
      ctx.strokeStyle = this.theme.floor;
      ctx.lineWidth = 2 * r;
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawMarkers(ctx) {
    const start = this.level.path[0];
    const fin = this.finish;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = this.theme.wall;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(start.x, start.y, 34, 0, TAU); ctx.stroke();
    ctx.restore();
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 4);
    ctx.save();
    ctx.shadowBlur = 24; ctx.shadowColor = this.theme.glow;
    ctx.strokeStyle = this.theme.glow;
    ctx.globalAlpha = 0.7 + 0.3 * pulse;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(fin.x, fin.y, 42 + pulse * 6, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = this.theme.glow;
    ctx.font = "700 26px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("终点", fin.x, fin.y);
    ctx.restore();
  }

  _drawStars(ctx) {
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 5);
    for (const s of this.stars) {
      if (s.got) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.shadowBlur = 18; ctx.shadowColor = "#ffd23f";
      ctx.fillStyle = "#ffd23f";
      ctx.globalAlpha = 0.85 + 0.15 * pulse;
      ctx.font = `700 ${34 + pulse * 4}px 'JetBrains Mono', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("★", 0, 2);
      ctx.restore();
    }
  }

  /** finale 阶段: 圆形竞技场——发光边环 + 深色地面, 与通道风格延续但区分明显 */
  _drawArena(ctx) {
    const a = this.finale.arena;
    ctx.save();
    // 深色地面
    ctx.fillStyle = "#05070f";
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r + 6, 0, TAU); ctx.fill();
    ctx.fillStyle = this.theme.floor;
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, TAU); ctx.fill();
    // 发光边环 + 脉动
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 3);
    ctx.strokeStyle = "#ff2bd6";
    ctx.shadowBlur = 32; ctx.shadowColor = "#ff2bd6";
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 6 + pulse * 3;
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, TAU); ctx.stroke();
    // 内圈装饰: 危险纹样
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "#ff2bd6";
    ctx.setLineDash([12, 18]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r * 0.72, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(a.x, a.y, a.r * 0.38, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** 玩家无敌帧内做跳帧闪烁, 提示"当前不吃伤害" */
  _drawPlayer(ctx) {
    const p = this.game.player;
    if (this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0) return;
    p.render(ctx);
  }

  /** 屏幕空间 HUD: 关卡名 / 倒计时 / 星星进度 / 生命值 / (finale 阶段的 Boss 血条) */
  _drawHud(ctx) {
    const W2 = this.game.viewW;
    const got = this.stars.filter((s) => s.got).length;
    const total = this.stars.length;
    const t = Math.max(0, this.timeLeft);
    const urgent = t <= 6;
    const inFinale = this.phase === "finale";

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = inFinale ? "#ff6b7d" : "#8fa9c8";
    ctx.font = "600 13px 'JetBrains Mono', monospace";
    const title = inFinale
      ? `${this.level.id}  ${this.level.name}  ·  终章决战`
      : `${this.level.id}  ${this.level.name}`;
    ctx.fillText(title, W2 / 2, 16);
    ctx.font = "800 40px 'JetBrains Mono', monospace";
    ctx.fillStyle = urgent ? "#ff6b7d" : "#e8f6ff";
    ctx.shadowBlur = 16;
    ctx.shadowColor = urgent ? "#ff2bd6" : "#00f0ff";
    ctx.fillText(t.toFixed(1), W2 / 2, 34);
    // 星星进度: finale 阶段固定显示"击败 x/N Boss"
    ctx.shadowBlur = 10;
    ctx.font = "700 22px 'JetBrains Mono', monospace";
    if (inFinale) {
      ctx.shadowColor = "#ff2bd6";
      ctx.fillStyle = "#ff2bd6";
      ctx.fillText(`Boss ${this.finale.killed} / ${this.finale.total}`, W2 / 2, 86);
    } else {
      ctx.shadowColor = "#ffd23f";
      ctx.fillStyle = "#ffd23f";
      let stars = "";
      for (let i = 0; i < total; i++) stars += i < got ? "★" : "☆";
      ctx.font = "700 24px 'JetBrains Mono', monospace";
      ctx.fillText(stars, W2 / 2, 84);
    }
    ctx.restore();

    // 生命值心形
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "700 26px 'JetBrains Mono', monospace";
    const blink = this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0;
    for (let i = 0; i < HP_MAX; i++) {
      const alive = i < this.hp;
      ctx.globalAlpha = blink && alive ? 0.35 : 1;
      ctx.shadowBlur = alive ? 12 : 0;
      ctx.shadowColor = "#ff2b4a";
      ctx.fillStyle = alive ? "#ff4a7f" : "#3a2130";
      ctx.fillText("♥", 20 + i * 30, 18);
    }
    ctx.restore();

    // finale 阶段: 顶部横向 Boss 血条(当前 Boss)
    if (inFinale && this.finale.active && this.finale.active.active) {
      this._drawBossBar(ctx, this.finale.active, W2);
    }
  }

  /** 简洁的顶部 Boss 血条 + 名称, 独立于生存模式 HUD 的 _bossBars */
  _drawBossBar(ctx, boss, W2) {
    const w = Math.min(560, W2 * 0.6);
    const x = (W2 - w) / 2;
    const y = 120;
    const h = 12;
    const ratio = Math.max(0, boss.hp / boss.maxHp);
    const color = boss.color || "#ff2bd6";
    const name = (boss.def && boss.def.name) || "Boss";
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 14px 'JetBrains Mono', monospace";
    ctx.fillStyle = color;
    ctx.shadowBlur = 10; ctx.shadowColor = color;
    ctx.fillText(`⚠ ${name}  ${Math.ceil(boss.hp)} / ${Math.round(boss.maxHp)}`, x, y - 6);
    ctx.shadowBlur = 0;
    // 底槽
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x, y, w, h);
    // 前景
    ctx.fillStyle = color;
    ctx.shadowBlur = 14; ctx.shadowColor = color;
    ctx.fillRect(x, y, w * ratio, h);
    // 描边
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }
}
