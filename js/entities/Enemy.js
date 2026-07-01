/**
 * Enemy.js — 敌人实体，支持多种行为类型（追逐 / 突袭 / 坦克 / 裂解 / Boss）。
 * 行为差异通过配置数据驱动，渲染采用各异的霓虹几何造型。
 */
import { CONFIG } from "../config.js";
import { Vector2 } from "../utils/Vector2.js";
import { TAU } from "../utils/math.js";
import { drawGlow } from "../core/GlowCache.js";

export class Enemy {
  constructor() { this.active = false; }

  spawn(type, x, y, hpScale = 1) {
    const def = CONFIG.enemies[type];
    this.type = type;
    this.def = def;
    this.x = x; this.y = y;
    this.maxHp = def.hp * hpScale;
    this.hp = this.maxHp;
    this.speed = def.speed;
    this.radius = def.radius;
    this.damage = def.damage;
    this.color = def.color;
    this.xp = def.xp;
    this.isBoss = type === "boss";
    this.flash = 0;             // 命中闪白计时
    this._orbitCd = 0;          // 轨道核命中冷却（对象池复用时重置）
    this.t = Math.random() * TAU;
    // Boss 攻击状态
    if (this.isBoss) {
      this._atkTimer = 3.5;     // 首次攻击前的缓冲
      this._casting = 0;        // 施法预警剩余时间
      this._atkIndex = 0;       // 攻击模式轮换序号
      this._pendingAtk = 0;
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
    }
    this._move(dt, player, speedMul);
  }

  /** 朝玩家移动（突袭体带摆动） */
  _move(dt, player, speedMul) {
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
      this._atkTimer = 3.2;
      this._casting = 0.55;                 // 蓄力预警时间
      this._pendingAtk = (this._atkIndex++) % 3;
      if (game.audio.bossAttack) game.audio.bossAttack();
    }
  }

  _fireBossAttack(player, game) {
    const dmg = 14;
    const color = "#ff8a3d";                // 醒目的警示橙
    const opt = (extra) => ({ damage: dmg, pierce: 0, radius: 7, color, life: 6, ...extra });

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
        const a0 = Math.atan2(player.y - this.y, player.x - this.x);
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
    game.camera.shake(8);
  }

  render(ctx) {
    // 背光（缓存精灵，替代 shadowBlur）
    drawGlow(ctx, this.color, this.x, this.y, this.radius * (this.isBoss ? 2.4 : 1.8));

    // Boss 蓄力预警：扩张的警示环
    if (this.isBoss && this._casting > 0) {
      const p = 1 - this._casting / 0.55;
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
    ctx.rotate(this.t * (this.isBoss ? 0.3 : 0.8));
    const c = this.flash > 0 ? "#ffffff" : this.color;
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = 2.5;

    switch (this.type) {
      case "chaser":   this._poly(ctx, 3, this.radius); break; // 三角
      case "rusher":   this._poly(ctx, 4, this.radius); break; // 菱形/方
      case "tank":     this._poly(ctx, 6, this.radius); break; // 六边形
      case "splitter": this._poly(ctx, 5, this.radius); break; // 五边
      case "boss":     this._boss(ctx); break;
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

  _boss(ctx) {
    this._poly(ctx, 8, this.radius);
    ctx.rotate(this.t);
    this._poly(ctx, 3, this.radius * 0.55);
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * 0.25, 0, TAU);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }

  _healthBar(ctx) {
    const w = this.isBoss ? this.radius * 2.4 : this.radius * 2;
    const h = this.isBoss ? 6 : 3;
    const x = this.x - w / 2;
    const y = this.y - this.radius - (this.isBoss ? 16 : 9);
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = this.isBoss ? "#ff2bd6" : "#aaff00";
    ctx.fillRect(x, y, w * Math.max(0, this.hp / this.maxHp), h);
    ctx.restore();
  }
}
