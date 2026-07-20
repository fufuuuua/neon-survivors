/**
 * Campaign.js — 闯关模式的数据源与进度逻辑（单一数据源）。
 *
 * 设计：
 *  - 关卡按「章节」组织, 每章 10 关(1..9 常规通道关, 第 10 关为 Boss 关)。
 *  - 关卡编码为 "章-关"(如 "1-1"), 每关最高 3 星。
 *  - 解锁规则:
 *      · 章节: 第 1 章默认解锁; 后续章节需上一章累计星数达到 reqStars。
 *      · 关卡: 所属章节需已解锁; 每章第 1 关默认可玩, 其余关需上一关已通关。
 *  - 进度存于 save.campaign.levels[关卡id] = 星数(0..3), 键存在即代表已通关。
 *
 * 玩法 type:
 *  - "path"  路线走廊: 从下方出发抵达上方终点, 沿途收集星星, 有时间限制。
 *              可选 widths(每段独立半宽), spawn({interval, batch}) 覆盖生成节奏,
 *              enemyTiers(每关允许敌种池, 覆盖默认按时间解锁), speedMul/hpMul(缩放)。
 *              可选 finale(终章 Boss 战): 抵达路径终点后不通关, 切入圆形竞技场依次挑战 Boss。
 *
 * 坐标系: 关卡在 3200×3200 的世界空间内布局。y 大在下, 起点 y ≈ 2980, 终点 y 小。
 *
 * 星星坐标: 用 pathPoint(path, t) 沿路径按累积长度比例(0..1)插值,
 *           保证星星**永远落在通道中心线上**, 无论通道多窄多弯都不会飞到路径外.
 */

// 世界尺寸(与 config.world 保持一致)
const W = 3200;

/**
 * 沿折线 path 按累积长度比例 t(0..1) 取一个点.
 * 用作 star 布置: 天然在路径中心线上, 无论通道形态都在合法可行走区域内.
 */
function pathPoint(path, t) {
  const clamped = Math.max(0, Math.min(1, t));
  // 累积段长
  const lens = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const dx = path[i + 1].x - path[i].x;
    const dy = path[i + 1].y - path[i].y;
    const l = Math.hypot(dx, dy);
    lens.push(l);
    total += l;
  }
  let target = clamped * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const k = lens[i] > 0 ? target / lens[i] : 0;
      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * k,
        y: path[i].y + (path[i + 1].y - path[i].y) * k,
      };
    }
    target -= lens[i];
  }
  return { ...path[path.length - 1] };
}

/** 三颗星: 均匀分布在路径 1/4, 1/2, 3/4 处 */
function trisect(path) {
  return [pathPoint(path, 0.25), pathPoint(path, 0.5), pathPoint(path, 0.75)];
}

/** 路线关卡工厂 */
function pathLevel(id, name, opts) {
  const path = opts.path;
  return {
    id, name, type: "path",
    radius: opts.radius,
    widths: opts.widths,
    timeLimit: opts.timeLimit,
    path,
    // stars 未显式传入时, 自动均分在路径上, 保证一定在通道内
    stars: opts.stars || trisect(path),
    spawn: opts.spawn,
    enemyTiers: opts.enemyTiers,
    speedMul: opts.speedMul || 1,
    hpMul: opts.hpMul || 1,
    finale: opts.finale,
  };
}

/**
 * 第一章 10 关设计: 每关一个独特形状(直线 / 弧 / 波 / U / 锯齿 / 十字 / 螺旋 / 极窄折线),
 * 难度从 chaser 单敌种 + 慢速渐进到四敌种 + 2.3× 速度 + 1.35× 血, 最后 Boss 关.
 * 起点固定 (1600, 2980), 常规关终点 (1600, 240); 1-10 通道终点在竞技场入口 (1600, 1180).
 */
