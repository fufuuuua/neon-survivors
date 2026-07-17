/**
 * POST /api/score — 提交一局成绩(需鉴权)。
 *
 * 请求体: { time, kills, bossKills, level }
 * 仅当本局存活时间刷新个人最佳时, 整行成绩一起更新(保证排行榜记录来自同一局)。
 * 服务端对各字段做上限校验, 拒绝明显异常/作弊值。
 */
import { json, bad, authUser, uint } from "./_lib.js";

// 合理上限(拒绝异常值)。
const MAX_TIME = 24 * 3600; // 24 小时
const MAX_KILLS = 1_000_000;
const MAX_BOSS = 10_000;
const MAX_LEVEL = 1000;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return bad("数据库未绑定", 500);
  const user = await authUser(request, env);
  if (!user) return bad("未授权", 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return bad("请求体必须是 JSON");
  }

  const time = uint(body?.time, MAX_TIME);
  const kills = uint(body?.kills, MAX_KILLS);
  const boss = uint(body?.bossKills, MAX_BOSS);
  const level = Math.max(1, uint(body?.level, MAX_LEVEL));
  const now = Date.now();

  // 条件更新: 仅当本局时间超过既有最佳时才整行覆盖。
  await env.DB.prepare(
    `UPDATE users SET
       best_time = ?, best_kills = ?, best_boss = ?, best_level = ?, updated_at = ?
     WHERE cloud_id = ? AND ? > best_time`
  )
    .bind(time, kills, boss, level, now, user.cloud_id, time)
    .run();

  return json({ ok: true });
}
