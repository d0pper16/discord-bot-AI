'use strict';

const path = require('path');
const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');

const log     = require('./utils/logger');
const gemini  = require('./ai/gemini');
const mapData = require('./db/mapData');
const cache   = require('./db/chatHistory');
const { bus } = require('./utils/hotReload');

// ---- konstanta path ----
const cfgPath         = path.join(__dirname, '..', 'config.json');
const personalityPath = path.join(__dirname, 'ai', 'personality.js');

const RESTART_EXIT_CODE   = 42;
const SHUTDOWN_EXIT_CODE  = 0;
const RESTART_QUIET_MS    = 2500;   // RESTART: jeda kecil sebelum exit (TANPA pesan pamit)
const SHUTDOWN_DELAY_MS   = 5000;   // SHUTDOWN: jeda setelah ucap pamit
const WAKEUP_DELAY_MS     = 4000;   // jeda setelah online (restart) baru ucap "hoamm"
const COLD_DELAY_MS       = 5000;   // jeda cold-start sebelum validasi API
const COLD_RETRY_MS       = 30000;  // jeda retry validasi API
const SABAR_WAIT_MS       = 60000;  // jeda "sabar 1 menit" sebelum coba jawab pakai reserve
const TIMEOUT_DURATION_MS = 5 * 60 * 1000; // 5 menit timeout user

function loadCfg() {
  delete require.cache[require.resolve(cfgPath)];
  return require(cfgPath);
}
function loadPersonality() {
  delete require.cache[require.resolve(personalityPath)];
  return require(personalityPath);
}
function botName() {
  try { return loadCfg().name || 'Yanto'; }
  catch (_) { return 'Yanto'; }
}
function botKeyword() {
  try { return loadCfg().keyword || 'yanto'; }
  catch (_) { return 'yanto'; }
}
const ucfirst = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const lower   = (s) => s.toLowerCase();

// ---- template pesan (semua memakai nama dinamis) ----
const MSG = {
  hello:    (n) => `halo, kenalin aku ${lower(n)} aku adalah AI paling ganteng sedunia, yang siap membantu menjawab pertanyaan kalian di server ini, tinggal sebut aja namaku "${lower(n)}" maka aku akan menjawab semua pertanyaan kalian`,
  back:     (n) => `hoamm... enak banget ${lower(n)} tidurnya walau gak lama, udah siap bantu jawab pertanyaan kalian lagi nih @everyone`,
  farewell: (n) => `${ucfirst(n)} capek, ${lower(n)} tidur dulu yaa, babay semua... @everyone`,
  apiFail:  (_n) => `maaf yah, token/API kamu salah/error nih, aku gagal mendarat`,
  sabar:    (_n) => `sabar ya kak, kasih aku mikir dulu 1 menit yaa`,
  warn:     (n, mention) => `jika kamu tidak bisa bersabar maka akan ${lower(n)} bungkam ya ${mention}`,
  timeout:  (n, mention) => `maaf yah ${mention} ${lower(n)} bungkam, kamu gasabaran sih jadi manusia, ${lower(n)} robot bukan nabi boyyy...`,
  empty:    (n) => `iya, ada apa? tanya aja, sebut "${lower(n)}" + pertanyaannya.`,
  errorApi: () => `aduh otak gue lagi nge-lag (API error). coba lagi sebentar yaa.`,
};

// ---- state ----
let SLEEPING = false; // saat true: bot SAMA SEKALI tidak merespon
let READY    = false;
let SHUTTING = false;
const WAITING  = new Map(); // userId -> { count, ts, handle, question, msg }
const TIMEOUTS = new Map(); // userId -> untilTs

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
//  Cold-start validasi & ucapan
// =================================================================
async function coldStartFlow() {
  log.info(`[startup] cold start, validasi Gemini dalam ${COLD_DELAY_MS}ms...`);
  await new Promise((r) => setTimeout(r, COLD_DELAY_MS));

  // attempt 1
  let v = await gemini.validate();
  if (v.ok) {
    log.info(`[startup] Gemini OK via ${v.keyId}`);
    SLEEPING = false;
    await sendToTargetChannel(MSG.hello(botName()));
    return;
  }

  log.error('[startup] validasi Gemini GAGAL (attempt 1)');
  await sendToTargetChannel(MSG.apiFail(botName()));

  // attempt 2 (retry sekali setelah 30s)
  await new Promise((r) => setTimeout(r, COLD_RETRY_MS));
  v = await gemini.validate();
  if (v.ok) {
    log.info(`[startup] Gemini OK via ${v.keyId} (attempt 2)`);
    SLEEPING = false;
    await sendToTargetChannel(MSG.hello(botName()));
    return;
  }

  log.error('[startup] validasi Gemini gagal total. Bot tetap halt sampai .env diperbaiki & restart.');
  // SLEEPING tetap true -> bot diam total
}

