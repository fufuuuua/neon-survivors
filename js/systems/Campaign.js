/**
 * Campaign.js — 闯关模式的数据源与进度逻辑（单一数据源）。
 *
 * 设计：
 *  - 关卡按「章节」组织, 每章有独立主题(配色)与玩法类型(type)。
 *  - 关卡编码为 "章-关"(如 "1-1"), 每关最高 3 星(沿路线可收集的星星数)。
 *  - 解锁规则:
 *      · 章节: 第 1 章默认解锁; 后续章节需上一章累计星数达到 reqStars。
 *      · 关卡: 所属章节需已解锁; 每章第 1 关默认可玩, 其余关需上一关已通关。
 *  - 进度存于 save.campaign.levels[关卡id] = 星数(0..3), 键存在即代表已通关。
 *
 * 目前 type 仅实现 "path"(路线走廊: 从下方出发抵达上方终点, 沿途收集星星, 有时间限制)。
 * 新增玩法只需扩展 type 与对应的关卡引擎分支, 数据在此追加即可。
 *
 * 坐标系: 关卡在 3200×3200 的世界空间内布局(与相机边界一致)。
 *  y 越大越靠下, 起点在下方(大 y), 终点在上方(小 y)。
 */

// 世界尺寸(与 config.world 保持一致, 供关卡布点参考)
const W = 3200;

/** 路线关卡工厂: 给定路点/星星/时间, 补齐默认字段 */
function pathLevel(id, name, { radius, timeLimit, path, stars }) {
  return { id, name, type: "path", radius, timeLimit, path, stars };
}

const CHAPTERS = [
  {
    id: 1,
    name: "起源回廊",
    sub: "ORIGIN CORRIDOR",
    intro: "沿着霓虹通道向上突进, 抵达顶端信标, 沿途拾取能量星。切勿撞出通道之外。",
    reqStars: 0,
    theme: { wall: "#00f0ff", floor: "rgba(0,54,74,0.42)", glow: "#00f0ff", grid: "rgba(0,240,255,0.06)" },
    levels: [
      pathLevel("1-1", "启程信标", {
        radius: 135, timeLimit: 32,
        // 平缓的 S 形通道, 新手友好
        path: [
          { x: 1600, y: 2980 }, { x: 1600, y: 2520 },
          { x: 1230, y: 2120 }, { x: 1230, y: 1680 },
          { x: 1930, y: 1260 }, { x: 1930, y: 840 },
          { x: 1600, y: 480 },  { x: 1600, y: 240 },
        ],
        stars: [
          { x: 1230, y: 2120 }, { x: 1930, y: 1050 }, { x: 1600, y: 420 },
        ],
      }),
      pathLevel("1-2", "曲折脉冲", {
        radius: 112, timeLimit: 30,
        // 更多转折, 通道更窄
        path: [
          { x: 1600, y: 2980 }, { x: 2050, y: 2600 },
          { x: 1150, y: 2260 }, { x: 2000, y: 1900 },
          { x: 1100, y: 1520 }, { x: 1900, y: 1140 },
          { x: 1250, y: 760 },  { x: 1600, y: 240 },
        ],
        stars: [
          { x: 1600, y: 2430 }, { x: 1520, y: 1710 }, { x: 1420, y: 950 },
        ],
      }),
      pathLevel("1-3", "临界穿越", {
        radius: 96, timeLimit: 30,
        // 最窄且转折密集, 收尾关
        path: [
          { x: 1600, y: 2980 }, { x: 1200, y: 2700 }, { x: 2000, y: 2440 },
          { x: 1200, y: 2140 }, { x: 2050, y: 1840 }, { x: 1150, y: 1520 },
          { x: 2000, y: 1180 }, { x: 1250, y: 820 },  { x: 1750, y: 480 },
          { x: 1600, y: 240 },
        ],
        stars: [
          { x: 1600, y: 2570 }, { x: 1600, y: 1680 }, { x: 1500, y: 650 },
        ],
      }),
    ],
  },
  {
    id: 2,
    name: "熔核裂隙",
    sub: "MOLTEN RIFT",
    intro: "灼热熔核深处的试炼, 全新玩法正在锻造中。集齐前一章的星星以点亮此处。",
    reqStars: 6, // 需第一章累计 6 星才能进入
    theme: { wall: "#ff7a3d", floor: "rgba(70,24,10,0.42)", glow: "#ff7a3d", grid: "rgba(255,122,61,0.06)" },
    levels: [
      { id: "2-1", name: "敬请期待", type: "coming" },
      { id: "2-2", name: "敬请期待", type: "coming" },
      { id: "2-3", name: "敬请期待", type: "coming" },
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

  /** 该关卡是否为「敬请期待」占位(不可进入) */
  isComing(level) { return !level || level.type === "coming"; },

  /** 已获得星数: 未通关返回 -1, 已通关返回 0..3 */
  stars(save, id) {
    const v = save.campaign && save.campaign.levels ? save.campaign.levels[id] : undefined;
    return typeof v === "number" ? Math.max(0, Math.min(3, v)) : -1;
  },
  isCleared(save, id) { return this.stars(save, id) >= 0; },

  /** 记录一次通关成绩(取历史最高星数); 返回是否刷新了最高星 */
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

  /** 某章节累计已得星数(仅统计可玩关卡) */
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

  /** 某章节可玩关卡的满星总数 */
  chapterMaxStars(ci) {
    const c = CHAPTERS[ci];
    if (!c) return 0;
    return c.levels.filter((lv) => !this.isComing(lv)).length * 3;
  },

  /** 全部累计已得星数 */
  totalStars(save) {
    let sum = 0;
    for (let i = 0; i < CHAPTERS.length; i++) sum += this.chapterStars(save, i);
    return sum;
  },

  /** 章节是否解锁: 第一章恒解锁, 其余看上一章累计星数是否达标 */
  chapterUnlocked(save, ci) {
    if (ci <= 0) return true;
    const c = CHAPTERS[ci];
    if (!c) return false;
    return this.chapterStars(save, ci - 1) >= (c.reqStars || 0);
  },

  /** 关卡是否解锁: 章节已解锁, 且为该章首关或上一关已通关 */
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
