'use strict';

/**
 * Roblox Watcher
 * Polling Roblox public API:
 *   GET https://games.roblox.com/v1/games?universeIds=<ID>
 *   -> { data: [{ id, name, playing, visits, ... }] }
 *
 * Schedule:
 *   - playing : update tiap 1 menit (realtime)
 *   - visits  : update tiap 1 jam
 *
 * Bila universeId KOSONG -> watcher OFF, semua field null.
 * Watcher restart otomatis bila start() dipanggil dengan ID baru.
 */

const log = require('../utils/logger');

const PLAYER_INTERVAL_MS = 60 * 1000;          // 1 menit
const VISITS_INTERVAL_MS = 60 * 60 * 1000;     // 1 jam
const ROBLOX_API = (id) => `https://games.roblox.com/v1/games?universeIds=${encodeURIComponent(id)}`;

const initialState = () => ({
  enabled: false,
  universeId: null,
  name: null,
  rootPlaceId: null,
  playing: null,
  visits: null,
  favorited: null,
  lastPlayingUpdate: 0,
  lastVisitsUpdate: 0,
  error: null,
  lastErrorAt: 0,
  startedAt: 0,
});

let state = initialState();
let playerInterval = null;
let visitsInterval = null;

async function fetchGame(universeId) {
  if (typeof fetch !== 'function') {
    throw new Error('global fetch tidak tersedia (butuh Node 18+)');
  }
  const url = ROBLOX_API(universeId);
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'YantoBot/1.0', 'Accept': 'application/json' },
    });
  } catch (err) {
    throw new Error(`network: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  let json;
  try { json = await res.json(); }
  catch (err) { throw new Error(`invalid JSON: ${err.message}`); }
  if (!json || !Array.isArray(json.data) || !json.data[0]) {
    throw new Error('Universe ID tidak ditemukan / map private / format tidak dikenali');
  }
  return json.data[0];
}

async function tickPlayer() {
  if (!state.enabled || !state.universeId) return;
  try {
    const d = await fetchGame(state.universeId);
    state.name           = d.name;
    state.rootPlaceId    = d.rootPlaceId;
    state.playing        = typeof d.playing === 'number' ? d.playing : null;
    state.favorited      = typeof d.favoritedCount === 'number' ? d.favoritedCount : null;
    state.lastPlayingUpdate = Date.now();
    state.error = null;
    log.info(`[roblox] tick player: ${d.name || '?'} - ${d.playing} playing`);
  } catch (err) {
    state.error = err.message;
    state.lastErrorAt = Date.now();
    log.warn(`[roblox] tick player error: ${err.message}`);
  }
}

async function tickVisits() {
  if (!state.enabled || !state.universeId) return;
  try {
    const d = await fetchGame(state.universeId);
    state.visits = typeof d.visits === 'number' ? d.visits : null;
    state.lastVisitsUpdate = Date.now();
    log.info(`[roblox] tick visits: ${(d.visits || 0).toLocaleString()} total visits`);
  } catch (_) {
    // error sudah di-log di tickPlayer
  }
}

function clearTimers() {
  if (playerInterval) clearInterval(playerInterval);
  if (visitsInterval) clearInterval(visitsInterval);
  playerInterval = null;
  visitsInterval = null;
}

function start(universeId) {
  clearTimers();
  const id = universeId ? String(universeId).trim() : '';
  if (!id) {
    state = initialState();
    log.info('[roblox] watcher OFF (universe ID kosong)');
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
  log.info(`[roblox] watcher ON, universeId=${id}`);

  // Initial fetch
  tickPlayer().catch(() => {});
  tickVisits().catch(() => {});

  playerInterval = setInterval(() => tickPlayer().catch(() => {}), PLAYER_INTERVAL_MS);
  visitsInterval = setInterval(() => tickVisits().catch(() => {}), VISITS_INTERVAL_MS);
  if (playerInterval.unref) playerInterval.unref();
  if (visitsInterval.unref) visitsInterval.unref();
}

function stop() {
  clearTimers();
  if (state.enabled) log.info('[roblox] watcher stopped');
  state = initialState();
}

function getStatus() {
  return { ...state };
}

module.exports = { start, stop, getStatus };
