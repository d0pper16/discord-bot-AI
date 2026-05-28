'use strict';

const db = require('./database');

const stmt = {
  list:        db.prepare('SELECT * FROM chat_history ORDER BY id DESC LIMIT ?'),
  byChannel:   db.prepare('SELECT * FROM chat_history WHERE channel_id = ? ORDER BY id DESC LIMIT ?'),
  findExact:   db.prepare('SELECT * FROM chat_history WHERE question_norm = ? ORDER BY id DESC LIMIT 1'),
  insert:      db.prepare(`INSERT INTO chat_history
                            (channel_id, user_id, question, question_norm, answer, source)
                            VALUES (@channel_id, @user_id, @question, @question_norm, @answer, @source)`),
  updateAns:   db.prepare(`UPDATE chat_history SET answer=@answer, source=@source,
                            updated_at=strftime('%s','now') WHERE id=@id`),
  updateFull:  db.prepare(`UPDATE chat_history
                            SET question=@question, question_norm=@question_norm,
                                answer=@answer, updated_at=strftime('%s','now')
                            WHERE id=@id`),
  remove:      db.prepare('DELETE FROM chat_history WHERE id = ?'),
  clearAll:    db.prepare('DELETE FROM chat_history'),
  recent:      db.prepare(`SELECT question, answer FROM chat_history
                            WHERE channel_id = ? ORDER BY id DESC LIMIT ?`),
  search:      db.prepare(`SELECT * FROM chat_history
                            WHERE question LIKE @q OR answer LIKE @q OR user_id LIKE @q
                            ORDER BY id DESC LIMIT @limit`),
  getOne:      db.prepare('SELECT * FROM chat_history WHERE id = ?'),
};

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kosa kata token unik (untuk Jaccard) */
function tokens(text) {
  return new Set(normalize(text).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function listHistory(limit = 100) {
  return stmt.list.all(limit);
}

function listByChannel(channelId, limit = 100) {
  return stmt.byChannel.all(channelId, limit);
}

function recentContext(channelId, limit = 10) {
  return stmt.recent.all(channelId, limit).reverse();
}

function findExact(question) {
  return stmt.findExact.get(normalize(question));
}

/**
 * Cari jawaban cache mirip. Kembalikan { row, score } atau null.
 */
function findSimilar(question, threshold = 0.82) {
  const norm = normalize(question);
  if (!norm) return null;

  // 1) Exact match
  const exact = stmt.findExact.get(norm);
  if (exact) return { row: exact, score: 1, exact: true };

  // 2) Jaccard similarity terhadap kandidat (limit 500 row terbaru)
  const cand = db.prepare('SELECT * FROM chat_history ORDER BY id DESC LIMIT 500').all();
  let best = null;
  for (const row of cand) {
    const score = jaccard(norm, row.question_norm);
    if (score >= threshold && (!best || score > best.score)) {
      best = { row, score, exact: false };
    }
  }
  return best;
}

function saveAnswer({ channelId, userId, question, answer, source = 'gemini' }) {
  const info = stmt.insert.run({
    channel_id: channelId,
    user_id: userId,
    question,
    question_norm: normalize(question),
    answer,
    source,
  });
  return info.lastInsertRowid;
}

function updateAnswer(id, answer, source = 'gemini') {
  stmt.updateAns.run({ id, answer, source });
}

function updateEntry(id, { question, answer }) {
  stmt.updateFull.run({
    id,
    question,
    question_norm: normalize(question),
    answer,
  });
  return stmt.getOne.get(id);
}

function searchHistory(query, limit = 200) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  if (!query || !String(query).trim()) {
    return stmt.list.all(lim);
  }
  return stmt.search.all({ q: `%${String(query).trim()}%`, limit: lim });
}

function deleteEntry(id) {
  return stmt.remove.run(id).changes > 0;
}

function clearAll() {
  return stmt.clearAll.run().changes;
}

module.exports = {
  normalize,
  jaccard,
  listHistory,
  listByChannel,
  recentContext,
  findExact,
  findSimilar,
  saveAnswer,
  updateAnswer,
  updateEntry,
  searchHistory,
  deleteEntry,
  clearAll,
};
