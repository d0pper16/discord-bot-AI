'use strict';

const path = require('path');
const { Client, GatewayIntentBits, Partials, Events, ActivityType } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const log     = require('./utils/logger');
const gemini  = require('./ai/gemini');
const mapData = require('./db/mapData');
const cache   = require('./db/chatHistory');
const chatLog = require('./db/chatLog');
const customMemory = require('./db/customMemory');
const audit   = require('./db/audit');
const runtime = require('./utils/runtimeEnv');
const robloxWatcher = require('./roblox/watcher');
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
const CACHE_TTL_DAYS      = 30;
const CACHE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1x per hari
const FORCED_MAP_TTL_MS   = 30 * 60 * 1000; // reset counter setelah 30 menit idle
const PRESENCE_INTERVAL_MS = 60 * 1000; // refresh activity status tiap 1 menit (sumber dari watcher.bus)

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

// ---- pesan boilerplate (selalu Indonesia) ----
// Catatan: TIDAK pakai @user di template -- helper reply() yang prepend @user.
const MSG = {
  hello:    (n) => `halo, kenalin aku ${lower(n)} aku adalah AI paling ganteng sedunia, yang siap membantu menjawab pertanyaan kalian di server ini, tinggal sebut aja namaku "${lower(n)}" maka aku akan menjawab semua pertanyaan kalian`,
  back:     (n) => `hoamm... enak banget ${lower(n)} tidurnya walau gak lama, udah siap bantu jawab pertanyaan kalian lagi nih @everyone`,
  farewell: (n) => `${ucfirst(n)} capek, ${lower(n)} tidur dulu yaa, babay semua... @everyone`,
  apiFail:  ()  => `maaf yah, token/API kamu salah/error nih, aku gagal mendarat`,
  sabar:    ()  => `sabar ya kak, kasih aku mikir dulu 1 menit yaa`,
  warn:     (n) => `jika kamu tidak bisa bersabar maka akan ${lower(n)} bungkam yaa`,
  timeout:  (n) => `maaf, ${lower(n)} bungkam, kamu gasabaran sih jadi manusia, ${lower(n)} robot bukan nabi boyyy...`,
  empty:    (n) => `iya, ada apa? tanya aja, sebut "${lower(n)}" + pertanyaannya.`,
  errorApi: ()  => `aduh otak gue lagi nge-lag (API error). coba lagi sebentar yaa.`,
  exploit:  (n) => `wah maaf, ${lower(n)} gak bantu soal cheat/exploit/bug abuse. ` +
                   `Itu ngelanggar **Roblox Terms of Service** dan bisa kena ` +
                   `**UU ITE Pasal 30, 32, dan 33** (akses ilegal & manipulasi ` +
                   `sistem elektronik di Indonesia). Mainnya yang fair yaa, biar ` +
                   `map-nya tetap aman buat semua player.\n\n` +
                   `(EN) sorry bro, no help with cheats/exploits/bug abuse. ` +
                   `It violates Roblox ToS and Indonesian ITE Law (Articles 30/32/33) ` +
                   `about unauthorized system access and data manipulation. Play fair.`,
  deferredErr: () => `masih limit nih, coba beberapa menit lagi yaa.`,

  // ===== "No-such-map" / forced map (req. user) =====
  noMapEmpty: (n) => `maaf yaa, database map ${lower(n)} lagi kosong nih, jadi terlalu banyak map di Roblox yang ${lower(n)} gak tau. Tanya admin map-nya yaa biar diisi datanya dulu.`,
  noMapMiss:  (n) => `maaf, map itu belum ada di catatan ${lower(n)}. ${lower(n)} cuma bantu Roblox umum dan map yang ada di database. Coba tanya admin map yang bersangkutan.`,
  forcedMap2: (n) => `udah ${lower(n)} bilang map itu gak ada di catatan, jangan dipaksa terus yaa. ${lower(n)} bukan google search.`,
  forcedMap3: (n) => `**WARNING**: kalo kamu masih maksa nanya map yang gak ada, ${lower(n)} bakal **bungkam beneran** loh. Stop ya, gak ada ya gak ada.`,
  forcedMap4: (n) => `maaf yaa kamu ${lower(n)} bungkam, makanya jangan dipaksa terus. Kalo gak ada di catatan ya emang gak ada, ${lower(n)} cuma jawab dari database bukan ngarang. Cooling down 5 menit yaa.`,
};

