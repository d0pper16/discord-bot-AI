# Deploy Yanto ke DigitalOcean Droplet

Tutorial lengkap dari nol → bot aktif di VPS DigitalOcean.

---

## 1. Spesifikasi Droplet yang Dibutuhkan

### Minimum (untuk 1 Discord server kecil)

| Resource | Value | Catatan |
|----------|-------|---------|
| **Plan** | Basic Regular Intel | Cukup, tidak butuh AMD/GPU |
| **CPU** | 1 vCPU | Bot light, single-thread Node.js |
| **RAM** | **1 GB** | 512 MB juga jalan tapi tight (Roblox watcher + dashboard + SQLite + buffer log) |
| **Disk** | **25 GB SSD** | DB + logs + node_modules ~500MB. Sisa untuk OS update. |
| **Bandwidth** | 1 TB/bulan | Lebih dari cukup |
| **OS** | **Ubuntu 24.04 LTS** | Recommended (default DO image) |
| **Region** | **Singapore (SGP1)** | Latency terbaik untuk Indonesia |

### Recommended (production / multi-server)

| Resource | Value |
|----------|-------|
| Plan | Basic Premium Intel atau AMD |
| CPU | 2 vCPU |
| RAM | **2 GB** |
| Disk | 50 GB SSD |

**Estimasi biaya** (per Mei 2026):
- Minimum 1GB/1vCPU: **~$6/bulan**
- Recommended 2GB/2vCPU: ~$18/bulan

---

## 2. Bikin Droplet via DigitalOcean Console

### Langkah 1: Login DO

1. Buka https://cloud.digitalocean.com/
2. Login akun kamu

### Langkah 2: Create Droplet

1. Klik **Create** → **Droplets** (pojok kanan atas)
2. Isi form:

```
Choose Region        : Singapore (SGP1)
Choose Datacenter    : SGP1
Choose an image      : Ubuntu 24.04 (LTS)
Choose Size          : Basic
CPU options          : Regular - Intel
Plan                 : $6/mo (1GB RAM)
                       atau $18/mo (2GB)

Authentication       : SSH Key (recommended)
                       atau Password (kalau tidak punya SSH key)

Hostname             : yanto-bot
```

### Langkah 3: Setup SSH Key (Recommended)

Kalau pilih SSH Key, di laptop kamu (Windows pakai PowerShell, Mac/Linux pakai Terminal):

```bash
ssh-keygen -t ed25519 -C "yanto-vps"
# Tekan Enter 3x (default location, no passphrase)

# Copy public key:
cat ~/.ssh/id_ed25519.pub
```

Paste output `cat` ke field "SSH public key content" di DO Create Droplet form.

### Langkah 4: Klik Create Droplet

Tunggu ~30 detik. Droplet akan jadi dan kasih **IP Public** (mis. `139.59.123.45`).

---

## 3. Connect ke Droplet via Console

### Opsi A: Web Console DO (paling cepat, dari browser)

1. Di dashboard DO, klik droplet **yanto-bot**
2. Klik tombol **Console** di pojok kanan atas
3. Console terminal akan terbuka di browser, login otomatis sebagai `root`

### Opsi B: SSH dari Laptop (recommended untuk daily use)

```bash
ssh root@139.59.123.45
# Replace IP dengan IP droplet kamu
```

---

## 4. Setup Bot — Step by Step

Semua command di bawah dijalankan **di console droplet** (sebagai user `root`).

### 4.1 Update OS + Install Dependency

```bash
apt update && apt upgrade -y
apt install -y git curl ufw
```

### 4.2 Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version    # harus v20.x.x
npm --version     # harus v10.x.x
```

### 4.3 Bikin User Khusus (security best practice)

```bash
adduser yanto             # masukkan password (catet)
usermod -aG sudo yanto    # kasih sudo akses
su - yanto                # switch ke user yanto
```

Sekarang prompt akan jadi `yanto@yanto-bot:~$`.

### 4.4 Clone Repo dengan Sparse-Checkout (skip file gak perlu)

Default `git clone` ambil semua file termasuk `examples/`, `docs/`, `.github/workflows/`, dll. yang gak dibutuhkan di VPS production. Kita pakai **sparse-checkout** supaya cuma file yang dipakai runtime saja yang di-clone.

```bash
# 1. Clone tanpa checkout dulu
git clone --no-checkout https://github.com/d0pper16/discord-bot-AI.git
cd discord-bot-AI

# 2. Aktifkan sparse-checkout
git config core.sparseCheckout true

# 3. Daftar file/folder yang DIPERLUKAN runtime
cat > .git/info/sparse-checkout << 'EOF'
/runner.js
/package.json
/package-lock.json
/config.json
/.env.example
/.gitignore
/ecosystem.config.js
/src/
/scripts/
EOF

