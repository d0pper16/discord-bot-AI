#!/usr/bin/env bash
# =============================================================================
#  Yanto VPS one-time installer.
#
#  Usage:
#    bash scripts/install-vps.sh          # tanpa sudo: PM2 + log rotate setup
#    sudo bash scripts/install-vps.sh     # dengan sudo: tambah firewall UFW
#
#  Apa yang dilakukan:
#    1. Install PM2 globally (kalau belum ada)
#    2. Install pm2-logrotate (rotate logs harian, max 10MB x 14 file, gzip)
#    3. Buka port DASHBOARD_PORT di UFW (kalau jalan dengan sudo + UFW ada)
#    4. Generate scripts/yanto.service (template systemd, ganti USER/PATH/NODE)
#    5. Generate scripts/nginx-yanto.conf (ganti port dari .env)
#
#  Yang TIDAK dilakukan otomatis (perlu sudo manual sesuai pilihan kamu):
#    - cp file ke /etc/systemd/system/
#    - cp file ke /etc/nginx/sites-available/
#    - certbot SSL setup
# =============================================================================

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Baca DASHBOARD_PORT dari .env, default 3000
PORT="3000"
if [ -f "$ROOT/.env" ]; then
  P=$(grep -E '^DASHBOARD_PORT=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -d '\r"' | xargs || true)
  if [ -n "$P" ]; then PORT="$P"; fi
fi

echo "==============================================="
echo "  Yanto VPS Setup"
echo "==============================================="
echo "  Project root : $ROOT"
echo "  Dashboard port: $PORT  (dari .env)"
echo "==============================================="

# --- 1. PM2 ---
if ! command -v pm2 >/dev/null 2>&1; then
  echo "[install] PM2 globally..."
  npm install -g pm2
  echo "[ok] PM2 v$(pm2 -v)"
else
  echo "[ok] PM2 sudah ter-install: v$(pm2 -v)"
fi

# --- 2. pm2-logrotate ---
echo "[setup] pm2-logrotate (rotate logs harian, max 10MB x 14 file, gzip)..."
pm2 install pm2-logrotate >/dev/null 2>&1 || true
pm2 set pm2-logrotate:max_size 10M    >/dev/null
pm2 set pm2-logrotate:retain 14       >/dev/null
pm2 set pm2-logrotate:compress true   >/dev/null
pm2 set pm2-logrotate:rotateInterval '0 0 * * *' >/dev/null   # midnight daily
echo "[ok] pm2-logrotate configured"

# --- 3. UFW (perlu sudo) ---
if command -v ufw >/dev/null 2>&1; then
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    ufw allow "$PORT/tcp" comment 'yanto-dashboard' >/dev/null 2>&1 || true
    echo "[ok] UFW: allow $PORT/tcp (TCP inbound dashboard)"
  else
    echo "[skip] UFW: jalankan dengan sudo untuk auto-allow port $PORT"
    echo "       atau manual:  sudo ufw allow $PORT/tcp"
  fi
else
  echo "[skip] UFW tidak ter-install di sistem ini"
fi

# --- 4. Generate systemd service ---
USR="${SUDO_USER:-$(whoami)}"
NODE_BIN="$(command -v node || echo /usr/bin/node)"
if [ -f "$ROOT/scripts/yanto.service.template" ]; then
  sed -e "s|__USER__|$USR|g" \
      -e "s|__PATH__|$ROOT|g" \
      -e "s|__NODE__|$NODE_BIN|g" \
      "$ROOT/scripts/yanto.service.template" > "$ROOT/scripts/yanto.service"
  echo "[ok] generated scripts/yanto.service (User=$USR, Node=$NODE_BIN)"
fi

# --- 5. Generate nginx config ---
if [ -f "$ROOT/scripts/nginx-yanto.conf.template" ]; then
  sed -e "s|__PORT__|$PORT|g" \
      "$ROOT/scripts/nginx-yanto.conf.template" > "$ROOT/scripts/nginx-yanto.conf"
  echo "[ok] generated scripts/nginx-yanto.conf (port=$PORT, edit server_name ke domain kamu)"
fi

# --- ringkasan ---
cat <<EOF

===============================================
  Setup base SELESAI.
===============================================

NEXT STEPS - Pilih salah satu (PM2 atau systemd):

[OPSI A] PM2  (recommended - simple, auto-restart, log rotate built-in)
  cd $ROOT
  pm2 start ecosystem.config.js
  pm2 save
  pm2 startup        # jalankan baris yang ditampilkan (perlu sudo)
  pm2 logs yanto     # lihat logs live
  pm2 status         # lihat status

[OPSI B] systemd  (alternatif - native Linux service)
  sudo cp $ROOT/scripts/yanto.service /etc/systemd/system/yanto.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now yanto
  sudo systemctl status yanto
  journalctl -u yanto -f              # lihat logs live

(Opsional) NGINX REVERSE PROXY + SSL gratis:
  1. Edit domain di scripts/nginx-yanto.conf (cari "server_name")
  2. sudo cp $ROOT/scripts/nginx-yanto.conf /etc/nginx/sites-available/yanto
  3. sudo ln -sf /etc/nginx/sites-available/yanto /etc/nginx/sites-enabled/
  4. sudo nginx -t && sudo systemctl reload nginx
  5. sudo certbot --nginx -d dashboard.yourdomain.com

Dashboard akses: http://YOUR_VPS_IP:$PORT
                 (atau https://your-domain.com kalau pakai nginx + SSL)
===============================================
EOF
