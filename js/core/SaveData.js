/**
 * SaveData.js — 本地存档（localStorage）。
 * 负责元进度数据的持久化：货币、永久升级等级、历史最佳、累计统计。
 *
 * 安全：读取时使用安全的 JSON 解析并与默认结构合并 + 数值校验，
 * 避免被篡改/损坏的存档导致运行异常（不使用 eval / 反序列化任意对象）。
 */
const KEY = "neondrift.save.v1";

function defaults() {
  return {
    cores: 0,                       // 货币：暗物质核心
    upgrades: {},                   // 永久升级 id -> 等级
    best: { time: 0, kills: 0, level: 1, bossKills: 0 },
    totals: { runs: 0, kills: 0, bossKills: 0, cores: 0 },
  };
}

/** 取安全的非负整数/数字 */
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const SaveData = {
  load() {
    const d = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return d;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return d;

      d.cores = num(parsed.cores);
      if (parsed.upgrades && typeof parsed.upgrades === "object") {
        for (const k of Object.keys(parsed.upgrades)) {
          d.upgrades[k] = Math.floor(num(parsed.upgrades[k]));
        }
      }
      if (parsed.best) {
        d.best.time = num(parsed.best.time);
        d.best.kills = num(parsed.best.kills);
        d.best.level = num(parsed.best.level, 1);
        d.best.bossKills = num(parsed.best.bossKills);
      }
      if (parsed.totals) {
        d.totals.runs = num(parsed.totals.runs);
        d.totals.kills = num(parsed.totals.kills);
        d.totals.bossKills = num(parsed.totals.bossKills);
        d.totals.cores = num(parsed.totals.cores);
      }
    } catch (_e) {
      return defaults();
    }
    return d;
  },

  save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch (_e) {
      // localStorage 不可用（隐私模式/超额）时静默降级
    }
  },

  reset() {
    try { localStorage.removeItem(KEY); } catch (_e) { /* ignore */ }
    return defaults();
  },
};
