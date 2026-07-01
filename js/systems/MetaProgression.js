/**
 * MetaProgression.js — 局外永久成长系统（roguelite 留存核心）。
 *
 * 玩家每局结束依据表现获得「暗物质核心 ◆」，可在强化实验室购买**跨局永久加成**。
 * 这使得每局不再孤立：失败也在变强，形成“再来一局”的长期驱动。
 *
 * 设计：
 *  - 永久升级有等级上限与递增花费曲线。
 *  - applyTo() 在开局把已购加成注入玩家初始属性。
 *  - reward() 计算本局结算获得的核心数量（受“贪婪”项加成）。
 */

const META = [
  {
    id: "hp", icon: "♥", name: "强化装甲", accent: "#ff5c8a", max: 5,
    baseCost: 6, costGrow: 1.7,
    effect: "起始最大生命 +20 / 级",
  },
  {
    id: "dmg", icon: "⚡", name: "武器校准", accent: "#ffd23f", max: 5,
    baseCost: 8, costGrow: 1.8,
    effect: "全武器伤害 +8% / 级",
  },
  {
    id: "spd", icon: "➤", name: "引擎调校", accent: "#00f0ff", max: 4,
    baseCost: 6, costGrow: 1.7,
    effect: "移动速度 +5% / 级",
  },
  {
    id: "regen", icon: "✚", name: "纳米基质", accent: "#aaff00", max: 4,
    baseCost: 10, costGrow: 1.8,
    effect: "每秒回复 +0.5 / 级",
  },
  {
    id: "magnet", icon: "⬇", name: "引力核心", accent: "#8a5bff", max: 4,
    baseCost: 5, costGrow: 1.6,
    effect: "经验拾取范围 +18% / 级",
  },
  {
    id: "greed", icon: "◆", name: "贪婪协议", accent: "#ff2bd6", max: 5,
    baseCost: 12, costGrow: 1.9,
    effect: "局末获得核心 +12% / 级",
  },
];

const BY_ID = Object.fromEntries(META.map((m) => [m.id, m]));

export class MetaProgression {
  static list() { return META; }

  static levelOf(save, id) { return Math.max(0, Math.floor(save.upgrades[id] || 0)); }

  /** 升到下一级所需花费；已满级返回 null */
  static costOf(save, id) {
    const m = BY_ID[id];
    const lv = MetaProgression.levelOf(save, id);
    if (lv >= m.max) return null;
    return Math.floor(m.baseCost * Math.pow(m.costGrow, lv));
  }

  static canBuy(save, id) {
    const cost = MetaProgression.costOf(save, id);
    return cost != null && save.cores >= cost;
  }

  /** 购买一级，成功则扣费并返回 true（调用方负责持久化） */
  static buy(save, id) {
    if (!MetaProgression.canBuy(save, id)) return false;
    const cost = MetaProgression.costOf(save, id);
    save.cores -= cost;
    save.upgrades[id] = MetaProgression.levelOf(save, id) + 1;
    return true;
  }

  /** 开局把永久加成注入玩家（在 player.reset() 之后调用） */
  static applyTo(player, save) {
    const L = (id) => MetaProgression.levelOf(save, id);
    player.maxHp += 20 * L("hp");
    player.hp = player.maxHp;
    player.damageMul *= 1 + 0.08 * L("dmg");
    player.speed *= 1 + 0.05 * L("spd");
    player.regen += 0.5 * L("regen");
    player.pickupRange *= 1 + 0.18 * L("magnet");
  }

  /** 计算本局结算获得的核心数（击杀 + 时长 + Boss 加权，再乘贪婪加成） */
  static reward(save, stats) {
    const base = stats.kills * 1 + Math.floor(stats.time / 5) + (stats.bossKills || 0) * 25;
    const mult = 1 + 0.12 * MetaProgression.levelOf(save, "greed");
    return Math.floor(base * mult);
  }
}
