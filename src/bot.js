'use strict';

const path = require('path');
const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const log     = require('./utils/logger');
const gemini  = require('./ai/gemini');
const mapData = require('./db/mapData');
const cache   = require('./db/chatHistory');
const runtime = require('./utils/runtimeEnv');
const { bus } = require('./utils/hotReload');

// ---- konstanta path ----
const cfgPath         = path.join(__dirname, '..', 'config.json');
const personalityPath = path.join(__dirname, 'ai', 'personality.js');

const RESTART_EXIT_CODE   = 42;
const SHUTDOWN_EXIT_CODE  = 0;
const RESTART_QUIET_MS    = 2500;
const SHUTDOWN_DELAY_MS   = 5000;
const WAKEUP_DELAY_MS     = 4000;
const COLD_DELAY_MS       = 5000;
const COLD_RETRY_MS       = 30000;
const SABAR_WAIT_MS       = 60000;
const TIMEOUT_DURATION_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS  = 3;
const LOGIN_RETRY_MS      = 5000;

function loadCfg() {
  delete require.cache[require.resolve(cfgPath)];
  return require(cfgPath);
}
function loadPersonality() {
  delete require.cache[require.resolve(personalityPath)];
  return require(personalityPath);
}
function botName()   { try { return loadCfg().name || 'Yanto'; } catch (_) { return 'Yanto'; } }
function botKeyword(){ try { return loadCfg().keyword || 'yanto'; } catch (_) { return 'yanto'; } }
const ucfirst = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase();
const lower   = (s) => String(s).toLowerCase();

// ---- pesan boilerplate (selalu Indonesia, sesuai req. user) ----
const MSG = {
  hello:    (n) => `halo, kenalin aku ${lower(n)} aku adalah AI paling ganteng sedunia, yang siap membantu menjawab pertanyaan kalian di server ini, tinggal sebut aja namaku "${lower(n)}" maka aku akan menjawab semua pertanyaan kalian`,
  back:     (n) => `hoamm... enak banget ${lower(n)} tidurnya walau gak lama, udah siap bantu jawab pertanyaan kalian lagi nih @everyone`,
  farewell: (n) => `${ucfirst(n)} capek, ${lower(n)} tidur dulu yaa, babay semua... @everyone`,
  apiFail:  ()  => `maaf yah, token/API kamu salah/error nih, aku gagal mendarat`,
  sabar:    ()  => `sabar ya kak, kasih aku mikir dulu 1 menit yaa`,
  warn:     (n, m) => `jika kamu tidak bisa bersabar maka akan ${lower(n)} bungkam ya ${m}`,
  timeout:  (n, m) => `maaf yah ${m} ${lower(n)} bungkam, kamu gasabaran sih jadi manusia, ${lower(n)} robot bukan nabi boyyy...`,
  empty:    (n) => `iya, ada apa? tanya aja, sebut "${lower(n)}" + pertanyaannya.`,
  errorApi: ()  => `aduh otak gue lagi nge-lag (API error). coba lagi sebentar yaa.`,
};

// ---- state ----
let SLEEPING = true;
let READY    = false;
let SHUTTING = false;
let API_OK   = false;
let CHAN_OK  = false;
const WAITING  = new Map();
const TIMEOUTS = new Map();

// ---- discord client ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// =================================================================
//  Helpers
// =================================================================
function containsKeyword(text, keyword) {
  if (!text) return false;
  const safe = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${safe}\\b`, 'i').test(text);
}
function stripKeyword(text, keyword) {
  const safe = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\b${safe}\\b[,:]?`, 'gi'), '').trim();
}
function isSpecificFollowup(text, triggers = []) {
  const t = String(text).toLowerCase();
  return triggers.some((k) => t.includes(String(k).toLowerCase()));
}
async function sendLong(msg, content) {
  const max = 1900;
  if (content.length <= max) return msg.reply(content);
  let first = true;
  for (let i = 0; i < content.length; i += max) {
    const part = content.slice(i, i + max);
    if (first) { await msg.reply(part); first = false; }
    else       { await msg.channel.send(part); }
  }
}
async function sendToTargetChannel(content) {
  const id = process.env.YANTO_CHANNEL_ID;
  if (!id || !content) return;
  try {
    const ch = await client.channels.fetch(id);
    if (ch && ch.isTextBased()) {
      await ch.send({
        content,
        allowedMentions: { parse: ['everyone', 'users'] },
      });
    }
  } catch (err) {
    log.error('sendToTargetChannel:', err.message);
  }
}
function isUserTimedOut(userId) {
  const t = TIMEOUTS.get(userId);
  if (!t) return false;
  if (Date.now() > t) { TIMEOUTS.delete(userId); return false; }
  return true;
}

