'use strict';

const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const path = require('path');

const log     = require('./utils/logger');
const gemini  = require('./ai/gemini');
const mapData = require('./db/mapData');
const cache   = require('./db/chatHistory');

const cfgPath = path.join(__dirname, '..', 'config.json');
const personalityPath = path.join(__dirname, 'ai', 'personality.js');

function loadCfg() {
  delete require.cache[require.resolve(cfgPath)];
  return require(cfgPath);
}
function loadPersonality() {
  delete require.cache[require.resolve(personalityPath)];
  return require(personalityPath);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ---- helpers ----
function containsKeyword(text, keyword) {
  if (!text) return false;
  const re = new RegExp(`\\b${keyword}\\b`, 'i');
  return re.test(text);
}

function stripKeyword(text, keyword) {
  return text.replace(new RegExp(`\\b${keyword}\\b[,:]?`, 'gi'), '').trim();
}

function isSpecificFollowup(text, triggers) {
  const t = String(text).toLowerCase();
  return triggers.some((k) => t.includes(k.toLowerCase()));
}

async function sendLong(message, content) {
  const max = 1900;
  if (content.length <= max) return message.reply(content);
  // pecah jadi beberapa pesan
  let first = true;
  for (let i = 0; i < content.length; i += max) {
    const part = content.slice(i, i + max);
    if (first) { await message.reply(part); first = false; }
    else       { await message.channel.send(part); }
  }
}

// ---- event handlers ----
client.once(Events.ClientReady, (c) => {
  log.info(`Yanto online sebagai ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.author.bot) return;

    const cfg = loadCfg();
    const targetChannel = process.env.YANTO_CHANNEL_ID;

    if (!targetChannel || msg.channelId !== targetChannel) return;
    if (!containsKeyword(msg.content, cfg.keyword)) return;

    const rawQuestion = stripKeyword(msg.content, cfg.keyword);
    if (!rawQuestion) {
      await msg.reply('iya, ada apa? tanya aja, sebut "yanto" + pertanyaannya.');
      return;
    }

    await msg.channel.sendTyping();

    // === Cek cache dulu ===
    const hit = cache.findSimilar(rawQuestion, cfg.cache.similarityThreshold);
    const followUp = isSpecificFollowup(rawQuestion, cfg.cache.specificTriggers);

    if (hit && !followUp) {
      log.info(`[cache] hit (score=${hit.score.toFixed(2)}) -> ${rawQuestion}`);
      return sendLong(msg, hit.row.answer);
    }

    // === Bangun konteks ===
    const { buildSystemPrompt } = loadPersonality();
    const mapCtx = mapData.buildContext(rawQuestion);
    const sysPrompt = buildSystemPrompt({
      mapContext: mapCtx,
      extraNote: followUp
        ? 'User minta jawaban LEBIH DETAIL/SPESIFIK dari sebelumnya. Tambahkan rincian yang relevan dari DATA MAP.'
        : '',
    });

    // riwayat ringkas dari channel ini agar Yanto "ingat"
    const recent = cache.recentContext(msg.channelId, cfg.history.maxContextMessages);
    const history = [];
    history.push({ role: 'user',  text: sysPrompt });
    history.push({ role: 'model', text: 'Siap, gue Yanto. Gas tanya apa aja soal map.' });
    for (const r of recent) {
      history.push({ role: 'user',  text: r.question });
      history.push({ role: 'model', text: r.answer });
    }

    // === Generate ===
    let answer, keyUsed;
    try {
      const res = await gemini.generate(rawQuestion, history);
      answer = res.text.trim();
      keyUsed = res.keyUsed;
    } catch (err) {
      log.error('gemini error:', err.message);
      await msg.reply('aduh otak gue lagi nge-lag (API limit atau error). coba lagi sebentar ya.');
      return;
    }

    // === Simpan / update cache ===
    if (hit && followUp) {
      cache.updateAnswer(hit.row.id, answer, `gemini:${keyUsed}`);
      log.info(`[cache] update id=${hit.row.id} (followup)`);
    } else {
      cache.saveAnswer({
        channelId: msg.channelId,
        userId: msg.author.id,
        question: rawQuestion,
        answer,
        source: `gemini:${keyUsed}`,
      });
    }

    await sendLong(msg, answer);
  } catch (err) {
    log.error('handler error:', err);
    try { await msg.reply('error internal, log udah dicatat.'); } catch (_) {}
  }
});

function start() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN belum di-set di .env');
  return client.login(token);
}

function stop() {
  return client.destroy();
}

module.exports = { client, start, stop };
