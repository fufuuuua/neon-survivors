/**
 * config.js — 全局游戏配置（单一数据源 / Single Source of Truth）
 * 所有可调数值集中于此，便于平衡性调整与维护。
 */
export const CONFIG = Object.freeze({
  world: {
    width: 3200,        // 世界尺寸（远大于屏幕，可滚动）
    height: 3200,
    gridSize: 80,       // 背景网格单元
  },

  player: {
    radius: 16,
    baseSpeed: 230,     // 像素/秒
    maxHp: 100,
    pickupRange: 90,    // 经验拾取磁吸半径
    invulnTime: 0.6,    // 受伤后无敌时间
    baseRegen: 0,       // 每秒回血
  },

  // 武器初始数值，可通过升级强化
  weapons: {
    blaster: {           // 主武器：自动瞄准最近敌人
      name: "脉冲枪",
      icon: "✦",
      accent: "#00f0ff",
      damage: 18,
      fireRate: 2.2,     // 次/秒
      projectileSpeed: 620,
      pierce: 0,
      count: 1,
    },
    orbit: {             // 环绕光球
      name: "轨道核",
      icon: "◓",
      accent: "#8a5bff",
      damage: 14,
      count: 0,           // 初始未解锁
      radius: 95,
      rotSpeed: 2.6,
    },
    aura: {              // 灼烧光环（范围持续伤害）
      name: "灼蚀场",
      icon: "❂",
      accent: "#aaff00",
      damage: 10,          // 每秒
      radius: 0,           // 初始未解锁
      tick: 0.25,
    },
    nova: {              // 新星：周期性环形爆发弹幕
      name: "超新星",
      icon: "✸",
      accent: "#ff2bd6",
      damage: 22,
      cooldown: 0,         // 0 = 未解锁
      bullets: 12,
      projectileSpeed: 380,
    },
    chain: {             // 电弧链：周期性电弧，在最近敌人间跳跃
      name: "电弧链",
      icon: "⚡",
      accent: "#7df9ff",
      damage: 16,
      cooldown: 0,         // 0 = 未解锁
      chains: 0,           // 跳跃目标数
      range: 230,          // 单次跳跃最大距离
    },
  },

  enemies: {
    chaser:  { name: "游荡者", hp: 30,  speed: 78,  radius: 14, damage: 8,  xp: 1,  color: "#ff5c8a" },
    rusher:  { name: "突袭体", hp: 18,  speed: 165, radius: 11, damage: 10, xp: 2,  color: "#ffd23f" },
    tank:    { name: "壁垒",   hp: 130, speed: 46,  radius: 24, damage: 16, xp: 4,  color: "#5cffd2" },
    splitter:{ name: "裂解体", hp: 50,  speed: 70,  radius: 18, damage: 9,  xp: 3,  color: "#b06bff" },
    // ---- Boss 三阶段变体：造型 / 攻击模式 / 节奏各异，轮换降临，每轮血量递增 ----
    boss_nucleus: { name: "母核",   hp: 1800, speed: 38, radius: 50, damage: 26, xp: 55,  color: "#ff2bd6", boss: true, kind: 0 },
    boss_flux:    { name: "裂能体", hp: 2500, speed: 56, radius: 44, damage: 30, xp: 78,  color: "#00f0ff", boss: true, kind: 1 },
    boss_void:    { name: "湮灭者", hp: 3800, speed: 30, radius: 60, damage: 36, xp: 110, color: "#ffd23f", boss: true, kind: 2 },
  },

  // Boss 轮换顺序（对应上面的三种变体）
  bossOrder: ["boss_nucleus", "boss_flux", "boss_void"],

  spawn: {
    interval: 1.15,      // 初始生成间隔（秒）
    minInterval: 0.28,
    batch: 2,            // 每次生成数量
    rampEvery: 18,       // 每多少秒提升难度
    bossEvery: 120,      // 每多少秒出现 Boss
    spawnPad: 80,        // 屏幕外生成边距
  },

  progression: {
    baseXp: 9,           // 升到 2 级所需经验（提高前期门槛，让升级更有分量）
    xpGrowth: 1.34,      // 每级经验增长系数
  },

  fx: {
    shakeDecay: 5.5,
    maxParticles: 600,
  },
});

/** 游戏运行状态枚举 */
export const GameState = Object.freeze({
  MENU: "MENU",
  SHOP: "SHOP",
  PLAYING: "PLAYING",
  LEVELUP: "LEVELUP",
  PAUSED: "PAUSED",
  GAMEOVER: "GAMEOVER",
});
