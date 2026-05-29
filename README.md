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
