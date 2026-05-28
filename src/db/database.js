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
`);

module.exports = db;
