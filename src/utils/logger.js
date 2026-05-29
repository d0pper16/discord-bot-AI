'use strict';

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
    buffer.push(entry);
    while (buffer.length > MAX_BUFFER) buffer.shift();
    bus.emit('log', entry);
  } finally {
    emitting = false;
  }
}

// Intercept console (sekali saja).
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

function getBuffer(since) {
  const sinceN = Number(since) || 0;
  if (sinceN > 0) return buffer.filter((e) => e.ts > sinceN);
  return buffer.slice(-300);
}

function subscribe(cb) {
  bus.on('log', cb);
  return () => bus.off('log', cb);
}

module.exports = { info, warn, error, getBuffer, subscribe };
