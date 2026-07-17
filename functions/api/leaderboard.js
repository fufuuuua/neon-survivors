/**
 * GET /api/leaderboard?limit=20 — 公开排行榜(无需鉴权)。
 *
 * 按最佳存活时间降序、击杀数次之, 返回前 N 名。
 * 昵称由客户端渲染时转义(Screens.esc), 防 XSS。
 */
import { json } from "./_lib.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: true, list: [] });

  const url = new URL(request.url);
  let limit = parseInt(url.searchParams.get("limit") || "20", 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  limit = Math.min(limit, 100);

  const { results } = await env.DB.prepare(
    `SELECT name, best_time, best_kills, best_boss, best_level
     FROM users
     WHERE best_time > 0
     ORDER BY best_time DESC, best_kills DESC
     LIMIT ?`
  )
    .bind(limit)
    .all();

  return json({ ok: true, list: results || [] });
}
