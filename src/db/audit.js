'use strict';

const db = require('./database');

const stmt = {
  insert: db.prepare('INSERT INTO audit_log (user, action, target, details) VALUES (?, ?, ?, ?)'),
  list:   db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?'),
  search: db.prepare(`SELECT * FROM audit_log
                       WHERE user LIKE @q OR action LIKE @q OR target LIKE @q OR details LIKE @q
                       ORDER BY id DESC LIMIT @lim`),
};

function logEntry(user, action, target = '', details = '') {
  try {
    const d = typeof details === 'string' ? details : JSON.stringify(details);
    stmt.insert.run(String(user || 'system'), String(action), String(target), String(d).slice(0, 4000));
  } catch (e) {
    console.error('[audit] gagal mencatat:', e.message);
  }
}

function list(limit = 200) {
  return stmt.list.all(Math.min(Math.max(Number(limit) || 200, 1), 1000));
}

function search(q, limit = 200) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  if (!q || !String(q).trim()) return list(lim);
  return stmt.search.all({ q: `%${String(q).trim()}%`, lim });
}

module.exports = { log: logEntry, list, search };
