'use strict';

require('dotenv').config();

const path = require('path');
const log  = require('./utils/logger');
const bot  = require('./bot');
const dashboard = require('./dashboard/server');
const { watch, bus } = require('./utils/hotReload');

async function main() {
  // 1. Dashboard duluan (biar bisa diakses meski Discord error)
  await dashboard.start();

  // 2. Bot
  await bot.start();

  // 3. Hot-reload: ubah personality.js / config.json langsung kepakai
  watch({
    personality: path.join(__dirname, 'ai', 'personality.js'),
    config:      path.join(__dirname, '..', 'config.json'),
  });

  bus.on('change', ({ name }) => {
    log.info(`[reload] ${name} aktif tanpa restart.`);
  });

  // graceful shutdown
  const shutdown = async (sig) => {
    log.info(`shutdown (${sig})...`);
    try { await bot.stop(); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('fatal:', err);
  process.exit(1);
});