// =================================================================
//  Anti-exploit pre-filter
//  Pre-block sebelum Gemini dipanggil (hemat token + hard refusal).
//  Konservatif: hanya block sinyal kuat. Sisa nuance ditangani prompt.
// =================================================================
const EXPLOIT_PATTERNS = [
  // Tools - script executor (universally exploit)
  /\b(?:synapse(?:\s*x)?|krnl|fluxus|jjsploit|hydrogen|delta\s*executor|sentinel\s*executor|script\s+executor|roblox\s+executor|wave\s+executor|valyse)\b/i,

  // Cheat-specific terms (no legitimate casual use)
  /\baimbot\b/i,
  /\bwall.?hack(?:s|ing)?\b/i,
  /\bno.?clip(?:ping)?\b/i,
  /\bgod.?mode\b/i,
  /\bspeed.?hack\b/i,
  /\bfly.?hack\b/i,
  /\bkill.?aura\b/i,
  /\besp\s+(?:roblox|game|hack|cheat|tool|script)/i,

  // Dupe (almost always exploit context in Roblox)
  /\bdupe\s*(?:glitch|method|item|exploit|trick|tip|cara|gimana|hack)?\b/i,

  // Ask patterns + exploit verb
  /\b(?:how\s+to|how\s+do\s+i|cara|tutorial|share|kasih|ngajarin|teach\s+me|gimana(?:\s+cara)?|bagaimana(?:\s+cara)?)\b.{0,50}\b(?:cheat|exploit|hack|bypass|inject|crack|dupe)\b/i,

  // Exploit verb + ask
  /\b(?:cheat|exploit|hack|bypass|inject|dupe)\b.{0,30}\b(?:method|cara|tutorial|trick|script|tool|software|step)\b/i,

  // Give/share/send + cheat
  /\b(?:give|share|send|kirim|kirimin|kasih|bagi|bagiin|drop|drop\s+it)\s+(?:me\s+)?(?:cheat|exploit|hack|script|injector|dupe)\b/i,

  // Bug abuse / glitch abuse
  /\bbug\s+(?:abuse|abusing|exploit|exploiting)\b/i,
  /\babus(?:e|ing)\s+(?:bug|glitch|exploit)\b/i,
  /\bglitch\s+abuse\b/i,

  // Bypass anti-cheat / ban evasion
  /\bbypass\s+(?:anti.?cheat|ban|hwid|protection|guard|byfron|hyperion)\b/i,
  /\bban\s+evasion\b/i,
  /\balt\s+account\s+(?:ban|exploit)\b/i,

  // Inject script
  /\binject(?:or|ing|ion)?\s+(?:script|dll|code|trainer|cheat|hack)\b/i,

  // Indonesian slang
  /\bnge.?(?:cheat|exploit|hack|bypass)\b/i,
  /\b(?:cara|gimana|bagaimana|how)\b.{0,30}\bcurang\b/i,
  /\bcurang(?:in|i|kan)\b/i,
];

function looksLikeExploitQuery(text) {
  const s = String(text || '');
  return EXPLOIT_PATTERNS.some((re) => re.test(s));
}

// ---- state ----
let SLEEPING = true;
let READY    = false;
let SHUTTING = false;
let API_OK   = false;
let CHAN_OK  = false;
const WAITING  = new Map();
const TIMEOUTS = new Map();
const FORCED_MAP = new Map(); // userId -> { hash, count, ts } untuk "no-such-map" escalation

function looksLikeMapQuestion(text) {
  return /\b(map|lobby|zona|dungeon|tempat|level|stage|world|raid|arena|gua|hutan|puncak|reruntuhan|spawn)\b/i.test(String(text));
}

function trackForcedMap(userId, question) {
  const h = cache.normalize(question);
  const now = Date.now();
  const cur = FORCED_MAP.get(userId);
  if (!cur || (now - cur.ts) > FORCED_MAP_TTL_MS) {
    FORCED_MAP.set(userId, { hash: h, count: 1, ts: now });
    return 1;
  }
  if (cache.jaccard(cur.hash, h) >= 0.7) {
    cur.count++;
    cur.ts = now;
    return cur.count;
  }
  FORCED_MAP.set(userId, { hash: h, count: 1, ts: now });
  return 1;
}

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
  const mention = `<@${msg.author.id}>`;
  const max = 1900;
  // Chunk pertama: prepend @user mention; sisanya plain channel.send (1 thread).
  if ((mention.length + 1 + content.length) <= max) {
    return msg.reply({
      content: `${mention} ${content}`,
      allowedMentions: { users: [msg.author.id], repliedUser: false },
    });
  }
  let first = true;
  let i = 0;
  while (i < content.length) {
    const slot = first ? max - mention.length - 1 : max;
    const part = content.slice(i, i + slot);
    if (first) {
      await msg.reply({
        content: `${mention} ${part}`,
        allowedMentions: { users: [msg.author.id], repliedUser: false },
      });
      first = false;
    } else {
      await msg.channel.send(part);
    }
    i += slot;
  }
}

