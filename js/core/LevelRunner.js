/**
 * LevelRunner.js — 闯关模式「路线走廊(path)」关卡引擎。
 *
 * 玩法(第一章):
 *  - 战机从世界下方出发, 沿一条带转折的霓虹通道向上突进, 抵达顶端终点即通关。
 *  - 生命值 3 点(心形 HUD): 触碰墙壁 -1, 被敌人撞击 -1, 归零即失败。
 *  - 走廊内会不断生成追击小怪, 玩家沿面朝方向自动射击, 需一边闪避一边清怪。
 *  - 通道沿途散布 3 颗能量星, 拾取数量决定本关星级(0..3)。
 *  - 有时间限制: 倒计时归零仍未抵达终点判定失败, 可重试。
 *
 * 与生存模式解耦: 复用 game.player 仅用于「造型渲染 + 引擎尾焰」, 移动/碰撞/射击/敌人 全部由本引擎驱动,
 * 不触发任何武器/升级/Boss 逻辑, 也不动 Game 的对象池。相机复用 game.camera(边界即世界边界)。
 */
import { CONFIG } from "../config.js";
import { Vector2 } from "../utils/Vector2.js";
import { TAU, clamp, rand } from "../utils/math.js";
import { Skins } from "../systems/Skins.js";

const SPEED = 300;         // 闯关固定移速(不受皮肤/局外强化影响, 保证关卡平衡)
const STAR_R = 30;         // 能量星拾取半径
const FINISH_PAD = 10;     // 抵达终点的纵向判定余量

// 生命值 / 受伤反馈
const HP_MAX = 3;
const INVULN_TIME = 1.1;   // 受击后的无敌帧, 避免贴墙/贴怪连续掉血

// 玩家射击(自动开火, 沿面朝方向)
const SHOOT_INTERVAL = 0.32;
const BULLET_SPEED = 640;
const BULLET_LIFE = 1.1;
const BULLET_R = 5;

// 敌人生成 / 属性
const ENEMY_SPAWN_INTERVAL = 1.7;
const ENEMY_R = 14;
const ENEMY_SPEED = 150;
const ENEMY_HP = 2;        // 需 2 发子弹击落, 保证战术压力

export class LevelRunner {
  constructor(game) {
    this.game = game;
    this.active = false;
    this._onEnd = null;
  }

  /**
   * 开始一关。level 为 Campaign 的关卡定义(type: "path"), theme 为章节主题配色。
   * onEnd({ result: "clear"|"fail"|"abort", stars }) 在关卡结束时回调。
   */
  start(level, theme, onEnd) {
    this.level = level;
    this.theme = theme || { wall: "#00f0ff", floor: "rgba(0,54,74,0.42)", glow: "#00f0ff", grid: "rgba(0,240,255,0.06)" };
    this._onEnd = onEnd;
    this.active = true;

    const g = this.game;
    // 复用玩家实体做移动与造型渲染, 但清空武器/数值(reset), 只套用选中皮肤外观
    g.player.reset();
    const sk = Skins.get(Skins.selected(g.save));
    if (sk) g.player.skin = { id: sk.id, shape: sk.shape, accent: sk.accent, star: Math.max(1, Skins.starOf(g.save, sk.id)) };

    const start = level.path[0];
    this.finish = level.path[level.path.length - 1];
    g.player.x = start.x;
    g.player.y = start.y;
    g.player.facing.set(0, -1);
    g.player.moveDir.set(0, 0);

    this.stars = level.stars.map((s) => ({ x: s.x, y: s.y, got: false }));
    this.timeLeft = level.timeLimit;
    this.elapsed = 0;
    this.done = false;
    this._flameT = 0;

    // 生命值 / 敌人 / 子弹 —— 关卡自管理, 不走 Game 的池
    this.hp = HP_MAX;
    this.invuln = 0;
    this._wallHit = false;         // 上一帧是否处于"越界贴墙"状态, 用于边沿触发扣血(不连扣)
    this.enemies = [];             // { x, y, hp, r, flash }
    this.bullets = [];             // { x, y, vx, vy, life, r, color }
    this._shootT = SHOOT_INTERVAL; // 首发略等
    this._spawnT = 1.2;            // 首刷延迟, 给玩家上手时间

    // 清场: 关卡不使用生存模式的敌人/子弹/掉落, 但复用粒子系统做尾焰与拾取特效
    g.particles.clear();
    g.beams.length = 0;
    g.bosses = [];
    g.timeScale = 1;
    g.flash = 0;
    g.camera.update(g.player, 1); // 立即对齐相机
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
    const cb = this._onEnd;
    this._onEnd = null;
    if (cb) cb({ result, stars });
  }

