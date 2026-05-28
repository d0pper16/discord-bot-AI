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
const db      = require('../db/database');
const { bus } = require('../utils/hotReload');

const ROOT = path.join(__dirname, '..', '..');
const PERSONALITY_FILE = path.join(ROOT, 'src', 'ai', 'personality.js');
const CONFIG_FILE      = path.join(ROOT, 'config.json');
const BOT_FILE         = path.join(ROOT, 'src', 'bot.js');

const upload = multer({
  dest: path.join(ROOT, 'data', 'uploads'),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ---- Kredensial ----
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
function requireDev(req, res, next) {
  if (req.role === 'dev') return next();
  return res.status(403).json({
    error: 'Akun admin bersifat read-only. Aksi ini butuh akun dev.',
  });
}
function requireConfirm(req, res, next) {
  const u = (req.body && req.body._confirm_user) || '';
  const p = (req.body && req.body._confirm_pass) || '';
  if (safeEq(u, CRED.dev.user) && safeEq(p, CRED.dev.pass)) return next();
  return res.status(403).json({
    error: 'Konfirmasi gagal. Username/password dev salah.',
  });
}

// =================================================================
//  Validator config (min/max)
// =================================================================
const BOUNDS = {
  name:                { min: 2,   max: 20 },
  similarityThreshold: { min: 0.5, max: 1.0 },
  rpmLimit:            { min: 2,   max: 60 },
  rpdLimit:            { min: 100, max: 50000 },
  cooldownSec:         { min: 10,  max: 300 },   // dashboard: detik
  reserveTokens:       { min: 0,   max: 3 },
  maxContextMessages:  { min: 0,   max: 30 },
};

function validateConfigInput(input) {
  const errs = [];
  const name = String(input.name || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9]{1,19}$/.test(name)) {
    errs.push('Nama bot harus 2-20 karakter, alfanumerik, awal huruf (mis: Yanto, Dandi).');
  }

  const sim = Number(input.similarityThreshold);
  if (!Number.isFinite(sim) || sim < BOUNDS.similarityThreshold.min || sim > BOUNDS.similarityThreshold.max) {
    errs.push(`Threshold cache harus ${BOUNDS.similarityThreshold.min} - ${BOUNDS.similarityThreshold.max}.`);
  }
  const rpm = Number(input.rpmLimit);
  if (!Number.isInteger(rpm) || rpm < BOUNDS.rpmLimit.min || rpm > BOUNDS.rpmLimit.max) {
    errs.push(`RPM limit harus integer ${BOUNDS.rpmLimit.min} - ${BOUNDS.rpmLimit.max}.`);
  }
  const rpd = Number(input.rpdLimit);
  if (!Number.isInteger(rpd) || rpd < BOUNDS.rpdLimit.min || rpd > BOUNDS.rpdLimit.max) {
    errs.push(`RPD limit harus integer ${BOUNDS.rpdLimit.min} - ${BOUNDS.rpdLimit.max}.`);
  }
  const cdSec = Number(input.cooldownSec);
  if (!Number.isInteger(cdSec) || cdSec < BOUNDS.cooldownSec.min || cdSec > BOUNDS.cooldownSec.max) {
    errs.push(`Cooldown switch API harus ${BOUNDS.cooldownSec.min}-${BOUNDS.cooldownSec.max} detik.`);
  }
  const reserve = Number(input.reserveTokens);
  if (!Number.isInteger(reserve) || reserve < BOUNDS.reserveTokens.min || reserve > BOUNDS.reserveTokens.max) {
    errs.push(`Reserve token harus integer ${BOUNDS.reserveTokens.min}-${BOUNDS.reserveTokens.max}.`);
  }
  if (Number.isInteger(rpm) && Number.isInteger(reserve) && reserve >= rpm) {
    errs.push('Reserve token harus < RPM limit.');
  }
  const ctx = Number(input.maxContextMessages);
  if (!Number.isInteger(ctx) || ctx < BOUNDS.maxContextMessages.min || ctx > BOUNDS.maxContextMessages.max) {
    errs.push(`Memori pesan harus ${BOUNDS.maxContextMessages.min}-${BOUNDS.maxContextMessages.max}.`);
  }

  let triggers = input.specificTriggers;
  if (typeof triggers === 'string') {
    triggers = triggers.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(triggers)) {
    errs.push('Pemicu detail harus list.');
    triggers = [];
  } else if (triggers.length > 50) {
    errs.push('Pemicu detail maksimal 50 item.');
  }

  if (errs.length) return { ok: false, errors: errs };

  return {
    ok: true,
    config: {
      name,
      keyword: name.toLowerCase(),
      cache: {
        similarityThreshold: sim,
        specificTriggers: triggers,
      },
      gemini: {
        rpmLimit: rpm,
        rpdLimit: rpd,
        cooldownMs: cdSec * 1000,
        reserveTokens: reserve,
      },
      history: {
        maxContextMessages: ctx,
      },
    },
  };
}

// ---- helpers DB cache untuk rename guard ----
const CACHE_SIZE_LIMIT = 100 * 1024; // 100 KB

function cacheSizeBytes() {
  const r = db.prepare(
    `SELECT COALESCE(SUM(LENGTH(question) + LENGTH(answer) + LENGTH(question_norm)), 0) AS s
     FROM chat_history`
  ).get();
  return Number(r.s || 0);
}

function renameInCache(oldName, newName) {
  if (!oldName || !newName) return { changes: 0 };
  if (oldName.toLowerCase() === newName.toLowerCase()) return { changes: 0 };

  const variants = (s) => [
    s,
    s.toLowerCase(),
    s.toUpperCase(),
    s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(),
  ];
  const oldV = variants(oldName);
  const newV = variants(newName);

  // Bangun ekspresi REPLACE bertumpuk untuk semua varian
  const buildExpr = (col) => {
    let expr = col;
    for (let i = 0; i < oldV.length; i++) {
      expr = `REPLACE(${expr}, ?, ?)`;
    }
    return expr;
  };

  const params = [];
  for (let i = 0; i < oldV.length; i++) { params.push(oldV[i], newV[i]); } // question
  for (let i = 0; i < oldV.length; i++) { params.push(oldV[i], newV[i]); } // answer
  for (let i = 0; i < oldV.length; i++) { params.push(oldV[i], newV[i]); } // question_norm

  const sql = `UPDATE chat_history SET
    question      = ${buildExpr('question')},
    answer        = ${buildExpr('answer')},
    question_norm = ${buildExpr('question_norm')},
    updated_at    = strftime('%s','now')`;
  return db.prepare(sql).run(...params);
}

// =================================================================
//  Server start
// =================================================================
function start() {
  const app = express();
  const port = Number(process.env.DASHBOARD_PORT || 3000);

  app.use(authMw, attachRole);
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true, limit: '4mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // ---- Identitas ----
  app.get('/api/me', (req, res) => {
    res.json({ user: req.auth.user, role: req.role });
  });

  // ---- Status ----
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
  //  READ (dev + admin)
  // =================================================================
  app.get('/api/personality', (_req, res) => {
    res.type('text/plain').send(fs.readFileSync(PERSONALITY_FILE, 'utf8'));
  });
  app.get('/api/config', (_req, res) => {
    res.type('application/json').send(fs.readFileSync(CONFIG_FILE, 'utf8'));
  });

  /** Config dalam bentuk struktur friendly untuk form (cooldownSec, dst). */
  app.get('/api/config-fields', (_req, res) => {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    res.json({
      bounds: BOUNDS,
      values: {
        name: cfg.name || 'Yanto',
        similarityThreshold: cfg.cache.similarityThreshold,
        rpmLimit: cfg.gemini.rpmLimit,
        rpdLimit: cfg.gemini.rpdLimit,
        cooldownSec: Math.round((cfg.gemini.cooldownMs || 60000) / 1000),
        reserveTokens: cfg.gemini.reserveTokens || 0,
        maxContextMessages: cfg.history.maxContextMessages,
        specificTriggers: cfg.cache.specificTriggers || [],
      },
      cacheSizeBytes: cacheSizeBytes(),
      cacheLimitBytes: CACHE_SIZE_LIMIT,
    });
  });

  app.get('/api/cache-size', (_req, res) => {
    res.json({ bytes: cacheSizeBytes(), limit: CACHE_SIZE_LIMIT });
  });

  app.get('/api/maps', (_req, res) => res.json(mapData.listMaps()));

  app.get('/api/history', (req, res) => {
    const q     = req.query.q || '';
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json(cache.searchHistory(q, limit));
  });

  // =================================================================
  //  WRITE (dev only + konfirmasi)
  // =================================================================

  // ---- Personality ----
  app.put('/api/personality', requireDev, requireConfirm, (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content wajib string' });
    const tmp = PERSONALITY_FILE + '.tmp';
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, PERSONALITY_FILE);
    log.info(`[dashboard] personality.js diperbarui oleh ${req.auth.user}`);
    res.json({ ok: true });
  });

  // ---- Config via form fields ----
  app.put('/api/config-fields', requireDev, requireConfirm, (req, res) => {
    const v = validateConfigInput(req.body);
    if (!v.ok) return res.status(400).json({ error: v.errors.join(' | '), errors: v.errors });

    const newCfg = v.config;
    const oldCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const oldName = oldCfg.name || 'Yanto';
    const newName = newCfg.name;

    // Rename guard: cache > 100KB harus dihapus dulu
    let renameInfo = { changes: 0 };
    if (oldName.toLowerCase() !== newName.toLowerCase()) {
      const size = cacheSizeBytes();
      if (size > CACHE_SIZE_LIMIT) {
        return res.status(400).json({
          error: `Cache ingatan ${(size / 1024).toFixed(1)}KB melebihi 100KB. Hapus dulu cache di tab "Riwayat Chat" sebelum mengubah nama bot.`,
          cacheSizeBytes: size,
          cacheLimitBytes: CACHE_SIZE_LIMIT,
        });
      }
      renameInfo = renameInCache(oldName, newName);
      log.info(`[dashboard] rename bot ${oldName} -> ${newName}, cache rows updated=${renameInfo.changes}`);
    }

    // Tulis config atomic
    const tmp = CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(newCfg, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
    log.info(`[dashboard] config.json diperbarui oleh ${req.auth.user}`);
    res.json({ ok: true, renamedRows: renameInfo.changes });
  });

  // ---- Upload script ----
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

      const expected = path.basename(dest).toLowerCase();
      const actual   = (req.file.originalname || '').toLowerCase();
      if (actual !== expected) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(400).json({
          error: `Nama file harus "${expected}" (kamu upload "${actual}").`,
        });
      }

      const buf = fs.readFileSync(req.file.path);
      if (dest === CONFIG_FILE) {
        try { JSON.parse(buf.toString('utf8')); }
        catch (e) {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ error: 'JSON tidak valid: ' + e.message });
        }
      }

      // Atomic write -> file lain TIDAK tersentuh
      const tmp = dest + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      try { fs.unlinkSync(req.file.path); } catch (_) {}

      log.info(`[dashboard] upload ${target} oleh ${req.auth.user}`);

      // Khusus bot.js: trigger graceful restart 2 detik kemudian
      if (target === 'bot') {
        setTimeout(() => {
          try { bus.emit('upload:bot'); }
          catch (e) { log.error('emit upload:bot', e); }
        }, 2000);
        return res.json({ ok: true, target, file: expected, restarting: true });
      }
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
    if (!question || !answer) return res.status(400).json({ error: 'question & answer wajib' });
    res.json(cache.updateEntry(id, { question, answer }));
  });
  app.delete('/api/history/:id', requireDev, requireConfirm, (req, res) => {
    res.json({ ok: cache.deleteEntry(Number(req.params.id)) });
  });
  app.delete('/api/history', requireDev, requireConfirm, (req, res) => {
    res.json({ deleted: cache.clearAll() });
  });

  // ---- Error handler ----
  app.use((err, _req, res, _next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File terlalu besar (>5MB).' });
    }
    log.error('[dashboard]', err);
    res.status(500).json({ error: err.message || 'internal error' });
  });

  app.get('/', (_req, res) => {
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
