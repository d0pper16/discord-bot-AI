'use strict';

/**
 * Chat Log (logger 2):
 *   Persisten di SQLite (tabel chat_log).
 *   FIFO max 1000 entries via TRIGGER chat_log_cap.
 *   Survive restart.
 *
 *   Field:
 *     - discord_id, username        : siapa nanya
 *     - question, answer            : isi percakapan
 *     - source                      : 'gemini:PRIMARY' / 'cache' / 'gemini:SECONDARY+deferred'
 *     - asked_at, answered_at       : unix seconds
 */

const db = require('./database');

const stmt = {
  insert: db.prepare(`INSERT INTO chat_log
    (discord_id, username, question, answer, source, asked_at, answered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  list:   db.prepare('SELECT * FROM chat_log ORDER BY id DESC LIMIT ?'),
  search: db.prepare(`SELECT * FROM chat_log
                       WHERE discord_id LIKE @q OR username LIKE @q
                          OR question  LIKE @q OR answer   LIKE @q
                       ORDER BY id DESC LIMIT @lim`),
  count:    db.prepare('SELECT COUNT(*) AS c FROM chat_log'),
  clearAll: db.prepare('DELETE FROM chat_log'),
};

function add({ discordId, username, question, answer, source = 'gemini', askedAt, answeredAt }) {
  if (!discordId || !question || !answer) return null;
  const now = Math.floor(Date.now() / 1000);
  try {
    const info = stmt.insert.run(
      String(discordId).slice(0, 30),
      String(username || 'unknown').slice(0, 100),
      String(question).slice(0, 4000),
      String(answer).slice(0, 4000),
      String(source).slice(0, 60),
      Number.isFinite(askedAt) ? Math.floor(askedAt) : now,
      Number.isFinite(answeredAt) ? Math.floor(answeredAt) : now
    );
    return info.lastInsertRowid;
  } catch (e) {
    console.error('[chatLog] add gagal:', e.message);
    return null;
  }
}

function list(limit = 200) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  return stmt.list.all(lim);
}

function search(q, limit = 200) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  if (!q || !String(q).trim()) return list(lim);
  return stmt.search.all({ q: `%${String(q).trim()}%`, lim });
}

function count() {
  return stmt.count.get().c;
}

function clearAll() {
  return stmt.clearAll.run().changes;
}

module.exports = { add, list, search, count, clearAll };