// =================================================================
//  Validators
// =================================================================
async function validateGeminiInternal() {
  const v = await gemini.validate();
  if (!v.ok) {
    log.error('[validation] semua API Gemini gagal divalidasi (cek token primary & secondary)');
    return false;
  }
  log.info(`[validation] Gemini OK via ${v.keyId}`);
  return true;
}

async function validateChannelInternal() {
  const id = process.env.YANTO_CHANNEL_ID;
  if (!id) {
    log.error('[validation] YANTO_CHANNEL_ID kosong - cek dashboard atau .env');
    return false;
  }
  if (!/^\d{17,20}$/.test(String(id))) {
    log.error(`[validation] YANTO_CHANNEL_ID format salah: "${id}" (harus 17-20 digit Discord snowflake)`);
    return false;
  }
  try {
    const ch = await client.channels.fetch(String(id));
    if (!ch) {
      log.error(`[validation] Channel ID ${id} tidak ditemukan / bot tidak ada di guild itu`);
      return false;
    }
    if (!ch.isTextBased()) {
      log.error(`[validation] Channel ${id} bukan text channel`);
      return false;
    }
    log.info(`[validation] Channel ${id} OK (${ch.name || 'unknown'})`);
    return true;
  } catch (err) {
    log.error(`[validation] gagal fetch channel ${id}: ${err.message}`);
    return false;
  }
}

/**
 * Validasi NEW values (dipakai endpoint dashboard sebelum apply).
 * Tidak modifikasi process.env -- test langsung dengan input.
 */
