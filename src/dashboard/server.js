'use strict';

const fs       = require('fs');
const path     = require('path');
const express  = require('express');
const basicAuth = require('express-basic-auth');
const multer   = require('multer');

const log      = require('../utils/logger');
const mapData  = require('../db/mapData');
const cache    = require('../db/chatHistory');
const gemini   = require('../ai/gemini');

const ROOT = path.join(__dirname, '..', '..');
const PERSONALITY_FILE = path.join(ROOT, 'src', 'ai', 'personality.js');
const CONFIG_FILE      = path.join(ROOT, 'config.json');
const BOT_FILE         = path.join(ROOT, 'src', 'bot.js');

const upload = multer({ dest: path.join(ROOT, 'data', 'uploads') });

function start() {
  const app = express();
  const port = Number(process.env.DASHBOARD_PORT || 3000);

  const user = process.env.DASHBOARD_USER || 'admin';
  const pass = process.env.DASHBOARD_PASS || 'admin';

  app.use(basicAuth({
    users: { [user]: pass },
    challenge: true,
    realm: 'YantoDashboard',
  }));

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  // ---- Status ----
  app.get('/api/status', (req, res) => {
    res.json({
      ok: true,
      gemini: gemini.status(),
      env: {
        channelId: process.env.YANTO_CHANNEL_ID || null,
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      },
    });
  });

  // ---- Personality (script AI) ----
  app.get('/api/personality', (req, res) => {
    res.type('text/plain').send(fs.readFileSync(PERSONALITY_FILE, 'utf8'));
  });
  app.put('/api/personality', (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content wajib string' });
    fs.writeFileSync(PERSONALITY_FILE, content, 'utf8');
    res.json({ ok: true });
  });

  // ---- Config ----
  app.get('/api/config', (req, res) => {
    res.type('application/json').send(fs.readFileSync(CONFIG_FILE, 'utf8'));
  });
  app.put('/api/config', (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content wajib string' });
    try { JSON.parse(content); } catch (e) { return res.status(400).json({ error: 'JSON tidak valid' }); }
    fs.writeFileSync(CONFIG_FILE, content, 'utf8');
    res.json({ ok: true });
  });

  // ---- Upload script (replace bot.js / personality.js / config.json) ----
  app.post('/api/upload', upload.single('file'), (req, res) => {
    const target = req.body.target;
    const map = {
      personality: PERSONALITY_FILE,
      config:      CONFIG_FILE,
      bot:         BOT_FILE,
    };
    const dest = map[target];
    if (!dest) return res.status(400).json({ error: 'target tidak dikenal' });
    if (!req.file) return res.status(400).json({ error: 'file kosong' });
    const buf = fs.readFileSync(req.file.path);
    if (dest === CONFIG_FILE) {
      try { JSON.parse(buf.toString('utf8')); }
      catch (e) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'JSON tidak valid' }); }
    }
    fs.writeFileSync(dest, buf);
    fs.unlinkSync(req.file.path);
    res.json({ ok: true, target });
  });

  // ---- Map DB CRUD ----
  app.get('/api/maps', (req, res) => {
    res.json(mapData.listMaps());
  });
  app.post('/api/maps', (req, res) => {
    const { topic, content, tags } = req.body || {};
    if (!topic || !content) return res.status(400).json({ error: 'topic & content wajib' });
    res.json(mapData.addMap({ topic, content, tags: tags || '' }));
  });
  app.put('/api/maps/:id', (req, res) => {
    const id = Number(req.params.id);
    const { topic, content, tags } = req.body || {};
    if (!topic || !content) return res.status(400).json({ error: 'topic & content wajib' });
    res.json(mapData.updateMap({ id, topic, content, tags: tags || '' }));
  });
  app.delete('/api/maps/:id', (req, res) => {
    res.json({ ok: mapData.deleteMap(Number(req.params.id)) });
  });

  // ---- Chat history (cache) ----
  app.get('/api/history', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json(cache.listHistory(limit));
  });
  app.delete('/api/history/:id', (req, res) => {
    res.json({ ok: cache.deleteEntry(Number(req.params.id)) });
  });
  app.delete('/api/history', (req, res) => {
    res.json({ deleted: cache.clearAll() });
  });

  // ---- root ----
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return new Promise((resolve) => {
    const srv = app.listen(port, () => {
      log.info(`Dashboard ready at http://localhost:${port}`);
      resolve(srv);
    });
  });
}

module.exports = { start };
