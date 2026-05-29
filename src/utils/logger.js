'use strict';

/**
 * Logger 1 (Server logs).
 *
 * Sifat (req. user):
 *   - SENORMAL & SEOPTIMAL mungkin -> in-memory, FIFO 1000 entries.
 *   - Errors di-protect: kalau buffer penuh, eviction prefer non-error dulu.
 *     Errors stays sampai server restart (yang otomatis clear semua).
 *
 * Intercept console.log/warn/error/info.
 */

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

const buffer = [];
const MAX_BUFFER = 1000;
let SEQ = 0;

function pad(n) { return String(n).padStart(2, '0'); }
function ts() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmt(args) {
  return args.map((a) => {
    if (a instanceof Error)         return a.stack || a.message;
    if (typeof a === 'string')      return a;
    if (a === null || a === undefined) return String(a);
    if (typeof a !== 'object')      return String(a);
    try { return JSON.stringify(a); } catch (_) { return String(a); }
  }).join(' ');
}

let emitting = false;
function emit(level, args) {
  if (emitting) return;
  emitting = true;
  try {
    const entry = {
      id: ++SEQ,
      ts: Date.now(),
      level,
      msg: fmt(args).slice(0, 4000),
    };

    // Eviction: kalau penuh, buang non-error dulu (errors di-protect).
    if (buffer.length >= MAX_BUFFER) {
      const idx = buffer.findIndex((e) => e.level !== 'error');
      if (idx !== -1) buffer.splice(idx, 1);
      else buffer.shift(); // semua errors -> evict oldest error
    }

    buffer.push(entry);
    bus.emit('log', entry);
  } finally {
    emitting = false;
  }
}

const orig = {
  log:   console.log.bind(console),
  warn:  console.warn.bind(console),
  error: console.error.bind(console),
  info:  console.info.bind(console),
};

console.log   = (...a) => { orig.log(...a);   emit('log',   a); };
console.warn  = (...a) => { orig.warn(...a);  emit('warn',  a); };
console.error = (...a) => { orig.error(...a); emit('error', a); };
console.info  = (...a) => { orig.info(...a);  emit('info',  a); };

function info(...a)  { console.log(`[${ts()}] [INFO]`, ...a); }
function warn(...a)  { console.warn(`[${ts()}] [WARN]`, ...a); }
function error(...a) { console.error(`[${ts()}] [ERR ]`, ...a); }

function getBuffer(since, levelFilter) {
  const sinceN = Number(since) || 0;
  let arr = sinceN > 0 ? buffer.filter((e) => e.ts > sinceN) : buffer.slice(-300);
  if (levelFilter && levelFilter !== 'all') {
    arr = arr.filter((e) => e.level === levelFilter);
  }
  return arr;
}

function getErrors() {
  return buffer.filter((e) => e.level === 'error');
}

function stats() {
  let errors = 0, warns = 0, normal = 0;
  for (const e of buffer) {
    if (e.level === 'error') errors++;
    else if (e.level === 'warn') warns++;
    else normal++;
  }
  return { total: buffer.length, errors, warns, normal };
}

function subscribe(cb) {
  bus.on('log', cb);
  return () => bus.off('log', cb);
}

module.exports = { info, warn, error, getBuffer, getErrors, stats, subscribe };
