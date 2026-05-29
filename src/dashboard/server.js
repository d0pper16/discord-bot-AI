'use strict';

const fs        = require('fs');
const os        = require('os');
const path      = require('path');
const crypto    = require('crypto');
const express   = require('express');
const basicAuth = require('express-basic-auth');
const multer    = require('multer');

const log     = require('../utils/logger');
const mapData = require('../db/mapData');
const cache   = require('../db/chatHistory');
const chatLog = require('../db/chatLog');
const gemini  = require('../ai/gemini');
const audit   = require('../db/audit');
const db      = require('../db/database');
const runtime = require('../utils/runtimeEnv');
const robloxWatcher = require('../roblox/watcher');
const { bus } = require('../utils/hotReload');

const ROOT = path.join(__dirname, '..', '..');
const PERSONALITY_FILE = path.join(ROOT, 'src', 'ai', 'personality.js');
const CONFIG_FILE      = path.join(ROOT, 'config.json');
const BOT_FILE         = path.join(ROOT, 'src', 'bot.js');

const upload = multer({
  dest: path.join(ROOT, 'data', 'uploads'),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// =================================================================
//  Kredensial
// =================================================================
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

// =================================================================
//  Middlewares
// =================================================================
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

/** Konfirmasi yang menerima dev ATAU admin (dipakai utk persona overlay). */
function requireConfirmAny(req, res, next) {
  const u = (req.body && req.body._confirm_user) || '';
  const p = (req.body && req.body._confirm_pass) || '';
  if (safeEq(u, CRED.dev.user) && safeEq(p, CRED.dev.pass)) return next();
  if (safeEq(u, CRED.admin.user) && safeEq(p, CRED.admin.pass)) return next();
  return res.status(403).json({
    error: 'Konfirmasi gagal. Username/password tidak match dev maupun admin.',
  });
}

// =================================================================
//  Validator config
//  RPD dikunci 995 (req. user, demi keamanan kuota harian)
//  RPM range 5-14 (req. user)
// =================================================================
const RPD_FIXED = 995;
const BOUNDS = {
  name:                { min: 2,   max: 20 },
  similarityThreshold: { min: 0.5, max: 1.0 },
  rpmLimit:            { min: 5,   max: 14 },
  rpdLimit:            { fixed: RPD_FIXED },
  cooldownSec:         { min: 10,  max: 300 },
  reserveTokens:       { min: 0,   max: 3 },
  maxContextMessages:  { min: 0,   max: 30 },
};

function validateConfigInput(input) {
  const errs = [];
  const name = String(input.name || '').trim();
  if (!/^[A-Za-z][A-Za-z0-9]{1,19}$/.test(name)) {
    errs.push('Nama bot harus 2-20 karakter, alfanumerik, awal huruf.');
  }
  const sim = Number(input.similarityThreshold);
  if (!Number.isFinite(sim) || sim < BOUNDS.similarityThreshold.min || sim > BOUNDS.similarityThreshold.max) {
    errs.push(`Threshold cache harus ${BOUNDS.similarityThreshold.min} - ${BOUNDS.similarityThreshold.max}.`);
  }
  const rpm = Number(input.rpmLimit);
  if (!Number.isInteger(rpm) || rpm < BOUNDS.rpmLimit.min || rpm > BOUNDS.rpmLimit.max) {
    errs.push(`RPM limit harus integer ${BOUNDS.rpmLimit.min} - ${BOUNDS.rpmLimit.max}.`);
  }
  // RPD dikunci di RPD_FIXED, abaikan input dari client
  const rpd = RPD_FIXED;
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
  if (!Array.isArray(triggers)) { errs.push('Pemicu detail harus list.'); triggers = []; }
  else if (triggers.length > 50) { errs.push('Pemicu detail maksimal 50 item.'); }

  if (errs.length) return { ok: false, errors: errs };

  return {
    ok: true,
    config: {
      name,
      keyword: name.toLowerCase(),
      cache: { similarityThreshold: sim, specificTriggers: triggers },
      gemini: { rpmLimit: rpm, rpdLimit: rpd, cooldownMs: cdSec * 1000, reserveTokens: reserve },
      history: { maxContextMessages: ctx },
    },
  };
}

// =================================================================
//  Cache size + rename helpers
// =================================================================
const CACHE_SIZE_LIMIT = 100 * 1024;

function cacheSizeBytes() {
  const r = db.prepare(
    `SELECT COALESCE(SUM(LENGTH(question) + LENGTH(answer) + LENGTH(question_norm)), 0) AS s
     FROM chat_history`
  ).get();
  return Number(r.s || 0);
}

/**
 * Rename DINAMIS: memakai oldName & newName apa pun, semua varian case.
 * Mis. dandi -> yanti, ganti dandi/DANDI/Dandi -> yanti/YANTI/Yanti.
 */
function renameInCache(oldName, newName) {
  if (!oldName || !newName) return { changes: 0 };
  if (oldName.toLowerCase() === newName.toLowerCase()) return { changes: 0 };

  const variants = (s) => Array.from(new Set([
    s,
    s.toLowerCase(),
    s.toUpperCase(),
    s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(),
  ]));
  const oldV = variants(oldName);
  const newV = variants(newName);

  // Pastikan jumlah varian sama (set unik bisa beda) -> padding
  while (newV.length < oldV.length) newV.push(newName);

  const buildExpr = (col) => {
    let expr = col;
    for (let i = 0; i < oldV.length; i++) expr = `REPLACE(${expr}, ?, ?)`;
    return expr;
  };

  const params = [];
  for (let pass = 0; pass < 3; pass++) { // 3x utk question, answer, question_norm
    for (let i = 0; i < oldV.length; i++) params.push(oldV[i], newV[i]);
  }

  const sql = `UPDATE chat_history SET
    question      = ${buildExpr('question')},
    answer        = ${buildExpr('answer')},
    question_norm = ${buildExpr('question_norm')},
    updated_at    = strftime('%s','now')`;
  return db.prepare(sql).run(...params);
}

// =================================================================
//  File Manager helpers
// =================================================================
const TEXT_EXT = /\.(js|json|md|css|html|txt|yml|yaml|cjs|mjs)$/i;
const IGNORED_DIRS = new Set(['node_modules', '.git', 'data', '.idea', '.vscode']);
const PROTECTED = new Set([
  'package.json',
  'runner.js',
  'config.json',
  'src/index.js',
  'src/bot.js',
  'src/ai/gemini.js',
  'src/ai/personality.js',
  'src/db/database.js',
  'src/db/mapData.js',
  'src/db/chatHistory.js',
  'src/dashboard/server.js',
  'src/dashboard/public/index.html',
  'src/dashboard/public/app.js',
  'src/dashboard/public/style.css',
  'src/utils/hotReload.js',
  'src/utils/logger.js',
]);

function safeRel(rel) {
  if (typeof rel !== 'string' || !rel.trim()) throw new Error('path wajib');
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (cleaned.includes('..') || cleaned.includes('\0')) throw new Error('Path traversal terdeteksi');
  const abs = path.resolve(ROOT, cleaned);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) throw new Error('Path di luar project root');
  const segs = cleaned.split('/');
  if (segs.some(s => s.startsWith('.'))) throw new Error('Path tersembunyi tidak diizinkan');
  if (segs.some(s => IGNORED_DIRS.has(s))) throw new Error('Path masuk direktori terlarang');
  if (cleaned.toLowerCase() === '.env') throw new Error('.env tidak boleh diakses dari dashboard');
  return { abs, rel: cleaned };
}

function listProjectFiles() {
  const out = [];
  function walk(dir) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && TEXT_EXT.test(e.name)) {
        const rel = path.relative(ROOT, full).split(path.sep).join('/');
        let size = 0; try { size = fs.statSync(full).size; } catch (_) {}
        out.push({
          path: rel,
          size,
          ext: path.extname(e.name).slice(1).toLowerCase(),
          protected: PROTECTED.has(rel),
        });
      }
    }
  }
  walk(ROOT);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/** Cari file dengan nama mirip (Lev <= 2) di direktori tujuan. */
