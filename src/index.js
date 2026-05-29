'use strict';

require('dotenv').config();

const path = require('path');
const log  = require('./utils/logger');
const runtime = require('./utils/runtimeEnv');

// Apply runtime overrides (channel id + 2 API key) BEFORE bot starts
runtime.load();

const bot = require('./bot');
const dashboard = require('./dashboard/server');
const { watch, bus } = require('./utils/hotReload');

async function main() {
  await dashboard.start();
  await bot.start();

  watch({
    personality: path.join(__dirname, 'ai', 'personality.js'),
    config:      path.join(__dirname, '..', 'config.json'),
  });

  bus.on('change', ({ name }) => log.info(`[reload] ${name} aktif tanpa restart.`));

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