/**
 * Helper reply: selalu prepend @user mention. Suppress reply-ping (avoid double).
 * Pakai utk semua boilerplate (sabar/warn/timeout/empty/errorApi/exploit/dst.).
 */
async function reply(msg, content) {
  const mention = `<@${msg.author.id}>`;
  // hindari double mention bila konten sudah terdapat mention
  const text = content.includes(mention) ? content : `${mention} ${content}`;
  return msg.reply({
    content: text,
    allowedMentions: { users: [msg.author.id], repliedUser: false },
  });
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
async function validateNewValues({ channelId, primaryKey, secondaryKey, key1, key2, key3, key4, key5 } = {}) {
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

  // Backward-compat: primaryKey -> key1, secondaryKey -> key2
  if (primaryKey !== undefined && key1 === undefined) key1 = primaryKey;
  if (secondaryKey !== undefined && key2 === undefined) key2 = secondaryKey;

  const slots = { key1, key2, key3, key4, key5 };
  for (const [name, val] of Object.entries(slots)) {
    if (val === undefined || val === null) continue;
    const e = await testKey(val);
    if (e) errors[name] = e;
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
  if (typeof updates.channelId === 'string')   persistKey.YANTO_CHANNEL_ID = updates.channelId;
  // legacy alias
  if (typeof updates.primaryKey === 'string')   persistKey.GEMINI_API_KEY_1 = updates.primaryKey;
  if (typeof updates.secondaryKey === 'string') persistKey.GEMINI_API_KEY_2 = updates.secondaryKey;
  // 5-slot
  for (let i = 1; i <= 5; i++) {
    if (typeof updates[`key${i}`] === 'string') {
      persistKey[`GEMINI_API_KEY_${i}`] = updates[`key${i}`];
    }
  }

  runtime.save(persistKey);
  log.info(`[env-update] runtime.json updated: ${Object.keys(persistKey).join(', ')}`);

  const apiOk = await validateGeminiInternal();
  const chOk  = await validateChannelInternal();
  API_OK = apiOk;
  CHAN_OK = chOk;

  if (apiOk && chOk) {
    SLEEPING = false;
    log.info('[env-update] semua valid -> bot WAKES UP, mengirim ucapan hello.');
    await sendToTargetChannel(MSG.hello(botName()));
    // Update presence langsung supaya activity Discord refresh ke status aktif
    try { await updatePresence(); } catch (_) {}
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
    try {
      const cfg = loadCfg();
      const uid = cfg.roblox && cfg.roblox.universeId ? String(cfg.roblox.universeId).trim() : '';
      robloxWatcher.start(uid);
    } catch (e) { log.warn('[startup] roblox watcher start error:', e.message); }

    // Schedule cache TTL cleanup (req. user: hapus cache > 30 hari)
    try {
      const removed = cache.cleanupOlderThanDays(CACHE_TTL_DAYS);
      if (removed > 0) log.info(`[cache.ttl] cold-start cleanup: ${removed} entries >${CACHE_TTL_DAYS}d removed`);
    } catch (e) { log.warn('[cache.ttl] cold-start cleanup error:', e.message); }

    // Background: cleanup harian
    setInterval(() => {
      try {
        const removed = cache.cleanupOlderThanDays(CACHE_TTL_DAYS);
        if (removed > 0) log.info(`[cache.ttl] daily cleanup: ${removed} entries >${CACHE_TTL_DAYS}d removed`);
      } catch (e) { log.warn('[cache.ttl] daily cleanup error:', e.message); }
    }, CACHE_CLEANUP_INTERVAL_MS).unref();

    // Auto-refresh validasi API tiap 1 menit (round-robin)
    gemini.startAutoRefresh();

    // Discord Activity / Rich Presence -- tampil di profile bot
    startPresenceLoop();

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
    try {
      const cfg = loadCfg();
      const uid = cfg.roblox && cfg.roblox.universeId ? String(cfg.roblox.universeId).trim() : '';
      robloxWatcher.start(uid);
    } catch (e) { log.warn('[restart] roblox watcher start error:', e.message); }
    // Resume presence loop & API refresh after restart
    startPresenceLoop();
    gemini.startAutoRefresh();
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
  stopPresenceLoop();
  setTimeout(() => {
    try { client.destroy(); } catch (_) {}
    process.exit(RESTART_EXIT_CODE);
  }, RESTART_QUIET_MS);
}

async function gracefulShutdown(reason = 'shutdown') {
  if (SHUTTING) return;
  SHUTTING = true; SLEEPING = true;
  log.info(`[shutdown] ${reason} -- pamit + exit dalam ${SHUTDOWN_DELAY_MS}ms`);
  stopPresenceLoop();
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

  // 0) Pre-filter ANTI-EXPLOIT (hard refusal, tanpa panggil Gemini)
  if (looksLikeExploitQuery(question)) {
    log.warn(`[exploit-block] user=${msg.author.id} q="${question.slice(0, 100)}"`);
    audit.log(
      `discord:${msg.author.id}`,
      'exploit.refused',
      `channel:${msg.channelId}`,
      question.slice(0, 300)
    );
    await reply(msg, MSG.exploit(botName()));
    return;
  }

  const cfg = loadCfg();
  const askedAt = Math.floor((msg.createdTimestamp || Date.now()) / 1000);

  // 1) CUSTOM MEMORY lookup (priority TERTINGGI - ingatan buatan dari dashboard)
  const customHit = customMemory.findSimilar(question, 0.85);
  if (customHit) {
    log.info(`[custom-memory] hit (score=${customHit.score.toFixed(2)}) -> ${question.slice(0, 60)}`);
    const finalAnswer = customMemory.applyPlaceholders(customHit.row.answer, { botName: botName() });
    // izinkan parsing user/role mention supaya tag di custom memory beneran nge-ping
    const mention = `<@${msg.author.id}>`;
    const text = finalAnswer.includes(mention) ? finalAnswer : `${mention} ${finalAnswer}`;
    await msg.reply({
      content: text.length > 1900 ? text.slice(0, 1900) : text,
      allowedMentions: { parse: ['users', 'roles'], repliedUser: false },
    });
    chatLog.add({
      discordId: msg.author.id,
      username:  msg.author.username || msg.author.tag || 'unknown',
      question,
      answer:    finalAnswer,
      source:    `custom-memory:${customHit.row.id}`,
      askedAt,
      answeredAt: Math.floor(Date.now() / 1000),
    });
    return;
  }

  const followUp = isSpecificFollowup(question, cfg.cache.specificTriggers);
  const hit = cache.findSimilar(question, cfg.cache.similarityThreshold);

  if (hit && !followUp) {
    log.info(`[cache] hit (score=${hit.score.toFixed(2)}) -> ${question.slice(0, 60)}`);
    await sendLong(msg, hit.row.answer);
    chatLog.add({
      discordId: msg.author.id,
      username:  msg.author.username || msg.author.tag || 'unknown',
      question,
      answer:    hit.row.answer,
      source:    `cache:${hit.row.id}`,
      askedAt,
      answeredAt: Math.floor(Date.now() / 1000),
    });
    return;
  }

  // 2) Cek status DB - kalau kosong + question is map-related, escalate forced-map dance
  const allMaps = mapData.listMaps();
  const dbEmpty = allMaps.length === 0;
  const matched = mapData.searchMap(question);
  const isMapQ  = looksLikeMapQuestion(question);

  if (isMapQ && (dbEmpty || matched.length === 0)) {
    const cnt = trackForcedMap(msg.author.id, question);
    log.info(`[forced-map] user=${msg.author.id} count=${cnt} dbEmpty=${dbEmpty}`);
    let resp;
    if (cnt === 1)      resp = dbEmpty ? MSG.noMapEmpty(botName()) : MSG.noMapMiss(botName());
    else if (cnt === 2) resp = MSG.forcedMap2(botName());
    else if (cnt === 3) resp = MSG.forcedMap3(botName()); // ANCAMAN bungkam
    else if (cnt === 4) {
      // EKSEKUSI bungkam: Discord timeout 5 menit + pesan "maaf ya kamu bungkam"
      try {
        let member = msg.member;
        if (!member && msg.guild) {
          member = await msg.guild.members.fetch(msg.author.id).catch(() => null);
        }
        if (member && member.moderatable) {
          await member.timeout(TIMEOUT_DURATION_MS, `Forced map dance escalation by ${botName()}`);
          log.info(`[forced-map] TIMEOUT user=${msg.author.id} (${TIMEOUT_DURATION_MS / 60000}min)`);
        } else {
          log.warn('[forced-map] member tidak moderatable, fallback timeout internal');
        }
      } catch (err) {
        log.warn('[forced-map] gagal Discord-timeout:', err.message);
      }
      TIMEOUTS.set(msg.author.id, Date.now() + TIMEOUT_DURATION_MS);
      FORCED_MAP.delete(msg.author.id); // reset counter (user sudah di-bungkam)
      resp = MSG.forcedMap4(botName());
      audit.log(
        `discord:${msg.author.id}`,
        'forcedMap.timeout',
        `channel:${msg.channelId}`,
        `5min timeout, question: ${question.slice(0, 200)}`
      );
    } else {
      resp = null; // count > 4: silent (tapi user juga sudah di-timeout di Discord)
    }
    if (resp) {
      await reply(msg, resp);
      chatLog.add({
        discordId: msg.author.id,
        username:  msg.author.username || msg.author.tag || 'unknown',
        question,
        answer:    resp,
        source:    `forced-map:${cnt}`,
        askedAt,
        answeredAt: Math.floor(Date.now() / 1000),
      });
    } else {
      log.info(`[forced-map] user=${msg.author.id} silent (count>${cnt})`);
    }
    return;
  }

  // Reset forced-map counter kalau user akhirnya nanya map yang ada
  if (isMapQ && matched.length > 0) FORCED_MAP.delete(msg.author.id);

  // 3) Bangun konteks Gemini
  const { buildSystemPrompt } = loadPersonality();
  const mapCtx = mapData.buildContext(question);
  const overlay = (cfg && typeof cfg.personaOverlay === 'string') ? cfg.personaOverlay : '';
  const sysPrompt = buildSystemPrompt({
    name: botName(),
    dbEmpty,
    overlay,
    mapContext: mapCtx,
    extraNote: followUp
      ? 'User minta jawaban LEBIH DETAIL/SPESIFIK dari sebelumnya. Tambahkan rincian relevan dari DATA MAP.'
      : '',
  });
  const recent = cache.recentContext(msg.channelId, cfg.history.maxContextMessages);
  const history = [
    { role: 'user',  text: sysPrompt },
    { role: 'model', text: `Siap, gue ${botName()}. Gas tanya soal Roblox / map yang ada di catatan gue.` },
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
      source: `gemini:${res.keyUsed}${isDeferred ? '+deferred' : ''}${dbEmpty ? '+dbEmpty' : ''}`,
    });
  }
  await sendLong(msg, answer);

  chatLog.add({
    discordId: msg.author.id,
    username:  msg.author.username || msg.author.tag || 'unknown',
    question,
    answer,
    source:    `gemini:${res.keyUsed}(API ke-${res.keyNum})${isDeferred ? '+deferred' : ''}${dbEmpty ? '+dbEmpty' : ''}`,
    askedAt,
    answeredAt: Math.floor(Date.now() / 1000),
  });
}

// =================================================================
//  Rate-limit dance
// =================================================================
async function handleRateLimited(msg, question) {
  const userId  = msg.author.id;
  const w = WAITING.get(userId);

  if (!w) {
    const handle = setTimeout(async () => {
      WAITING.delete(userId);
      try {
        await processQuestion(question, msg, { allowReserve: true, isDeferred: true });
      } catch (err) {
        log.error('[deferred] gagal:', err.message);
        try { await reply(msg, MSG.deferredErr()); } catch (_) {}
      }
    }, SABAR_WAIT_MS);

    WAITING.set(userId, { count: 1, ts: Date.now(), handle, question });
    await reply(msg, MSG.sabar());
    return;
  }

  w.count++;
  if (w.count === 2) {
    await reply(msg, MSG.warn(botName()));
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
  try { await reply(msg, MSG.timeout(botName())); } catch (_) {}
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
      await reply(msg, MSG.empty(botName()));
      return;
    }

    // Pre-filter ANTI-EXPLOIT di top-level juga (cover spam mode + jalur deferred)
    if (looksLikeExploitQuery(rawQuestion)) {
      log.warn(`[exploit-block] user=${msg.author.id} q="${rawQuestion.slice(0, 100)}"`);
      audit.log(
        `discord:${msg.author.id}`,
        'exploit.refused',
        `channel:${msg.channelId}`,
        rawQuestion.slice(0, 300)
      );
      // Cancel deferred answer kalau user lagi WAITING (mereka sudah salahin haknya)
      const w = WAITING.get(msg.author.id);
      if (w && w.handle) clearTimeout(w.handle);
      WAITING.delete(msg.author.id);
      await reply(msg, MSG.exploit(botName()));
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
      try { await reply(msg, MSG.errorApi()); } catch (_) {}
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

// =================================================================
//  Discord Activity / Rich Presence
//
//  Format (sesuai req. user):
//    Watching <Map Name> | 1.4K Active | 2.1M Visit | 510 fav
//
//  Trigger:
//    - emit 'update' dari Roblox watcher (1 menit sekali, source-of-truth)
//    - sleep mode: status DnD + "{Nama} lagi tidur"
//    - watcher OFF: status default "Sebut <keyword>"
// =================================================================

/**
 * Format compact KMB style (req. user).
 *   142    -> "142"
 *   1234   -> "1.2K"
 *   1.4M   -> "1.4M"
 *   2.1B   -> "2.1B"
 */
function fmtKMB(n) {
  if (typeof n !== 'number' || isNaN(n)) return '...';
  if (n < 1000) return String(n);
  const u = [
    { v: 1e12, s: 'T' },
    { v: 1e9,  s: 'B' },
    { v: 1e6,  s: 'M' },
    { v: 1e3,  s: 'K' },
  ];
  for (const x of u) {
    if (n >= x.v) {
      const v = n / x.v;
      // >=100 -> integer, lainnya 1 desimal (drop .0 trailing)
      const str = v >= 100 ? Math.floor(v).toString() : v.toFixed(1).replace(/\.0$/, '');
      return str + x.s;
    }
  }
  return String(n);
}

let presenceTimer = null;
let presenceLoopBound = false;

async function updatePresence() {
  try {
    if (!client.user) return;

    // Bot tidur (validasi gagal) -> DnD + diam
    if (SLEEPING) {
      await client.user.setPresence({
        status: 'dnd',
        activities: [{
          type: ActivityType.Custom,
          name: 'custom',
          state: `${ucfirst(botName())} lagi tidur (cek dashboard)`,
        }],
      });
      return;
    }

    const wstate = robloxWatcher.getStatus();

    // Watcher OFF (universe ID belum di-set) -> hint default
    if (!wstate || !wstate.enabled) {
      await client.user.setPresence({
        status: 'online',
        activities: [{
          type: ActivityType.Custom,
          name: 'custom',
          state: `Sebut "${botKeyword()}" untuk tanya soal Roblox`,
        }],
      });
      return;
    }

    // Watcher ON tapi data belum siap (initial fetch < 5 detik)
    if (wstate.playing == null && wstate.visits == null) {
      await client.user.setPresence({
        status: 'idle',
        activities: [{
          type: ActivityType.Watching,
          name: wstate.name || 'Roblox map...',
        }],
      });
      return;
    }

    // SINGLE FRAME: "Watching <map> | 1.4K Active | 2.1M Visit | 510 fav"
    const mapName = wstate.name || 'Roblox';
    const active  = wstate.playing != null ? fmtKMB(wstate.playing)   : '...';
    const visits  = wstate.visits  != null ? fmtKMB(wstate.visits)    : '...';
    const fav     = wstate.favorited != null ? fmtKMB(wstate.favorited) : '...';

    await client.user.setPresence({
      status: 'online',
      activities: [{
        type: ActivityType.Watching,
        name: mapName,
        state: `${active} Active | ${visits} Visit | ${fav} fav`,
      }],
    });
  } catch (err) {
    log.warn('[presence] update error:', err.message);
  }
}

function startPresenceLoop() {
  // Initial set + bind ke event watcher (1 menit sekali sumber data sama).
  // TIDAK ada interval terpisah -- presence di-update tiap watcher.bus 'update'.
  updatePresence().catch(() => {});

  if (!presenceLoopBound) {
    robloxWatcher.bus.on('update', () => {
      updatePresence().catch(() => {});
    });
    presenceLoopBound = true;
  }

  // Backup interval: refresh tiap 1 menit kalau watcher OFF (biar status
  // sleep/idle/default tetap "fresh" -- ini lightweight, no API call).
  if (!presenceTimer) {
    presenceTimer = setInterval(() => {
      const wstate = robloxWatcher.getStatus();
      if (!wstate.enabled || SLEEPING) {
        updatePresence().catch(() => {});
      }
    }, 60 * 1000);
    if (presenceTimer.unref) presenceTimer.unref();
  }
}

function stopPresenceLoop() {
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
}

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
