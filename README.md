# Yanto — Discord Bot AI (Gemini + SQLite + Dashboard)

Bot Discord "Yanto" dengan kepribadian sendiri, sumber jawaban dari database
map Roblox (SQLite), 2 API key Gemini (utama + fallback), cache riwayat chat,
dan dashboard web untuk edit semuanya secara realtime.

## Fitur

- **Kepribadian**: persona "Yanto" santai, ramah, kocak, jawab pakai DATA MAP saja.
- **Trigger**: hanya merespon pesan yang mengandung kata `yanto` (case-insensitive)
  pada channel Discord dengan ID yang ditentukan di `.env`.
- **Sumber kebenaran**: tabel `map_data` di SQLite. Bot dilarang ngarang —
  hanya jawab berdasar isi DB.
- **2 API Gemini bergiliran**:
  - `GEMINI_API_KEY_PRIMARY` selalu jadi prioritas.
  - `GEMINI_API_KEY_SECONDARY` otomatis dipakai bila primary kena
    rate-limit per-menit / per-hari atau cooldown.
- **Cache jawaban**:
  - Pertanyaan baru -> jawab via Gemini, disimpan di `chat_history`.
  - Pertanyaan mirip / sama -> jawab dari cache, **tanpa** request Gemini.
  - User minta lebih detail (`"lebih detail"`, `"lebih spesifik"`, dll.) ->
    bot regenerate via Gemini lalu **replace** entry cache lama.
- **Dashboard realtime** (Express, port 3000):
  - Edit `personality.js` (kepribadian Yanto) -> hot-reload tanpa restart.
  - Edit `config.json` (kata kunci, threshold, limit API) -> hot-reload.
  - CRUD database map Roblox (topic, content, tags).
  - Lihat / hapus riwayat chat (cache).
  - Upload file `.js` / `.json` untuk replace script.
- **Hot-reload**: pakai `chokidar` + `require.cache` purge -> tidak ganggu
  koneksi Discord, tidak ganggu cache chat, tidak ganggu DB.

## Struktur

```
discord-bot-AI/
├── package.json
├── config.json
├── .env.example
├── data/
│   └── bot.db                # auto-create
└── src/
    ├── index.js              # entry
    ├── bot.js                # Discord handler
    ├── ai/
    │   ├── gemini.js         # rotasi 2 API + tracking limit
    │   └── personality.js    # persona Yanto (HOT-RELOAD)
    ├── db/
    │   ├── database.js       # init SQLite
    │   ├── mapData.js        # CRUD map Roblox
    │   └── chatHistory.js    # cache riwayat chat
    ├── dashboard/
    │   ├── server.js         # REST API + static
    │   └── public/           # HTML/CSS/JS dashboard
    └── utils/
        ├── hotReload.js
        └── logger.js
```

## Setup

```bash
cd discord-bot-AI
cp .env.example .env
# edit .env -> isi DISCORD_TOKEN, YANTO_CHANNEL_ID,
# GEMINI_API_KEY_PRIMARY, GEMINI_API_KEY_SECONDARY
npm install
npm start
```

Dashboard: `http://localhost:3000` (basic-auth: `DASHBOARD_USER` / `DASHBOARD_PASS`).

## Login Dashboard (2 Role)

| Role | Username | Password | Hak Akses |
|------|----------|----------|-----------|
| **dev** | `dev` | `devtbiapril2026` | Full: edit, upload, hapus, ubah cache, ubah DB map |
| **admin** | `admin` | `admintbi2025` | **Read-only**: hanya pantau (status API, lihat DB, lihat cache) |

Akun `admin` tidak bisa menambah/mengubah/menghapus apa pun — semua tombol tulis akan disabled.

### Konfirmasi Ulang

Setiap aksi tulis (simpan personality, simpan config, upload file, tambah/edit/hapus map, edit/hapus entry cache, hapus seluruh cache) akan memunculkan **modal "Yakin melakukan perubahan?"** yang meminta isi ulang username + password dev. Tujuannya: cegah perubahan tidak sengaja & audit jejak yang jelas.

## Update File via Dashboard (tanpa Git/SSH)

Tab **Upload Script** menerima 1 file dan replace target sesuai nama:

| Target | File yang Ditimpa | Hot-reload? |
|--------|-------------------|-------------|
| personality | `src/ai/personality.js` | ✅ otomatis |
| config | `config.json` | ✅ otomatis |
| bot | `src/bot.js` | ⚠️ butuh restart proses |

Aturan keamanan:
- **Nama file harus cocok** (`personality.js` / `config.json` / `bot.js`).
  Upload nama lain → ditolak. Cegah replace silang.
- **JSON divalidasi** sebelum ditimpa.
- **Atomic write**: file ditulis ke `.tmp` lalu di-`rename`. Bot tidak akan
  pernah baca file setengah jadi.
- **Cuma 1 file** yang disentuh per upload — file lain (DB, cache, script
  lain) tidak terpengaruh sama sekali.

## Cara Pakai (Discord)

Di channel yang ID-nya disetel pada `YANTO_CHANNEL_ID`, ketik:

```
yanto map kebun ada apa aja?
yanto, ada checkpoint di map "Lobby Kota"?
yanto jelaskan lebih detail soal map parkour
```

Bot hanya merespon kalau kata `yanto` muncul. Pesan tanpa kata kunci diabaikan.

## Catatan API Gemini

Limit default di `config.json`:
- `rpmLimit`: 14 request/menit per key
- `rpdLimit`: 1400 request/hari per key
- `cooldownMs`: 60000 (1 menit cooldown bila key dilempar 429)

Sesuaikan dengan kuota tier Gemini kamu.

## Aman dari Restart

- DB file (`data/bot.db`) tidak pernah di-rewrite saat hot-reload.
- Cache chat tetap utuh meski `personality.js` diganti.
- Replace `bot.js` lewat dashboard memerlukan restart proses
  (file disimpan, tapi modul Discord aktif tidak diganti karena ini
  bisa memutus session — sengaja tidak otomatis).
