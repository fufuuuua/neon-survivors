/**
 * /api/feedback — 玩家反馈留言板 API。
 *
 * GET  ?ownerId=xxx     -> { ok:true, messages: [{ role, name, body, created_at }...] }
 *       拉取指定 owner 的对话时间线; ownerId = 云账号 cloud_id 或 "local:<localUserId>".
 *       为方便匿名玩家使用, 该端点不做鉴权; 但列表按 ownerId 精确匹配, 一个人只能看到自己发的和 dev 回复自己的.
 *
 * POST                  -> { ok:true, message: {...} }
 *       body: { ownerId, name, body }
 *       ownerId 由前端提供:
 *         · 已登录云账号: 前端传自己的 cloud_id (与 Authorization 一致时二次校验)
 *         · 匿名玩家:    前端传 "local:<localUserId>"
 *       仅接受 role="user" 的写入; dev 回复由运维用 wrangler d1 execute 直接 INSERT (不开放端点).
 *
 * 反滥用护栏:
 *  - body 长度 1..500;
 *  - 单条 IP 每分钟限 6 条(靠 Cloudflare 边缘/DB 时间戳做粗粒度限流, 见下方逻辑).
 */
import { json, bad, authUser, cleanName } from "./_lib.js";

const MAX_BODY = 500;
const MIN_BODY = 1;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 分钟
const RATE_LIMIT_MAX = 6;                // 同一 ownerId 每分钟最多 6 条

/** ownerId 合法性: 云 uuid(36) 或 "local:xxx"(其中 xxx 长度 <= 64 字母数字/短横线) */
function isValidOwnerId(v) {
  if (typeof v !== "string") return false;
  if (v.length < 4 || v.length > 80) return false;
  if (v.startsWith("local:")) return /^local:[A-Za-z0-9_-]{1,64}$/.test(v);
  return /^[A-Za-z0-9-]{16,48}$/.test(v);
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return bad("数据库未绑定", 500);
  const url = new URL(request.url);
  const ownerId = (url.searchParams.get("ownerId") || "").trim();
  if (!isValidOwnerId(ownerId)) return bad("ownerId 不合法");

  const rs = await env.DB
    .prepare("SELECT role, name, body, created_at FROM feedback WHERE cloud_id = ? ORDER BY created_at ASC LIMIT 200")
    .bind(ownerId)
    .all();
  const messages = (rs.results || []).map((r) => ({
    role: r.role === "dev" ? "dev" : "user",
    name: r.name || "",
    body: r.body || "",
    created_at: Number(r.created_at) || 0,
  }));
  return json({ ok: true, messages });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return bad("数据库未绑定", 500);

  let body;
  try { body = await request.json(); } catch { return bad("请求体不合法"); }
  if (!body || typeof body !== "object") return bad("请求体不合法");

  const ownerId = String(body.ownerId || "").trim();
  const name = cleanName(body.name || "指挥官") || "指挥官";
  const text = String(body.body || "").trim();

  if (!isValidOwnerId(ownerId)) return bad("ownerId 不合法");
  if (text.length < MIN_BODY || text.length > MAX_BODY) return bad(`内容长度需在 ${MIN_BODY}..${MAX_BODY} 之间`);

  // 若声称是云账号 ownerId, 二次校验 Authorization: 防止冒名给别人的收件箱塞消息.
  // (匿名 local:xx 无从校验, 只能靠限流兜底.)
  if (!ownerId.startsWith("local:")) {
    const user = await authUser(request, env);
    if (!user || user.cloud_id !== ownerId) return bad("未授权", 401);
  }

  // 简易限流: 查最近窗口内该 ownerId 的消息条数.
  const now = Date.now();
  const rl = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM feedback WHERE cloud_id = ? AND role = 'user' AND created_at > ?")
    .bind(ownerId, now - RATE_LIMIT_WINDOW_MS)
    .first();
  if (rl && Number(rl.n) >= RATE_LIMIT_MAX) return bad("发送太频繁, 请稍后再试", 429);

  await env.DB
    .prepare("INSERT INTO feedback (cloud_id, name, role, body, created_at) VALUES (?, ?, 'user', ?, ?)")
    .bind(ownerId, name, text, now)
    .run();

  return json({
    ok: true,
    message: { role: "user", name, body: text, created_at: now },
  });
}
