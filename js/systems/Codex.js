/**
 * Codex.js — 图鉴系统（局外收集元素）。
 *
 * 玩家在对局中「首次遭遇」敌人/Boss/武器/道具即视为发掘, 已发掘的以对应符号 + 主题色展示,
 * 未发掘的以黑色轮廓遮罩显示. 图鉴总数达到收集里程碑时可领取奖励（棱牌/核心/皮肤）,
 * 满收集额外解锁「万象编纂」传说皮肤 + 局内主动技能（归零协议），构成额外的养成闭环.
 *
 * 数据结构（save.codex）：
 *   enemies / bosses / weapons / items —— { [id]: true } 已发掘集合
 *   claimed —— { [milestoneId]: true } 已领取的里程碑奖励
 *
 * 兼容：字段缺失时按空集合处理, 老存档自动升级.
 */
import { CONFIG } from "../config.js";

// ---------------- 条目定义 ----------------
// 条目从 CONFIG 里派生, 保持单一数据源；额外补充图鉴专属的图标 / 描述。
const _enemyList = () => Object.entries(CONFIG.enemies)
  .filter(([, def]) => !def.boss)
  .map(([id, def]) => ({ id, name: def.name, color: def.color, symbol: symbolOfEnemy(id) }));

const _bossList = () => Object.entries(CONFIG.enemies)
  .filter(([, def]) => def.boss)
  .map(([id, def]) => ({ id, name: def.name, color: def.color, symbol: symbolOfBoss(def.kind || 0) }));

const _weaponList = () => Object.entries(CONFIG.weapons)
  .map(([id, def]) => ({ id, name: def.name, color: def.accent, symbol: def.icon }));

const ITEMS = [
  { id: "HEAL",   name: "医疗补给", color: "#aaff00", symbol: "+" },
  { id: "MAGNET", name: "引力磁吸", color: "#ffd23f", symbol: "⬇" },
  { id: "BOMB",   name: "湮灭炸弹", color: "#ff2bd6", symbol: "✸" },
];

/** 敌人图鉴符号（多边形边数暗示造型）：三角/菱/六边/五角 */
function symbolOfEnemy(id) {
  return { chaser: "△", rusher: "◆", tank: "⬡", splitter: "⬠" }[id] || "△";
}
function symbolOfBoss(kind) {
  return ["⯃", "✦", "⬢"][kind] || "⯃";
}

/** 分类元信息（顺序即界面展示顺序） */
export const CATEGORIES = [
  { key: "enemies", title: "敌 · 常见战斗单元", list: _enemyList },
  { key: "bosses",  title: "Boss · 阶段化威胁", list: _bossList },
  { key: "weapons", title: "武器 · 舰载火力",   list: _weaponList },
  { key: "items",   title: "道具 · 战场拾取",   list: () => ITEMS },
];

/**
 * 收集里程碑：按总发掘数触发的阶段性奖励.
 * 奖励种类：shards(棱牌) / cores(核心) / skin(解锁皮肤 id) / active(是否附带主动技能提示).
 */
const MILESTONES = [
  {
    id: "m1", label: "初识", need: 3,
    reward: { shards: 100 },
    desc: "初次接触 3 种目标, 情报库正在启动.",
  },
  {
    id: "m2", label: "见闻录", need: 7,
    reward: { shards: 300 },
    desc: "情报覆盖过半, 编纂协议持续记录.",
  },
  {
    id: "m3", label: "深度勘测", need: 12,
    reward: { cores: 500 },
    desc: "深入战场核心, 收获额外暗物质核心.",
  },
  {
    id: "m4", label: "万象编纂", need: -1, // -1 表示"全收集"，运行时按 totalCount 判定
    reward: { skin: "omniscient", active: true },
    desc: "收录全部目标: 解锁传说皮肤「万象编纂」及其主动技能「归零协议」.",
  },
];

/** 统计图鉴条目总数 */
function totalCount() {
  return CATEGORIES.reduce((s, c) => s + c.list().length, 0);
}

export class Codex {
  static categories() { return CATEGORIES; }
  static milestones() { return MILESTONES; }
  static totalCount() { return totalCount(); }

  /** 保证 save.codex 结构完整（老存档兼容, 由 SaveData.load 与本方法双保险）*/
  static _ensure(save) {
    if (!save.codex || typeof save.codex !== "object") save.codex = {};
    for (const cat of ["enemies", "bosses", "weapons", "items", "claimed"]) {
      if (!save.codex[cat] || typeof save.codex[cat] !== "object") save.codex[cat] = {};
    }
    return save.codex;
  }

  static discovered(save, cat, id) {
    return !!(save.codex && save.codex[cat] && save.codex[cat][id]);
  }

  /**
   * 记录一次发现. 返回是否为「首次发现」（用于弹提示 / 触发音效）.
   * 内部会校验 id 是否属于当前分类的有效条目, 避免拼错 id 污染存档.
   */
  static discover(save, cat, id) {
    if (!id) return false;
    const list = CATEGORIES.find((c) => c.key === cat);
    if (!list) return false;
    const entry = list.list().find((e) => e.id === id);
    if (!entry) return false;
    Codex._ensure(save);
    if (save.codex[cat][id]) return false;
    save.codex[cat][id] = true;
    return true;
  }

  /** 计算当前收集进度 { owned, total, byCategory: {cat: {owned,total}} } */
  static progress(save) {
    Codex._ensure(save);
    let owned = 0;
    let total = 0;
    const byCategory = {};
    for (const c of CATEGORIES) {
      const items = c.list();
      let o = 0;
      for (const e of items) if (save.codex[c.key][e.id]) o++;
      byCategory[c.key] = { owned: o, total: items.length };
      owned += o; total += items.length;
    }
    return { owned, total, byCategory };
  }

  /** 里程碑实际所需数量（-1 特殊值代表全收集） */
  static needOf(m) {
    return m.need > 0 ? m.need : totalCount();
  }

  static claimed(save, id) {
    Codex._ensure(save);
    return !!save.codex.claimed[id];
  }

  static reached(save, m) {
    return Codex.progress(save).owned >= Codex.needOf(m);
  }

  /**
   * 领取里程碑奖励. 返回奖励详情或 null（未达成 / 已领取 / 无效 id）.
   * 皮肤类奖励通过写入 save.skins.owned 完成解锁, 保持与机库一致.
   */
  static claim(save, id) {
    const m = MILESTONES.find((x) => x.id === id);
    if (!m) return null;
    if (!Codex.reached(save, m)) return null;
    if (Codex.claimed(save, id)) return null;
    Codex._ensure(save);
    save.codex.claimed[id] = true;

    const r = m.reward || {};
    if (r.shards) {
      if (!save.skins || typeof save.skins !== "object") save.skins = { shards: 0, owned: {}, selected: "drift", lastFreeDraw: "" };
      save.skins.shards = (save.skins.shards || 0) + r.shards;
    }
    if (r.cores) save.cores = (save.cores || 0) + r.cores;
    if (r.skin) {
      if (!save.skins.owned) save.skins.owned = {};
      // 图鉴解锁皮肤默认 1 星（与首抽一致, 后续在机库继续升星）
      if (!save.skins.owned[r.skin]) save.skins.owned[r.skin] = 1;
    }
    return { id, label: m.label, need: Codex.needOf(m), reward: { ...r } };
  }
}
