/**
 * MetaProgression.js — 局外永久成长系统（roguelite 留存核心）。
 *
 * 玩家每局结束依据表现获得「暗物质核心 ◆」，可在强化实验室购买**跨局永久加成**。
 * 这使得每局不再孤立：失败也在变强，形成“再来一局”的长期驱动。
 *
 * 平衡设计（本次重构）：
 *  - 项目更多、等级更高、花费曲线更陡：全部买满需数千核心，远超单局产出，
 *    因此**不可能一局就买满全部加点**，长期养成有充足空间。
 *  - reward() 采用更克制的系数，单局收益占总目标很小的比例，鼓励反复挑战。
 *  - applyTo() 在开局把已购加成注入玩家初始属性 / 能力。
 */

const META = [
  {
    id: "hp", icon: "♥", name: "强化装甲", accent: "#ff5c8a", max: 8,
    baseCost: 10, costGrow: 1.55,
    effect: "起始最大生命 +18 / 级",
  },
  {
    id: "dmg", icon: "⚡", name: "武器校准", accent: "#ffd23f", max: 8,
    baseCost: 14, costGrow: 1.55,
    effect: "全武器伤害 +7% / 级",
  },
  {
    id: "spd", icon: "➤", name: "引擎调校", accent: "#00f0ff", max: 6,
    baseCost: 10, costGrow: 1.5,
    effect: "移动速度 +4% / 级",
  },
  {
    id: "regen", icon: "✚", name: "纳米基质", accent: "#aaff00", max: 6,
    baseCost: 12, costGrow: 1.5,
    effect: "每秒回复 +0.4 / 级",
  },
  {
    id: "magnet", icon: "⬇", name: "引力核心", accent: "#8a5bff", max: 5,
    baseCost: 8, costGrow: 1.5,
    effect: "经验拾取范围 +15% / 级",
  },
  {
    id: "crit", icon: "✧", name: "暴击矩阵", accent: "#ff8a3d", max: 6,
    baseCost: 15, costGrow: 1.55,
    effect: "暴击率 +5% / 级（暴击造成 2 倍伤害）",
  },
  {
    id: "haste", icon: "⟳", name: "时序压缩", accent: "#00f0ff", max: 5,
    baseCost: 16, costGrow: 1.6,
    effect: "武器攻速 +4% / 级",
  },
  {
    id: "armor", icon: "◈", name: "相位护盾", accent: "#5cffd2", max: 5,
    baseCost: 18, costGrow: 1.6,
    effect: "受到伤害 -6% / 级",
  },
  {
    id: "xp", icon: "◇", name: "学习协议", accent: "#8a5bff", max: 5,
    baseCost: 14, costGrow: 1.5,
    effect: "经验获取 +8% / 级",
  },
  {
    id: "preload", icon: "★", name: "战术预载", accent: "#ffd23f", max: 3,
    baseCost: 30, costGrow: 1.9,
    effect: "开局额外获得 1 次强化选择 / 级",
  },
  {
    id: "revive", icon: "☯", name: "应急重构", accent: "#aaff00", max: 2,
    baseCost: 60, costGrow: 2.2,
    effect: "每局阵亡后原地复活一次 / 级",
  },
  {
    id: "greed", icon: "◆", name: "贪婪协议", accent: "#ff2bd6", max: 6,
    baseCost: 20, costGrow: 1.6,
    effect: "局末获得核心 +10% / 级",
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
    player.maxHp += 18 * L("hp");
    player.hp = player.maxHp;
    player.damageMul *= 1 + 0.07 * L("dmg");
    player.speed *= 1 + 0.04 * L("spd");
    player.regen += 0.4 * L("regen");
    player.pickupRange *= 1 + 0.15 * L("magnet");
    player.critChance += 0.05 * L("crit");
    player.cooldownMul *= Math.pow(0.96, L("haste"));   // 攻速：冷却缩短
    player.damageReduction = Math.min(0.7, player.damageReduction + 0.06 * L("armor"));
    player.xpMul *= 1 + 0.08 * L("xp");
    player.pendingLevels += L("preload");
    player.revives += L("revive");
  }

  /**
   * 计算本局结算获得的核心数（击杀 + 时长 + Boss 加权，再乘贪婪加成）。
   * 系数刻意克制：单局产出仅占“全部买满”目标的很小比例，长期养成才可满级。
   */
  static reward(save, stats) {
    const base = stats.kills * 0.5 + Math.floor(stats.time / 8) + (stats.bossKills || 0) * 12;
    const mult = 1 + 0.1 * MetaProgression.levelOf(save, "greed");
    return Math.max(1, Math.floor(base * mult));
  }
}
