'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'bot.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// ---- Schema ----
db.exec(`
CREATE TABLE IF NOT EXISTS map_data (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic       TEXT    NOT NULL,
  content     TEXT    NOT NULL,
  tags        TEXT    DEFAULT '',
  updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_map_topic ON map_data(topic);

CREATE TABLE IF NOT EXISTS chat_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id   TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,
  question     TEXT    NOT NULL,
  question_norm TEXT   NOT NULL,
  answer       TEXT    NOT NULL,
  source       TEXT    NOT NULL DEFAULT 'gemini',
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_norm    ON chat_history(question_norm);
CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_history(channel_id);

CREATE TABLE IF NOT EXISTS api_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id TEXT    NOT NULL,
  used_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  status     TEXT    NOT NULL DEFAULT 'ok'
);
CREATE INDEX IF NOT EXISTS idx_api_used ON api_usage(api_key_id, used_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user       TEXT    NOT NULL,
  action     TEXT    NOT NULL,
  target     TEXT    NOT NULL DEFAULT '',
  details    TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(user);

-- ============================================================
--  CHAT LOG (logger 2): persistent SQLite, FIFO max 1000
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id   TEXT    NOT NULL,
  username     TEXT    NOT NULL,
  question     TEXT    NOT NULL,
  answer       TEXT    NOT NULL,
  source       TEXT    NOT NULL DEFAULT 'gemini',
  asked_at     INTEGER NOT NULL,
  answered_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chatlog_asked ON chat_log(asked_at DESC);
CREATE INDEX IF NOT EXISTS idx_chatlog_user  ON chat_log(discord_id);

CREATE TRIGGER IF NOT EXISTS chat_log_cap
AFTER INSERT ON chat_log
WHEN (SELECT COUNT(*) FROM chat_log) > 1000
BEGIN
  DELETE FROM chat_log WHERE id NOT IN (
    SELECT id FROM chat_log ORDER BY id DESC LIMIT 1000
  );
END;

-- ============================================================
--  CUSTOM MEMORY (ingatan buatan dari dashboard)
--  Q&A pasangan yang ditambahkan manual oleh dev/admin.
--  Bot pakai ini SEBELUM cek cache & Gemini.
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_memory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question      TEXT    NOT NULL,
  question_norm TEXT    NOT NULL,
  answer        TEXT    NOT NULL,
  tags          TEXT    DEFAULT '',
  created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_custmem_norm ON custom_memory(question_norm);
`);

module.exports = db;
