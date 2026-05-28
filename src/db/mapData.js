'use strict';

const db = require('./database');

const stmt = {
  list:   db.prepare('SELECT * FROM map_data ORDER BY id DESC'),
  get:    db.prepare('SELECT * FROM map_data WHERE id = ?'),
  insert: db.prepare(`INSERT INTO map_data (topic, content, tags, updated_at)
                      VALUES (@topic, @content, @tags, strftime('%s','now'))`),
  update: db.prepare(`UPDATE map_data SET topic=@topic, content=@content,
                      tags=@tags, updated_at=strftime('%s','now') WHERE id=@id`),
  remove: db.prepare('DELETE FROM map_data WHERE id = ?'),
  search: db.prepare(`SELECT * FROM map_data
                      WHERE topic LIKE @q OR content LIKE @q OR tags LIKE @q
                      ORDER BY updated_at DESC LIMIT 30`),
};

function listMaps() {
  return stmt.list.all();
}

function getMap(id) {
  return stmt.get.get(id);
}

function addMap({ topic, content, tags = '' }) {
  const info = stmt.insert.run({ topic, content, tags });
  return stmt.get.get(info.lastInsertRowid);
}

function updateMap({ id, topic, content, tags = '' }) {
  stmt.update.run({ id, topic, content, tags });
  return stmt.get.get(id);
}

function deleteMap(id) {
  return stmt.remove.run(id).changes > 0;
}

function searchMap(query) {
  if (!query || !query.trim()) return [];
  return stmt.search.all({ q: `%${query.trim()}%` });
}

/**
 * Build context block for AI: gabungkan semua entry yang relevan
 * dengan pertanyaan user. Bila query kosong, kembalikan semua (ringkas).
 */
function buildContext(query, limit = 12) {
  const rows = query ? searchMap(query) : listMaps().slice(0, limit);
  if (!rows.length) return '';
  return rows
    .slice(0, limit)
    .map((r, i) => `# ${i + 1}. ${r.topic}\n${r.content}${r.tags ? `\n(tag: ${r.tags})` : ''}`)
    .join('\n\n');
}

module.exports = {
  listMaps,
  getMap,
  addMap,
  updateMap,
  deleteMap,
  searchMap,
  buildContext,
};
