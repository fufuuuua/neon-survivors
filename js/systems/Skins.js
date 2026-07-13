/**
 * Skins.js — 局外「机库」外观系统（形象 + 抽卡 + 星级成长 + 专属特性）。
 *
 * 设计要点：
 *  - 每个外观有稀有度（普通/稀有/史诗/传说），决定抽卡权重与特性强度。
 *  - 外观具有「星级」（1..MAX_STAR）：重复抽到同一外观会升星，特性随星级增强；
 *    满星后重复抽到则返还棱牌 ✦。
 *  - 每个外观拥有**专属特性**，在开局注入玩家属性（与永久强化叠加）。
 *  - 造型由 drawShip() 按 shape 分支绘制，各具辨识度。
 *  - 抽卡货币「棱牌 ✦」独立于强化用的「暗物质核心 ◆」，避免两套养成互相挤占。
 */
import { TAU } from "../utils/math.js";

export const MAX_STAR = 5;

/** 稀有度定义：抽卡权重、主题色、满星重复返还的棱牌 */
export const RARITY = {
  common:    { key: "common",    name: "普通", color: "#8fa9c8", weight: 56, refund: 25 },
  rare:      { key: "rare",      name: "稀有", color: "#00f0ff", weight: 28, refund: 55 },
  epic:      { key: "epic",      name: "史诗", color: "#b06bff", weight: 12, refund: 120 },
  legendary: { key: "legendary", name: "传说", color: "#ffd23f", weight: 4,  refund: 260 },
};

/** 抽卡定价（棱牌） */
export const GACHA = {
  single: 100,   // 单抽
  ten: 900,      // 十连（打折）
};

/**
 * 外观表。
 * perk(player, star)：把特性注入玩家（star 为当前星级 1..MAX_STAR）。
 * perkText(star)：返回当前星级下的特性描述（用于 UI）。
 */
const SKINS = [
  // ---------------- 普通 ----------------
  {
    id: "drift", name: "漂移者", rarity: "common", shape: "arrow", accent: "#00f0ff",
    desc: "标准量产侦察机，操控均衡，是每位驾驶员的起点。",
    perk: (p, s) => { p.speed *= 1 + 0.02 * s; },
    perkText: (s) => `移动速度 +${2 * s}%`,
  },
  {
    id: "ember", name: "余烬", rarity: "common", shape: "delta", accent: "#ff5c8a",
    desc: "改装尾焰喷口的突进机，火力略有提升。",
    perk: (p, s) => { p.damageMul *= 1 + 0.03 * s; },
    perkText: (s) => `全武器伤害 +${3 * s}%`,
  },
  // ---------------- 稀有 ----------------
  {
    id: "aegis", name: "壁垒", rarity: "rare", shape: "shield", accent: "#5cffd2",
    desc: "重装护盾型机体，正面防护出众。",
    perk: (p, s) => { p.damageReduction = Math.min(0.7, p.damageReduction + 0.03 * s); },
    perkText: (s) => `受到伤害 -${3 * s}%`,
  },
  {
    id: "comet", name: "彗核", rarity: "rare", shape: "wing", accent: "#aaff00",
    desc: "流线双翼高机动机，拾取范围与航速兼优。",
    perk: (p, s) => { p.speed *= 1 + 0.03 * s; p.pickupRange *= 1 + 0.1 * s; },
    perkText: (s) => `移速 +${3 * s}% · 拾取范围 +${10 * s}%`,
  },
  // ---------------- 史诗 ----------------
  {
    id: "phantom", name: "幻影", rarity: "epic", shape: "diamond", accent: "#b06bff",
    desc: "相位隐匿机，瞄准系统经过精密校准。",
    perk: (p, s) => { p.critChance = Math.min(1, p.critChance + 0.05 * s); },
    perkText: (s) => `暴击率 +${5 * s}%`,
  },
  {
    id: "vortex", name: "涡轮", rarity: "epic", shape: "ring", accent: "#00f0ff",
    desc: "环形超频核心，武器循环极速。",
    perk: (p, s) => { p.cooldownMul *= Math.pow(0.96, s); },
    perkText: (s) => `武器攻速 +${Math.round((1 / Math.pow(0.96, s) - 1) * 100)}%`,
  },
  // ---------------- 传说 ----------------
  {
    id: "novalord", name: "新星君主", rarity: "legendary", shape: "star", accent: "#ffd23f",
    desc: "王级战舰，火力与生命俱强，气场压制全场。",
    perk: (p, s) => { p.damageMul *= 1 + 0.06 * s; p.maxHp += 12 * s; p.hp = p.maxHp; },
    perkText: (s) => `全伤害 +${6 * s}% · 起始生命 +${12 * s}`,
  },
  {
    id: "singularity", name: "奇点", rarity: "legendary", shape: "void", accent: "#ff2bd6",
    desc: "吞噬一切的黑洞引擎：暴击、攻速与噬血于一身。",
    perk: (p, s) => {
      p.critChance = Math.min(1, p.critChance + 0.04 * s);
      p.cooldownMul *= Math.pow(0.97, s);
      p.lifesteal += 0.6 * s;
    },
    perkText: (s) => `暴击 +${4 * s}% · 攻速 +${Math.round((1 / Math.pow(0.97, s) - 1) * 100)}% · 击杀吸血 +${(0.6 * s).toFixed(1)}`,
  },
  // ---------------- 图鉴解锁（不参与抽卡池, 仅通过 100% 图鉴收集获得） ----------------
  {
    id: "omniscient", name: "万象编纂", rarity: "legendary", shape: "codex", accent: "#7df9ff",
    desc: "由所有战场情报编织而成的智能核心, 携带主动技能「归零协议」.",
    hidden: true, // 不参与抽卡权重
    perk: (p, s) => {
      // 全面但克制的加成; 主打的是主动技能, 而非常规数值.
      p.damageMul *= 1 + 0.03 * s;
      p.critChance = Math.min(1, p.critChance + 0.02 * s);
      // 装备该皮肤即获得主动技能: 空格释放, 会经玩家的 cooldownMul 缩短冷却.
      p.activeSkill = {
        id: "zeroProtocol",
        name: "归零协议",
        icon: "◎",
        cooldown: 30,         // 基础冷却 30s
        maxCooldown: 30,
        timer: 0,             // 就绪
        // 效果: 对屏内敌人造成范围重创, 清屏敌方弹幕, 短暂无敌.
        // (具体实现在 Player.releaseActiveSkill 中调用 game 服务方法, 保持解耦)
      };
    },
    perkText: (s) => `伤害 +${3 * s}% · 暴击 +${2 * s}% · 附带主动技能「归零协议」`,
  },
];

const BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]));

/** 首个默认拥有的外观 id */
export const DEFAULT_SKIN = "drift";

export class Skins {
  static list() { return SKINS; }
  static get(id) { return BY_ID[id] || BY_ID[DEFAULT_SKIN]; }
  static rarityOf(id) { return RARITY[Skins.get(id).rarity]; }

  // ---------------- 定价与产出 ----------------
  static priceSingle() { return GACHA.single; }
  static priceTen() { return GACHA.ten; }

  /**
   * 依据单局战绩产出棱牌 ✦：击杀、Boss、存活时长各有贡献。
   * 与暗物质核心相互独立，鼓励持续挑战以解锁更多外观。
   */
  static reward(stats) {
    const kills = Math.max(0, Math.floor(stats.kills || 0));
    const bossKills = Math.max(0, Math.floor(stats.bossKills || 0));
    const time = Math.max(0, stats.time || 0);
    return Math.floor(kills * 0.5 + bossKills * 40 + time * 0.4);
  }

  /** 拥有的外观 id -> 星级（>=1 表示已拥有） */
  static starOf(save, id) {
    const s = save.skins && save.skins.owned ? save.skins.owned[id] : 0;
    return Math.max(0, Math.min(MAX_STAR, Math.floor(s || 0)));
  }
  static owns(save, id) { return Skins.starOf(save, id) > 0; }

  /** 当前选中的外观（回退到默认） */
  static selected(save) {
    const id = save.skins && save.skins.selected;
    return Skins.owns(save, id) ? id : DEFAULT_SKIN;
  }

  static select(save, id) {
    if (Skins.owns(save, id)) { save.skins.selected = id; return true; }
    return false;
  }

  /** 把当前选中外观的专属特性注入玩家（在 MetaProgression.applyTo 之后调用） */
  static applyTo(player, save) {
    const id = Skins.selected(save);
    const skin = Skins.get(id);
    const star = Math.max(1, Skins.starOf(save, id));
    player.skin = { id: skin.id, shape: skin.shape, accent: skin.accent, star };
    if (skin.perk) skin.perk(player, star);
  }

  // ---------------- 抽卡 ----------------
  /** 本地日期字符串 YYYY-MM-DD（用于每日免费抽卡的判定，按玩家本地时区） */
  static _today() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  /** 今天是否还能领取每日免费抽卡 */
  static canFreeDraw(save) {
    return (save.skins && save.skins.lastFreeDraw) !== Skins._today();
  }

  /**
   * 领取每日免费抽卡：与付费抽卡等价，但不消耗棱牌，每天一次。
   * 返回抽卡结果对象，若今日已领取则返回 null。
   */
  static freeDraw(save) {
    if (!Skins.canFreeDraw(save)) return null;
    save.skins.lastFreeDraw = Skins._today();
    return Skins.drawOne(save);
  }

  /** 按稀有度权重随机抽取一个外观（跳过隐藏皮肤: 仅通过图鉴等特殊途径获取） */
  static _rollSkin() {
    const total = Object.values(RARITY).reduce((a, r) => a + r.weight, 0);
    let r = Math.random() * total;
    let picked = "common";
    for (const rar of Object.values(RARITY)) {
      if (r < rar.weight) { picked = rar.key; break; }
      r -= rar.weight;
    }
    const pool = SKINS.filter((s) => s.rarity === picked && !s.hidden);
    // 该稀有度全部为隐藏皮肤时兜底到普通池, 保证抽卡不会返回 undefined
    const safePool = pool.length ? pool : SKINS.filter((s) => s.rarity === "common" && !s.hidden);
    return safePool[Math.floor(Math.random() * safePool.length)];
  }

