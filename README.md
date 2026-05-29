# Yanto - Discord Bot AI (Gemini + SQLite + Dashboard)

Bot Discord dengan kepribadian sendiri (default "Yanto", bisa di-rename),
sumber jawaban dari database map Roblox (SQLite), 2 API key Gemini
(utama + fallback), cache jawaban, rate-limit dance + spam timeout,
auto-translate jawaban AI, audit log, theme toggle, system monitor,
server logs live, dan dashboard web realtime.

## Fitur Inti

- **Persona dinamis & 1-identitas-tunggal**: rename otomatis menyebar ke keyword + sapaan + prompt + cache.
- **Trigger** case-insensitive (DANDI/dandi/Dandi).
- **Sumber kebenaran**: tabel `map_data` di SQLite.
- **2 API Gemini**: PRIMARY prioritas, SECONDARY fallback, reserve token untuk deferred.
- **Cache** dengan exact + Jaccard similarity, replace pada follow-up "lebih detail".
- **Rate-limit dance**: sabar -> warn -> Discord-timeout 5 menit.
- **Validasi cold-start**: 5dtk delay -> validate Gemini + Channel -> "halo, kenalin..." atau bot SLEEPING.
- **Login Discord retry** 3x kalau token salah/error/kosong, lalu exit.
- **Auto-translate jawaban AI** (id/en/pt). Boilerplate (hello/back/farewell/sabar/warn/timeout/empty/errorApi/apiFail) **selalu Indonesia**.
- **Restart silent** (no farewell): bot diam total ~3 detik -> respawn -> "hoamm...".
- **Shutdown total** (tombol di dashboard): bot ucap pamit -> mati.
- **Dashboard 11 tab** dengan 2 role (dev/admin).
- **System Monitor** realtime: RAM, CPU, Disk (debounce 1%), bot process.
- **Server Logs live** (polling 1.5s, buffer 1000 baris, filter level + substring).
- **Connection editor**: ubah Channel ID + 2 API key tanpa edit .env.
- **Audit Log**: setiap aksi tulis tercatat.
- **Theme toggle**: dark/light, persist di localStorage.
- **DB Backup**: export/import map_data + chat_history.
- **File Manager**: edit/tambah/hapus file project, atomic write, typo guard.
- **Auto-restart** saat upload bot.js / save bot.js via File Manager.

## Struktur

```
discord-bot-AI/
├── runner.js               supervisor: respawn pada exit code 42
├── package.json
├── config.json             tuning runtime (di-edit lewat dashboard)
├── .env.example
├── data/
│   ├── bot.db              SQLite (map_data, chat_history, api_usage, audit_log)
│   └── runtime.json        override channel + API keys (dari dashboard)
└── src/
    ├── index.js            entry: load runtime override -> dashboard -> bot
    ├── bot.js              Discord handler: login retry, validation, rate-limit
    ├── ai/
    │   ├── gemini.js       2 API rotation + reserve + lastUsedKey
    │   ├── personality.js  persona (parameterized name + lang)
    │   └── lang.js         language detection (id/en/pt) untuk prompt AI
    ├── db/
    │   ├── database.js     init SQLite (4 tabel)
    │   ├── mapData.js      CRUD map
    │   ├── chatHistory.js  cache + Jaccard
    │   └── audit.js        audit log
    ├── dashboard/
    │   ├── server.js       REST API
    │   └── public/         UI (11 tab)
    └── utils/
        ├── hotReload.js
        ├── logger.js       console intercept + buffer + subscribers
        └── runtimeEnv.js   load/save data/runtime.json
```

## Setup (one-time, mesin baru)

```bash
cd discord-bot-AI
cp .env.example .env
# .env wajib: DISCORD_TOKEN. YANTO_CHANNEL_ID + GEMINI_API_KEY_*
# bisa diisi di sini atau diatur dari dashboard tab "Connection".
npm install
npm start
```

Dashboard: `http://localhost:3000`. Login dev / devtbiapril2026 atau admin / admintbi2025.