async function validateNewValues({ channelId, primaryKey, secondaryKey } = {}) {
  const errors = {};
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  async function testKey(key) {
    if (!key || String(key).trim().length < 10) return 'API key kosong / terlalu pendek';
    try {
      const ai = new GoogleGenerativeAI(String(key));
      const m = ai.getGenerativeModel({ model });
      const r = await m.generateContent('ok');
      r.response.text();
      return null;
    } catch (err) {
      return err.message || 'unknown error';
    }
  }

  if (primaryKey !== undefined && primaryKey !== null) {
    const e = await testKey(primaryKey);
    if (e) errors.primaryKey = e;
  }
  if (secondaryKey !== undefined && secondaryKey !== null) {
    const e = await testKey(secondaryKey);
    if (e) errors.secondaryKey = e;
  }
  if (channelId !== undefined && channelId !== null) {
    const id = String(channelId).trim();
    if (!id) errors.channelId = 'Channel ID kosong';
    else if (!/^\d{17,20}$/.test(id)) errors.channelId = 'Channel ID format salah (harus 17-20 digit)';
    else {
      try {
        const ch = await client.channels.fetch(id);
        if (!ch) errors.channelId = 'Channel tidak ditemukan / bot tidak di guild';
        else if (!ch.isTextBased()) errors.channelId = 'Channel bukan text channel';
      } catch (err) {
        errors.channelId = err.message || 'fetch error';
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

// =================================================================
//  Apply env update dari dashboard
//   - Validate via validateNewValues() DULU di endpoint
//   - Persist ke runtime.json + update process.env
//   - Re-validate API & channel
//   - Send hello bila semua ok (req. user)
// =================================================================
async function applyEnvUpdate(updates = {}) {
  const persistKey = {};
  if (typeof updates.channelId === 'string')    persistKey.YANTO_CHANNEL_ID = updates.channelId;
  if (typeof updates.primaryKey === 'string')   persistKey.GEMINI_API_KEY_PRIMARY = updates.primaryKey;
  if (typeof updates.secondaryKey === 'string') persistKey.GEMINI_API_KEY_SECONDARY = updates.secondaryKey;

  runtime.save(persistKey);
  log.info(`[env-update] runtime.json updated: ${Object.keys(persistKey).join(', ')}`);

  // Re-validate seluruhnya
  const apiOk = await validateGeminiInternal();
  const chOk  = await validateChannelInternal();
  API_OK = apiOk;
  CHAN_OK = chOk;

  if (apiOk && chOk) {
    SLEEPING = false;
    log.info('[env-update] semua valid -> bot WAKES UP, mengirim ucapan hello.');
    await sendToTargetChannel(MSG.hello(botName()));
    return { ok: true, apiOk, chOk };
  } else {
    SLEEPING = true;
    log.error(`[env-update] masih ada yang salah (apiOk=${apiOk}, chOk=${chOk}). Bot hidup tapi TIDUR.`);
    return { ok: false, apiOk, chOk };
  }
}

// =================================================================
//  Cold start & restart
// =================================================================
async function coldStartFlow() {
  log.info(`[startup] cold start, validasi dalam ${COLD_DELAY_MS}ms...`);
  await new Promise((r) => setTimeout(r, COLD_DELAY_MS));

  let apiOk = await validateGeminiInternal();
  if (!apiOk) {
    log.warn(`[startup] retry API dalam ${COLD_RETRY_MS}ms`);
    await new Promise((r) => setTimeout(r, COLD_RETRY_MS));
    apiOk = await validateGeminiInternal();
  }
  const chOk = await validateChannelInternal();
  API_OK = apiOk;
  CHAN_OK = chOk;

  if (apiOk && chOk) {
    SLEEPING = false;
    log.info('[startup] validasi OK -> bot active, mengirim ucapan hello.');
    await sendToTargetChannel(MSG.hello(botName()));
    return;
  }

  // Hanya 1 dari (API, channel) yang error -> bot tetap hidup tapi tidur.
  log.error(
    `[startup] HIDUP TAPI TIDUR. API valid=${apiOk}, Channel valid=${chOk}. ` +
    `Bot tidak akan merespon perintah. Perbaiki via tab "Connection" di dashboard, ` +
    `lalu bot otomatis bangun & ucap hello.`
  );
  SLEEPING = true;
}

async function restartFlow() {
  log.info('[startup] restart detected, jeda lalu bangun...');
  await new Promise((r) => setTimeout(r, WAKEUP_DELAY_MS));
  // Validasi tetap dijalankan supaya bot tahu kondisi env saat ini
  const apiOk = await validateGeminiInternal();
  const chOk  = await validateChannelInternal();
  API_OK = apiOk;
  CHAN_OK = chOk;
  if (apiOk && chOk) {
    SLEEPING = false;
    await sendToTargetChannel(MSG.back(botName()));
  } else {
    log.error(`[restart] HIDUP TAPI TIDUR. API=${apiOk}, Channel=${chOk}. Tidak ucap "hoamm".`);
    SLEEPING = true;
  }
}

// =================================================================
//  Graceful restart (silent) & shutdown (with farewell)
// =================================================================
async function gracefulRestart(reason = 'restart') {
  if (SHUTTING) return;
  SHUTTING = true; SLEEPING = true;
  log.info(`[restart] ${reason} -- silent exit, exit ${RESTART_QUIET_MS}ms lagi`);
  setTimeout(() => {
    try { client.destroy(); } catch (_) {}
    process.exit(RESTART_EXIT_CODE);
  }, RESTART_QUIET_MS);
}

async function gracefulShutdown(reason = 'shutdown') {
  if (SHUTTING) return;
  SHUTTING = true; SLEEPING = true;
  log.info(`[shutdown] ${reason} -- pamit + exit dalam ${SHUTDOWN_DELAY_MS}ms`);
  try {
    await sendToTargetChannel(MSG.farewell(botName()));
  } catch (err) {
    log.warn('[shutdown] gagal ucap pamit:', err.message);
  }
  setTimeout(() => {
    try { client.destroy(); } catch (_) {}
    process.exit(SHUTDOWN_EXIT_CODE);
  }, SHUTDOWN_DELAY_MS);
}

bus.on('upload:bot', () => gracefulRestart('upload bot.js'));
bus.on('restart',    () => gracefulRestart('tombol restart'));
bus.on('shutdown',   () => gracefulShutdown('tombol matikan bot'));

// =================================================================
//  Pemrosesan pertanyaan
// =================================================================
async function processQuestion(question, msg, opts = {}) {
  const { allowReserve = false, isDeferred = false } = opts;
  const cfg = loadCfg();

  const followUp = isSpecificFollowup(question, cfg.cache.specificTriggers);
  const hit = cache.findSimilar(question, cfg.cache.similarityThreshold);

  if (hit && !followUp) {
    log.info(`[cache] hit (score=${hit.score.toFixed(2)}) -> ${question.slice(0, 60)}`);
    await sendLong(msg, hit.row.answer);
    return;
  }

  // Gemini multilingual natively -- TIDAK perlu deteksi bahasa di sini.
  // Persona sudah berisi instruksi "ikuti bahasa user".
  const { buildSystemPrompt } = loadPersonality();
  const mapCtx = mapData.buildContext(question);
  const sysPrompt = buildSystemPrompt({
    name: botName(),
    mapContext: mapCtx,
    extraNote: followUp
      ? 'User minta jawaban LEBIH DETAIL/SPESIFIK dari sebelumnya. Tambahkan rincian relevan dari DATA MAP.'
      : '',
  });
  const recent = cache.recentContext(msg.channelId, cfg.history.maxContextMessages);
  const history = [
    { role: 'user',  text: sysPrompt },
    { role: 'model', text: `Siap, gue ${botName()}. Gas tanya apa aja soal map.` },
  ];
  for (const r of recent) {
    history.push({ role: 'user',  text: r.question });
    history.push({ role: 'model', text: r.answer });
  }

  const res = await gemini.generate(question, history, { allowReserve });
  const answer = res.text.trim();

  if (hit && followUp) {
    cache.updateAnswer(hit.row.id, answer, `gemini:${res.keyUsed}`);
  } else {
    cache.saveAnswer({
      channelId: msg.channelId,
      userId: msg.author.id,
      question,
      answer,
      source: `gemini:${res.keyUsed}${isDeferred ? '+deferred' : ''}`,
    });
  }
  await sendLong(msg, answer);
}

// =================================================================
//  Rate-limit dance
// =================================================================
async function handleRateLimited(msg, question) {
  const userId  = msg.author.id;
  const mention = `<@${userId}>`;
  const w = WAITING.get(userId);

  if (!w) {
    const handle = setTimeout(async () => {
      WAITING.delete(userId);
      try {
        await processQuestion(question, msg, { allowReserve: true, isDeferred: true });
      } catch (err) {
        log.error('[deferred] gagal:', err.message);
        try {
          await msg.channel.send({
            content: `${mention} masih limit nih, coba beberapa menit lagi yaa.`,
            allowedMentions: { parse: ['users'] },
          });
        } catch (_) {}
      }
    }, SABAR_WAIT_MS);

    WAITING.set(userId, { count: 1, ts: Date.now(), handle, question });
    await msg.reply(MSG.sabar());
    return;
  }

  w.count++;
  if (w.count === 2) {
    await msg.reply(MSG.warn(botName(), mention));
    return;
  }

  if (w.handle) clearTimeout(w.handle);
  WAITING.delete(userId);

  try {
    let member = msg.member;
    if (!member && msg.guild) {
      member = await msg.guild.members.fetch(userId).catch(() => null);
    }
    if (member && member.moderatable) {
      await member.timeout(TIMEOUT_DURATION_MS, `Spam ${botName()} saat rate-limit`);
    } else {
      log.warn('[timeout] member tidak moderatable, fallback timeout internal');
    }
  } catch (err) {
    log.warn('[timeout] gagal Discord-timeout:', err.message);
  }
  TIMEOUTS.set(userId, Date.now() + TIMEOUT_DURATION_MS);
  try { await msg.reply(MSG.timeout(botName(), mention)); } catch (_) {}
}

// =================================================================
//  Discord events
// =================================================================
client.once(Events.ClientReady, async (c) => {
  log.info(`${botName()} online sebagai ${c.user.tag}`);
  READY = true;
  SLEEPING = true;

  if (process.env.YANTO_IS_RESTART === '1') {
    await restartFlow();
  } else {
    await coldStartFlow();
  }
});

client.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!READY || SLEEPING) return;

    const cfg = loadCfg();
    const targetChannel = process.env.YANTO_CHANNEL_ID;
    if (!targetChannel || msg.channelId !== targetChannel) return;

    const keyword = cfg.keyword || 'yanto';
    if (!containsKeyword(msg.content, keyword)) return;
    if (isUserTimedOut(msg.author.id)) return;

    const rawQuestion = stripKeyword(msg.content, keyword);
    if (!rawQuestion) {
      await msg.reply(MSG.empty(botName()));
      return;
    }

    if (WAITING.has(msg.author.id)) {
      return handleRateLimited(msg, rawQuestion);
    }

    await msg.channel.sendTyping();

    try {
      await processQuestion(rawQuestion, msg);
    } catch (err) {
      const code = err && err.code;
      const txt  = String(err && err.message).toLowerCase();
      if (code === 'RATE_LIMIT' ||
          txt.includes('limit') || txt.includes('429') ||
          txt.includes('quota') || txt.includes('exhausted')) {
        log.warn('[rate-limit] -> sabar mode:', err.message);
        return handleRateLimited(msg, rawQuestion);
      }
      log.error('processQuestion error:', err.message);
      try { await msg.reply(MSG.errorApi()); } catch (_) {}
    }
  } catch (err) {
    log.error('handler error:', err);
  }
});