# 4. Checkout (hanya file yang di-list)
git checkout main
ls -la
```

Hasilnya, di VPS hanya ada:

```
discord-bot-AI/
├── runner.js
├── package.json
├── config.json
├── .env.example
├── .gitignore
├── ecosystem.config.js
├── src/                  (semua source code)
├── scripts/              (install-vps.sh, templates)
└── .git/
```

**TIDAK ada** di VPS:
- `docs/` — dokumentasi (cuma untuk dev di laptop)
- `examples/sample-map-data.json` — DB sample (di-import via dashboard kalau perlu)
- `.github/workflows/` — CI/CD (cuma untuk repo, gak butuh runtime)
- `README.md` — dokumentasi (sudah ada di GitHub)
- File lain yang gak essential

Hemat ~2-5 MB tergantung berapa banyak dokumentasi/asset yang ada.

### 4.5 Setup `.env`

```bash
cp .env.example .env
nano .env
```

Isi minimum:
```ini
DISCORD_TOKEN=token_bot_kamu_dari_discord_developer_portal
YANTO_CHANNEL_ID=1234567890123456789
GEMINI_API_KEY_1=AIzaSy_key_dari_aistudio.google.com
DASHBOARD_PORT=3000
DEV_USER=dev
DEV_PASS=ganti_password_yang_kuat
ADMIN_USER=admin
ADMIN_PASS=ganti_password_yang_kuat
```

`Ctrl+O` save → `Enter` → `Ctrl+X` exit.

### 4.6 Install Dependency Node

```bash
npm install
```

Tunggu ~1-2 menit. Output: `added XXX packages`.

### 4.7 Auto-setup PM2 + Firewall

```bash
sudo bash scripts/install-vps.sh
```

Output yang diharapkan:
```
[install] PM2 globally...
[ok] PM2 v5.4.x
[setup] pm2-logrotate (rotate logs harian, max 10MB x 14 file, gzip)...
[ok] pm2-logrotate configured
[ok] UFW: allow 3000/tcp (TCP inbound dashboard)
[ok] generated scripts/yanto.service
[ok] generated scripts/nginx-yanto.conf
```

### 4.8 Aktifkan UFW Firewall

```bash
sudo ufw allow OpenSSH       # SSH supaya gak ke-lock
sudo ufw allow 3000/tcp      # dashboard (atau port di .env kamu)
sudo ufw enable              # aktifkan firewall (ketik 'y' kalau ditanya)
sudo ufw status              # cek status
```

### 4.9 Start Bot dengan PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # output 1 baris yang harus di-run dengan sudo
```

Output `pm2 startup` akan kasih command seperti:
```
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u yanto --hp /home/yanto
```

Copy-paste & run baris itu. Tujuannya: bot auto-start saat VPS reboot.

### 4.10 Verifikasi Bot Aktif

```bash
pm2 status                   # cek status (online?)
pm2 logs yanto --lines 50    # liat 50 log terakhir
```

Output yang diharapkan di logs:
```
[INFO] Yanto online sebagai YourBot#1234
[INFO] [validation] Gemini OK via KEY_1
[INFO] [validation] Channel ... OK
[INFO] [startup] validasi OK -> bot active, mengirim ucapan hello.
[INFO] Dashboard ready at http://localhost:3000
```

Cek di Discord: bot harus online (lampu hijau) + kirim pesan `halo, kenalin aku yanto...` di channel target.

### 4.11 Akses Dashboard dari Browser

Buka di browser: `http://139.59.123.45:3000` (replace dengan IP droplet kamu).

Login: `dev` / password yang kamu set di `.env`.

### 4.12 (Opsional) Setup Domain + HTTPS

Kalau punya domain:

```bash
# Install nginx + certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Edit template nginx, ganti "dashboard.example.com" jadi domain kamu
nano scripts/nginx-yanto.conf

# Deploy nginx config
sudo cp scripts/nginx-yanto.conf /etc/nginx/sites-available/yanto
sudo ln -sf /etc/nginx/sites-available/yanto /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# Buka port 80 + 443
sudo ufw allow 'Nginx Full'

# Setup SSL gratis (auto-renew)
sudo certbot --nginx -d dashboard.yourdomain.com
# Ikuti prompt, pilih "Redirect HTTP to HTTPS"
```

Sekarang akses: `https://dashboard.yourdomain.com` — encrypted + tanpa port di URL.

---

## 5. Tutorial Operasi Daily

Semua command dijalankan di console droplet (web console DO atau SSH).

### 5.1 START Bot

Bot biasanya **auto-start** setelah VPS reboot karena `pm2 startup`. Manual start:

