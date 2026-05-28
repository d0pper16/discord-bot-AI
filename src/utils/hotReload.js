'use strict';

const path = require('path');
const chokidar = require('chokidar');
const { EventEmitter } = require('events');

/**
 * Hot-reload sederhana berbasis cache require().
 * Dipakai untuk personality.js & config.json supaya
 * editan via dashboard berlaku realtime tanpa restart.
 */

const bus = new EventEmitter();

function purge(modulePath) {
  const abs = require.resolve(modulePath);
  delete require.cache[abs];
  return require(modulePath);
}

function watch(targets) {
  // targets: { name: absolutePath }
  const files = Object.values(targets);
  const watcher = chokidar.watch(files, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });

  watcher.on('change', (file) => {
    const name = Object.keys(targets).find((k) => targets[k] === file) || file;
    try {
      // hanya purge bila .js / .json
      if (/\.(js|json)$/i.test(file)) {
        purge(file);
      }
      bus.emit('change', { name, file });
      console.log(`[hot-reload] ${name} diperbarui`);
    } catch (err) {
      console.error('[hot-reload] gagal reload', file, err.message);
    }
  });

  return watcher;
}

module.exports = { bus, watch, purge };