## Validasi & State Machine Bot

```
[index.js mulai]
   |
   v
[runtime.load()]  <- merge data/runtime.json ke process.env
   |
   v
[dashboard.start]
   |
   v
[bot.loginWithRetry(3x)] <- token Discord salah/error/kosong -> exit setelah 3x gagal
   |  ok
   v
[ClientReady]
   |  cold start (5s delay)
   v
[validate Gemini] -> retry 1x
[validate Channel ID]
   |
   +-- BOTH ok    -> SLEEPING=false, kirim "halo, kenalin..."
   +-- SALAH 1+   -> log ke console, SLEEPING=true (HIDUP TAPI TIDUR)
                    Bot tidak respon apa-apa sampai diperbaiki via dashboard.
```

Saat user fix via tab "Connection":
1. Server validasi nilai baru (test Gemini key + fetch channel).
2. Kalau valid: persist ke `data/runtime.json` + apply ke `process.env`.
3. Re-validate keseluruhan -> kalau both OK -> SLEEPING=false + kirim "halo, kenalin..." (BUKAN back/farewell).

## Auto-translate

- Hanya untuk **jawaban AI** (Gemini diberi prompt instruction).
- Boilerplate (sabar/warn/timeout/empty/errorApi/hello/back/farewell/apiFail) **selalu Indonesia**.
- Auto: deteksi bahasa user via stopwords, threshold 70% (Indonesian benefit-of-the-doubt).

## Permission Discord

Bot pakai permission `Administrator` -> sudah cukup (Administrator supersede semua permission). Pastikan role bot lebih tinggi dari role user yang akan di-timeout.

## Login Dashboard

| Role | User | Pass | Akses |
|------|------|------|-------|
| dev   | `dev`   | `devtbiapril2026` | Full edit/upload/restart/shutdown |
| admin | `admin` | `admintbi2025`    | Read-only (tombol disabled, banner none) |

Semua aksi tulis butuh re-konfirmasi user/pass dev (modal).

## Config Bot Fields

| Field | Min | Max | Default | Catatan |
|---|---|---|---|---|
| Nama Bot | 2 | 20 | Yanto | Identitas tunggal. |
| RPM Limit | 5 | 14 | 14 | request/menit per key. |
| **RPD Limit** | - | - | **995 (locked)** | Tidak bisa diubah dari dashboard. |
| Cooldown switch API | 10dtk | 300dtk | 30dtk | UI: detik. File: ms. |
| Reserve token | 0 | 3 | 1 | Untuk balasan deferred. |
| Threshold cache | 0.5 | 1.0 | 0.82 | Jaccard. |
| Memori pesan | 0 | 30 | 10 | Q/A terakhir kirim ke AI. |
| Pemicu detail | - | 50 | preset | 1 frasa/baris. |

## System Monitor

Poll 2s. Disk: hanya update DOM kalau perubahan >= 1% dari kapasitas total (req. user).
- RAM (system) + RAM (process)
- CPU process %
- Disk %
- Gemini API usage 2 key + indikator key aktif



## Auto-sync ke main (GitHub Actions)

Repo ini punya 3 workflow di `.github/workflows/`:

### 1. `auto-sync-main.yml`
- Trigger: setiap push ke `feat/yanto-bot`.
- Aksi: fast-forward `main` ke HEAD `feat/yanto-bot` lalu push `main` otomatis.
- Hanya jalan kalau `main` adalah ancestor dari `feat/yanto-bot` (linear history).
- Skip kalau pesan commit mengandung `[skip sync]`.

### 2. `ci.yml`
- Trigger: setiap push ke `feat/yanto-bot` / `main`, dan setiap PR ke `main`.
- Aksi: `node --check` semua `.js`, validasi JSON, verifikasi file core, verifikasi dependency.

### 3. `auto-pr.yml`
- Trigger: push ke `feat/yanto-bot` dengan pesan commit mengandung `[skip sync]`.
- Aksi: bikin PR otomatis ke `main` (kalau belum ada).

