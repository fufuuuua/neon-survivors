/**
 * Enemy.js — 敌人实体，支持多种行为类型（追逐 / 突袭 / 坦克 / 裂解 / Boss）。
 * 行为差异通过配置数据驱动，渲染采用各异的霓虹几何造型。
 *
 * Boss 分三种阶段化变体（kind 0/1/2），各自拥有不同造型、攻击套路与节奏：
 *   0 母核   —— 稳健：环形弹幕 / 扇形散射 / 召唤突袭体
 *   1 裂能体 —— 敏捷：双臂螺旋 / 突进扇射 / 高速环爆
 *   2 湮灭者 —— 沉重：双层环波 / 宽域横扫 / 召唤壁垒
 */
import { CONFIG } from "../config.js";
import { Vector2 } from "../utils/Vector2.js";
import { TAU } from "../utils/math.js";
import { drawGlow } from "../core/GlowCache.js";

// 各 Boss 变体的攻击节奏与蓄力时长
const BOSS_TUNE = [
  { interval: 3.2, cast: 0.55, bullet: 14 }, // 母核
  { interval: 2.1, cast: 0.40, bullet: 16 }, // 裂能体（更急促）
  { interval: 4.0, cast: 0.85, bullet: 20 }, // 湮灭者（更沉重）
];

export class Enemy {
  constructor() { this.active = false; }

  spawn(type, x, y, hpScale = 1) {
    const def = CONFIG.enemies[type];
    this.type = type;
    this.def = def;
    this.x = x; this.y = y;
    this.maxHp = Math.round(def.hp * hpScale); // 取整：避免血条出现 .99999 之类的浮点尾数
    this.hp = this.maxHp;
    this.speed = def.speed;
    this.radius = def.radius;
    this.damage = def.damage;
    this.color = def.color;
    this.xp = def.xp;
    this.isBoss = def.boss === true;
    this.kind = def.kind || 0;
    this.flash = 0;             // 命中闪白计时
    this._orbitCd = 0;          // 轨道核命中冷却（对象池复用时重置）
    this.t = Math.random() * TAU;
    // Boss 攻击状态
    if (this.isBoss) {
      const tune = BOSS_TUNE[this.kind];
      this._interval = tune.interval;
      this._castTime = tune.cast;
      this._atkTimer = 3.2;     // 首次攻击前的缓冲
      this._casting = 0;        // 施法预警剩余时间
      this._atkIndex = 0;       // 攻击模式轮换序号
      this._pendingAtk = 0;
      this._dashTime = 0;       // 突进剩余时间（裂能体）
      this._dashX = 0; this._dashY = 0;
    }
    this.active = true;
  }

  hurt(amount) {
    this.hp -= amount;
    this.flash = 0.08;
    return this.hp <= 0;
  }

  update(dt, player, game) {
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;

    // Boss 攻击 AI；施法预警期间几乎静止（蓄力感）
    let speedMul = 1;
    if (this.isBoss && game) {
      this._bossAI(dt, player, game);
      if (this._casting > 0) speedMul = 0.12;
      if (this._dashTime > 0) { this._dashTime -= dt; speedMul = 3.4; } // 突进冲刺
    }
    this._move(dt, player, speedMul);
  }

  /** 朝玩家移动（突袭体带摆动；Boss 突进期间沿锁定方向冲刺） */
  _move(dt, player, speedMul) {
    if (this.isBoss && this._dashTime > 0) {
      this.x += this._dashX * this.speed * speedMul * dt;
      this.y += this._dashY * this.speed * speedMul * dt;
      return;
    }
    const dir = Vector2.dir(this, player);
    const sp = this.speed * speedMul;
    if (this.type === "rusher") {
      const perp = { x: -dir.y, y: dir.x };
      const wob = Math.sin(this.t * 6) * 0.4;
      this.x += (dir.x + perp.x * wob) * sp * dt;
      this.y += (dir.y + perp.y * wob) * sp * dt;
    } else {
      this.x += dir.x * sp * dt;
      this.y += dir.y * sp * dt;
    }
  }

  /** Boss 攻击循环：蓄力(telegraph) → 释放，三种模式轮换 */
  _bossAI(dt, player, game) {
    if (this._casting > 0) {
      this._casting -= dt;
      if (this._casting <= 0) this._fireBossAttack(player, game);
      return;
    }
    this._atkTimer -= dt;
    if (this._atkTimer <= 0) {
      this._atkTimer = this._interval;
      this._casting = this._castTime;         // 蓄力预警时间
      this._pendingAtk = (this._atkIndex++) % 3;
      if (game.audio.bossAttack) game.audio.bossAttack();
    }
  }

