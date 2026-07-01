/**
 * SaveData.js — 本地存档（localStorage）。
 * 负责元进度数据的持久化：货币、永久升级等级、历史最佳、累计统计。
 *
 * 安全：读取时使用安全的 JSON 解析并与默认结构合并 + 数值校验，
 * 避免被篡改/损坏的存档导致运行异常（不使用 eval / 反序列化任意对象）。
 */
const KEY = "neondrift.save.v1";
const RUN_KEY = "neondrift.run.v1"; // 当前进行中的一局快照（用于「继续上局」）

function defaults() {
  return {
    cores: 0,                       // 货币：暗物质核心（强化实验室）
    upgrades: {},                   // 永久升级 id -> 等级
    best: { time: 0, kills: 0, level: 1, bossKills: 0 },
    totals: { runs: 0, kills: 0, bossKills: 0, cores: 0 },
    // 机库：外观抽卡与选择
    skins: {
      shards: 0,                    // 货币：棱牌 ✦（抽卡专用）
      owned: { drift: 1 },          // 外观 id -> 星级（默认拥有「漂移者」1 星）
      selected: "drift",            // 当前选中外观
      lastFreeDraw: "",             // 上次领取每日免费抽卡的本地日期（YYYY-MM-DD）
    },
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
      if (parsed.skins && typeof parsed.skins === "object") {
        d.skins.shards = num(parsed.skins.shards);
        if (parsed.skins.owned && typeof parsed.skins.owned === "object") {
          const owned = {};
          for (const k of Object.keys(parsed.skins.owned)) {
            // 星级限制在 1..5，非法值忽略
            const star = Math.floor(num(parsed.skins.owned[k]));
            if (star >= 1) owned[k] = Math.min(5, star);
          }
          // 至少保留默认外观，避免存档损坏后无可用外观
          if (!owned.drift) owned.drift = 1;
          d.skins.owned = owned;
        }
        if (typeof parsed.skins.selected === "string" && d.skins.owned[parsed.skins.selected]) {
          d.skins.selected = parsed.skins.selected;
        }
        // 仅接受 YYYY-MM-DD 形式的日期字符串，其余忽略
        if (typeof parsed.skins.lastFreeDraw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.skins.lastFreeDraw)) {
          d.skins.lastFreeDraw = parsed.skins.lastFreeDraw;
        }
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

  // ---------------- 进行中的一局快照 ----------------

  /** 保存当前对局快照，便于下次打开时「继续上局」（数据由 Game 组织，均为纯 JSON） */
  saveRun(run) {
    try {
      localStorage.setItem(RUN_KEY, JSON.stringify(run));
    } catch (_e) {
      // localStorage 不可用时静默降级
    }
  },

  /**
   * 读取对局快照。安全解析：仅接受结构完整、玩家仍存活的快照，
   * 否则返回 null（不使用 eval / 不信任任意结构）。
   */
  loadRun() {
    try {
      const raw = localStorage.getItem(RUN_KEY);
      if (!raw) return null;
      const r = JSON.parse(raw);
      if (!r || typeof r !== "object") return null;
      if (!r.player || typeof r.player !== "object") return null;
      if (!r.stats || typeof r.stats !== "object") return null;
      if (!r.spawn || typeof r.spawn !== "object") return null;
      // 玩家已阵亡的快照无意义
      if (!(Number(r.player.hp) > 0)) return null;
      return r;
    } catch (_e) {
      return null;
    }
  },

  clearRun() {
    try { localStorage.removeItem(RUN_KEY); } catch (_e) { /* ignore */ }
  },
};
