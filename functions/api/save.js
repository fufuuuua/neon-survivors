/**
 * /api/save — 云存档读写(需鉴权: Authorization: Bearer <token>)。
 *
 * GET  -> { ok:true, name, save|null }
 * PUT  (body 为存档 JSON) -> { ok:true }
 *
 * 存档内容即 SaveData 的结构; 服务端只做体积与合法性护栏, 详细字段校验由客户端 SaveData.load 负责。
 */
import { json, bad, authUser, safeRun } from "./_lib.js";

const MAX_SAVE_BYTES = 32 * 1024; // 32KB 上限, 防滥用

export async function onRequestGet({ request, env }) {
  if (!env.DB) return bad("数据库未绑定", 500);
  const user = await authUser(request, env);
  if (!user) return bad("未授权", 401);

  let save = null;
  if (user.save) {
    try {
      save = JSON.parse(user.save);
    } catch {
      save = null;
    }
  }
  return json({ ok: true, name: user.name, save });
}

export async function onRequestPut({ request, env }) {
  if (!env.DB) return bad("数据库未绑定", 500);
  const user = await authUser(request, env);
  if (!user) return bad("未授权", 401);

  const raw = await request.text();
  // 用字节长度判断, 避免多字节字符绕过限制。
  if (new Blob([raw]).size > MAX_SAVE_BYTES) return bad("存档体积超限", 413);

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return bad("存档必须是合法 JSON");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return bad("存档格式不合法");

  const now = Date.now();
  const wrote = await safeRun("save.PUT", () =>
    env.DB.prepare("UPDATE users SET save = ?, updated_at = ? WHERE cloud_id = ?")
      .bind(JSON.stringify(obj), now, user.cloud_id)
      .run(),
  );
  // safeRun 出错时直接返回 500 Response, 用 instanceof Response 早退
  if (wrote instanceof Response) return wrote;
  return json({ ok: true });
}