function findSimilar(targetDir, fileName, maxDistance = 2) {
  let dirAbs;
  try { dirAbs = path.resolve(ROOT, targetDir); }
  catch (_) { return []; }
  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) return [];
  const lower = fileName.toLowerCase();
  let entries; try { entries = fs.readdirSync(dirAbs); } catch (_) { return []; }
  return entries
    .filter((n) => {
      try { return fs.statSync(path.join(dirAbs, n)).isFile() && !n.startsWith('.'); }
      catch (_) { return false; }
    })
    .map((n) => ({ name: n, distance: levenshtein(lower, n.toLowerCase()) }))
    .filter((x) => x.distance > 0 && x.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);
}

function atomicWriteFile(absPath, buf) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = absPath + '.tmp-' + Date.now();
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, absPath);
}

// =================================================================
//  start()
// =================================================================
// =================================================================
//  System monitor (CPU sample window)
// =================================================================
let cpuSnapshot = process.cpuUsage();
let cpuSnapshotTime = process.hrtime.bigint();
let CURRENT_CPU_PERCENT = 0;

setInterval(() => {
  try {
    const cur = process.cpuUsage();
    const now = process.hrtime.bigint();
    const elapsedMicros = Number(now - cpuSnapshotTime) / 1000;
    const cpuMicros = (cur.user - cpuSnapshot.user) + (cur.system - cpuSnapshot.system);
    CURRENT_CPU_PERCENT = elapsedMicros > 0
      ? Math.min(100, Math.max(0, (cpuMicros / elapsedMicros) * 100))
      : 0;
    cpuSnapshot = cur;
    cpuSnapshotTime = now;
  } catch (_) {}
}, 2000).unref();