### Workflow ke depan

```
1. Edit kode (lokal / dashboard / git)
2. Commit + push ke feat/yanto-bot
3. GitHub Actions otomatis:
   a. CI run (syntax check)
   b. Auto-fast-forward main -> production langsung up-to-date
4. Selesai.
```

### Setup Permission Actions (sekali aja)

**Settings -> Actions -> General -> Workflow permissions**:
- Pilih "Read and write permissions"
- Centang "Allow GitHub Actions to create and approve pull requests"

Tanpa setting ini, workflow gagal push ke main (403 forbidden).



## Bahasa Jawaban (Multilingual)

Gemini natively multilingual - **TIDAK** ada deteksi bahasa di Node side.
Kalau user tanya pakai bahasa Indonesia, English, Portugis, atau bahasa
lain, Gemini paham & jawab natural di bahasa yang sama. Persona
mengandung instruksi soft *"ikuti bahasa user"* untuk memastikan.

Boilerplate (`hello`, `back`, `farewell`, `sabar`, `warn`, `timeout`,
`empty`, `errorApi`, `apiFail`) selalu Indonesia karena itu pesan sistem
khas komunitas (bukan jawaban AI).

## Contoh Database Map Roblox

Lihat `examples/sample-map-data.json` untuk contoh DB lengkap (15 entri,
fictional map "Petualangan Pulau Yantoland"). Kategori entri yang
disarankan untuk fundamental bot:

1. **Tentang Map** - overview umum (mode, tema, max player, durasi)
2. **Per-Zona** - 1 entry per zona/area (mob, NPC, drop, akses)
3. **Sistem Crafting** - resep, tier equipment
4. **Currency & Trading** - cara dapat koin, trade rules
5. **Sistem Level & Stats** - level cap, stat distribution, prestige
6. **PvP Zone & Aturan** - lokasi PvP, ban rules
7. **Easter Eggs & Rahasia** - hidden content
8. **Update Changelog** - perubahan terbaru
9. **Bug Report & Support** - cara lapor, kontak admin
10. **FAQ** - pertanyaan umum
11. **Tips & Strategi** - panduan player baru

Cara import: Dashboard -> tab **Backup DB** -> Import -> upload JSON ->
mode `replace` (kalau DB kosong) atau `merge` (kalau mau tambah).



## Scope Guard & Anti-Exploit (2-Layer Defense)

### Layer 1: Pre-filter regex di Node (bot.js)

`looksLikeExploitQuery()` pakai 24 regex pattern untuk hard-block sebelum
panggil Gemini (hemat token + jawaban instan). Pattern conservatif - sinyal
kuat saja:

- **Tools**: synapse, krnl, fluxus, jjsploit, hydrogen, delta executor, dst.
- **Cheat moves**: aimbot, wallhack, noclip, godmode, speed/fly hack, kill aura
- **Dupe**: any "dupe" reference dalam konteks Roblox
- **Ask + verb**: "cara/gimana/how to" + "cheat/exploit/hack/bypass/inject/dupe"
- **Bug abuse**: "bug abuse", "abuse glitch"
- **Bypass anti-cheat**: "bypass byfron", "bypass HWID", "ban evasion"
- **Inject script**: "inject script/dll/trainer"
- **Indonesian slang**: "ngecheat", "ngehack", "curangin"

False-positive guards: "ada cheater" (reporting), "fix bug" (legitimate),
"akun ke-hack" (victim) → tetap pass through ke Gemini.

### Layer 2: Prompt persona (personality.js)

Persona berisi rules eksplisit:

- **CAKUPAN**: hanya jawab Roblox umum + map yang ada di DATA MAP.
  Map lain (Adopt Me, Brookhaven, dll. yang ga di-list) → tolak.
  Topik non-Roblox (politik, agama, finansial, dll.) → tolak.
- **ANTI-EXPLOIT**: tolak tegas, sebut Roblox ToS + UU ITE Pasal 30/32/33,
  jangan kasih workaround.

