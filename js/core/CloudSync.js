/**
 * CloudSync.js — 云端同步客户端(对接 Cloudflare Pages Functions + D1)。
 *
 * 职责:
 *  - 管理本地保存的云端凭证 { cloudId, token, name }(token 即恢复码/云存档密钥)。
 *  - 封装注册、按恢复码找回、拉/推云存档、提交成绩、拉取排行榜等网络调用。
 *
 * 设计:
 *  - 所有方法都是「失败不抛异常」的: 网络/服务端出错时返回 { ok:false, error }, 由调用方决定降级,
 *    从而保证离线时游戏仍能纯本地运行(localStorage), 云端只是可选增强。
 *  - token 仅存在本地 localStorage, 并通过 Authorization 头发送; 绝不写入 URL/日志。
 *
 * 安全: 昵称等由服务端清洗; 排行榜昵称在 UI 渲染时须经 Screens.esc() 转义。
 */
const LS_KEY = "neondrift.cloud.v1"; // { cloudId, token, name }
const BASE = "/api";
const TIMEOUT = 8000; // ms, 避免弱网长时间挂起

/** 读取本地云端凭证 */
function loadCred() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (c && typeof c.token === "string" && c.token.length >= 16) {
      return { cloudId: String(c.cloudId || ""), token: c.token, name: String(c.name || "") };
    }
  } catch (_e) { /* ignore */ }
  return null;
}

function saveCred(c) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch (_e) { /* ignore */ }
}

function clearCred() {
  try { localStorage.removeItem(LS_KEY); } catch (_e) { /* ignore */ }
}

/** 带超时 + 统一错误处理的 fetch 包装。返回 { ok, status, data } */
async function req(path, { method = "GET", token = null, body = null, isText = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const headers = {};
    if (token) headers["authorization"] = `Bearer ${token}`;
    let payload = null;
    if (body != null) {
      if (isText) { headers["content-type"] = "text/plain"; payload = body; }
      else { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    }
    const res = await fetch(`${BASE}${path}`, { method, headers, body: payload, signal: ctrl.signal });
    let data = null;
    try { data = await res.json(); } catch (_e) { data = null; }
    return { ok: res.ok && (data ? data.ok !== false : true), status: res.status, data };
  } catch (_e) {
    return { ok: false, status: 0, data: null }; // 网络错误/超时
  } finally {
    clearTimeout(timer);
  }
}

export const CloudSync = {
  /** 当前本地凭证(未绑定返回 null) */
  cred() { return loadCred(); },

  /** 是否已绑定云端 */
  isLinked() { return !!loadCred(); },

  /**
   * 注册新云端账号。成功后本地保存凭证并返回 { ok:true, token, name }。
   * token 就是「恢复码」, 调用方应提示用户妥善保存。
   */
  async register(name) {
    const r = await req("/register", { method: "POST", body: { name: name || "" } });
    if (!r.ok || !r.data?.token) return { ok: false, error: "注册失败, 请稍后重试" };
    const cred = { cloudId: r.data.cloudId, token: r.data.token, name: r.data.name };
    saveCred(cred);
    return { ok: true, token: cred.token, name: cred.name };
  },

  /**
   * 用恢复码(token)在新设备上找回账号: 尝试拉取存档以验证 token 有效。
   * 成功返回 { ok:true, name, save }。
   */
  async linkByToken(token) {
    const t = (token || "").trim();
    if (t.length < 16) return { ok: false, error: "恢复码格式不正确" };
    const r = await req("/save", { method: "GET", token: t });
    if (r.status === 401) return { ok: false, error: "恢复码无效" };
    if (!r.ok) return { ok: false, error: "网络异常, 请稍后重试" };
    const name = r.data?.name || "";
    saveCred({ cloudId: "", token: t, name });
    return { ok: true, name, save: r.data?.save || null };
  },

  /** 拉取云存档: { ok:true, name, save|null } */
  async pullSave() {
    const c = loadCred();
    if (!c) return { ok: false, error: "未绑定云端" };
    const r = await req("/save", { method: "GET", token: c.token });
    if (!r.ok) return { ok: false, error: "拉取失败" };
    return { ok: true, name: r.data?.name || c.name, save: r.data?.save || null };
  },

  /** 推送(覆盖)云存档 */
  async pushSave(save) {
    const c = loadCred();
    if (!c) return { ok: false, error: "未绑定云端" };
    const r = await req("/save", { method: "PUT", token: c.token, body: JSON.stringify(save), isText: true });
    return r.ok ? { ok: true } : { ok: false, error: "上传失败" };
  },

  /** 提交一局成绩(用于排行榜) */
  async submitScore({ time, kills, bossKills, level }) {
    const c = loadCred();
    if (!c) return { ok: false, error: "未绑定云端" };
    const r = await req("/score", {
      method: "POST",
      token: c.token,
      body: { time, kills, bossKills, level },
    });
    return r.ok ? { ok: true } : { ok: false, error: "提交失败" };
  },

  /** 拉取排行榜前 N 名(无需绑定): { ok:true, list:[{name,best_time,...}] } */
  async leaderboard(limit = 20) {
    const r = await req(`/leaderboard?limit=${encodeURIComponent(limit)}`, { method: "GET" });
    if (!r.ok) return { ok: false, error: "排行榜加载失败", list: [] };
    return { ok: true, list: Array.isArray(r.data?.list) ? r.data.list : [] };
  },

  /** 解绑(仅清除本地凭证, 不删除云端数据) */
  unlink() { clearCred(); },
};
