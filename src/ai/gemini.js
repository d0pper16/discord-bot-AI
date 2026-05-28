'use strict';

const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../db/database');

/**
 * Layanan Gemini.
 * - PRIMARY selalu didahulukan; SECONDARY fallback.
 * - Hitung RPM/RPD per key di tabel api_usage.
 * - Mendukung "reserveTokens": N kuota terakhir/menit DICADANGKAN
 *   khusus untuk pemanggilan dengan opsi { allowReserve: true }
 *   (dipakai setelah bot kasih balasan "sabar ya kak..." di rate-limit).
 */

const cfgPath = path.join(__dirname, '..', '..', 'config.json');

function loadCfg() {
  delete require.cache[require.resolve(cfgPath)];
  return require(cfgPath);
}

const KEYS = () => ({
  PRIMARY:   process.env.GEMINI_API_KEY_PRIMARY,
  SECONDARY: process.env.GEMINI_API_KEY_SECONDARY,
});
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-1.5-flash';

const cooldownUntil = { PRIMARY: 0, SECONDARY: 0 };

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
  if (!KEYS()[keyId]) return false;
  if (Date.now() < cooldownUntil[keyId]) return false;
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
  return (
    msg.includes('429') ||
    msg.includes('rate') ||
    msg.includes('quota') ||
    msg.includes('exceed') ||
    msg.includes('resource_exhausted')
  );
}

async function callOnce(keyId, prompt, history = []) {
  const apiKey = KEYS()[keyId];
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: MODEL() });

  const chat = model.startChat({
    history: history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    generationConfig: {
      temperature: 0.85,
      topP: 0.9,
      maxOutputTokens: 1024,
    },
  });

  const res = await chat.sendMessage(prompt);
  const text = res.response.text();
  stmtLog.run(keyId, 'ok');
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

  let lastErr = null;
  for (const keyId of ['PRIMARY', 'SECONDARY']) {
    if (!isAvailable(keyId, allowReserve)) continue;
    try {
      const text = await callOnce(keyId, prompt, history);
      return { text, keyUsed: keyId };
    } catch (err) {
      lastErr = err;
      stmtLog.run(keyId, 'err');
      if (isRateLimitErr(err)) {
        cooldownUntil[keyId] = Date.now() + cfg.gemini.cooldownMs;
        console.warn(`[gemini] ${keyId} rate-limited, cooldown ${cfg.gemini.cooldownMs}ms`);
        continue;
      }
      throw err;
    }
  }

  // Tidak ada key tersedia -> lempar error rate-limit terstandar
  const e = new Error(lastErr ? lastErr.message : 'RATE_LIMIT: semua API Gemini sedang habis kuota / cooldown');
  e.code = 'RATE_LIMIT';
  throw e;
}

/**
 * Validasi token Gemini saat startup.
 * Mencoba 1 panggilan kecil (TIDAK dihitung di api_usage internal).
 */
async function validate() {
  for (const keyId of ['PRIMARY', 'SECONDARY']) {
    const apiKey = KEYS()[keyId];
    if (!apiKey) continue;
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: MODEL() });
      const r = await model.generateContent('ok');
      r.response.text();
      return { ok: true, keyId };
    } catch (err) {
      console.warn(`[gemini.validate] ${keyId} gagal: ${err.message}`);
    }
  }
  return { ok: false };
}

function status() {
  const cfg = loadCfg();
  return {
    primary: {
      configured: !!KEYS().PRIMARY,
      cooldownMs: Math.max(0, cooldownUntil.PRIMARY - Date.now()),
      ...usageOf('PRIMARY'),
    },
    secondary: {
      configured: !!KEYS().SECONDARY,
      cooldownMs: Math.max(0, cooldownUntil.SECONDARY - Date.now()),
      ...usageOf('SECONDARY'),
    },
    model: MODEL(),
    reserveTokens: cfg.gemini.reserveTokens || 0,
  };
}

module.exports = { generate, validate, status };