### Layer 3: Empty DB handling

Kalau `mapData.listMaps().length === 0`, prompt diberi flag `dbEmpty=true`.
Gemini diinstruksikan untuk:
- Pertanyaan map spesifik → "wah database map masih kosong, admin belum input data"
- Pertanyaan Roblox umum → tetap dijawab seperti biasa

### Refusal Message

Bilingual (Indonesia + English):

> "wah maaf, yanto gak bantu soal cheat/exploit/bug abuse. Itu ngelanggar
> **Roblox Terms of Service** dan bisa kena **UU ITE Pasal 30, 32, dan 33**
> (akses ilegal & manipulasi sistem elektronik di Indonesia). Mainnya yang
> fair yaa, biar map-nya tetap aman buat semua player.
>
> (EN) sorry bro, no help with cheats/exploits/bug abuse. It violates
> Roblox ToS and Indonesian ITE Law (Articles 30/32/33) about unauthorized
> system access and data manipulation. Play fair."

### Audit Log

Setiap exploit attempt dicatat di tabel `audit_log`:
- `user`: `discord:<userId>`
- `action`: `exploit.refused`
- `target`: `channel:<channelId>`
- `details`: pertanyaan user (truncated 300 char)

Bisa dilihat di tab **Audit Log** dashboard, filter `exploit` di search bar.

### Edge Cases yang Ditangani

| Pesan user | Hasil |
|------------|-------|
| "yanto, gimana cara cheat?" | BLOCK (refusal + audit) |
| "yanto, mau pake synapse" | BLOCK |
| "yanto, ada cheater di server" | PASS - empati, arahkan lapor admin |
| "yanto, akun gua ke-hack" | PASS - bantu recovery (general Roblox) |
| "yanto, gimana cara fix bug?" | PASS - dev question, OK |
| "yanto, Adopt Me itu apa?" | Pass ke Gemini → tolak (map lain, scope rule) |
| "yanto, siapa Presiden Indonesia?" | Pass ke Gemini → tolak (non-Roblox) |
| "yanto, NPC di Pantai Spawn?" | Pass ke Gemini → jawab dari DATA MAP |
| (DB kosong) "yanto, level cap?" | Pass ke Gemini → "DB masih kosong" |
| (DB kosong) "yanto, Roblox itu apa?" | Pass ke Gemini → jawab Roblox umum |



## Persona Overlay (Additive, Editable by Admin & Dev)

Dashboard tab **Gaya Bicara** memungkinkan tambahan gaya bicara yang
ADDITIVE ke BASE PERSONA di script. **Tidak mengubah** base persona di
`personality.js`.

- Field overlay: max 500 char, disimpan di `config.json:personaOverlay`.
- Kalau dihapus -> bot kembali ke BASE PERSONA.
- Aturan inti BASE (anti-exploit, scope, refusal rules) **TIDAK BISA**
  dioverride oleh overlay (di-enforce via instruction explicit di prompt).
