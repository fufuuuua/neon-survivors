/**
 * UpgradeSystem.js — Roguelite 升级系统。
 *
 * 设计目标（本次增强）：
 *  - 每个升级项有明确的「等级上限 maxLevel」，并记录玩家已获取等级 (player.acquired[id])，
 *    使成长有节奏、可读、不再“无脑叠加”。
 *  - 卡片可展示「当前等级 → 下一等级」，让玩家清楚每次选择的意义。
 *  - 提供 describeLoadout()：实时汇总玩家当前所有武器与被动加成的真实数值，
 *    供升级/暂停界面展示，解决“看不出区别 / 能力不透明”的问题。
 */
import { choice } from "../utils/math.js";
import { CONFIG } from "../config.js";

// 被动数值的基准（用于计算增幅百分比）
const CONFIG_BASE = {
  speed: CONFIG.player.baseSpeed,
  maxHp: CONFIG.player.maxHp,
  pickupRange: CONFIG.player.pickupRange,
};

/**
 * 升级项定义。
 * - maxLevel：可重复获取的次数上限
 * - unlock：是否为解锁型（解锁后该项不再出现，由对应的进阶项接管）
 * - available(p)：额外出现条件
 * - apply(p)：施加强化
 */
const UPGRADES = [
  // ---- 武器解锁 ----
  {
    id: "unlock_orbit", icon: "◓", name: "轨道核", accent: "#8a5bff", maxLevel: 1, unlock: true,
    desc: "召唤 2 颗环绕光球，碰触敌人造成伤害。",
    available: (p) => p.weapons.orbit.count === 0,
    apply: (p) => { p.weapons.orbit.count = 2; },
  },
  {
    id: "unlock_aura", icon: "❂", name: "灼蚀场", accent: "#aaff00", maxLevel: 1, unlock: true,
    desc: "在身边展开灼烧领域，持续灼伤范围内敌人。",
    available: (p) => p.weapons.aura.radius === 0,
    apply: (p) => { p.weapons.aura.radius = 110; },
  },
  {
    id: "unlock_nova", icon: "✸", name: "超新星", accent: "#ff2bd6", maxLevel: 1, unlock: true,
    desc: "每 4 秒爆发一圈环形弹幕，可穿透敌人。",
    available: (p) => p.weapons.nova.cooldown === 0,
    apply: (p) => { p.weapons.nova.cooldown = 4; },
  },
  {
    id: "unlock_chain", icon: "⚡", name: "电弧链", accent: "#7df9ff", maxLevel: 1, unlock: true,
    desc: "每 1.4 秒放出电弧，在最近的 3 个敌人间跳跃。",
    available: (p) => p.weapons.chain.cooldown === 0,
    apply: (p) => { p.weapons.chain.cooldown = 1.4; p.weapons.chain.chains = 3; },
  },

  // ---- 武器进阶 ----
  {
    id: "blaster_count", icon: "✦", name: "多重弹道", accent: "#00f0ff", maxLevel: 5,
    desc: "脉冲枪额外发射 +1 发子弹（散射）。",
    apply: (p) => { p.weapons.blaster.count++; },
  },
  {
    id: "blaster_rate", icon: "✦", name: "高速循环", accent: "#00f0ff", maxLevel: 6,
    desc: "脉冲枪射速 +22%。",
    apply: (p) => { p.weapons.blaster.fireRate *= 1.22; },
  },
  {
    id: "blaster_pierce", icon: "✦", name: "穿甲弹芯", accent: "#00f0ff", maxLevel: 5,
    desc: "脉冲枪子弹额外穿透 +1 个敌人。",
    apply: (p) => { p.weapons.blaster.pierce++; },
  },
  {
    id: "blaster_dmg", icon: "✦", name: "聚能弹头", accent: "#00f0ff", maxLevel: 6,
    desc: "脉冲枪单发伤害 +6。",
    apply: (p) => { p.weapons.blaster.damage += 6; },
  },
  {
    id: "orbit_more", icon: "◓", name: "轨道增殖", accent: "#8a5bff", maxLevel: 6,
    desc: "轨道核 +1 颗，旋转更快。",
    available: (p) => p.weapons.orbit.count > 0,
    apply: (p) => { p.weapons.orbit.count++; p.weapons.orbit.rotSpeed += 0.3; },
  },
  {
    id: "orbit_dmg", icon: "◓", name: "轨道过载", accent: "#8a5bff", maxLevel: 5,
    desc: "轨道核伤害 +50%，半径 +15。",
    available: (p) => p.weapons.orbit.count > 0,
    apply: (p) => { p.weapons.orbit.damage *= 1.5; p.weapons.orbit.radius += 15; },
  },
  {
    id: "aura_size", icon: "❂", name: "领域扩张", accent: "#aaff00", maxLevel: 6,
    desc: "灼蚀场范围 +28%，伤害 +25%。",
    available: (p) => p.weapons.aura.radius > 0,
    apply: (p) => { p.weapons.aura.radius *= 1.28; p.weapons.aura.damage *= 1.25; },
  },
  {
    id: "nova_fast", icon: "✸", name: "坍缩加速", accent: "#ff2bd6", maxLevel: 5,
    desc: "超新星冷却 -18%，弹幕 +4 发。",
    available: (p) => p.weapons.nova.cooldown > 0,
    apply: (p) => { p.weapons.nova.cooldown *= 0.82; p.weapons.nova.bullets += 4; },
  },
  {
    id: "nova_dmg", icon: "✸", name: "恒星熔炉", accent: "#ff2bd6", maxLevel: 5,
    desc: "超新星伤害 +40%。",
    available: (p) => p.weapons.nova.cooldown > 0,
    apply: (p) => { p.weapons.nova.damage *= 1.4; },
  },
  {
    id: "chain_more", icon: "⚡", name: "电弧增幅", accent: "#7df9ff", maxLevel: 5,
    desc: "电弧链 +1 跳跃目标，冷却 -12%。",
    available: (p) => p.weapons.chain.chains > 0,
    apply: (p) => { p.weapons.chain.chains++; p.weapons.chain.cooldown *= 0.88; },
  },
  {
    id: "chain_dmg", icon: "⚡", name: "过载电容", accent: "#7df9ff", maxLevel: 5,
    desc: "电弧链伤害 +45%，跳跃距离 +30。",
    available: (p) => p.weapons.chain.chains > 0,
    apply: (p) => { p.weapons.chain.damage *= 1.45; p.weapons.chain.range += 30; },
  },

  // ---- 被动属性 ----
  {
    id: "power", icon: "⚡", name: "过载核心", accent: "#ffd23f", maxLevel: 8,
    desc: "所有武器伤害 +15%。",
    apply: (p) => { p.damageMul *= 1.15; },
  },
  {
    id: "speed", icon: "➤", name: "推进强化", accent: "#00f0ff", maxLevel: 5,
    desc: "移动速度 +12%。",
    apply: (p) => { p.speed *= 1.12; },
  },
  {
    id: "maxhp", icon: "♥", name: "装甲扩容", accent: "#ff5c8a", maxLevel: 8,
    desc: "最大生命 +25，并立即回复。",
    apply: (p) => { p.maxHp += 25; p.heal(25); },
  },
  {
    id: "regen", icon: "✚", name: "纳米修复", accent: "#aaff00", maxLevel: 5,
    desc: "每秒回复 +1.5 生命。",
    apply: (p) => { p.regen += 1.5; },
  },
  {
    id: "magnet", icon: "⬇", name: "引力线圈", accent: "#ffd23f", maxLevel: 4,
    desc: "经验拾取范围 +50%。",
    apply: (p) => { p.pickupRange *= 1.5; },
  },
  {
    id: "crit_up", icon: "✧", name: "精准校准", accent: "#ff8a3d", maxLevel: 6,
    desc: "暴击率 +8%（暴击造成 2 倍伤害）。",
    apply: (p) => { p.critChance = Math.min(1, p.critChance + 0.08); },
  },
  {
    id: "haste_up", icon: "⟳", name: "超频循环", accent: "#00f0ff", maxLevel: 5,
    desc: "所有武器攻速 +8%。",
    apply: (p) => { p.cooldownMul *= 0.92; },
  },
  {
    id: "lifesteal", icon: "❤", name: "噬能装甲", accent: "#ff5c8a", maxLevel: 5,
    desc: "每次击杀回复 +1.2 生命。",
    apply: (p) => { p.lifesteal += 1.2; },
  },
];

const BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

export class UpgradeSystem {
  static getLevel(player, id) { return player.acquired[id] || 0; }

  /** 判断升级项当前是否可被抽取（满足条件 且 未达上限） */
  static _isPickable(player, u) {
    if (UpgradeSystem.getLevel(player, u.id) >= u.maxLevel) return false;
    if (u.available && !u.available(player)) return false;
    return true;
  }

  /** 随机抽取 n 个可用的升级项（不重复） */
  static roll(player, n = 3) {
    const pool = UPGRADES.filter((u) => UpgradeSystem._isPickable(player, u));
    const picks = [];
    const copy = [...pool];
    while (picks.length < n && copy.length > 0) {
      const idx = Math.floor(Math.random() * copy.length);
      picks.push(copy.splice(idx, 1)[0]);
    }
    // 兜底：可选项不足时用任意被动属性填充
    const passives = UPGRADES.filter((u) => !u.unlock);
    while (picks.length < n) picks.push(choice(passives));
    return picks;
  }

  /** 施加升级并记录等级 */
  static apply(u, player) {
    u.apply(player);
    player.acquired[u.id] = (player.acquired[u.id] || 0) + 1;
  }

  /** 生成卡片上的等级标签：解锁项显示“解锁”，进阶项显示“Lv.N → N+1” */
  static levelLabel(player, u) {
    const lv = UpgradeSystem.getLevel(player, u.id);
    if (u.unlock || lv === 0) return u.unlock ? "解锁 NEW" : `Lv.1 (新)`;
    return `Lv.${lv} → ${lv + 1}`;
  }

