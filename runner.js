'use strict';

/**
 * Supervisor proses Yanto.
 * - Spawn `src/index.js` sebagai child.
 * - Bila child exit dengan code 42 (RESTART_EXIT_CODE) -> respawn.
 * - Bila exit code lain -> ikut keluar.
 *
 * Set env YANTO_IS_RESTART=1 saat respawn supaya bot tahu ini
 * restart (ucap "hoamm..."), bukan cold-start (validasi + "halo").
 */

const path  = require('path');
const { spawn } = require('child_process');

const RESTART_EXIT_CODE = 42;
const RESPAWN_DELAY_MS  = 2000;

let isRestart = false;
let stopped   = false;

function spawnBot() {
  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'src', 'index.js')],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        YANTO_RUNNER:    '1',
        YANTO_IS_RESTART: isRestart ? '1' : '0',
      },
    }
  );

  child.on('exit', (code, signal) => {
    if (stopped) return;
    if (code === RESTART_EXIT_CODE) {
      console.log(`[runner] child requested restart (signal=${signal}), respawn dalam ${RESPAWN_DELAY_MS}ms`);
      isRestart = true;
      setTimeout(spawnBot, RESPAWN_DELAY_MS);
      return;
    }
    console.log(`[runner] child exit code=${code} signal=${signal}, supervisor keluar.`);
    process.exit(code === null ? 1 : code);
  });

  ['SIGINT', 'SIGTERM'].forEach((sig) => {
    process.on(sig, () => {
      stopped = true;
      try { child.kill(sig); } catch (_) {}
      setTimeout(() => process.exit(0), 3000);
    });
  });
}

console.log('[runner] starting Yanto supervisor...');
spawnBot();
