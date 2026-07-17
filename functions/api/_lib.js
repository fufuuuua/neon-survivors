/**
 * _lib.js — Pages Functions 共享工具。
 *
 * 以 `_` 开头的文件不会被 Pages 当作路由端点, 仅供其它 functions 导入。
 * 这里集中放: 统一 JSON 响应、随机 token 生成、SHA-256、鉴权、输入清洗与数值校验。
 *
 * 安全约定:
 *  - 鉴权 token 只在库里存 SHA-256 哈希, 明文不落库、不打日志。
 *  - 所有数据库访问由调用方使用预处理语句 + bind(), 本文件不拼 SQL。
 */

/** 统一 JSON 响应 */
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

/** 错误响应 */
export const bad = (msg, status = 400) => json({ ok: false, error: msg }, status);

/** SHA-256 -> 十六进制字符串 */
export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 生成不可猜的随机 token(32 字节 -> base64url, 约 43 字符) */
export function randomToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 从 `Authorization: Bearer <token>` 解析并校验, 命中返回 user 行, 否则 null。
 * 通过 token 的哈希在 users 表查找, 避免明文比对与时序泄露。
 */
export async function authUser(request, env) {
  const h = request.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  // 长度护栏: 既避免超短弱 token, 也避免异常超长输入进哈希。
  if (token.length < 16 || token.length > 128) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT * FROM users WHERE token_hash = ?")
    .bind(hash)
    .first();
  return row || null;
}

/** 昵称清洗: 去控制符、折叠空白、截断到 16(与前端 Account.sanitizeName 对齐) */
export function cleanName(raw) {
  if (typeof raw !== "string") return "";
  const s = raw.replace(/[\u0000-\u001F\u007F]/g, "").trim().replace(/\s+/g, " ");
  return s.slice(0, 16);
}

/** 安全非负整数, 并限制上限, 用于拒绝异常/作弊数值 */
export function uint(v, max = Number.MAX_SAFE_INTEGER) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}