function diskUsage() {
  try {
    if (typeof fs.statfsSync === 'function') {
      const s = fs.statfsSync(__dirname);
      const blockSize = Number(s.bsize);
      const total = blockSize * Number(s.blocks);
      const free = blockSize * Number(s.bfree || s.bavail || 0);
      const used = total - free;
      return {
        total, used, free,
        percent: total > 0 ? (used / total) * 100 : 0,
        method: 'statfs',
      };
    }
  } catch (e) { /* fallback below */ }
  return { total: 0, used: 0, free: 0, percent: 0, method: 'unavailable' };
}

function start() {
  const app = express();
  const port = Number(process.env.DASHBOARD_PORT || 3000);

  app.use(authMw, attachRole);
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true, limit: '4mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // ----------- Identity / Status -----------
  app.get('/api/me', (req, res) => res.json({ user: req.auth.user, role: req.role }));

  app.get('/api/status', (req, res) => {
    res.json({
      ok: true,
      role: req.role,
      gemini: { ...gemini.status(), lastUsedKey: gemini.lastUsedKey() },
      env: {
        channelId: process.env.YANTO_CHANNEL_ID || null,
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      },
    });
  });

  // ---- System Monitor ----
  app.get('/api/system', (_req, res) => {
    const totalMem = os.totalmem();
    const freeMem  = os.freemem();
    const usedMem  = totalMem - freeMem;
    const procMem  = process.memoryUsage();
    const cores    = os.cpus().length || 1;
    const loadAvg  = os.loadavg();
    res.json({
      uptime:  Math.floor(process.uptime()),
      uptimeOs: Math.floor(os.uptime()),
      memory: {
        total: totalMem, used: usedMem, free: freeMem,
        percent: (usedMem / totalMem) * 100,
        process: {
          rss: procMem.rss,
          heapUsed: procMem.heapUsed,
          heapTotal: procMem.heapTotal,
          external: procMem.external,
        },
      },
      cpu: {
        cores,
        processPercent: CURRENT_CPU_PERCENT,
        loadAvg,
        loadPercent: Math.min(100, (loadAvg[0] / cores) * 100),
      },
      disk: diskUsage(),
      gemini: { ...gemini.status(), lastUsedKey: gemini.lastUsedKey() },
      proc: { pid: process.pid, node: process.version, platform: process.platform },
    });
  });

  // ---- Server Logs (logger 1, in-memory) ----
  app.get('/api/logs', (req, res) => {
    const since = Number(req.query.since) || 0;
    const level = req.query.level || 'all';
    res.json({
      now: Date.now(),
      stats: log.stats(),
      entries: log.getBuffer(since, level),
    });
  });

  // ---- Chat Log (logger 2, persisten SQLite) ----
  app.get('/api/chat-log', (req, res) => {
    const q     = req.query.q || '';
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json({
      total: chatLog.count(),
      entries: chatLog.search(q, limit),
    });
  });
  app.delete('/api/chat-log', requireDev, requireConfirm, (req, res) => {
    const deleted = chatLog.clearAll();
    audit.log(req.auth.user, 'chatLog.clearAll', 'all', `${deleted} rows`);
    res.json({ deleted });
  });

  // ---- Connection (channel + 2 API key) -- read masked ----
  app.get('/api/connection', (_req, res) => {
    const rt = runtime.readFile();
    res.json({
      channelId:    process.env.YANTO_CHANNEL_ID || '',
      primaryMask:  runtime.maskKey(process.env.GEMINI_API_KEY_PRIMARY),
      secondaryMask: runtime.maskKey(process.env.GEMINI_API_KEY_SECONDARY),
      hasOverrides: !!Object.keys(rt).length,
      overrideFile: 'data/runtime.json',
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
  app.get('/api/config-fields', (_req, res) => {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    res.json({
      bounds: BOUNDS,
      values: {
        name: cfg.name || 'Yanto',
        similarityThreshold: cfg.cache.similarityThreshold,
        rpmLimit: cfg.gemini.rpmLimit,
        rpdLimit: RPD_FIXED,
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
    const q = req.query.q || '';
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json(cache.searchHistory(q, limit));
  });

  // ----------- Audit Log (read-only utk admin & dev) -----------
  app.get('/api/audit', (req, res) => {
    const q     = req.query.q || '';
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json(audit.search(q, limit));
  });

  // ----------- Persona Overlay (READ utk semua role) -----------
  app.get('/api/persona-overlay', (_req, res) => {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      res.json({
        overlay: typeof cfg.personaOverlay === 'string' ? cfg.personaOverlay : '',
        maxLength: 500,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ----------- Roblox Watcher: status + config (READ semua role) -----------
  app.get('/api/roblox-status', (_req, res) => {
    res.json(robloxWatcher.getStatus());
  });
  app.get('/api/roblox-config', (_req, res) => {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      const uid = (cfg.roblox && cfg.roblox.universeId) || '';
      res.json({ universeId: uid });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ----------- DB Export (dev & admin boleh download backup) -----------
  app.get('/api/db/export', (req, res) => {
    const data = {
      exportedAt: new Date().toISOString(),
      version: 1,
      map_data: db.prepare('SELECT * FROM map_data ORDER BY id').all(),
      chat_history: db.prepare('SELECT * FROM chat_history ORDER BY id').all(),
    };
    audit.log(req.auth.user, 'db.export', 'database',
      JSON.stringify({ maps: data.map_data.length, history: data.chat_history.length }));
    res.setHeader('Content-Disposition',
      `attachment; filename="yanto-db-${Date.now()}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, 2));
  });

  // ----------- File manager: list & read -----------
  app.get('/api/files', (_req, res) => {
    res.json({ files: listProjectFiles(), protected: Array.from(PROTECTED) });
  });
  app.get('/api/files/read', (req, res) => {
    try {
      const { abs, rel } = safeRel(req.query.path || '');
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        return res.status(404).json({ error: 'file tidak ditemukan' });
      }
      if (!TEXT_EXT.test(rel)) return res.status(400).json({ error: 'hanya file teks yang bisa dibaca' });
      res.json({
        path: rel,
        content: fs.readFileSync(abs, 'utf8'),
        protected: PROTECTED.has(rel),
        size: fs.statSync(abs).size,
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // =================================================================
  //  WRITE (dev only + konfirmasi)
  // =================================================================

  // ----------- Personality (dipakai tab khusus) -----------
  app.put('/api/personality', requireDev, requireConfirm, (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string') return res.status(400).json({ error: 'content wajib string' });
    atomicWriteFile(PERSONALITY_FILE, Buffer.from(content, 'utf8'));
    audit.log(req.auth.user, 'personality.save', 'src/ai/personality.js', `${content.length} bytes`);
    log.info(`[dashboard] personality.js diperbarui oleh ${req.auth.user}`);
    res.json({ ok: true });
  });

  // ----------- Config form -----------
  app.put('/api/config-fields', requireDev, requireConfirm, (req, res) => {
    const v = validateConfigInput(req.body);
    if (!v.ok) return res.status(400).json({ error: v.errors.join(' | '), errors: v.errors });

    const newCfg = v.config;
    const oldCfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const oldName = oldCfg.name || 'Yanto';
    const newName = newCfg.name;
    const force = !!req.body.force;

    let renameInfo = { changes: 0 };
    let cleared = 0;
    if (oldName.toLowerCase() !== newName.toLowerCase()) {
      const size = cacheSizeBytes();
      if (size > CACHE_SIZE_LIMIT && !force) {
        // Konfirmasi force diperlukan
        return res.status(409).json({
          requiresForce: true,
          oldName, newName,
          cacheSizeBytes: size,
          cacheLimitBytes: CACHE_SIZE_LIMIT,
          message: `Peringatan: Cache ${(size / 1024).toFixed(1)}KB > 100KB. Ganti nama akan menghapus cache ingatan. Lanjutkan?`,
        });
      }
      if (force && size > CACHE_SIZE_LIMIT) {
        cleared = cache.clearAll();
        log.warn(`[rename] force=true, cache dihapus (${cleared} rows)`);
      } else {
        renameInfo = renameInCache(oldName, newName);
      }
      log.info(`[dashboard] rename bot ${oldName} -> ${newName} (cache rows updated=${renameInfo.changes}, cleared=${cleared})`);
    }

    atomicWriteFile(CONFIG_FILE, Buffer.from(JSON.stringify(newCfg, null, 2), 'utf8'));
    audit.log(req.auth.user, 'config.save', 'config.json',
      JSON.stringify({ oldName, newName, renamedRows: renameInfo.changes, clearedRows: cleared }));
    log.info(`[dashboard] config.json diperbarui oleh ${req.auth.user}`);
    res.json({ ok: true, renamedRows: renameInfo.changes, clearedRows: cleared });
  });

  // ----------- Tombol Restart / Shutdown -----------
  app.post('/api/restart', requireDev, requireConfirm, (req, res) => {
    audit.log(req.auth.user, 'system.restart', 'process', '');
    setTimeout(() => bus.emit('restart'), 500);
    res.json({ ok: true, action: 'restart' });
  });
  app.post('/api/shutdown', requireDev, requireConfirm, (req, res) => {
    audit.log(req.auth.user, 'system.shutdown', 'process', '');
    setTimeout(() => bus.emit('shutdown'), 500);
    res.json({ ok: true, action: 'shutdown' });
  });

  // ----------- Persona Overlay update (admin ATAU dev) -----------
  app.put('/api/persona-overlay', requireConfirmAny, (req, res) => {
    let { overlay } = req.body || {};
    if (typeof overlay !== 'string') overlay = '';
    if (overlay.length > 500) {
      return res.status(400).json({ error: 'Overlay maksimal 500 karakter.' });
    }
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      cfg.personaOverlay = overlay;
      atomicWriteFile(CONFIG_FILE, Buffer.from(JSON.stringify(cfg, null, 2), 'utf8'));
      audit.log(req.auth.user, 'persona.overlay.save', 'config.json',
        `len=${overlay.length}`);
      log.info(`[dashboard] persona overlay diperbarui oleh ${req.auth.user} (len=${overlay.length})`);
      res.json({ ok: true, length: overlay.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ----------- Roblox Watcher: update universe ID (dev only) -----------
  app.put('/api/roblox-config', requireDev, requireConfirm, (req, res) => {
    let { universeId } = req.body || {};
    universeId = universeId == null ? '' : String(universeId).trim();
    if (universeId !== '' && !/^\d{1,20}$/.test(universeId)) {
      return res.status(400).json({ error: 'Universe ID harus angka 1-20 digit (atau kosong utk disable).' });
    }
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      cfg.roblox = cfg.roblox || {};
      cfg.roblox.universeId = universeId;
      atomicWriteFile(CONFIG_FILE, Buffer.from(JSON.stringify(cfg, null, 2), 'utf8'));
      // Restart watcher dengan ID baru (atau stop kalau kosong)
      try { robloxWatcher.start(universeId); }
      catch (e) { log.warn('[roblox] start error:', e.message); }
      audit.log(req.auth.user, 'roblox.config.save', 'config.json',
        universeId ? `universeId=${universeId}` : 'disabled');
      log.info(`[dashboard] roblox universe ID diperbarui oleh ${req.auth.user}: "${universeId}"`);
      res.json({ ok: true, universeId, status: robloxWatcher.getStatus() });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ----------- Connection update (channel + API keys) -----------
  app.put('/api/connection', requireDev, requireConfirm, async (req, res) => {
    try {
      const bot = require('../bot');
      const updates = {};
      if (typeof req.body.channelId === 'string'    && req.body.channelId.trim())    updates.channelId    = req.body.channelId.trim();
      if (typeof req.body.primaryKey === 'string'   && req.body.primaryKey.trim())   updates.primaryKey   = req.body.primaryKey.trim();
      if (typeof req.body.secondaryKey === 'string' && req.body.secondaryKey.trim()) updates.secondaryKey = req.body.secondaryKey.trim();

      if (!Object.keys(updates).length) {
        return res.status(400).json({ error: 'minimal 1 field harus diisi' });
      }

      // Step 1: Validasi tanpa modifikasi env
      const v = await bot.validateNewValues(updates);
      if (!v.ok) {
        log.warn('[connection] validasi gagal:', JSON.stringify(v.errors));
        return res.status(400).json({ ok: false, errors: v.errors });
      }

      // Step 2: Apply (persist + reload validation + send hello)
      const r = await bot.applyEnvUpdate(updates);
      audit.log(req.auth.user, 'connection.update', 'runtime',
        JSON.stringify({ fields: Object.keys(updates), apiOk: r.apiOk, chOk: r.chOk }));
      res.json({ ok: r.ok, apiOk: r.apiOk, chOk: r.chOk });
    } catch (e) {
      log.error('[connection] error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ----------- File Manager: simpan (edit) file existing -----------
  app.put('/api/files/save', requireDev, requireConfirm, (req, res) => {
    try {
      const { path: rel, content } = req.body || {};
      if (typeof content !== 'string') return res.status(400).json({ error: 'content wajib string' });
      const sf = safeRel(rel);
      if (!fs.existsSync(sf.abs)) return res.status(404).json({ error: 'file tidak ditemukan, gunakan endpoint create' });
      if (!TEXT_EXT.test(sf.rel)) return res.status(400).json({ error: 'hanya file teks yg dapat di-edit' });
      // Validasi JSON kalau .json
      if (/\.json$/i.test(sf.rel)) {
        try { JSON.parse(content); }
        catch (e) { return res.status(400).json({ error: 'JSON tidak valid: ' + e.message }); }
      }
      atomicWriteFile(sf.abs, Buffer.from(content, 'utf8'));
      audit.log(req.auth.user, 'files.save', sf.rel, `${content.length} bytes`);
      log.info(`[files] save ${sf.rel} oleh ${req.auth.user}`);

      const isBot = sf.rel === 'src/bot.js';
      if (isBot) setTimeout(() => bus.emit('upload:bot'), 1000);
      res.json({ ok: true, path: sf.rel, restarting: isBot });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ----------- File Manager: buat file baru -----------
  app.post('/api/files/create', requireDev, requireConfirm, (req, res) => {
    try {
      const { path: rel, content = '' } = req.body || {};
      const sf = safeRel(rel);
      if (fs.existsSync(sf.abs)) {
        return res.status(409).json({ error: 'file sudah ada, gunakan save (update)' });
      }
      if (!TEXT_EXT.test(sf.rel)) return res.status(400).json({ error: 'ekstensi belum didukung' });
      if (/\.json$/i.test(sf.rel) && content) {
        try { JSON.parse(content); }
        catch (e) { return res.status(400).json({ error: 'JSON tidak valid: ' + e.message }); }
      }
      atomicWriteFile(sf.abs, Buffer.from(String(content), 'utf8'));
      audit.log(req.auth.user, 'files.create', sf.rel, `${String(content).length} bytes`);
      log.info(`[files] create ${sf.rel} oleh ${req.auth.user}`);
      res.json({ ok: true, path: sf.rel });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ----------- File Manager: hapus -----------
  app.delete('/api/files/delete', requireDev, requireConfirm, (req, res) => {
    try {
      const { path: rel } = req.body || {};
      const sf = safeRel(rel);
      if (PROTECTED.has(sf.rel)) {
        return res.status(403).json({ error: `File ${sf.rel} dilindungi. Tidak bisa dihapus.` });
      }
      if (!fs.existsSync(sf.abs)) return res.status(404).json({ error: 'file tidak ditemukan' });
      fs.unlinkSync(sf.abs);
      audit.log(req.auth.user, 'files.delete', sf.rel, '');
      log.info(`[files] delete ${sf.rel} oleh ${req.auth.user}`);
      res.json({ ok: true, path: sf.rel });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ----------- File Manager: upload (dengan typo guard) -----------
  app.post('/api/files/upload',
    requireDev,
    upload.single('file'),
    requireConfirm,
    (req, res) => {
      const cleanup = () => { if (req.file) try { fs.unlinkSync(req.file.path); } catch (_) {} };
      try {
        if (!req.file) { cleanup(); return res.status(400).json({ error: 'file kosong' }); }

        const dir       = String(req.body.dir || '').replace(/^\/+|\/+$/g, '');
        const mode      = String(req.body.mode || 'auto');         // 'auto' | 'update' | 'create'
        const tgtPath   = String(req.body.target_path || '').trim();
        const orig      = req.file.originalname || '';

        // tentukan target
        let relTarget;
        if (tgtPath) {
          relTarget = tgtPath;
        } else {
          if (!orig) { cleanup(); return res.status(400).json({ error: 'nama file kosong' }); }
          relTarget = (dir ? dir + '/' : '') + orig;
        }

        const sf = safeRel(relTarget);
        if (!TEXT_EXT.test(sf.rel)) {
          cleanup();
          return res.status(400).json({ error: 'ekstensi tidak didukung (hanya teks)' });
        }

        const exists = fs.existsSync(sf.abs);

        // Mode auto -> pre-flight typo detection
        if (mode === 'auto') {
          if (exists) {
            // exact target ada -> minta konfirmasi sebagai update
            cleanup();
            return res.status(409).json({
              status: 'exists',
              targetPath: sf.rel,
              message: `File ${sf.rel} sudah ada. Pilih: update (timpa) atau batalkan dan rename file.`,
            });
          }
          // target belum ada -> cek typo di direktori parent
          const parentDir = path.dirname(sf.rel);
          const fileName  = path.basename(sf.rel);
          const sims = findSimilar(parentDir, fileName, 2);
          if (sims.length) {
            cleanup();
            return res.status(409).json({
              status: 'ambiguous',
              targetPath: sf.rel,
              parentDir,
              uploaded: fileName,
              suggestions: sims.map(s => ({
                path: (parentDir === '.' ? '' : parentDir + '/') + s.name,
                name: s.name,
                distance: s.distance,
              })),
              message: `File "${fileName}" mirip dengan file existing (beda 1-2 huruf). Pilih: update file existing atau buat file baru.`,
            });
          }
          // benar-benar baru -> minta konfirmasi sebagai NEW
          cleanup();
          return res.status(409).json({
            status: 'new',
            targetPath: sf.rel,
            message: `File baru: ${sf.rel}. Konfirmasi penambahan file baru?`,
          });
        }

        // Mode 'update'
        if (mode === 'update') {
          if (!exists) {
            cleanup();
            return res.status(400).json({ error: `target ${sf.rel} tidak ada untuk di-update` });
          }
          const buf = fs.readFileSync(req.file.path);
          if (/\.json$/i.test(sf.rel)) {
            try { JSON.parse(buf.toString('utf8')); }
            catch (e) { cleanup(); return res.status(400).json({ error: 'JSON tidak valid: ' + e.message }); }
          }
          atomicWriteFile(sf.abs, buf);
          cleanup();
          audit.log(req.auth.user, 'files.upload.update', sf.rel, '');
          log.info(`[files] upload UPDATE ${sf.rel} oleh ${req.auth.user}`);
          const isBot = sf.rel === 'src/bot.js';
          if (isBot) setTimeout(() => bus.emit('upload:bot'), 1000);
          return res.json({ ok: true, mode: 'update', path: sf.rel, restarting: isBot });
        }

        // Mode 'create'
        if (mode === 'create') {
          if (exists) {
            cleanup();
            return res.status(409).json({ error: `target ${sf.rel} sudah ada (gunakan mode=update)` });
          }
          const buf = fs.readFileSync(req.file.path);
          if (/\.json$/i.test(sf.rel)) {
            try { JSON.parse(buf.toString('utf8')); }
            catch (e) { cleanup(); return res.status(400).json({ error: 'JSON tidak valid: ' + e.message }); }
          }
          atomicWriteFile(sf.abs, buf);
          cleanup();
          audit.log(req.auth.user, 'files.upload.create', sf.rel, '');
          log.info(`[files] upload CREATE ${sf.rel} oleh ${req.auth.user}`);
          return res.json({ ok: true, mode: 'create', path: sf.rel });
        }

        cleanup();
        return res.status(400).json({ error: 'mode tidak dikenal (auto/update/create)' });
      } catch (e) {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch (_) {}
        return res.status(400).json({ error: e.message });
      }
    }
  );

  // ----------- Map DB CRUD -----------
  app.post('/api/maps', requireDev, requireConfirm, (req, res) => {
    const { topic, content, tags } = req.body || {};
    if (!topic || !content) return res.status(400).json({ error: 'topic & content wajib' });
    const row = mapData.addMap({ topic, content, tags: tags || '' });
    audit.log(req.auth.user, 'map.create', `map:${row.id}`, topic);
    res.json(row);
  });
  app.put('/api/maps/:id', requireDev, requireConfirm, (req, res) => {
    const id = Number(req.params.id);
    const { topic, content, tags } = req.body || {};
    if (!topic || !content) return res.status(400).json({ error: 'topic & content wajib' });
    const row = mapData.updateMap({ id, topic, content, tags: tags || '' });
    audit.log(req.auth.user, 'map.update', `map:${id}`, topic);
    res.json(row);
  });
  app.delete('/api/maps/:id', requireDev, requireConfirm, (req, res) => {
    const id = Number(req.params.id);
    const ok = mapData.deleteMap(id);
    audit.log(req.auth.user, 'map.delete', `map:${id}`, '');
    res.json({ ok });
  });

  // ----------- Chat history -----------
  app.put('/api/history/:id', requireDev, requireConfirm, (req, res) => {
    const id = Number(req.params.id);
    const { question, answer } = req.body || {};
    if (!question || !answer) return res.status(400).json({ error: 'question & answer wajib' });
    const row = cache.updateEntry(id, { question, answer });
    audit.log(req.auth.user, 'history.update', `history:${id}`, '');
    res.json(row);
  });
  app.delete('/api/history/:id', requireDev, requireConfirm, (req, res) => {
    const id = Number(req.params.id);
    const ok = cache.deleteEntry(id);
    audit.log(req.auth.user, 'history.delete', `history:${id}`, '');
    res.json({ ok });
  });
  app.delete('/api/history', requireDev, requireConfirm, (req, res) => {
    const deleted = cache.clearAll();
    audit.log(req.auth.user, 'history.clearAll', 'all', `${deleted} rows`);
    res.json({ deleted });
  });

  // ----------- DB Import -----------
  app.post('/api/db/import', requireDev, requireConfirm, (req, res) => {
    try {
      const {
        content,
        mode = 'merge',           // 'merge' | 'replace'
        includeMaps = true,
        includeHistory = true,
      } = req.body || {};
      const data = typeof content === 'string' ? JSON.parse(content) : content;
      if (!data || (!Array.isArray(data.map_data) && !Array.isArray(data.chat_history))) {
        return res.status(400).json({ error: 'format JSON tidak valid (butuh map_data dan/atau chat_history array)' });
      }
      let mapInserted = 0, histInserted = 0, mapCleared = 0, histCleared = 0;
      const trx = db.transaction(() => {
        if (mode === 'replace') {
          if (includeMaps) {
            mapCleared = db.prepare('SELECT COUNT(*) AS c FROM map_data').get().c;
            db.exec('DELETE FROM map_data');
          }
          if (includeHistory) {
            histCleared = db.prepare('SELECT COUNT(*) AS c FROM chat_history').get().c;
            db.exec('DELETE FROM chat_history');
          }
        }
        if (includeMaps && Array.isArray(data.map_data)) {
          const ins = db.prepare('INSERT INTO map_data (topic, content, tags) VALUES (?, ?, ?)');
          for (const m of data.map_data) {
            if (m && m.topic && m.content) {
              ins.run(String(m.topic), String(m.content), String(m.tags || ''));
              mapInserted++;
            }
          }
        }
        if (includeHistory && Array.isArray(data.chat_history)) {
          const ins = db.prepare(`INSERT INTO chat_history
            (channel_id, user_id, question, question_norm, answer, source)
            VALUES (?, ?, ?, ?, ?, ?)`);
          for (const c of data.chat_history) {
            if (c && c.question && c.answer) {
              const norm = c.question_norm || cache.normalize(c.question);
              ins.run(
                String(c.channel_id || ''),
                String(c.user_id || ''),
                String(c.question),
                String(norm),
                String(c.answer),
                String(c.source || 'imported')
              );
              histInserted++;
            }
          }
        }
      });
      trx();
      audit.log(req.auth.user, 'db.import', 'database',
        JSON.stringify({ mode, mapInserted, histInserted, mapCleared, histCleared }));
      res.json({ ok: true, mode, mapInserted, histInserted, mapCleared, histCleared });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // ----------- Error handler -----------
  app.use((err, _req, res, _next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File terlalu besar (>5MB).' });
    log.error('[dashboard]', err);
    res.status(500).json({ error: err.message || 'internal error' });
  });

  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  return new Promise((resolve) => {
    const srv = app.listen(port, () => {
      log.info(`Dashboard ready at http://localhost:${port}`);
      resolve(srv);
    });
  });
}

module.exports = { start };