const CHAPTERS = [
  {
    id: 1,
    name: "起源回廊",
    sub: "ORIGIN CORRIDOR",
    intro: "沿着霓虹通道向上突进, 抵达顶端信标, 沿途拾取能量星。第 10 关是 Boss 终章。",
    reqStars: 0,
    theme: { wall: "#00f0ff", floor: "rgba(0,54,74,0.42)", glow: "#00f0ff", grid: "rgba(0,240,255,0.06)" },
    levels: [
      // ============ 1-1 「起航」直上通道 ============
      // 形状: 纯垂直中轴. 教学关, 只熟悉移动/射击.
      pathLevel("1-1", "起航", {
        radius: 160, timeLimit: 34,
        path: [
          { x: 1600, y: 2980 }, { x: 1600, y: 2200 },
          { x: 1600, y: 1400 }, { x: 1600, y: 700 },
          { x: 1600, y: 240 },
        ],
        spawn: { interval: 2.2, batch: 1 },
        enemyTiers: ["chaser"],
        speedMul: 1.4,
      }),

      // ============ 1-2 「弯月」右侧大弧 ============
      // 形状: 单侧向右鼓出的大 C 形. 首次引入 rusher.
      pathLevel("1-2", "弯月", {
        radius: 140, timeLimit: 32,
        path: [
          { x: 1600, y: 2980 }, { x: 2300, y: 2600 },
          { x: 2500, y: 1900 }, { x: 2400, y: 1200 },
          { x: 1900, y: 700 },  { x: 1600, y: 240 },
        ],
        spawn: { interval: 1.8, batch: 2 },
        enemyTiers: ["chaser", "rusher"],
        speedMul: 1.5,
      }),

      // ============ 1-3 「波纹」正弦波浪 ============
      // 形状: 左右等幅波浪, 连续但不急. 引入 splitter.
      pathLevel("1-3", "波纹", {
        radius: 128, timeLimit: 32,
        path: [
          { x: 1600, y: 2980 }, { x: 1050, y: 2600 },
          { x: 2150, y: 2200 }, { x: 1050, y: 1800 },
          { x: 2150, y: 1400 }, { x: 1050, y: 1000 },
          { x: 1600, y: 500 },  { x: 1600, y: 240 },
        ],
        spawn: { interval: 1.5, batch: 2 },
        enemyTiers: ["chaser", "rusher", "splitter"],
        speedMul: 1.6,
      }),

      // ============ 1-4 「回廊」U 型转弯 ============
      // 形状: 先右探顶再横穿到左再上. 有大幅度转向, 拐点密.
      pathLevel("1-4", "回廊", {
        radius: 125, timeLimit: 36,
        path: [
          { x: 1600, y: 2980 }, { x: 2500, y: 2500 },
          { x: 2500, y: 1700 }, { x: 600,  y: 1700 },
          { x: 600,  y: 900 },  { x: 1600, y: 240 },
        ],
        spawn: { interval: 1.4, batch: 2 },
        enemyTiers: ["chaser", "rusher", "splitter", "tank"],
        speedMul: 1.7,
        hpMul: 1.1,
      }),

      // ============ 1-5 「锐角」直角折线 ============
      // 形状: 90 度硬转折, 类似方波. 需要在拐点急停调向.
      pathLevel("1-5", "锐角", {
        radius: 115, timeLimit: 36,
        path: [
          { x: 1600, y: 2980 }, { x: 1600, y: 2700 },
          { x: 2400, y: 2700 }, { x: 2400, y: 2100 },
          { x: 800,  y: 2100 }, { x: 800,  y: 1500 },
          { x: 2400, y: 1500 }, { x: 2400, y: 900 },
          { x: 1600, y: 900 },  { x: 1600, y: 240 },
        ],
        spawn: { interval: 1.2, batch: 2 },
        enemyTiers: ["chaser", "rusher", "splitter"],
        speedMul: 1.8,
        hpMul: 1.15,
      }),

      // ============ 1-6 「洪流」宽窄反差 ============
      // 形状: 波浪但宽窄剧烈交替(150 ↔ 90), 宽段清怪, 窄段专注走位.
      pathLevel("1-6", "洪流", {
        radius: 110, timeLimit: 34,
        path: [
          { x: 1600, y: 2980 }, { x: 2100, y: 2600 },
          { x: 1100, y: 2200 }, { x: 2100, y: 1800 },
          { x: 1100, y: 1400 }, { x: 2100, y: 1000 },
          { x: 1600, y: 500 },  { x: 1600, y: 240 },
        ],
        widths: [155, 88, 155, 88, 155, 88, 155],
        spawn: { interval: 1.05, batch: 3 },
        enemyTiers: ["rusher", "tank", "splitter"],
        speedMul: 1.9,
        hpMul: 1.2,
      }),

      // ============ 1-7 「针尖」极窄之字 ============
      // 形状: 密集左右抖动, 窄通道 78, 敌人速度 2.0×. 走位极限.
      pathLevel("1-7", "针尖", {
        radius: 78, timeLimit: 32,
        path: [
          { x: 1600, y: 2980 }, { x: 1350, y: 2700 },
          { x: 1850, y: 2400 }, { x: 1350, y: 2100 },
          { x: 1850, y: 1800 }, { x: 1350, y: 1500 },
          { x: 1850, y: 1200 }, { x: 1350, y: 900 },
          { x: 1850, y: 600 },  { x: 1600, y: 240 },
        ],
        spawn: { interval: 1.05, batch: 2 },
        enemyTiers: ["chaser", "rusher"],
        speedMul: 2.0,
        hpMul: 1.2,
      }),

      // ============ 1-8 「潮汐」十字大幅 ============
      // 形状: 大幅横穿 + 大幅纵进. 拐点少但每段特别长, 沿途持续压力.
      pathLevel("1-8", "潮汐", {
        radius: 108, timeLimit: 40,
        path: [
          { x: 1600, y: 2980 }, { x: 1600, y: 2500 },
          { x: 500,  y: 2500 }, { x: 500,  y: 1700 },
          { x: 2700, y: 1700 }, { x: 2700, y: 900 },
          { x: 1600, y: 900 },  { x: 1600, y: 240 },
        ],
        spawn: { interval: 0.95, batch: 3 },
        enemyTiers: ["chaser", "rusher", "splitter", "tank"],
        speedMul: 2.1,
        hpMul: 1.25,
      }),

      // ============ 1-9 「织网」折返螺旋 ============
      // 形状: 大幅左右折返(近全屏), 有变宽. 综合考验.
      pathLevel("1-9", "织网", {
        radius: 100, timeLimit: 42,
        path: [
          { x: 1600, y: 2980 }, { x: 2500, y: 2650 },
          { x: 500,  y: 2450 }, { x: 500,  y: 1900 },
          { x: 2500, y: 1750 }, { x: 2500, y: 1250 },
          { x: 500,  y: 1100 }, { x: 500,  y: 700 },
          { x: 1600, y: 240 },
        ],
        widths: [115, 92, 115, 92, 115, 92, 115, 92],
        spawn: { interval: 0.85, batch: 3 },
        enemyTiers: ["chaser", "rusher", "splitter", "tank"],
        speedMul: 2.2,
        hpMul: 1.3,
      }),

      // ============ 1-10 「母核降临」极限窄折线 + 终章 Boss ============
      // 形状 1: 前段极限窄之字通道抵达世界中部;
      // 形状 2: 抵达通道终点 (1600, 1180) 后触发 finale: 圆形竞技场三 Boss 战.
      // 通关条件: 击败全部 Boss(3 星); 通道段拿到的星数作为失败保底.
      pathLevel("1-10", "母核降临", {
        radius: 88, timeLimit: 100,
        path: [
          { x: 1600, y: 2980 }, { x: 2400, y: 2700 },
          { x: 1200, y: 2450 }, { x: 2400, y: 2200 },
          { x: 1200, y: 1950 }, { x: 2400, y: 1700 },
          { x: 1200, y: 1450 }, { x: 1600, y: 1180 },
        ],
        widths: [95, 82, 92, 78, 92, 78, 90],
        spawn: { interval: 0.85, batch: 3 },
        enemyTiers: ["rusher", "splitter", "tank"],
        speedMul: 2.3,
        hpMul: 1.35,
        finale: {
          arena: { x: 1600, y: 900, r: 620 },
          bosses: ["boss_nucleus", "boss_flux", "boss_void"],
          interval: 2.5,
          hpMul: 1.0,
          spawn: { interval: 3.0, batch: 1, tiers: ["chaser", "rusher"] },
        },
      }),
    ],
  },
  {
    id: 2,
    name: "熔核裂隙",
    sub: "MOLTEN RIFT",
    intro: "灼热熔核深处的试炼, 全新玩法正在锻造中。集齐前一章的星星以点亮此处。",
    reqStars: 20, // 需第一章累计 20 星
    theme: { wall: "#ff7a3d", floor: "rgba(70,24,10,0.42)", glow: "#ff7a3d", grid: "rgba(255,122,61,0.06)" },
    levels: [
      { id: "2-1",  name: "敬请期待", type: "coming" },
      { id: "2-2",  name: "敬请期待", type: "coming" },
      { id: "2-3",  name: "敬请期待", type: "coming" },
      { id: "2-4",  name: "敬请期待", type: "coming" },
      { id: "2-5",  name: "敬请期待", type: "coming" },
      { id: "2-6",  name: "敬请期待", type: "coming" },
      { id: "2-7",  name: "敬请期待", type: "coming" },
      { id: "2-8",  name: "敬请期待", type: "coming" },
      { id: "2-9",  name: "敬请期待", type: "coming" },
      { id: "2-10", name: "敬请期待", type: "coming" },
    ],
  },
];