// =================================================================
//  Login dengan retry (3x) - permintaan user untuk token salah/error/kosong
// =================================================================
async function loginWithRetry(maxAttempts = LOGIN_MAX_ATTEMPTS) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    log.error('[startup] DISCORD_TOKEN kosong di .env. Bot tidak bisa login.');
    return false;
  }
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      log.info(`[startup] Discord login attempt ${i}/${maxAttempts}...`);
      await client.login(token);
      log.info(`[startup] Discord login OK pada percobaan ${i}.`);
      return true;
    } catch (err) {
      log.error(`[startup] login attempt ${i}/${maxAttempts} GAGAL: ${err.message}`);
      const m = String(err && err.message || '').toLowerCase();
      if (/token|invalid|disallowed|unauthorized|expired/.test(m)) {
        log.error('[startup] Token Discord salah / error / kosong / expired.');
      }
      if (i < maxAttempts) {
        log.warn(`[startup] retry ${LOGIN_RETRY_MS}ms lagi...`);
        await new Promise((r) => setTimeout(r, LOGIN_RETRY_MS));
      }
    }
  }
  log.error(`[startup] Bot mati setelah ${maxAttempts}x percobaan login Discord.`);
  return false;
}

function start() {
  return loginWithRetry(LOGIN_MAX_ATTEMPTS).then((ok) => {
    if (!ok) process.exit(1);
  });
}
function stop() { return client.destroy(); }

module.exports = {
  client,
  start,
  stop,
  gracefulRestart,
  gracefulShutdown,
  state: () => ({ ready: READY, sleeping: SLEEPING, shutting: SHUTTING, apiOk: API_OK, chanOk: CHAN_OK }),
  validateNewValues,
  applyEnvUpdate,
  RESTART_EXIT_CODE,
  SHUTDOWN_EXIT_CODE,
};