  /**
   * 汇总玩家当前装备与被动加成的真实数值，用于界面透明展示。
   * 返回 { weapons: [...], passives: [...] }，每项 { icon, name, accent, detail }。
   */
  static describeLoadout(player) {
    const w = player.weapons;
    const r1 = (n) => Math.round(n * 10) / 10;
    const weapons = [];

    weapons.push({
      icon: w.blaster.icon, name: w.blaster.name, accent: w.blaster.accent,
      detail: `伤害 ${r1(w.blaster.damage)} · 射速 ${r1(w.blaster.fireRate)}/s · ${w.blaster.count} 连发 · 穿透 ${w.blaster.pierce}`,
    });
    if (w.orbit.count > 0) weapons.push({
      icon: w.orbit.icon, name: w.orbit.name, accent: w.orbit.accent,
      detail: `${w.orbit.count} 颗 · 伤害 ${r1(w.orbit.damage)} · 半径 ${Math.round(w.orbit.radius)}`,
    });
    if (w.aura.radius > 0) weapons.push({
      icon: w.aura.icon, name: w.aura.name, accent: w.aura.accent,
      detail: `半径 ${Math.round(w.aura.radius)} · ${r1(w.aura.damage)}/s`,
    });
    if (w.nova.cooldown > 0) weapons.push({
      icon: w.nova.icon, name: w.nova.name, accent: w.nova.accent,
      detail: `每 ${r1(w.nova.cooldown)}s · ${w.nova.bullets} 发 · 伤害 ${r1(w.nova.damage)}`,
    });
    if (w.chain.chains > 0) weapons.push({
      icon: w.chain.icon, name: w.chain.name, accent: w.chain.accent,
      detail: `每 ${r1(w.chain.cooldown)}s · ${w.chain.chains} 跳 · 伤害 ${r1(w.chain.damage)}`,
    });

    const passives = [];
    const dmgPct = Math.round((player.damageMul - 1) * 100);
    if (dmgPct > 0) passives.push({ icon: "⚡", name: "伤害", accent: "#ffd23f", detail: `+${dmgPct}%` });
    const spdPct = Math.round((player.speed / CONFIG_BASE.speed - 1) * 100);
    if (spdPct > 0) passives.push({ icon: "➤", name: "移速", accent: "#00f0ff", detail: `+${spdPct}%` });
    if (player.maxHp > CONFIG_BASE.maxHp) passives.push({ icon: "♥", name: "最大生命", accent: "#ff5c8a", detail: `${player.maxHp}` });
    if (player.regen > 0) passives.push({ icon: "✚", name: "回复", accent: "#aaff00", detail: `${r1(player.regen)}/s` });
    const magPct = Math.round((player.pickupRange / CONFIG_BASE.pickupRange - 1) * 100);
    if (magPct > 0) passives.push({ icon: "⬇", name: "拾取", accent: "#ffd23f", detail: `+${magPct}%` });
    if (player.critChance > 0) passives.push({ icon: "✧", name: "暴击", accent: "#ff8a3d", detail: `${Math.round(player.critChance * 100)}%` });
    const hastePct = Math.round((1 / player.cooldownMul - 1) * 100);
    if (hastePct > 0) passives.push({ icon: "⟳", name: "攻速", accent: "#00f0ff", detail: `+${hastePct}%` });
    if (player.damageReduction > 0) passives.push({ icon: "◈", name: "减伤", accent: "#5cffd2", detail: `${Math.round(player.damageReduction * 100)}%` });
    if (player.lifesteal > 0) passives.push({ icon: "❤", name: "吸血", accent: "#ff5c8a", detail: `${r1(player.lifesteal)}/击杀` });
    if (player.revives > 0) passives.push({ icon: "☯", name: "复活", accent: "#aaff00", detail: `×${player.revives}` });

    return { weapons, passives };
  }
}