  // ---------------- 几何: 通道中心线最近点 ----------------
  /** 返回玩家点到折线(通道中心线)的最近点, 附带所在段索引 seg 与该段上的 t 参数(用于沿路径前推) */
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

  /** 玩家受伤统一入口: 处理无敌帧/演出/死亡判定 */
  _hurtPlayer(reason) {
    if (this.invuln > 0 || this.done) return;
    this.hp -= 1;
    this.invuln = INVULN_TIME;
    const g = this.game;
    g.camera.shake(reason === "wall" ? 12 : 16);
    g.screenFlash(reason === "wall" ? 0.35 : 0.5);
    g.audio.hit && g.audio.hit();
    g.particles.burst(g.player.x, g.player.y, "#ff6b7d", 22, 260, 3, 0.6);
    g.particles.text(g.player.x, g.player.y - 32, "-1", "#ff6b7d", 22);
    if (this.hp <= 0) {
      g.audio.gameover && g.audio.gameover();
      g.camera.shake(24);
      this._finish("fail", 0);
    }
  }

  /**
   * 全屏生成敌人: 在当前相机可视范围的边缘随机挑一个点(通道内外都可以),
   * 敌人无需受走廊约束, 可从墙外冲进来撞玩家, 强化"到处都是威胁"的压迫感.
   */
  _spawnEnemy() {
    const g = this.game;
    const cam = g.camera;
    const W = g.viewW, H = g.viewH;
    const margin = 40; // 出屏外一点点, 让敌人从画面外缓入, 视觉上更自然
    // 四条边随机: 0=上 1=右 2=下 3=左
    const edge = Math.floor(rand(0, 4));
    let ex, ey;
    if (edge === 0)      { ex = cam.x + rand(-margin, W + margin); ey = cam.y - margin; }
    else if (edge === 1) { ex = cam.x + W + margin;                ey = cam.y + rand(-margin, H + margin); }
    else if (edge === 2) { ex = cam.x + rand(-margin, W + margin); ey = cam.y + H + margin; }
    else                 { ex = cam.x - margin;                    ey = cam.y + rand(-margin, H + margin); }
    // 世界边界钳制, 避免刷到世界外反被相机丢掉
    ex = clamp(ex, ENEMY_R, CONFIG.world.width - ENEMY_R);
    ey = clamp(ey, ENEMY_R, CONFIG.world.height - ENEMY_R);
    this.enemies.push({ x: ex, y: ey, hp: ENEMY_HP, r: ENEMY_R, flash: 0 });
    g.particles.burst(ex, ey, "#ff6b7d", 10, 160, 2, 0.35);
  }

  // ---------------- 更新 ----------------
  update(dt) {
    if (!this.active || this.done) return;
    const g = this.game;
    const p = g.player;
    this.elapsed += dt;
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);

    // 移动(键盘/摇杆), 不触发任何武器逻辑
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

    // 世界边界兜底
    p.x = clamp(p.x, p.radius, CONFIG.world.width - p.radius);
    p.y = clamp(p.y, p.radius, CONFIG.world.height - p.radius);

    // 通道约束: 距中心线超过 (radius - 机身半径) 则贴墙滑回;
    // 边沿触发扣血——只有"从非贴墙 -> 贴墙"这一帧扣一次, 无敌帧结束再贴仍会再扣.
    const near = this._closestOnPath(p.x, p.y);
    const maxD = this.level.radius - p.radius;
    if (near.dist > maxD) {
      const nx = (p.x - near.x) / (near.dist || 1);
      const ny = (p.y - near.y) / (near.dist || 1);
      p.x = near.x + nx * maxD;
      p.y = near.y + ny * maxD;
      if (!this._wallHit) {
        this._wallHit = true;
        this._hurtPlayer("wall");
      }
      // 撞墙火花(常驻贴墙也保留少量, 强化边界感)
      if (Math.floor(this.elapsed * 30) % 3 === 0) {
        g.particles.spark(p.x, p.y, rand(-40, 40), rand(-40, 40), 0.25, this.theme.wall, 2.2);
      }
    } else {
      this._wallHit = false;
    }

