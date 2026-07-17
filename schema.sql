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
