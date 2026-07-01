/**
 * Player.js — 玩家实体。
 * 负责移动、生命值、经验/等级，并驱动其拥有的多种武器。
 * 武器作用于敌人时通过传入的 `game` 上下文调用（spawnProjectile / damageEnemy 等），
 * 实现实体与系统的解耦。
 */
import { CONFIG } from "../config.js";
import { Vector2 } from "../utils/Vector2.js";
import { TAU, clamp } from "../utils/math.js";

export class Player {
  constructor() {
    this.reset();
  }

  reset() {
    const w = CONFIG.world;
    this.x = w.width / 2;
    this.y = w.height / 2;
    this.radius = CONFIG.player.radius;

    // 基础属性（可被升级修改）
    this.maxHp = CONFIG.player.maxHp;
    this.hp = this.maxHp;
    this.speed = CONFIG.player.baseSpeed;
    this.pickupRange = CONFIG.player.pickupRange;
    this.regen = CONFIG.player.baseRegen;
    this.damageMul = 1;       // 全局伤害倍率
    this.invuln = 0;

    // 进阶属性（由局内/局外强化注入）
    this.critChance = 0;      // 暴击率 0..1
    this.critMult = 2;        // 暴击倍率
    this.cooldownMul = 1;     // 武器冷却倍率（<1 更快）
    this.damageReduction = 0; // 受伤减免 0..1
    this.xpMul = 1;           // 经验获取倍率
    this.lifesteal = 0;       // 每次击杀回复
    this.revives = 0;         // 剩余复活次数
    this.pendingLevels = 0;   // 开局待领取的额外强化次数

    // 等级 / 经验
    this.level = 1;
    this.xp = 0;
    this.xpToNext = CONFIG.progression.baseXp;

    // 武器实例数据（深拷贝配置，避免污染原始 CONFIG）
    this.weapons = JSON.parse(JSON.stringify(CONFIG.weapons));
    this.acquired = {};       // 升级项 id -> 已获取等级（用于 UI 展示与上限判断）
    this._timers = { blaster: 0, nova: 0, aura: 0, chain: 0 };
    this._orbitAngle = 0;

    this.moveDir = new Vector2();
    this.facing = new Vector2(0, -1);
  }

  get alive() { return this.hp > 0; }

  takeDamage(amount, game) {
    if (this.invuln > 0) return;
    const real = amount * (1 - this.damageReduction);
    this.hp = clamp(this.hp - real, 0, this.maxHp);
    this.invuln = CONFIG.player.invulnTime;
    game.audio.hurt();
    game.camera.shake(14);
    game.particles.burst(this.x, this.y, "#ff2bd6", 16, 240, 3, 0.5);
  }

  heal(amount) { this.hp = clamp(this.hp + amount, 0, this.maxHp); }

