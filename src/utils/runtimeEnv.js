'use strict';

const fs   = require('fs');
const path = require('path');

const RUNTIME_FILE = path.join(__dirname, '..', '..', 'data', 'runtime.json');

const OVERRIDABLE = [
  'YANTO_CHANNEL_ID',
  'GEMINI_API_KEY_1',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'GEMINI_API_KEY_4',
  'GEMINI_API_KEY_5',
  'DISCORD_APP_ID',
  // Backward-compat (auto-mapped saat load):
  'GEMINI_API_KEY_PRIMARY',
  'GEMINI_API_KEY_SECONDARY',
];

function load() {
  try {
    // Backward-compat: kalau .env masih pakai PRIMARY/SECONDARY,
    // map ke KEY_1/KEY_2 supaya kode baru bisa baca.
    if (!process.env.GEMINI_API_KEY_1 && process.env.GEMINI_API_KEY_PRIMARY) {
      process.env.GEMINI_API_KEY_1 = process.env.GEMINI_API_KEY_PRIMARY;
    }
    if (!process.env.GEMINI_API_KEY_2 && process.env.GEMINI_API_KEY_SECONDARY) {
      process.env.GEMINI_API_KEY_2 = process.env.GEMINI_API_KEY_SECONDARY;
    }

    if (!fs.existsSync(RUNTIME_FILE)) return {};
    const j = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8')) || {};
    for (const k of OVERRIDABLE) {
      if (typeof j[k] === 'string' && j[k].trim()) {
        process.env[k] = j[k].trim();
      }
    }
    // Re-map sekali lagi setelah override runtime
    if (!process.env.GEMINI_API_KEY_1 && process.env.GEMINI_API_KEY_PRIMARY) {
      process.env.GEMINI_API_KEY_1 = process.env.GEMINI_API_KEY_PRIMARY;
    }
    return j;
  } catch (e) {
    console.error('[runtimeEnv] gagal load:', e.message);
    return {};
  }
}

function readFile() {
  try {
    if (!fs.existsSync(RUNTIME_FILE)) return {};
    return JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8')) || {};
  } catch (_) { return {}; }
}

function save(updates) {
  const cur = readFile();
  for (const k of OVERRIDABLE) {
    if (Object.prototype.hasOwnProperty.call(updates, k) && typeof updates[k] === 'string') {
      const v = updates[k].trim();
      if (v) cur[k] = v; else delete cur[k];
    }
  }
  fs.mkdirSync(path.dirname(RUNTIME_FILE), { recursive: true });
  const tmp = RUNTIME_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cur, null, 2), 'utf8');
  fs.renameSync(tmp, RUNTIME_FILE);
  for (const k of OVERRIDABLE) {
    if (typeof cur[k] === 'string' && cur[k]) process.env[k] = cur[k];
  }
  return cur;
}

function maskKey(s) {
  if (!s) return '';
  const str = String(s);
  if (str.length <= 8) return '****';
  return str.slice(0, 4) + '*'.repeat(Math.max(4, str.length - 8)) + str.slice(-4);
}

module.exports = { load, save, readFile, maskKey, OVERRIDABLE, RUNTIME_FILE };