export const Campaign = {
  WORLD: W,

  chapters() { return CHAPTERS; },
  chapter(ci) { return CHAPTERS[ci] || null; },
  level(ci, li) {
    const c = CHAPTERS[ci];
    return c && c.levels[li] ? c.levels[li] : null;
  },

  isComing(level) { return !level || level.type === "coming"; },
  isBoss(level) { return !!(level && level.finale); },

  stars(save, id) {
    const v = save.campaign && save.campaign.levels ? save.campaign.levels[id] : undefined;
    return typeof v === "number" ? Math.max(0, Math.min(3, v)) : -1;
  },
  isCleared(save, id) { return this.stars(save, id) >= 0; },

  record(save, id, stars) {
    if (!save.campaign) save.campaign = { levels: {} };
    if (!save.campaign.levels) save.campaign.levels = {};
    const s = Math.max(0, Math.min(3, Math.floor(stars || 0)));
    const prev = save.campaign.levels[id];
    const best = typeof prev === "number" ? Math.max(prev, s) : s;
    const improved = typeof prev !== "number" || s > prev;
    save.campaign.levels[id] = best;
    return improved;
  },

  chapterStars(save, ci) {
    const c = CHAPTERS[ci];
    if (!c) return 0;
    let sum = 0;
    for (const lv of c.levels) {
      if (this.isComing(lv)) continue;
      sum += Math.max(0, this.stars(save, lv.id));
    }
    return sum;
  },

  chapterMaxStars(ci) {
    const c = CHAPTERS[ci];
    if (!c) return 0;
    return c.levels.filter((lv) => !this.isComing(lv)).length * 3;
  },

  totalStars(save) {
    let sum = 0;
    for (let i = 0; i < CHAPTERS.length; i++) sum += this.chapterStars(save, i);
    return sum;
  },

  chapterUnlocked(save, ci) {
    if (ci <= 0) return true;
    const c = CHAPTERS[ci];
    if (!c) return false;
    return this.chapterStars(save, ci - 1) >= (c.reqStars || 0);
  },

  levelUnlocked(save, ci, li) {
    if (!this.chapterUnlocked(save, ci)) return false;
    const c = CHAPTERS[ci];
    if (!c || !c.levels[li]) return false;
    if (this.isComing(c.levels[li])) return false;
    if (li === 0) return true;
    const prev = c.levels[li - 1];
    return prev ? this.isCleared(save, prev.id) : false;
  },
};
