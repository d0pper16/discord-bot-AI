'use strict';

const fs        = require('fs');
const path      = require('path');
const crypto    = require('crypto');
const express   = require('express');
const basicAuth = require('express-basic-auth');
const multer    = require('multer');

const log     = require('../utils/logger');
const mapData = require('../db/mapData');
const cache   = require('../db/chatHistory');
const gemini  = require('../ai/gemini');

const ROOT = path.join(__dirname, '..', '..');
const PERSONALITY_FILE = path.join(ROOT, 'src', 'ai', 'personality.js');
const CONFIG_FILE      = path.join(ROOT, 'config.json');
const BOT_FILE         = path.join(ROOT, 'src', 'bot.js');

const upload = multer({
  dest: path.join(ROOT, 'data', 'uploads'),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ---- Kredensial: env > default ----
const CRED = {
  dev:   { user: process.env.DEV_USER   || 'dev',
           pass: process.env.DEV_PASS   || 'devtbiapril2026' },
  admin: { user: process.env.ADMIN_USER || 'admin',
           pass: process.env.ADMIN_PASS || 'admintbi2025' },
};

function safeEq(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

function roleOf(user, pass) {
  if (safeEq(user, CRED.dev.user)   && safeEq(pass, CRED.dev.pass))   return 'dev';
  if (safeEq(user, CRED.admin.user) && safeEq(pass, CRED.admin.pass)) return 'admin';
  return null;
}

// ---- Middlewares ----
const authMw = basicAuth({
  authorizer: (user, pass) => roleOf(user, pass) !== null,
  authorizeAsync: false,
  challenge: true,
  realm: 'YantoDashboard',
});

function attachRole(req, _res, next) {
  if (req.auth) req.role = roleOf(req.auth.user, req.auth.password);
  next();
}

/** Hanya akun dev yang boleh aksi tulis. */
function requireDev(req, res, next) {
  if (req.role === 'dev') return next();
  return res.status(403).json({
    error: 'Akun admin bersifat read-only. Aksi ini butuh akun dev.',
  });
}

/**
 * Validasi konfirmasi: setiap aksi tulis WAJIB mengirim ulang
 * username + password dev di body (`_confirm_user`, `_confirm_pass`).
 * Ini meniru "yakin lakukan perubahan? isi user/pass lagi".
 */
function requireConfirm(req, res, next) {
  const u = (req.body && req.body._confirm_user) || '';
  const p = (req.body && req.body._confirm_pass) || '';
  if (safeEq(u, CRED.dev.user) && safeEq(p, CRED.dev.pass)) return next();
  return res.status(403).json({
    error: 'Konfirmasi gagal. Username/password dev salah.',
  });
}

function start() {
  const app = express();
  const port = Number(process.env.DASHBOARD_PORT || 3000);

  app.use(authMw, attachRole);
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true, limit: '4mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // ---- Identitas akun login ----
  app.get('/api/me', (req, res) => {
    res.json({ user: req.auth.user, role: req.role });
  });

  // ---- Status (boleh dibaca dev & admin) ----
  app.get('/api/status', (req, res) => {
    res.json({
      ok: true,
      role: req.role,
      gemini: gemini.status(),
      env: {
        channelId: process.env.YANTO_CHANNEL_ID || null,
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      },
    });
  });

  // =================================================================
  //  READ ENDPOINTS  (dev + admin)
  // =================================================================

  app.get('/api/personality', (req, res) => {
    res.type('text/plain').send(fs.readFileSync(PERSONALITY_FILE, 'utf8'));
  });

  app.get('/api/config', (req, res) => {
    res.type('application/json').send(fs.readFileSync(CONFIG_FILE, 'utf8'));
  });

  app.get('/api/maps', (req, res) => {
    res.json(mapData.listMaps());
  });

  app.get('/api/history', (req, res) => {
    const q     = req.query.q || '';
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json(cache.searchHistory(q, limit));
  });

  // =================================================================
  //  WRITE ENDPOINTS  (dev only + konfirmasi user/pass dev)
  // =================================================================

  // ---- Personality (script AI) ----
  app.put('/api/personality', requireDev, requireConfirm, (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content wajib string' });
    }
    fs.writeFileSync(PERSONALITY_FILE, content, 'utf8');
    log.info(`[dashboard] personality.js diperbarui oleh ${req.auth.user}`);
    res.json({ ok: true });
  });

  // ---- Config ----
  app.put('/api/config', requireDev, requireConfirm, (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content wajib string' });
    }
    try { JSON.parse(content); }
    catch (e) { return res.status(400).json({ error: 'JSON tidak valid: ' + e.message }); }
    fs.writeFileSync(CONFIG_FILE, content, 'utf8');
    log.info(`[dashboard] config.json diperbarui oleh ${req.auth.user}`);
    res.json({ ok: true });
  });

  // ---- Upload script: replace satu file saja sesuai nama target ----
  app.post('/api/upload',
    requireDev,
    upload.single('file'),
    requireConfirm,
    (req, res) => {
      const target = req.body.target;
      const map = {
        personality: PERSONALITY_FILE,
        config:      CONFIG_FILE,
        bot:         BOT_FILE,
      };
      const dest = map[target];
      if (!dest) {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(400).json({ error: 'target tidak dikenal' });
      }
      if (!req.file) return res.status(400).json({ error: 'file kosong' });

      // Nama file harus cocok dengan target (cegah replace silang)
      const expected = path.basename(dest).toLowerCase();
      const actual   = (req.file.originalname || '').toLowerCase();
      if (actual !== expected) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(400).json({
          error: `Nama file harus "${expected}" (kamu upload "${actual}").`,
        });
      }

      const buf = fs.readFileSync(req.file.path);

      // Validasi isi sesuai format
      if (dest === CONFIG_FILE) {
        try { JSON.parse(buf.toString('utf8')); }
        catch (e) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'JSON tidak valid: ' + e.message });
        }
      }

      // Tulis atomic: tulis ke .tmp lalu rename -> file lain tidak tersentuh
      const tmp = dest + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      try { fs.unlinkSync(req.file.path); } catch (_) {}

      log.info(`[dashboard] upload ${target} oleh ${req.auth.user}`);
      res.json({ ok: true, target, file: expected });
    }
  );

  // ---- Map DB CRUD ----
  app.post('/api/maps', requireDev, requireConfirm, (req, res) => {
    const { topic, content, tags } = req.body || {};
    if (!topic || !content) return res.status(400).json({ error: 'topic & content wajib' });
    res.json(mapData.addMap({ topic, content, tags: tags || '' }));
  });

  app.put('/api/maps/:id', requireDev, requireConfirm, (req, res) => {
    const id = Number(req.params.id);
    const { topic, content, tags } = req.body || {};
    if (!topic || !content) return res.status(400).json({ error: 'topic & content wajib' });
    res.json(mapData.updateMap({ id, topic, content, tags: tags || '' }));
  });

  app.delete('/api/maps/:id', requireDev, requireConfirm, (req, res) => {
    res.json({ ok: mapData.deleteMap(Number(req.params.id)) });
  });

  // ---- Chat history ----
  app.put('/api/history/:id', requireDev, requireConfirm, (req, res) => {
    const id = Number(req.params.id);
    const { question, answer } = req.body || {};
    if (!question || !answer) {
      return res.status(400).json({ error: 'question & answer wajib' });
    }
    res.json(cache.updateEntry(id, { question, answer }));
  });

  app.delete('/api/history/:id', requireDev, requireConfirm, (req, res) => {
    res.json({ ok: cache.deleteEntry(Number(req.params.id)) });
  });

  app.delete('/api/history', requireDev, requireConfirm, (req, res) => {
    res.json({ deleted: cache.clearAll() });
  });

  // ---- Error handler global ----
  app.use((err, req, res, _next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File terlalu besar (>5MB).' });
    }
    log.error('[dashboard]', err);
    res.status(500).json({ error: err.message || 'internal error' });
  });

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