```bash
# Login as user yanto (kalau jalan dari root)
su - yanto
cd ~/discord-bot-AI

# Cek status dulu
pm2 status

# Kalau status "stopped" / "errored":
pm2 start yanto

# Kalau bot belum pernah ke-register di PM2:
pm2 start ecosystem.config.js
pm2 save
```

Verifikasi:
```bash
pm2 logs yanto --lines 20
# Harus ada: "Yanto online sebagai ..."
```

### 5.2 STOP Bot

#### Stop sementara (process berhenti, masih ke-track PM2)

```bash
pm2 stop yanto
pm2 status   # status: "stopped"
```

Bot benar-benar mati di Discord. Untuk menyalakan lagi cukup `pm2 start yanto`.

#### Stop + hapus dari PM2 (jarang dipakai)

```bash
pm2 delete yanto
pm2 save
```

Untuk menyalakan lagi harus `pm2 start ecosystem.config.js` dari scratch.

#### Stop dari Dashboard (recommended kalau bot lagi running)

1. Buka dashboard di browser
2. Header pojok kanan → klik **"Matikan Bot"**
3. Modal Yes/No → konfirmasi
4. Bot ucap pamit di Discord (`{Nama} capek, {nama} tidur dulu yaa, babay...`) → exit graceful

Setelah ini PM2 akan auto-restart dalam 10 detik (default behavior). Kalau mau benar-benar mati, kombinasikan:

```bash
# Klik "Matikan Bot" di dashboard, lalu segera:
pm2 stop yanto
```

### 5.3 RESTART Bot

#### Restart cepat (recommended)

```bash
pm2 restart yanto
```

Bot mati → spawn ulang dalam 1-2 detik. Tidak ada pesan pamit di Discord.

#### Reload zero-downtime

```bash
pm2 reload yanto
```

Sama seperti restart tapi proses lama tetap jalan sampai proses baru ready. Untuk Yanto (bukan cluster mode), efeknya sama dengan `restart`.

#### Restart dari Dashboard

1. Header dashboard → klik **"Restart Bot"**
2. Modal konfirmasi → user/pass dev
3. Bot tutup koneksi Discord (silent, no pamit) → exit code 42 → `runner.js` respawn → bot bangun → ucap `hoamm... enak banget yanto tidurnya...` di Discord

Total waktu: ~7-10 detik.

#### Restart full (kalau dependency baru di-install)

```bash
pm2 stop yanto
npm install      # update dependency
pm2 start yanto
```

### 5.4 STATUS / MONITOR

```bash
pm2 status                       # tabel ringkas (online/stopped/errored, RAM, CPU)
pm2 monit                        # interactive realtime monitor
pm2 logs yanto                   # tail logs live (Ctrl+C untuk exit)
pm2 logs yanto --lines 200       # 200 log terakhir
pm2 logs yanto --err --lines 50  # cuma error
pm2 describe yanto               # detail lengkap process
```

---

## 6. Replace / Update File

### Opsi A: Lewat Dashboard (recommended untuk file kecil)

Tab **File Manager** di dashboard:

1. Klik file yang mau diedit (mis. `src/bot.js`)
2. Editor akan terbuka, edit isinya
3. Klik **Simpan** → modal konfirmasi user/pass dev
4. File otomatis di-replace, atomic write (.tmp → rename)
5. Kalau yang di-replace `src/bot.js` atau `config.json`, bot auto-restart (~7 detik)

Untuk **upload file replacement**:

1. Tab **File Manager** → tombol **Upload File**
2. Pilih file lokal
3. Dashboard akan deteksi:
   - File sudah ada → modal "Update file existing? (Lev=0)"
   - Nama mirip (typo guard) → modal "Update X atau buat baru?"
   - Nama unik → modal "Tambah file baru?"
4. Pilih → konfirmasi user/pass → done

### Opsi B: Lewat Git Pull (recommended untuk update besar)

Kalau perubahan sudah di GitHub `feat/yanto-bot` atau `main`:

```bash
cd ~/discord-bot-AI
git pull origin main         # atau feat/yanto-bot

# Kalau dependency berubah (package.json edit):
npm install

# Restart
pm2 restart yanto
```

⚠ **Catatan**: kalau pakai sparse-checkout (langkah 4.4), `git pull` cuma akan update file yang ada di `.git/info/sparse-checkout`. File di luar list tetap di-skip (sesuai keinginan kita: hemat disk).

### Opsi C: Edit Langsung di VPS via nano/vim

```bash
cd ~/discord-bot-AI
nano src/bot.js              # atau vim, vi
# edit, save (Ctrl+O Enter, Ctrl+X)
pm2 restart yanto
```

⚠ **Hati-hati**: edit langsung di VPS tidak masuk Git. Kalau VPS hilang, perubahan hilang. Pakai opsi A atau B kalau perubahan permanen.