  gainXp(amount, game) {
    this.xp += amount * this.xpMul;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = Math.round(this.xpToNext * CONFIG.progression.xpGrowth);
      game.onLevelUp();
    }
  }

  update(dt, input, game) {
    if (this.invuln > 0) this.invuln -= dt;
    if (this.regen > 0) this.heal(this.regen * dt);

    // 移动
    this.moveDir = input.getMoveVector();
    if (this.moveDir.lengthSq > 0) {
      this.x += this.moveDir.x * this.speed * dt;
      this.y += this.moveDir.y * this.speed * dt;
      this.facing.copy(this.moveDir);
      game.particles.trail(this.x, this.y, "#00f0ff", 2, 0.25);
    }
    // 边界约束
    this.x = clamp(this.x, this.radius, CONFIG.world.width - this.radius);
    this.y = clamp(this.y, this.radius, CONFIG.world.height - this.radius);

    this._updateWeapons(dt, game);
  }

  // ---------------- 武器逻辑 ----------------
  _updateWeapons(dt, game) {
    this._fireBlaster(dt, game);
    this._fireNova(dt, game);
    this._tickAura(dt, game);
    this._updateOrbit(dt, game);
    this._fireChain(dt, game);
  }

  /** 主武器：自动瞄准最近敌人，可多发散射、可穿透 */
  _fireBlaster(dt, game) {
    const w = this.weapons.blaster;
    this._timers.blaster -= dt;
    if (this._timers.blaster > 0) return;
    const target = game.findNearestEnemy(this.x, this.y);
    if (!target) return;
    this._timers.blaster = (1 / w.fireRate) * this.cooldownMul;

    const base = Vector2.dir(this, target);
    const baseAngle = Math.atan2(base.y, base.x);
    const spread = 0.18;
    for (let i = 0; i < w.count; i++) {
      const offset = (i - (w.count - 1) / 2) * spread;
      const a = baseAngle + offset;
      game.spawnProjectile(this.x, this.y,
        Math.cos(a) * w.projectileSpeed, Math.sin(a) * w.projectileSpeed,
        { damage: w.damage * this.damageMul, pierce: w.pierce, color: w.accent, radius: 5 });
    }
    game.audio.shoot();
  }

  /** 超新星：周期性向四周发射环形弹幕 */
  _fireNova(dt, game) {
    const w = this.weapons.nova;
    if (w.cooldown <= 0) return; // 未解锁
    this._timers.nova -= dt;
    if (this._timers.nova > 0) return;
    this._timers.nova = w.cooldown * this.cooldownMul;
    for (let i = 0; i < w.bullets; i++) {
      const a = (i / w.bullets) * TAU;
      game.spawnProjectile(this.x, this.y,
        Math.cos(a) * w.projectileSpeed, Math.sin(a) * w.projectileSpeed,
        { damage: w.damage * this.damageMul, pierce: 1, color: w.accent, radius: 6 });
    }
    game.audio.nova();
    game.camera.shake(6);
  }

  /** 电弧链：周期性放出电弧，在最近的多个敌人之间跳跃造成伤害 */
  _fireChain(dt, game) {
    const w = this.weapons.chain;
    if (w.cooldown <= 0 || w.chains <= 0) return; // 未解锁
    this._timers.chain -= dt;
    if (this._timers.chain > 0) return;
    this._timers.chain = w.cooldown * this.cooldownMul;

    let src = { x: this.x, y: this.y };
    const hit = new Set();
    let hops = 0;
    for (let i = 0; i < w.chains; i++) {
      const target = game.findNearestEnemyExcept(src.x, src.y, hit, w.range);
      if (!target) break;
      game.addBeam(src.x, src.y, target.x, target.y, w.accent, 0.16);
      game.damageEnemy(target, w.damage * this.damageMul, true, target.x, target.y);
      hit.add(target);
      src = { x: target.x, y: target.y };
      hops++;
    }
    if (hops > 0) game.audio.hit();
  }

  /** 灼蚀场：以玩家为中心的持续范围伤害（经空间网格查询近邻） */
  _tickAura(dt, game) {
    const w = this.weapons.aura;
    if (w.radius <= 0) return; // 未解锁
    this._timers.aura -= dt;
    if (this._timers.aura > 0) return;
    this._timers.aura = w.tick;
    const dmg = w.damage * w.tick * this.damageMul;
    const rr = w.radius;
    game.grid.queryCircle(this.x, this.y, rr + 32, (e) => {
      if (!e.active) return;
      if (Vector2.distSq(e, this) < (rr + e.radius) ** 2) {
        game.damageEnemy(e, dmg, false);
      }
    });
  }

  /** 轨道核：环绕玩家旋转的光球，碰触敌人造成伤害（经空间网格查询近邻） */
  _updateOrbit(dt, game) {
    const w = this.weapons.orbit;
    if (w.count <= 0) return; // 未解锁
    this._orbitAngle += w.rotSpeed * dt;
    for (let i = 0; i < w.count; i++) {
      const a = this._orbitAngle + (i / w.count) * TAU;
      const ox = this.x + Math.cos(a) * w.radius;
      const oy = this.y + Math.sin(a) * w.radius;
      game.grid.queryCircle(ox, oy, 12 + 32, (e) => {
        if (!e.active) return;
        if (Vector2.distSq(e, { x: ox, y: oy }) < (e.radius + 12) ** 2) {
          if (!e._orbitCd || e._orbitCd <= 0) {
            game.damageEnemy(e, w.damage * this.damageMul, false);
            e._orbitCd = 0.3;
          }
        }
      });
    }
    // 冷却递减（仅活跃敌人）
    for (const e of game.enemies) if (e._orbitCd > 0) e._orbitCd -= dt;
  }

  // ---------------- 渲染 ----------------
  render(ctx) {
    const a = this.weapons.aura;
    // 灼蚀场视觉
    if (a.radius > 0) {
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = a.accent;
      ctx.beginPath(); ctx.arc(this.x, this.y, a.radius, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.4; ctx.strokeStyle = a.accent; ctx.lineWidth = 1.5;
      ctx.shadowBlur = 12; ctx.shadowColor = a.accent;
      ctx.beginPath(); ctx.arc(this.x, this.y, a.radius, 0, TAU); ctx.stroke();
      ctx.restore();
    }

    // 飞船本体（朝向移动方向的三角飞行器）
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(Math.atan2(this.facing.y, this.facing.x) + Math.PI / 2);
    ctx.shadowBlur = 18;
    ctx.shadowColor = this.invuln > 0 && Math.floor(this.invuln * 20) % 2 ? "#fff" : "#00f0ff";
    ctx.fillStyle = ctx.shadowColor;
    ctx.beginPath();
    ctx.moveTo(0, -this.radius);
    ctx.lineTo(this.radius * 0.8, this.radius);
    ctx.lineTo(0, this.radius * 0.5);
    ctx.lineTo(-this.radius * 0.8, this.radius);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#05060e";
    ctx.beginPath(); ctx.arc(0, 0, this.radius * 0.28, 0, TAU); ctx.fill();
    ctx.restore();

    // 轨道核
    const w = this.weapons.orbit;
    if (w.count > 0) {
      for (let i = 0; i < w.count; i++) {
        const ang = this._orbitAngle + (i / w.count) * TAU;
        const ox = this.x + Math.cos(ang) * w.radius;
        const oy = this.y + Math.sin(ang) * w.radius;
        ctx.save();
        ctx.shadowBlur = 14; ctx.shadowColor = w.accent;
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(ox, oy, 8, 0, TAU); ctx.fill();
        ctx.globalAlpha = 0.5; ctx.fillStyle = w.accent;
        ctx.beginPath(); ctx.arc(ox, oy, 13, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
  }
}