    // 自动射击: 沿 facing 每 SHOOT_INTERVAL 发射一颗
    this._shootT -= dt;
    if (this._shootT <= 0) {
      this._shootT += SHOOT_INTERVAL;
      const dir = (p.facing.lengthSq > 0) ? p.facing : { x: 0, y: -1 };
      const c = p.skin.accent || this.theme.wall;
      this.bullets.push({
        x: p.x + dir.x * (p.radius + 4),
        y: p.y + dir.y * (p.radius + 4),
        vx: dir.x * BULLET_SPEED,
        vy: dir.y * BULLET_SPEED,
        life: BULLET_LIFE,
        r: BULLET_R,
        color: c,
      });
      g.audio.shoot && g.audio.shoot();
    }

    // 敌人生成
    this._spawnT -= dt;
    if (this._spawnT <= 0) {
      this._spawnT += ENEMY_SPAWN_INTERVAL;
      this._spawnEnemy();
    }

    // 子弹: 直线飞行 + 撞敌 + 出走廊消散
    for (const b of this.bullets) {
      if (b.life <= 0) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) continue;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        const dx = e.x - b.x, dy = e.y - b.y;
        const rr = e.r + b.r;
        if (dx * dx + dy * dy < rr * rr) {
          e.hp -= 1;
          e.flash = 0.09;
          b.life = 0;
          g.particles.burst(b.x, b.y, b.color, 6, 200, 2, 0.28);
          if (e.hp <= 0) {
            g.audio.hurt && g.audio.hurt();
            g.particles.burst(e.x, e.y, "#ff6b7d", 20, 280, 3, 0.55);
          } else {
            g.audio.hit && g.audio.hit();
          }
          break;
        }
      }
      if (b.life <= 0) continue;
      // 敌人现在可能在通道外, 子弹不再受走廊约束; 只在飞出世界边界时消散
      if (b.x < 0 || b.y < 0 || b.x > CONFIG.world.width || b.y > CONFIG.world.height) {
        b.life = 0;
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);

    // 敌人: 朝玩家追击, 全屏活动(可穿墙来袭), 撞玩家自毁并扣血
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt);
      const dx = p.x - e.x, dy = p.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      e.x += (dx / len) * ENEMY_SPEED * dt;
      e.y += (dy / len) * ENEMY_SPEED * dt;
      // 世界边界钳制(允许穿墙, 但不能跑出地图, 否则相机会丢)
      e.x = clamp(e.x, e.r, CONFIG.world.width - e.r);
      e.y = clamp(e.y, e.r, CONFIG.world.height - e.r);
      const rr = (e.r + p.radius) * 0.9;
      if (dx * dx + dy * dy < rr * rr) {
        this._hurtPlayer("enemy");
        e.hp = 0;
        g.particles.burst(e.x, e.y, "#ff6b7d", 18, 240, 3, 0.5);
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0);

    // 拾取能量星
    for (const s of this.stars) {
      if (s.got) continue;
      if (Vector2.distSq(p, s) < (p.radius + STAR_R) ** 2) {
        s.got = true;
        g.audio.pickup();
        g.particles.burst(s.x, s.y, "#ffd23f", 18, 240, 3, 0.6);
        g.particles.text(s.x, s.y - 30, "★", "#ffd23f", 26);
      }
    }

    // 粒子/相机
    g.particles.update(dt);
    g.camera.update(p, dt);

    // 通关: 抵达终点纵向阈值
    if (p.y <= this.finish.y + FINISH_PAD) {
      const got = this.stars.filter((s) => s.got).length;
      g.audio.bossKill && g.audio.bossKill();
      g.screenFlash(0.7);
      g.camera.shake(24);
      g.particles.burst(p.x, p.y, this.theme.glow, 40, 320, 5, 1.0);
      this._finish("clear", got);
      return;
    }

    // 超时失败
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      g.audio.gameover && g.audio.gameover();
      g.camera.shake(20);
      this._finish("fail", 0);
    }
  }

  // ---------------- 渲染 ----------------
  render(ctx) {
    if (!this.level) return;
    const g = this.game;
    const cam = g.camera;

    cam.begin(ctx);
    this._drawBackground(ctx);
    this._drawCorridor(ctx);
    this._drawMarkers(ctx);
    this._drawStars(ctx);
    this._drawEnemies(ctx);
    this._drawBullets(ctx);
    this._drawPlayer(ctx);
    g.particles.render(ctx);
    cam.end(ctx);

    this._drawHud(ctx);

    // 通关瞬间的全屏白闪(演出)
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

  _drawCorridor(ctx) {
    const r = this.level.radius;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // 外层: 发光墙壁
    this._tracePath(ctx);
    ctx.strokeStyle = this.theme.wall;
    ctx.globalAlpha = 0.9;
    ctx.shadowBlur = 26;
    ctx.shadowColor = this.theme.wall;
    ctx.lineWidth = 2 * r + 14;
    ctx.stroke();
    // 内层: 深色可行走地面(挖出通道)
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
    ctx.restore();
  }

  _drawMarkers(ctx) {
    const start = this.level.path[0];
    const fin = this.finish;
    // 起点: 淡环
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = this.theme.wall;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(start.x, start.y, 34, 0, TAU); ctx.stroke();
    ctx.restore();
    // 终点: 脉动发光环 + "终点"
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

  /** 玩家无敌帧内做跳帧闪烁, 提示"当前不吃伤害" */
  _drawPlayer(ctx) {
    const p = this.game.player;
    if (this.invuln > 0 && Math.floor(this.invuln * 20) % 2 === 0) return;
    p.render(ctx);
  }

  /** 敌人: 红色菱形几何体, 命中闪白, 造型与生存模式区分, 关卡不复用 Enemy 类 */
  _drawEnemies(ctx) {
    for (const e of this.enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(this.elapsed * 2);
      ctx.shadowBlur = 16; ctx.shadowColor = "#ff6b7d";
      ctx.fillStyle = e.flash > 0 ? "#ffffff" : "#ff2b4a";
      ctx.strokeStyle = "#ffd23f";
      ctx.lineWidth = 2;
      const r = e.r;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /** 子弹: 沿运动方向的短彗尾, 复用玩家 accent 色 */
  _drawBullets(ctx) {
    for (const b of this.bullets) {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const ux = b.vx / sp, uy = b.vy / sp;
      const tail = b.r * 2.4;
      ctx.save();
      ctx.shadowBlur = 12; ctx.shadowColor = b.color;
      ctx.strokeStyle = b.color;
      ctx.lineCap = "round";
      ctx.lineWidth = b.r * 1.6;
      ctx.beginPath();
      ctx.moveTo(b.x - ux * tail, b.y - uy * tail);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  /** 屏幕空间 HUD: 关卡名 / 倒计时 / 星星进度 / 生命值(三颗心) */
  _drawHud(ctx) {
    const W2 = this.game.viewW;
    const got = this.stars.filter((s) => s.got).length;
    const total = this.stars.length;
    const t = Math.max(0, this.timeLeft);
    const urgent = t <= 6;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    // 关卡编号 + 名称
    ctx.fillStyle = "#8fa9c8";
    ctx.font = "600 13px 'JetBrains Mono', monospace";
    ctx.fillText(`${this.level.id}  ${this.level.name}`, W2 / 2, 16);
    // 倒计时
    ctx.font = "800 40px 'JetBrains Mono', monospace";
    ctx.fillStyle = urgent ? "#ff6b7d" : "#e8f6ff";
    ctx.shadowBlur = 16;
    ctx.shadowColor = urgent ? "#ff2bd6" : "#00f0ff";
    ctx.fillText(t.toFixed(1), W2 / 2, 34);
    // 星星进度
    ctx.shadowBlur = 10; ctx.shadowColor = "#ffd23f";
    ctx.font = "700 24px 'JetBrains Mono', monospace";
    let stars = "";
    for (let i = 0; i < total; i++) stars += i < got ? "★" : "☆";
    ctx.fillStyle = "#ffd23f";
    ctx.fillText(stars, W2 / 2, 84);
    ctx.restore();

    // 生命值: 左上角三颗心, 已损失显示为暗轮廓; 无敌帧内整体闪烁提示
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
  }
}