### Opsi D: Upload File via SCP (dari laptop)

```bash
# Di laptop kamu:
scp /path/local/bot.js yanto@139.59.123.45:~/discord-bot-AI/src/bot.js

# Atau upload folder:
scp -r /path/local/folder/ yanto@139.59.123.45:~/discord-bot-AI/

# Lalu ssh ke VPS dan restart:
ssh yanto@139.59.123.45
cd ~/discord-bot-AI
pm2 restart yanto
```

### Opsi E: Replace via curl/wget (fetch dari URL)

```bash
cd ~/discord-bot-AI
curl -o src/bot.js https://gist.githubusercontent.com/.../bot.js
pm2 restart yanto
```

---

## 7. Update Bot dari GitHub (rutin)

```bash
ssh yanto@139.59.123.45
cd ~/discord-bot-AI

# Pull update terbaru
git pull origin main

# Kalau ada perubahan dependency
npm install

# Apply
pm2 reload yanto      # zero-downtime
# atau
pm2 restart yanto
```

---

## 8. Troubleshooting

### Bot tidak online di Discord

```bash
pm2 logs yanto --err --lines 50
```

Cek error: token salah? channel ID salah? API key invalid?

### Dashboard tidak bisa diakses

```bash
sudo ufw status                            # port 3000 open?
ss -tlnp | grep 3000                       # ada proses listen di port 3000?
curl http://localhost:3000/api/me -u dev:devpass   # response?
```

### PM2 tidak auto-start setelah VPS reboot

```bash
pm2 startup           # baris yang muncul, copy-paste run dengan sudo
pm2 save              # simpan list process saat ini
```

### RAM penuh

```bash
free -h               # cek RAM usage
pm2 status            # cek RAM per process
pm2 reload yanto      # restart untuk clear leak (kalau ada)
```

Default `ecosystem.config.js` set `max_memory_restart: 512M` → PM2 auto-restart bot kalau RAM > 512MB.

### Port 3000 sudah dipakai

```bash
sudo lsof -i :3000             # liat proses yang pakai
nano .env                      # ganti DASHBOARD_PORT
sudo ufw allow $NEW_PORT/tcp   # buka port baru
sudo ufw delete allow 3000/tcp # tutup port lama
pm2 restart yanto
```

---

## 9. Backup DB Berkala

Database SQLite (`data/bot.db`) berisi map data + chat log + custom memory.

### Backup manual

```bash
cd ~/discord-bot-AI
cp data/bot.db backup-$(date +%Y%m%d-%H%M%S).db
```

### Backup otomatis (cron daily)

```bash
crontab -e
# Tambahkan baris (jam 02:00 backup, jam 03:00 hapus >30 hari):
0 2 * * * cp /home/yanto/discord-bot-AI/data/bot.db /home/yanto/backups/bot-$(date +\%Y\%m\%d).db
0 3 * * 0 find /home/yanto/backups -name 'bot-*.db' -mtime +30 -delete
```

```bash
mkdir -p ~/backups
```

### Backup via Dashboard

Tab **Backup DB** → tombol **Download backup .json** → file akan ter-download ke laptop kamu (JSON, bisa di-restore via tab yang sama mode "import").

---

## Quick Reference Cheatsheet

| Aksi | Command |
|------|---------|
| Start | `pm2 start yanto` |
| Stop | `pm2 stop yanto` |
| Restart | `pm2 restart yanto` |
| Status | `pm2 status` |
| Logs (live) | `pm2 logs yanto` |
| Logs (last 200) | `pm2 logs yanto --lines 200` |
| Errors only | `pm2 logs yanto --err` |
| Update from Git | `cd ~/discord-bot-AI && git pull && npm install && pm2 reload yanto` |
| Edit env | `nano ~/discord-bot-AI/.env && pm2 restart yanto` |
| Backup DB | `cp ~/discord-bot-AI/data/bot.db ~/backups/$(date +%F).db` |
| Cek RAM bot | `pm2 status` (kolom mem) |
| Cek port | `sudo lsof -i :3000` |
| Reboot VPS (graceful) | `sudo reboot` (PM2 auto-start setelah boot) |

---

## Time Estimate

Total dari nol → bot aktif: **~15-20 menit** untuk pengguna pemula.

| Step | Estimate |
|------|----------|
| 1-2 (setup DO + Droplet) | 3-5 menit |
| 3 (connect SSH) | 1 menit |
| 4.1-4.2 (apt + Node) | 3-4 menit |
| 4.3 (user) | 1 menit |
| 4.4-4.5 (clone + .env) | 2 menit |
| 4.6 (npm install) | 1-2 menit |
| 4.7-4.9 (PM2 start) | 1 menit |
| 4.10-4.11 (verify) | 1 menit |
