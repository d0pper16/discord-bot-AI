/**
 * PM2 ecosystem config.
 * Auto-detected oleh PM2 saat:
 *   pm2 start ecosystem.config.js
 *
 * Auto-restart, max-restart limit, log rotate, .env file pickup -- semua otomatis.
 */
module.exports = {
  apps: [
    {
      name:         'yanto',
      script:       'runner.js',
      instances:    1,
      exec_mode:    'fork',
      autorestart:  true,
      watch:        false,                  // kita pakai dashboard hot-reload, bukan PM2 watch
      max_restarts: 15,
      min_uptime:   '30s',
      max_memory_restart: '512M',
      env_file:     '.env',
      out_file:     'data/logs/yanto-out.log',
      error_file:   'data/logs/yanto-err.log',
      merge_logs:   true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      kill_timeout: 8000,                   // beri waktu graceful shutdown (5dtk pamit + buffer)
    },
  ],
};