- Marker section (`===`, `---`, `` ``` ``) di-strip otomatis untuk cegah
  prompt injection.
- **Admin & dev keduanya** bisa edit (endpoint pakai `requireConfirmAny`
  yang accept dev OR admin creds).

Contoh overlay yang valid:
```
pakai sapaan "halo gaes" di awal jawaban, selipin emoji api di tengah,
akhiri dengan tagline "-salam ngeroblox-"
```

## Roblox Watcher

Tab **Roblox Watcher** memantau map Roblox kamu lewat Universe ID public.

- **Player count**: update tiap **1 menit** (realtime)
- **Total visits**: update tiap **1 jam**
- **Favorited count**: update tiap 1 menit (bonus dari API)
- API yang dipakai: `https://games.roblox.com/v1/games?universeIds=<id>`
  (public, tidak butuh auth Roblox)

Universe ID disimpan di `config.json:roblox.universeId`. Selama field
kosong, watcher OFF (semua interval berhenti). Saat di-set, watcher
otomatis start. Saat diganti via dashboard, watcher restart.

Display di tab Roblox Watcher:
- Map name + universe ID
- Players online (live, last update)
- Total visits (last 1-hour update)
- Favorited count
- Error indicator kalau API gagal (rate limit, network, dst.)

Watcher otomatis di-start juga setelah cold-start sukses dan setelah
restart bot (selama universe ID terisi di config).



## Format `.env` WAJIB (untuk deploy)

File `.env` ini WAJIB ada sebelum `npm start`. Copy dari `.env.example`:

```bash
cp .env.example .env
nano .env
```

Field wajib:

```ini
# DISCORD
DISCORD_TOKEN=<token bot dari Discord Developer Portal>
YANTO_CHANNEL_ID=<snowflake channel ID>

# GEMINI (min 1 wajib, max 5 opsional fallback)
GEMINI_API_KEY_1=<api key utama dari aistudio.google.com>
GEMINI_API_KEY_2=<opsional>
GEMINI_API_KEY_3=<opsional>
GEMINI_API_KEY_4=<opsional>
GEMINI_API_KEY_5=<opsional>
GEMINI_MODEL=gemini-1.5-flash

# DASHBOARD
DASHBOARD_PORT=3000

# DEV (full administrator)
DEV_USER=dev
DEV_PASS=devtbiapril2026

# ADMIN (read-only + edit gaya bicara overlay)
ADMIN_USER=admin
ADMIN_PASS=admintbi2025
```

Setelah deploy:
- Channel ID + 5 API keys juga bisa diubah via tab **Connection** di dashboard.
- Disimpan di `data/runtime.json` (override .env, tetap aktif lintas restart).

## Custom Memory (Ingatan Buatan)

Tab **Ingatan Buatan** di dashboard. Bot pakai DULU sebelum ke cache/Gemini.
Format placeholder yang didukung di kolom **jawaban**:

| Format | Render |
|--------|--------|
| `{nama}` | nama bot dari config (auto, sesuai rename) |
| `{bot}` | alias `{nama}` |
| `<@123456789012345678>` | tag user spesifik (Discord User ID) |
| `<@&987654321098765432>` | tag role spesifik (Discord Role ID) |

Cara dapat User/Role ID Discord:
1. Activate Developer Mode: Settings → Advanced → Developer Mode
2. Right-click user/role → Copy ID

Contoh entry:
```
Q: {nama} siapa pembuatmu?
A: pembuatku adalah <@123456789012345678>, salah satu admin di server ini.

Q: {nama} siapa admin di sini?
A: admin server ini ada <@&987654321> -- mereka yang ngurusin semua hal.
```

Bot auto-detect via Jaccard similarity ≥ 0.85 (lebih ketat dari cache supaya
match jelas saja).

## 5 API Keys + Auto-Refresh

- Slot: `GEMINI_API_KEY_1` ... `GEMINI_API_KEY_5` di `.env` atau dashboard.
- API ke-1 selalu prioritas utama. Switch otomatis ke ke-2 saat rate-limit, dst.
- **Auto-validate setiap 1 menit** (round-robin, 1 key per cycle).
  Dengan 5 keys = tiap key divalidasi setiap ~5 menit.
- Per-key state: ok / cooldown / banned / recent-error / validated.
- Indikator "API ke-N" aktif di System Monitor & header status.
- Total budget RPM/RPD = sum dari semua key yang ter-konfigurasi.

## Logger 1 (Server) - 3-Hour TTL

- In-memory FIFO max 5000 entries (~2-3 MB RAM).
- Sweep tiap 5 menit: hapus entries non-error yang umurnya > 3 jam.
- **Errors NEVER evicted by sweep** -- hanya hilang saat server restart.
- Pas restart auto-clear semua (memory wiped).

## Cache Auto-Cleanup 30 Hari

- `chat_history` (cache jawaban AI) di-cleanup harian.
- Entry yang `updated_at < (now - 30 days)` -> auto-deleted.
- Mencegah cache "ingat" event/data lama yang sudah tidak relevan.
- Cleanup pertama jalan saat cold-start, lalu interval 24 jam.

## Forced Map Dance (Anti-Spam Map Question)

Saat user nanya map yg ga ada di DB:
1. **1×**: bot respon "maaf, map itu belum ada di catatan {nama}..."
2. **2×** (similar question, same user, < 30 menit): "udah {nama} bilang map itu gak ada, jangan dipaksa terus..."
3. **3×**: "udah berkali-kali GAK ADA, kamu maksa terus, kalo gini {nama} mending diem..."
4. **4×+**: silent treatment (tidak respon sama sekali untuk pertanyaan ini)

Counter reset setelah 30 menit idle atau saat user tanya map yang ada di DB.



## VPS Deploy (Auto-setup)

Project ini dilengkapi script setup VPS supaya proses deploy minim manual:

### Quick Start

```bash
# 1. Clone & setup .env
git clone https://github.com/d0pper16/discord-bot-AI.git
cd discord-bot-AI
cp .env.example .env
nano .env                       # isi DISCORD_TOKEN, GEMINI_API_KEY_1, dll.

# 2. Install deps
npm install

# 3. Auto-setup VPS (jalankan SEKALI)
sudo bash scripts/install-vps.sh

# 4. Pilih: PM2 (rekomendasi)
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # follow instruksi yang muncul
```

### Yang Otomatis vs Manual

| Item | Auto? | Catatan |
|------|-------|---------|
| **PM2 ecosystem** | ✅ FULL AUTO | `pm2 start ecosystem.config.js` -- file sudah di repo |
| **PM2 install** | ✅ Auto via script | `sudo bash scripts/install-vps.sh` install PM2 globally |
| **PM2 log rotate** | ✅ Auto via script | pm2-logrotate (10MB × 14 file, gzip, harian) |
| **Auto-restart on crash** | ✅ Built-in PM2 | max 15 restart, min uptime 30s, max RAM 512MB |
| **UFW firewall (a)** | ⚠ Semi-auto | otomatis kalau script jalankan dengan `sudo` |
| **systemd service (c)** | ⚠ Template only | script generate file, copy manual ke `/etc/systemd/system/` |
| **nginx reverse proxy (b)** | ⚠ Template only | script generate file, edit domain + copy manual |
| **SSL/HTTPS (certbot)** | ❌ Manual | `sudo certbot --nginx -d domain.com` |

### File yang Di-generate

```
ecosystem.config.js               (sudah di repo, PM2 auto-detect)
scripts/install-vps.sh            (one-time setup)
scripts/yanto.service.template    (systemd template)
scripts/nginx-yanto.conf.template (nginx template)

Setelah jalankan install-vps.sh:
scripts/yanto.service             (generated, USER/PATH/NODE auto-fill)
scripts/nginx-yanto.conf          (generated, port auto-fill dari .env)
```

### Pilih PM2 atau systemd?

**PM2** lebih cocok kalau:
- Mau cepat (1 command jalan)
- Mau log rotate built-in
- Mau monitor via `pm2 status` / `pm2 logs`

**systemd** lebih cocok kalau:
- Server pakai banyak service systemd (uniformity)
- Mau auto-start lebih reliable lewat journald
- Mau hardening lebih ketat (PrivateTmp, ProtectSystem, dst.)

Dua-duanya valid. PM2 lebih simple untuk hobby/single-app deploy. systemd lebih native untuk production multi-service.

### Update Bot di VPS

```bash
cd discord-bot-AI
git pull origin main         # atau feat/yanto-bot
npm install                   # kalau dependency berubah
pm2 reload yanto             # zero-downtime reload (atau pm2 restart yanto)
```

### Lihat Logs

```bash
pm2 logs yanto              # live tail
pm2 logs yanto --lines 500  # last 500 lines
pm2 monit                    # interactive monitor

# atau langsung baca file (kalau pakai PM2):
tail -f data/logs/yanto-out.log
tail -f data/logs/yanto-err.log
```