  _fireBossAttack(player, game) {
    const dmg = BOSS_TUNE[this.kind].bullet;
    const color = this.color;                 // 用本体颜色，强化 Boss 辨识度
    const opt = (extra) => ({ damage: dmg, pierce: 0, radius: 7, color, life: 6, hostile: true, ...extra });
    const aimAngle = () => Math.atan2(player.y - this.y, player.x - this.x);

    if (this.kind === 0) this._attackNucleus(player, game, opt, aimAngle);
    else if (this.kind === 1) this._attackFlux(player, game, opt, aimAngle);
    else this._attackVoid(player, game, opt, aimAngle);

    game.camera.shake(this.kind === 2 ? 12 : 8);
  }

  // ---- 母核：环形 / 扇形 / 召唤突袭体 ----
  _attackNucleus(player, game, opt, aimAngle) {
    switch (this._pendingAtk) {
      case 0: { // 环形弹幕
        const n = 20, sp = 185;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + this.t;
          game.spawnEnemyProjectile(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, opt());
        }
        break;
      }
      case 1: { // 朝玩家的扇形散射
        const a0 = aimAngle();
        const n = 7, spread = 0.85, sp = 250;
        for (let i = 0; i < n; i++) {
          const a = a0 + (i - (n - 1) / 2) * (spread / (n - 1));
          game.spawnEnemyProjectile(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, opt({ radius: 8 }));
        }
        break;
      }
      case 2: { // 召唤突袭体增援
        const hp = game.spawnSystem.hpScale * 0.6;
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU;
          game.spawnEnemy("rusher", this.x + Math.cos(a) * 60, this.y + Math.sin(a) * 60, hp);
        }
        break;
      }
    }
  }

  // ---- 裂能体：双臂螺旋 / 突进扇射 / 高速环爆 ----
  _attackFlux(player, game, opt, aimAngle) {
    switch (this._pendingAtk) {
      case 0: { // 双臂反向螺旋
        const arms = 2, per = 12, sp = 215;
        for (let a = 0; a < arms; a++) {
          for (let i = 0; i < per; i++) {
            const ang = this.t * 2.2 + a * Math.PI + i * 0.16;
            game.spawnEnemyProjectile(this.x, this.y, Math.cos(ang) * sp, Math.sin(ang) * sp, opt({ radius: 6 }));
          }
        }
        break;
      }
      case 1: { // 突进 + 紧密扇射
        const a0 = aimAngle();
        this._dashX = Math.cos(a0); this._dashY = Math.sin(a0);
        this._dashTime = 0.5;             // 触发一次冲刺
        const n = 5, spread = 0.5, sp = 340;
        for (let i = 0; i < n; i++) {
          const a = a0 + (i - (n - 1) / 2) * (spread / (n - 1));
          game.spawnEnemyProjectile(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, opt({ radius: 7 }));
        }
        break;
      }
      case 2: { // 高速环爆
        const n = 28, sp = 250;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + this.t * 0.5;
          game.spawnEnemyProjectile(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, opt({ radius: 6 }));
        }
        break;
      }
    }
  }

  // ---- 湮灭者：双层环波 / 宽域横扫 / 召唤壁垒 ----
  _attackVoid(player, game, opt, aimAngle) {
    switch (this._pendingAtk) {
      case 0: { // 双层同心环波（内快外慢，制造节奏差）
        const n = 16;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + this.t;
          game.spawnEnemyProjectile(this.x, this.y, Math.cos(a) * 160, Math.sin(a) * 160, opt({ radius: 9 }));
        }
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + this.t + Math.PI / n;
          game.spawnEnemyProjectile(this.x, this.y, Math.cos(a) * 95, Math.sin(a) * 95, opt({ radius: 11 }));
        }
        break;
      }
      case 1: { // 宽域横扫：一大片朝玩家覆盖的重弹
        const a0 = aimAngle();
        const n = 14, spread = 1.8, sp = 175;
        for (let i = 0; i < n; i++) {
          const a = a0 + (i - (n - 1) / 2) * (spread / (n - 1));
          game.spawnEnemyProjectile(this.x, this.y, Math.cos(a) * sp, Math.sin(a) * sp, opt({ radius: 10 }));
        }
        break;
      }
      case 2: { // 召唤壁垒 + 裂解体
        const hp = game.spawnSystem.hpScale * 0.7;
        for (let i = 0; i < 2; i++) {
          const a = (i / 2) * TAU;
          game.spawnEnemy("tank", this.x + Math.cos(a) * 70, this.y + Math.sin(a) * 70, hp);
        }
        for (let i = 0; i < 2; i++) {
          const a = (i / 2) * TAU + Math.PI / 2;
          game.spawnEnemy("splitter", this.x + Math.cos(a) * 70, this.y + Math.sin(a) * 70, hp);
        }
        break;
      }
    }
  }

  render(ctx) {
    // 背光（缓存精灵，替代 shadowBlur）
    drawGlow(ctx, this.color, this.x, this.y, this.radius * (this.isBoss ? 2.4 : 1.8));

    // Boss 蓄力预警：扩张的警示环
    if (this.isBoss && this._casting > 0) {
      const p = 1 - this._casting / this._castTime;
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.4 * Math.abs(Math.sin(this._casting * 22));
      ctx.strokeStyle = "#ff8a3d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + 10 + p * 70, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    const spin = this.isBoss ? [0.3, 0.9, 0.18][this.kind] : 0.8;
    ctx.rotate(this.t * spin);
    const c = this.flash > 0 ? "#ffffff" : this.color;
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = 2.5;

    if (this.isBoss) {
      this._boss(ctx);
    } else {
      switch (this.type) {
        case "chaser":   this._poly(ctx, 3, this.radius); break; // 三角
        case "rusher":   this._poly(ctx, 4, this.radius); break; // 菱形/方
        case "tank":     this._poly(ctx, 6, this.radius); break; // 六边形
        case "splitter": this._poly(ctx, 5, this.radius); break; // 五边
      }
    }
    ctx.restore();

    // 血条（仅非满血或 Boss）
    if (this.hp < this.maxHp || this.isBoss) this._healthBar(ctx);
  }

  _poly(ctx, sides, r) {
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * TAU - Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.28; ctx.fill();
    ctx.globalAlpha = 1; ctx.stroke();
  }

  /** 星形（用于裂能体的尖锐造型） */
  _star(ctx, points, rOuter, rInner) {
    ctx.beginPath();
    for (let i = 0; i <= points * 2; i++) {
      const r = i % 2 === 0 ? rOuter : rInner;
      const a = (i / (points * 2)) * TAU - Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.28; ctx.fill();
    ctx.globalAlpha = 1; ctx.stroke();
  }

  /** Boss 造型：按 kind 区分，各具辨识度 */
  _boss(ctx) {
    const r = this.radius;
    if (this.kind === 0) {
      // 母核：八边形 + 旋转三角 + 亮核
      this._poly(ctx, 8, r);
      ctx.rotate(this.t);
      this._poly(ctx, 3, r * 0.55);
      ctx.beginPath(); ctx.arc(0, 0, r * 0.25, 0, TAU);
      ctx.fillStyle = "#fff"; ctx.fill();
    } else if (this.kind === 1) {
      // 裂能体：六角尖星 + 反向内星，锐利敏捷感
      this._star(ctx, 6, r, r * 0.5);
      ctx.rotate(-this.t * 1.6);
      this._star(ctx, 3, r * 0.6, r * 0.28);
      ctx.beginPath(); ctx.arc(0, 0, r * 0.18, 0, TAU);
      ctx.fillStyle = "#fff"; ctx.fill();
    } else {
      // 湮灭者：厚重双层六边形 + 环状裂纹核，沉重感
      this._poly(ctx, 6, r);
      this._poly(ctx, 6, r * 0.72);
      ctx.rotate(this.t * 0.6);
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, TAU);
      ctx.fillStyle = "#fff"; ctx.fill();
    }
  }

  _healthBar(ctx) {
    const w = this.isBoss ? this.radius * 2.4 : this.radius * 2;
    const h = this.isBoss ? 6 : 3;
    const x = this.x - w / 2;
    const y = this.y - this.radius - (this.isBoss ? 16 : 9);
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = this.isBoss ? this.color : "#aaff00";
    ctx.fillRect(x, y, w * Math.max(0, this.hp / this.maxHp), h);
    ctx.restore();
  }
}
