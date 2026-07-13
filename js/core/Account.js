/**
 * Account.js — 本地"账号"管理（localStorage 分区）。
 *
 * 每位玩家拥有一个稳定的 userId（默认为 8 位随机字母数字，可由玩家自定义），
 * 所有存档 / 对局快照都按 `<key>:<userId>` 分区存储，避免共用同一浏览器时互相覆盖。
 * 该 userId 未来会作为 EdgeOne KV 的 key，实现云端同步 / 多人榜单等能力。
 *
 * 安全：
 *  - 用户输入的 ID / 昵称做严格的字符与长度校验，避免注入奇怪的 key。
 *  - 读写只经 JSON.parse / JSON.stringify，绝不 eval 或反序列化任意对象。
 */
const KEY = "neondrift.account.v1";

/** 允许的 ID 字符：仅数字, 长度 ≥ 3（如 001、002、... 、1024）。 */
const ID_RE = /^\d{3,}$/;
/** 昵称：任意可见字符，长度 1-16（去首尾空白） */
const NAME_MAX = 16;

/**
 * 依据现有用户列表生成下一个递增 ID (最小 3 位, 从 001 开始)。
 * 规则:
 *  - 取现有 ID 的最大数值 + 1;
 *  - 位数不足 3 位时前补 0, 超过 3 位自然增长为 4 / 5 位。
 * 这样 ID 稳定、可读、可作为 EdgeOne KV 的 key。
 */
function nextId(users) {
  let max = 0;
  for (const u of users) {
    if (u && typeof u.id === "string" && ID_RE.test(u.id)) {
      const n = parseInt(u.id, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  return String(next).padStart(3, "0");
}

/** 昵称清洗：去掉控制字符，压缩空白，截断到 NAME_MAX */
function sanitizeName(raw) {
  if (typeof raw !== "string") return "";
  // 允许中英文/emoji 等可见字符，剔除控制符
  let s = raw.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!s) return "";
  // 折叠内部空白
  s = s.replace(/\s+/g, " ");
  if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX);
  return s;
}

/** 默认结构 */
function emptyStore() {
  return { currentId: "", users: [] };
}

function loadRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return emptyStore();
    const store = emptyStore();
    if (Array.isArray(p.users)) {
      for (const u of p.users) {
        if (!u || typeof u !== "object") continue;
        if (typeof u.id !== "string" || !ID_RE.test(u.id)) continue;
        const name = sanitizeName(u.name) || u.id;
        const createdAt = Number(u.createdAt) || Date.now();
        if (store.users.some((x) => x.id === u.id)) continue; // 去重
        store.users.push({ id: u.id, name, createdAt });
      }
    }
    if (typeof p.currentId === "string" && store.users.some((u) => u.id === p.currentId)) {
      store.currentId = p.currentId;
    }
    return store;
  } catch (_e) {
    return emptyStore();
  }
}

function saveRaw(store) {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (_e) { /* 隐私模式静默降级 */ }
}

export const Account = {
  ID_RE,
  NAME_MAX,
  sanitizeName,

  /**
   * 初始化：读取账号库，若没有任何用户则自动创建默认账号 (ID = 001)。
   * 返回 { store, current }
   */
  init() {
    let store = loadRaw();

    if (store.users.length === 0) {
      // 全新用户 —— 建立首个账号, ID = 001
      const id = nextId(store.users);
      store.users.push({ id, name: "指挥官", createdAt: Date.now() });
      store.currentId = id;
      saveRaw(store);
    } else if (!store.currentId || !store.users.some((u) => u.id === store.currentId)) {
      // currentId 丢失或指向不存在的用户
      store.currentId = store.users[0].id;
      saveRaw(store);
    }

    return { store, current: store.users.find((u) => u.id === store.currentId) };
  },

  list() { return loadRaw().users.slice().sort((a, b) => b.createdAt - a.createdAt); },

  current() {
    const store = loadRaw();
    return store.users.find((u) => u.id === store.currentId) || null;
  },

  /**
   * 创建新用户: ID 由系统按已有列表自动递增分配 (001, 002, ...)。
   * @param {{name:string}} input
   * @returns {{ok:true, user}|{ok:false, error:string}}
   */
  create({ name }) {
    const store = loadRaw();
    const cleanName = sanitizeName(name);
    if (!cleanName) return { ok: false, error: "昵称不能为空" };

    const id = nextId(store.users);
    const user = { id, name: cleanName, createdAt: Date.now() };
    store.users.push(user);
    store.currentId = id;
    saveRaw(store);
    return { ok: true, user };
  },

  /** 切换当前用户，返回是否切换成功 */
  switchTo(id) {
    const store = loadRaw();
    if (!store.users.some((u) => u.id === id)) return false;
    if (store.currentId === id) return false;
    store.currentId = id;
    saveRaw(store);
    return true;
  },

  /** 重命名。返回错误消息或 null */
  rename(id, name) {
    const store = loadRaw();
    const u = store.users.find((x) => x.id === id);
    if (!u) return "用户不存在";
    const cleanName = sanitizeName(name);
    if (!cleanName) return "昵称不能为空";
    u.name = cleanName;
    saveRaw(store);
    return null;
  },

  /**
   * 删除用户，同时清除其对应的存档 / 快照。
   * 若删除的是当前用户，则自动切换到剩余用户中最近创建的一个；
   * 若删完最后一个用户，则重新初始化一个"访客"账号。
   * 返回新的 currentId。
   */
  remove(id) {
    const store = loadRaw();
    const idx = store.users.findIndex((u) => u.id === id);
    if (idx === -1) return store.currentId;
    store.users.splice(idx, 1);
    // 清理该用户的分区存档
    try {
      localStorage.removeItem(`neondrift.save.v1:${id}`);
      localStorage.removeItem(`neondrift.run.v1:${id}`);
    } catch (_e) { /* ignore */ }

    if (store.currentId === id) {
      store.currentId = store.users.length
        ? store.users.slice().sort((a, b) => b.createdAt - a.createdAt)[0].id
        : "";
    }
    saveRaw(store);

    if (!store.currentId) {
      // 至少保留一个可用账号
      return this.init().current.id;
    }
    return store.currentId;
  },
};
