'use strict';

const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../db/database');

/**
 * Layanan Gemini multi-key (1-5 keys).
 *
 * Slot key:
 *   GEMINI_API_KEY_1 .. GEMINI_API_KEY_5  (KEY_1 selalu dipakai duluan)
 *   Backward-compat: PRIMARY -> KEY_1, SECONDARY -> KEY_2 (di-map di runtimeEnv.load).
 *
 * Per-key state:
 *   { cooldownUntil, lastError, lastValidated, banned, lastSuccess }
 *
 * Auto-refresh: 1× per menit, round-robin (1 key per cycle).
 *   Dengan 5 keys, tiap key divalidasi setiap ~5 menit (hemat token,
 *   tetap meet req. user "validasi setiap 1 menit" di level overall scheduler).
 */

const cfgPath = path.join(__dirname, '..', '..', 'config.json');
function loadCfg() {
  delete require.cache[require.resolve(cfgPath)];
  return require(cfgPath);
}

function loadKeys() {
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const v = process.env[`GEMINI_API_KEY_${i}`];
    if (v && v.trim() && !v.startsWith('AIzaSyXX')) {
      out.push({ id: `KEY_${i}`, num: i, key: v.trim() });
    }
  }
  return out;
}

const MODEL = () => process.env.GEMINI_MODEL || 'gemini-1.5-flash';

const keyState = {}; // 'KEY_1': { cooldownUntil, lastError, lastValidated, banned, lastSuccess }
let LAST_USED_KEY = null;
let LAST_USED_NUM = null;

function ensureState(id) {
  if (!keyState[id]) keyState[id] = {
    cooldownUntil: 0,
    lastError: null,
    lastValidated: 0,
    banned: false,
    lastSuccess: 0,
  };
  return keyState[id];
}

const stmtCount = db.prepare(
  `SELECT COUNT(*) AS c FROM api_usage WHERE api_key_id = ? AND used_at >= ?`
);
const stmtLog = db.prepare(
  `INSERT INTO api_usage (api_key_id, status) VALUES (?, ?)`
);

function nowSec() { return Math.floor(Date.now() / 1000); }

function usageOf(keyId) {
  const t = nowSec();
  return {
    rpm: stmtCount.get(keyId, t - 60).c,
    rpd: stmtCount.get(keyId, t - 86400).c,
  };
}

function isAvailable(keyId, allowReserve = false) {
  const cfg = loadCfg();
  const state = ensureState(keyId);
  if (state.banned) return false;
  if (Date.now() < state.cooldownUntil) return false;
  const u = usageOf(keyId);
  const reserve = Math.max(0, Number(cfg.gemini.reserveTokens || 0));
  const ceiling = allowReserve
    ? cfg.gemini.rpmLimit
    : Math.max(1, cfg.gemini.rpmLimit - reserve);
  if (u.rpm >= ceiling) return false;
  if (u.rpd >= cfg.gemini.rpdLimit) return false;
  return true;
}

function isRateLimitErr(err) {
  const msg = String(err && (err.message || err)).toLowerCase();
  return /\b429\b|rate|quota|exceed|resource_exhausted/.test(msg);
}

function isAuthErr(err) {
  const msg = String(err && (err.message || err)).toLowerCase();
  return /\b401\b|\b403\b|invalid api key|api[\s_]key.*invalid|permission_denied|unauthenticated|api[_\s]key[_\s]not[_\s]valid|forbidden/.test(msg);
}

async function callOnce(keyId, apiKey, prompt, history = []) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: MODEL() });

  const chat = model.startChat({
    history: history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    generationConfig: { temperature: 0.85, topP: 0.9, maxOutputTokens: 1024 },
  });

  const res = await chat.sendMessage(prompt);
  const text = res.response.text();
  stmtLog.run(keyId, 'ok');
  const state = ensureState(keyId);
  state.lastSuccess = Date.now();
  state.lastError = null;
  state.banned = false;
  return text;
}

/**
 * @param {string} prompt
 * @param {Array<{role:'user'|'model', text:string}>} history
 * @param {{allowReserve?:boolean}} opts
 */
