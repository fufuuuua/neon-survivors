-- schema.sql — Cloudflare D1 数据库结构。
-- 单表设计: 每个云端账号一行, 同时承载「云存档 blob」与「排行榜最佳成绩」。
--
-- 部署时执行一次(见 README/部署指引):
--   npx wrangler d1 execute neon-survivors-db --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  cloud_id   TEXT PRIMARY KEY,           -- 内部稳定 id (UUID), 不暴露鉴权作用
  name       TEXT NOT NULL,              -- 昵称(注册时已清洗, 最长 16)
  token_hash TEXT NOT NULL UNIQUE,       -- 鉴权 token 的 SHA-256 十六进制; 绝不存明文
  save       TEXT NOT NULL DEFAULT '',   -- 云存档 JSON 字符串(SaveData 结构), 空串表示尚无存档
  best_time  INTEGER NOT NULL DEFAULT 0, -- 排行榜: 最佳存活秒数(主排序键)
  best_kills INTEGER NOT NULL DEFAULT 0, -- 该最佳局的击杀数
  best_boss  INTEGER NOT NULL DEFAULT 0, -- 该最佳局的 Boss 击杀数
  best_level INTEGER NOT NULL DEFAULT 1, -- 该最佳局的等级
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 排行榜按存活时间降序, 建索引加速 ORDER BY。
CREATE INDEX IF NOT EXISTS idx_best_time ON users(best_time DESC);

-- ------------------------------------------------------------------
-- 反馈留言板: 玩家 <-> 开发者的双向异步对话。
-- 设计:
--  - 每条消息独立一行(不做 thread 抽象), 用 cloud_id 归属到某个云账号,
--    通过 (cloud_id, created_at) 建索引按时间顺序拉取对话流.
--  - role 区分消息作者: "user"=玩家(前端发送) / "dev"=开发者回复(由运维用 wrangler 直接 INSERT).
--  - name 冗余存一次玩家昵称, 便于开发者直接读表就能看到"谁说的", 且历史消息不受昵称改动影响.
--  - 未鉴权玩家(无云账号)也能留言: cloud_id 存本地 userId(带前缀 "local:") 便于区分.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cloud_id   TEXT NOT NULL,               -- 云账号 id, 或 "local:xxx"(未注册玩家的本地 id)
  name       TEXT NOT NULL DEFAULT "",    -- 发送时的玩家昵称(仅展示用途)
  role       TEXT NOT NULL,               -- "user" | "dev"
  body       TEXT NOT NULL,               -- 消息正文(前端发送时已 trim/长度校验, 服务端二次限)
  created_at INTEGER NOT NULL             -- 时间戳(ms)
);

CREATE INDEX IF NOT EXISTS idx_feedback_thread ON feedback(cloud_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_feedback_time ON feedback(created_at DESC);
