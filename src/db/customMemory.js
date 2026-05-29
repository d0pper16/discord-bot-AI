'use strict';

const db = require('./database');
const { normalize, jaccard } = require('./chatHistory');

const stmt = {
  insert: db.prepare(`INSERT INTO custom_memory (question, question_norm, answer, tags)
                       VALUES (@question, @question_norm, @answer, @tags)`),
  list:   db.prepare('SELECT * FROM custom_memory ORDER BY id DESC'),
  search: db.prepare(`SELECT * FROM custom_memory
                       WHERE question LIKE @q OR answer LIKE @q OR tags LIKE @q
                       ORDER BY id DESC LIMIT @lim`),
  update: db.prepare(`UPDATE custom_memory
                       SET question=@question, question_norm=@question_norm,
                           answer=@answer, tags=@tags,
                           updated_at=strftime('%s','now')
                       WHERE id=@id`),
  remove: db.prepare('DELETE FROM custom_memory WHERE id = ?'),
  exact:  db.prepare('SELECT * FROM custom_memory WHERE question_norm = ? ORDER BY id DESC LIMIT 1'),
  all:    db.prepare('SELECT * FROM custom_memory'),
  count:  db.prepare('SELECT COUNT(*) AS c FROM custom_memory'),
};

function add({ question, answer, tags = '' }) {
  if (!question || !answer) throw new Error('question & answer wajib');
  const info = stmt.insert.run({
    question: String(question).slice(0, 1000),
    question_norm: normalize(question),
    answer: String(answer).slice(0, 4000),
    tags: String(tags || '').slice(0, 200),
  });
  return get(info.lastInsertRowid);
}

function get(id) {
  return db.prepare('SELECT * FROM custom_memory WHERE id = ?').get(id);
}

function list() {
  return stmt.list.all();
}

function search(q, limit = 200) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  if (!q || !String(q).trim()) return list().slice(0, lim);
  return stmt.search.all({ q: `%${String(q).trim()}%`, lim });
}

function update({ id, question, answer, tags = '' }) {
  if (!question || !answer) throw new Error('question & answer wajib');
  stmt.update.run({
    id,
    question: String(question).slice(0, 1000),
    question_norm: normalize(question),
    answer: String(answer).slice(0, 4000),
    tags: String(tags || '').slice(0, 200),
  });
  return get(id);
}

function remove(id) {
  return stmt.remove.run(id).changes > 0;
}

function count() {
  return stmt.count.get().c;
}

/**
 * Cari custom memory mirip pertanyaan user.
 * Threshold 0.85 (lebih ketat dari cache karena custom memory adalah
 * ingatan intentional yang harus match jelas).
 */
function findSimilar(question, threshold = 0.85) {
  const norm = normalize(question);
  if (!norm) return null;
  const exact = stmt.exact.get(norm);
  if (exact) return { row: exact, score: 1, exact: true };

  const cand = stmt.all.all();
  let best = null;
  for (const row of cand) {
    const score = jaccard(norm, row.question_norm);
    if (score >= threshold && (!best || score > best.score)) {
      best = { row, score, exact: false };
    }
  }
  return best;
}

/**
 * Substitusi placeholder di answer:
 *   {nama}        -> nama bot dari config
 *   {bot}         -> alias {nama}
 *   <@123>        -> tetap (Discord render sebagai user mention)
 *   <@&456>       -> tetap (Discord render sebagai role mention)
 */
function applyPlaceholders(answer, ctx = {}) {
  const name = ctx.botName || 'Yanto';
  return String(answer)
    .replace(/\{nama\}/gi, name)
    .replace(/\{bot\}/gi, name);
}

module.exports = {
  add, get, list, search, update, remove, count, findSimilar, applyPlaceholders,
};