async function generate(prompt, history = [], opts = {}) {
  const cfg = loadCfg();
  const allowReserve = !!opts.allowReserve;
  const keys = loadKeys();
  if (!keys.length) {
    const e = new Error('Tidak ada Gemini API key yang ter-konfigurasi (GEMINI_API_KEY_1..5).');
    e.code = 'NO_KEY';
    throw e;
  }

  let lastErr = null;
  for (const k of keys) {
    if (!isAvailable(k.id, allowReserve)) continue;
    try {
      const text = await callOnce(k.id, k.key, prompt, history);
      LAST_USED_KEY = k.id;
      LAST_USED_NUM = k.num;
      return { text, keyUsed: k.id, keyNum: k.num };
    } catch (err) {
      lastErr = err;
      stmtLog.run(k.id, 'err');
      const state = ensureState(k.id);
      state.lastError = { msg: err.message, ts: Date.now() };
      if (isRateLimitErr(err)) {
        state.cooldownUntil = Date.now() + cfg.gemini.cooldownMs;
        console.warn(`[gemini] ${k.id} rate-limited, cooldown ${cfg.gemini.cooldownMs}ms`);
        continue;
      }
      if (isAuthErr(err)) {
        state.banned = true;
        console.error(`[gemini] ${k.id} BANNED/INVALID: ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  const e = new Error(lastErr ? lastErr.message : 'RATE_LIMIT: semua API Gemini habis kuota / cooldown / banned');
  e.code = 'RATE_LIMIT';
  throw e;
}

/**
 * Validate satu key (cheap call).
 */
async function validateKey({ id, key }) {
  const state = ensureState(id);
  try {
    const ai = new GoogleGenerativeAI(key);
    const m = ai.getGenerativeModel({ model: MODEL() });
    const r = await m.generateContent('hi');
    r.response.text();
    state.lastValidated = Date.now();
    state.banned = false;
    state.lastError = null;
    return { ok: true };
  } catch (err) {
    state.lastError = { msg: err.message, ts: Date.now() };
    if (isAuthErr(err)) state.banned = true;
    return { ok: false, error: err.message };
  }
}

/**
 * Cold-start validation: cek key pertama yang available.
 */
async function validate() {
  const keys = loadKeys();
  for (const k of keys) {
    const r = await validateKey(k);
    if (r.ok) return { ok: true, keyId: k.id, keyNum: k.num };
  }
  return { ok: false };
}

// ===== Auto-refresh round-robin per 1 menit =====
let refreshIdx = 0;
let refreshTimer = null;

async function refreshTick() {
  const keys = loadKeys();
  if (!keys.length) return;
  const k = keys[refreshIdx % keys.length];
  refreshIdx++;
  const r = await validateKey(k);
  if (!r.ok) {
    console.warn(`[gemini.refresh] ${k.id} (API ke-${k.num}) error: ${r.error}`);
  }
}

function startAutoRefresh() {
  if (refreshTimer) return;
  // First tick after 30 detik biar tidak race dengan cold-start validate
  setTimeout(() => {
    refreshTick().catch(() => {});
    refreshTimer = setInterval(() => refreshTick().catch(() => {}), 60 * 1000);
    if (refreshTimer.unref) refreshTimer.unref();
  }, 30 * 1000);
}

function stopAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

function status() {
  const cfg = loadCfg();
  const keys = loadKeys();
  const perKey = keys.map((k) => {
    const state = ensureState(k.id);
    const usage = usageOf(k.id);
    let statusLabel = 'ok';
    if (state.banned) statusLabel = 'banned';
    else if (Date.now() < state.cooldownUntil) statusLabel = 'cooldown';
    else if (state.lastError && (Date.now() - state.lastError.ts) < 5 * 60 * 1000) statusLabel = 'recent-error';
    else if (state.lastValidated && (Date.now() - state.lastValidated) < 10 * 60 * 1000) statusLabel = 'validated';
    return {
      id: k.id,
      num: k.num,
      configured: true,
      rpm: usage.rpm,
      rpd: usage.rpd,
      cooldownMs: Math.max(0, state.cooldownUntil - Date.now()),
      banned: state.banned,
      lastError: state.lastError,
      lastValidated: state.lastValidated,
      lastSuccess: state.lastSuccess,
      status: statusLabel,
    };
  });

  // Slot 1-5 (kosong tampilkan sebagai unconfigured)
  const slots = [];
  for (let i = 1; i <= 5; i++) {
    const found = perKey.find((p) => p.num === i);
    if (found) slots.push(found);
    else slots.push({ id: `KEY_${i}`, num: i, configured: false, status: 'empty' });
  }

  return {
    keysConfigured: keys.length,
    activeKey: LAST_USED_KEY,
    activeKeyNum: LAST_USED_NUM,
    keys: slots,
    totalRpm: perKey.reduce((s, k) => s + k.rpm, 0),
    totalRpd: perKey.reduce((s, k) => s + k.rpd, 0),
    rpmBudget: keys.length * cfg.gemini.rpmLimit,
    rpdBudget: keys.length * cfg.gemini.rpdLimit,
    model: MODEL(),
    reserveTokens: cfg.gemini.reserveTokens || 0,
  };
}

module.exports = {
  generate,
  validate,
  validateKey,
  startAutoRefresh,
  stopAutoRefresh,
  status,
  lastUsedKey: () => LAST_USED_KEY,
  lastUsedNum: () => LAST_USED_NUM,
};