  /**
   * 抽一次卡（调用方需先校验并扣除棱牌）。
   * 返回 { skin, star, isNew, upgraded, refund }。
   * - 新外观：加入并置 1 星。
   * - 已有未满星：升 1 星。
   * - 已满星：返还对应稀有度棱牌。
   */
  static drawOne(save) {
    const skin = Skins._rollSkin();
    const prev = Skins.starOf(save, skin.id);
    let isNew = false, upgraded = false, refund = 0;
    if (prev <= 0) { isNew = true; save.skins.owned[skin.id] = 1; }
    else if (prev < MAX_STAR) { upgraded = true; save.skins.owned[skin.id] = prev + 1; }
    else { refund = RARITY[skin.rarity].refund; save.skins.shards += refund; }
    return { skin, star: Skins.starOf(save, skin.id), isNew, upgraded, refund };
  }

  // ---------------- 渲染 ----------------
  /**
   * 绘制机体（以原点为中心、朝上 -y）。调用方负责 translate/rotate。
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} shape 造型标识
   * @param {number} r     半径
   * @param {string} color 主色（无敌闪烁时可传入白色）
   */
  static drawShip(ctx, shape, r, color) {
    ctx.shadowBlur = 18;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    switch (shape) {
      case "delta": { // 后掠双翼突进机
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.15);
        ctx.lineTo(r * 1.02, r * 0.95);
        ctx.lineTo(r * 0.34, r * 0.5);
        ctx.lineTo(0, r * 0.85);
        ctx.lineTo(-r * 0.34, r * 0.5);
        ctx.lineTo(-r * 1.02, r * 0.95);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "shield": { // 六边盾形重装
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + i * (TAU / 6);
          const px = Math.cos(a) * r, py = Math.sin(a) * r;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        // 内圈盾纹
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case "wing": { // 流线双翼
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.1);
        ctx.quadraticCurveTo(r * 1.2, 0, r * 0.5, r);
        ctx.quadraticCurveTo(0, r * 0.55, -r * 0.5, r);
        ctx.quadraticCurveTo(-r * 1.2, 0, 0, -r * 1.1);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "diamond": { // 相位菱形
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.1);
        ctx.lineTo(r * 0.72, 0);
        ctx.lineTo(0, r * 1.1);
        ctx.lineTo(-r * 0.72, 0);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.55); ctx.lineTo(r * 0.36, 0);
        ctx.lineTo(0, r * 0.55); ctx.lineTo(-r * 0.36, 0);
        ctx.closePath(); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
      case "ring": { // 超频环核
        ctx.lineWidth = r * 0.34;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, TAU); ctx.stroke();
        ctx.lineWidth = 2;
        // 前向指示尖
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.15);
        ctx.lineTo(r * 0.28, -r * 0.6);
        ctx.lineTo(-r * 0.28, -r * 0.6);
        ctx.closePath(); ctx.fill();
        break;
      }
      case "star": { // 王级多角星
        const spikes = 5;
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
          const rad = i % 2 === 0 ? r * 1.2 : r * 0.5;
          const a = -Math.PI / 2 + i * (Math.PI / spikes);
          const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "void": { // 奇点双环
        ctx.lineWidth = r * 0.22;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.95, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.arc(0, -r * 0.15, r * 0.55, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        // 黑洞核心
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#05060e";
        ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, TAU); ctx.fill();
        return; // 已绘制核心，直接返回
      }
      case "codex": { // 万象编纂: 三层同心多边形 + 十字光轴, 象征"编纂/汇总"
        // 外层六边框
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + i * (TAU / 6);
          const px = Math.cos(a) * r * 1.05, py = Math.sin(a) * r * 1.05;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.stroke();
        // 中层四芒
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.85); ctx.lineTo(r * 0.42, 0);
        ctx.lineTo(0, r * 0.85); ctx.lineTo(-r * 0.42, 0);
        ctx.closePath();
        ctx.globalAlpha = 0.35; ctx.fill();
        ctx.globalAlpha = 1; ctx.stroke();
        // 十字光轴
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.05); ctx.lineTo(0, r * 1.05);
        ctx.moveTo(-r * 1.05, 0); ctx.lineTo(r * 1.05, 0);
        ctx.stroke();
        // 中心亮点
        ctx.shadowBlur = 14; ctx.shadowColor = color;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, TAU); ctx.fill();
        break;
      }
      case "arrow":
      default: { // 经典侦察三角
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.8, r);
        ctx.lineTo(0, r * 0.5);
        ctx.lineTo(-r * 0.8, r);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }

    // 通用中心舱
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#05060e";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.28, 0, TAU); ctx.fill();
    // 玩家专属：白热能量核心（区别于敌人的暗核/同色核，强化“这是玩家”辨识）
    ctx.fillStyle = "#ffffff";
    ctx.shadowBlur = 8; ctx.shadowColor = color;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.14, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
  }
}