async function restartFlow() {
  log.info('[startup] restart detected, jeda lalu sapa kembali...');
  await new Promise((r) => setTimeout(r, WAKEUP_DELAY_MS));
  SLEEPING = false;
  await sendToTargetChannel(MSG.back(botName()));
}

// =================================================================
//  Graceful restart (TANPA pesan pamit - permintaan user)
//  Dipicu: upload bot.js, atau tombol "Restart" di dashboard.
// =================================================================
async function gracefulRestart(reason = 'restart') {
  if (SHUTTING) return;
  SHUTTING = true;
  SLEEPING = true; // langsung diam total, tidak terima pesan baru
  log.info(`[restart] ${reason} -- silent exit (no farewell), exit ${RESTART_QUIET_MS}ms lagi`);

  // Jeda pendek supaya in-flight HTTP/Discord op bisa selesai.
  setTimeout(() => {
    try { client.destroy(); } catch (_) {}
    process.exit(RESTART_EXIT_CODE);
  }, RESTART_QUIET_MS);
}

// =================================================================
//  Graceful shutdown total (ucap pamit, tidak respawn)
//  Dipicu: tombol "Matikan Bot" di dashboard.
// =================================================================
async function gracefulShutdown(reason = 'shutdown') {
  if (SHUTTING) return;
  SHUTTING = true;
  SLEEPING = true;
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

// dengarkan event dari dashboard
bus.on('upload:bot', () => gracefulRestart('upload bot.js'));
bus.on('restart',    () => gracefulRestart('tombol restart'));
bus.on('shutdown',   () => gracefulShutdown('tombol matikan bot'));

// =================================================================
//  Pemrosesan pertanyaan utama
// =================================================================
async function processQuestion(question, msg, opts = {}) {
  const { allowReserve = false, isDeferred = false } = opts;
  const cfg = loadCfg();

  // 1) Cek cache
  const followUp = isSpecificFollowup(question, cfg.cache.specificTriggers);
  const hit = cache.findSimilar(question, cfg.cache.similarityThreshold);

  if (hit && !followUp) {
    log.info(`[cache] hit (score=${hit.score.toFixed(2)}) -> ${question.slice(0, 60)}`);
    await sendLong(msg, hit.row.answer);
    return;
  }

  // 2) Bangun konteks
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

  // 3) Generate
  const res = await gemini.generate(question, history, { allowReserve });
  const answer = res.text.trim();

  // 4) Simpan / update cache
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
//  Handler rate-limit / spam
//  - 1x: kasih "sabar ya kak..." + jadwalkan jawaban 60dtk pakai reserve
//  - 2x: kasih warning bungkam
//  - 3x: timeout 5 menit + pesan bungkam, deferred jawaban di-cancel
// =================================================================
async function handleRateLimited(msg, question) {
  const userId  = msg.author.id;
  const mention = `<@${userId}>`;
  const w = WAITING.get(userId);

  if (!w) {
    // pertama kali -> sabar + scheduler
    const handle = setTimeout(async () => {
      const cur = WAITING.get(userId);
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
      // (cur dipakai untuk nothing - just safety)
      void cur;
    }, SABAR_WAIT_MS);

    WAITING.set(userId, { count: 1, ts: Date.now(), handle, question });
    await msg.reply(MSG.sabar(botName()));
    return;
  }

  // sudah ada entry waiting -> spam
  w.count++;

  if (w.count === 2) {
    await msg.reply(MSG.warn(botName(), mention));
    return;
  }

  // count >= 3 -> timeout user 5 menit + cancel deferred
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

  try {
    await msg.reply(MSG.timeout(botName(), mention));
  } catch (_) {}
}

// =================================================================
//  Discord events
// =================================================================
client.once(Events.ClientReady, async (c) => {
  log.info(`${botName()} online sebagai ${c.user.tag}`);
  READY = true;
  SLEEPING = true; // mulai tidur dulu, di-flip oleh flow di bawah

  if (process.env.YANTO_IS_RESTART === '1') {
    await restartFlow();
  } else {
    await coldStartFlow();
  }
});

client.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.author.bot) return;
    if (!READY || SLEEPING) return; // diam saat tidur / belum siap

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

    // user lagi dalam mode "menunggu" -> rute spam-handler
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
//  start/stop
// =================================================================
function start() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN belum di-set di .env');
  return client.login(token);
}
function stop() {
  return client.destroy();
}

module.exports = {
  client,
  start,
  stop,
  gracefulRestart,
  gracefulShutdown,
  // helpers untuk dashboard / index
  state: () => ({ ready: READY, sleeping: SLEEPING, shutting: SHUTTING }),
  RESTART_EXIT_CODE,
  SHUTDOWN_EXIT_CODE,
};
