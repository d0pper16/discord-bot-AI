'use strict';

/**
 * Roblox Watcher
 *
 * Polling Roblox public API:
 *   GET https://games.roblox.com/v1/games?universeIds=<ID>
 *     -> { data: [{ id, name, playing, visits, ... }] }
 *
 * Schedule (sesuai req. user):
 *   - 1x request per 1 menit
 *   - data feed dashboard + Discord Rich Presence dari source yang SAMA
 *   - icon/thumbnail di-refresh tiap 60 tick (~1 jam, jarang berubah)
 *
 * Bila universeId KOSONG -> watcher OFF, semua field null.
 *
 * Event bus: emit 'update' tiap kali state berubah.
 */

const { EventEmitter } = require('events');
const log = require('../utils/logger');

const bus = new EventEmitter();
bus.setMaxListeners(20);

const TICK_INTERVAL_MS         = 60 * 1000;   // 1 menit (1x request)
const ICON_REFRESH_EVERY_TICKS = 60;          // tiap 60 menit refresh icon
const ROBLOX_API   = (id) => `https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(id)}`;
const ROBLOX_ICON  = (id) => `https://thumbnails.roblox.com/v1/games/icons?universeIds=${encodeURIComponent(id)}&size=512x512&format=Png&isCircular=false`;
const ROBLOX_THUMB = (id) => `https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${encodeURIComponent(id)}&size=768x432&countPerUniverse=1&defaults=true&format=Png`;

const initialState = () => ({
  enabled: false,
  universeId: null,
  name: null,
  rootPlaceId: null,
  description: null,
  playing: null,
  visits: null,
  favorited: null,
  iconUrl: null,
  thumbnailUrl: null,
  lastUpdate: 0,
  lastIconUpdate: 0,
  error: null,
  lastErrorAt: 0,
  startedAt: 0,
});

let state = initialState();
let tickTimer = null;
let tickCount = 0;

async function fetchGame(universeId) {
  if (typeof fetch !== 'function') {
    throw new Error('global fetch tidak tersedia (butuh Node 18+)');
  }
  const res = await fetch(ROBLOX_API(universeId), {
    headers: { 'User-Agent': 'YantoBot/1.0', 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.data) || !json.data[0]) {
    throw new Error('Universe ID tidak ditemukan / map private / format tidak dikenali');
  }
  return json.data[0];
}

async function fetchIcon(universeId) {
  if (typeof fetch !== 'function') return null;
  try {
    const r = await fetch(ROBLOX_ICON(universeId), {
      headers: { 'User-Agent': 'YantoBot/1.0', 'Accept': 'application/json' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const item = j && Array.isArray(j.data) && j.data[0];
    if (item && item.state === 'Completed' && item.imageUrl) return item.imageUrl;
    return null;
  } catch (_) { return null; }
}

async function fetchThumbnail(universeId) {
  if (typeof fetch !== 'function') return null;
  try {
    const r = await fetch(ROBLOX_THUMB(universeId), {
      headers: { 'User-Agent': 'YantoBot/1.0', 'Accept': 'application/json' },
    });
    if (!r.ok) return null;
    const j = await r.json();
    const item = j && Array.isArray(j.data) && j.data[0];
    const t = item && Array.isArray(item.thumbnails) && item.thumbnails[0];
    if (t && t.state === 'Completed' && t.imageUrl) return t.imageUrl;
    return null;
  } catch (_) { return null; }
}

/**
 * Tick utama: 1x request game info per 1 menit.
 * Update SEMUA field (players, visits, favorited, name) sekaligus.
 * Icon/thumbnail di-fetch terpisah tiap 60 tick.
 */
async function tick() {
  if (!state.enabled || !state.universeId) return;
  tickCount++;

  try {
    const d = await fetchGame(state.universeId);
    state.name        = d.name;
    state.rootPlaceId = d.rootPlaceId;
    state.description = (d.description || '').slice(0, 500);
    state.playing     = typeof d.playing === 'number' ? d.playing : null;
    state.visits      = typeof d.visits === 'number' ? d.visits : null;
    state.favorited   = typeof d.favoritedCount === 'number' ? d.favoritedCount : null;
    state.lastUpdate  = Date.now();
    state.error       = null;
    log.info(`[roblox] tick #${tickCount}: ${d.name || '?'} - ${d.playing} active, ${(d.visits || 0).toLocaleString()} visits, ${d.favoritedCount || 0} fav`);
    bus.emit('update', { ...state });
  } catch (err) {
    state.error = err.message;
    state.lastErrorAt = Date.now();
    log.warn(`[roblox] tick #${tickCount} error: ${err.message}`);
  }

  // Refresh icon/thumb di tick pertama, lalu tiap 60 tick
  if (tickCount === 1 || (tickCount % ICON_REFRESH_EVERY_TICKS === 0)) {
    try {
      const [icon, thumb] = await Promise.all([
        fetchIcon(state.universeId),
        fetchThumbnail(state.universeId),
      ]);
      if (icon)  state.iconUrl = icon;
      if (thumb) state.thumbnailUrl = thumb;
      if (icon || thumb) {
        state.lastIconUpdate = Date.now();
        log.info(`[roblox] icon refreshed (icon=${!!icon}, thumb=${!!thumb})`);
        bus.emit('update', { ...state });
      }
    } catch (e) {
      log.warn(`[roblox] icon fetch error: ${e.message}`);
    }
  }
}

function clearTimers() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  tickCount = 0;
}

function start(universeId) {
  clearTimers();
  const id = universeId ? String(universeId).trim() : '';
  if (!id) {
    state = initialState();
    log.info('[roblox] watcher OFF (universe ID kosong)');
    bus.emit('update', { ...state });
    return;
  }
  if (!/^\d{1,20}$/.test(id)) {
    state = initialState();
    log.error(`[roblox] universe ID tidak valid: "${id}" (harus 1-20 digit)`);
    return;
  }
  state = {
    ...initialState(),
    enabled: true,
    universeId: id,
    startedAt: Date.now(),
  };
  log.info(`[roblox] watcher ON, universeId=${id} (1 request/menit)`);

  // Initial fetch (tick #1)
  tick().catch(() => {});

  // Schedule tiap 1 menit
  tickTimer = setInterval(() => tick().catch(() => {}), TICK_INTERVAL_MS);
  if (tickTimer.unref) tickTimer.unref();
}

function stop() {
  clearTimers();
  if (state.enabled) log.info('[roblox] watcher stopped');
  state = initialState();
}

function getStatus() {
  return { ...state };
}

module.exports = { start, stop, getStatus, bus };
