'use strict';

const pad = (n) => String(n).padStart(2, '0');
function ts() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function info(...a)  { console.log(`[${ts()}] [INFO]`, ...a); }
function warn(...a)  { console.warn(`[${ts()}] [WARN]`, ...a); }
function error(...a) { console.error(`[${ts()}] [ERR ]`, ...a); }

module.exports = { info, warn, error };
