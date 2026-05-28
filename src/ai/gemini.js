'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../db/database');

/**
 * Layanan Gemini dengan rotasi 2 API key.
 * - PRIMARY selalu didahulukan.
 * - SECONDARY dipakai bila PRIMARY kena RPM/RPD limit
 *   atau melempar error rate-limit dari server.
 *
 * Hitungan kuota di-track di tabel api_usage.
 */

const cfgPath = require('path').join(__dirname, '..', '..', 'config.json');
function loadCfg() {
  delete require.cache[require.resolve(cfgPath)];
  return require(cfgPath);
}

const KEY_IDS = {
  primary:   'PRIMARY',
  secondary: 'SECONDARY',
};

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

function isAvailable(keyId) {
  const cfg = loadCfg();
  if (!KEYS()[keyId]) return false;
  if (Date.now() < cooldownUntil[keyId]) return false;
  const u = usageOf(keyId);
  if (u.rpm >= cfg.gemini.rpmLimit) return false;
  if (u.rpd >= cfg.gemini.rpdLimit) return false;
  return true;
}

function pickKey() {
  // PRIMARY selalu prioritas
  if (isAvailable('PRIMARY')) return 'PRIMARY';
  if (isAvailable('SECONDARY')) return 'SECONDARY';
  return null;
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
    history: history.map((h) => ({
      role: h.role,
      parts: [{ text: h.text }],
    })),
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
 */
async function generate(prompt, history = []) {
  const cfg = loadCfg();
  const order = ['PRIMARY', 'SECONDARY'];

  let lastErr = null;
  for (const keyId of order) {
    if (!isAvailable(keyId)) continue;
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
      // error non-ratelimit -> langsung lempar (jangan ganti key tanpa alasan)
      throw err;
    }
  }

  // tidak ada key tersedia
  if (!lastErr) {
    throw new Error('Semua API Gemini sedang tidak tersedia (limit/cooldown).');
  }
  throw lastErr;
}

function status() {
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
  };
}

module.exports = { generate, status, KEY_IDS };
