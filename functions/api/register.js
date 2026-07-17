/**
 * POST /api/register — 创建一个云端账号。
 *
 * 请求体: { name?: string }
 * 响应:   { ok:true, cloudId, name, token }
 *
 * token 即「云存档密钥/恢复码」, 服务端只存其哈希, 明文仅此一次返回给客户端保存。
 */
import { json, bad, sha256Hex, randomToken, cleanName } from "./_lib.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return bad("数据库未绑定(请在 Pages 项目配置 D1 绑定 DB)", 500);

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const name = cleanName(body?.name) || "指挥官";
  const token = randomToken();
  const hash = await sha256Hex(token);
  const cloudId = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO users (cloud_id, name, token_hash, save, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?)`
  )
    .bind(cloudId, name, hash, now, now)
    .run();

  return json({ ok: true, cloudId, name, token });
}
