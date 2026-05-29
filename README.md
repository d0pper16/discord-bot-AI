# Yanto - Discord Bot AI (Gemini + SQLite + Dashboard)

Bot Discord dengan kepribadian sendiri (default "Yanto", bisa di-rename),
sumber jawaban dari database map Roblox (SQLite), 2 API key Gemini
(utama + fallback), cache riwayat chat, rate-limit dance + spam timeout,
auto-translate response, audit log, theme toggle, dan dashboard web
realtime.

## Fitur Inti

- **Persona dinamis & 1-identitas-tunggal**: nama bot diatur via Config Bot,
  ganti nama otomatis menyebar ke keyword pemicu, sapaan, prompt, dan rewrite
  cache. Tidak ada alias - identitas tunggal.
- **Trigger** case-insensitive: hanya merespon di channel `YANTO_CHANNEL_ID`
  yang mengandung kata `keyword` (DANDI / dandi / Dandi semua valid).
- **Sumber kebenaran**: tabel `map_data` di SQLite. Bot dilarang mengarang.
- **2 API Gemini bergiliran** dengan reserve token untuk balasan deferred.
- **Cache jawaban** dengan exact + Jaccard similarity, replace pada follow-up "lebih detail".
- **Rate-limit dance**: sabar -> warn -> Discord-timeout 5 menit pada spam ke-3.
- **Cold start validate**: 5 detik delay -> validate Gemini -> "halo, kenalin..." atau "maaf yah, token salah".
- **Restart silent** (no farewell): bot diam total ~3 detik -> respawn -> "hoamm... enak banget {nama} tidurnya...".
- **Shutdown total** (tombol di dashboard): bot ucap pamit -> mati. Dashboard ikut mati.
- **Auto-translate**: bot deteksi bahasa user (id/en/pt) dan jawab dalam bahasa tersebut. Bahasa Indonesia default; foreign language harus dominan supaya translate. Pesan boilerplate (sabar/warn/timeout/empty/errorApi) ada terjemahan natif. Pesan broadcast (hello/back/farewell) pakai bahasa channel hasil deteksi 30 pesan terakhir non-bot.
- **Dashboard web** dengan 2 role:
  - `dev` / `devtbiapril2026` -> full administrator.
  - `admin` / `admintbi2025` -> read-only (tombol disabled, tetap visible).
  - Setiap aksi tulis butuh re-konfirmasi user/pass dev (modal).
- **Audit Log**: semua aksi tulis tercatat (user, action, target, details, waktu).
  Read-only untuk semua role.
- **Theme toggle**: dark/light, simpan di localStorage.
- **DB Backup**: export semua tabel `map_data` + `chat_history` ke JSON.
  Import dengan mode merge atau replace.
- **File Manager**: edit, tambah, hapus file project apa pun (text only).
  Save bot.js trigger auto-restart. Levenshtein typo guard saat upload.
- **Restart/Shutdown buttons** di header dashboard. Auto-restart juga otomatis
  saat upload bot.js / save bot.js via File Manager.

## Struktur

```
discord-bot-AI/
├── runner.js               supervisor: respawn pada exit code 42
├── package.json            "start": "node runner.js"
├── config.json             tuning runtime (di-edit lewat dashboard form)
├── .env.example
├── data/
│   └── bot.db              SQLite (map_data, chat_history, api_usage, audit_log)
└── src/
    ├── index.js            entry: dashboard + bot + watcher
    ├── bot.js              Discord handler (sleeping, sabar, spam timeout, translation)
    ├── ai/
    │   ├── gemini.js       rotasi 2 API + allowReserve + validate()
    │   ├── personality.js  persona (parameterized by name & lang)
    │   └── lang.js         language detection + translation tables (id/en/pt)
    ├── db/
    │   ├── database.js     init SQLite (WAL) - 4 tabel
    │   ├── mapData.js      CRUD map Roblox + buildContext
    │   ├── chatHistory.js  cache + Jaccard similarity + search
    │   └── audit.js        audit log helper
    ├── dashboard/
    │   ├── server.js       REST API (role + confirm + audit + DB export/import)
    │   └── public/         UI (8 tab: Maps/Personality/Config/Files/Upload/History/Audit/Backup)
    └── utils/
        ├── hotReload.js    chokidar + bus event
        └── logger.js
```

## Setup (one-time, mesin baru)

```bash
cd discord-bot-AI
cp .env.example .env
# edit .env -> isi DISCORD_TOKEN, YANTO_CHANNEL_ID, GEMINI_API_KEY_*
npm install
npm start
```

Dashboard: `http://localhost:3000`. Setelah ini, **semua via dashboard**
(restart/shutdown/edit/upload). CLI hanya perlu kalau full shutdown
& mau menyalakan kembali.

## Config Bot Fields (semua min/max divalidasi server-side)

| Field | Min | Max | Default | Keterangan |
|---|---|---|---|---|
| Nama Bot | 2 | 20 | Yanto | Identitas tunggal. Rename = ganti keyword + cache rewrite. |
| RPM Limit | **5** | **14** | 14 | Request/menit per key (sesuai tier free Gemini Flash). |
| **RPD Limit** | - | - | **995 (locked)** | **Tidak bisa diubah dari dashboard** demi keamanan kuota harian. |
| Cooldown switch API | 10 dtk | 300 dtk | 30 dtk | UI: detik. File: ms. |
| Reserve token | 0 | 3 | 1 | Untuk balasan deferred. Harus < RPM. |
| Threshold cache | 0.5 | 1.0 | 0.82 | Jaccard similarity. |
| Memori pesan | 0 | 30 | 10 | Q/A terakhir kirim ke AI. |
| Pemicu detail | - | 50 item | preset | 1 frasa per baris. |

Bot yang menulis config.json - dashboard cuma perantara. Penulisan **atomic**
(`.tmp` -> `rename`).

## Login Dashboard

| Role | User | Pass | Hak |
|------|------|------|-----|
| dev | `dev` | `devtbiapril2026` | Full edit/upload/hapus |
| admin | `admin` | `admintbi2025` | Read-only |

Tombol **Restart Bot** & **Matikan Bot** tetap visible untuk admin tapi
disabled (sesuai req: "tetap ada pada user admin yang masuk, tetapi
tidak dapat digunakan").

## Auto-translate (id/en/pt)

- Deteksi: stopword-counting heuristic. Bahasa Indonesia default,
  hanya translate kalau foreign language **dominan** (id < 70% best, dan best >= 15%).
- AI answer: prompt mengandung instruksi "respond in {detected language}".
- Boilerplate (sabar/warn/timeout/empty/errorApi): tabel terjemahan natif.
- Broadcast (hello/back/farewell): deteksi dari 30 pesan terakhir non-bot di channel target. Hasil di-cache untuk durasi sesi.

## Permission Discord

Bot **butuh permission `Moderate Members`** untuk timeout user 5 menit.
Kalau bot sudah punya **`Administrator`**, tidak perlu config tambahan
(Administrator supersede semua permission lain). Pastikan role bot
**lebih tinggi** dari role user yang akan di-timeout.

## DB Backup

- **Export** (semua role): tab "Backup DB" -> Download backup .json.
  File berisi `map_data` + `chat_history` lengkap.
- **Import** (dev only): pilih file JSON, pilih mode `merge` atau `replace`,
  centang tabel mana saja. Modal Yes/No untuk konfirmasi `replace`.

## Audit Log

Tab "Audit Log" menampilkan setiap aksi tulis: rename config, edit personality,
upload file, CRUD map, edit/hapus history, restart, shutdown, import DB.
Tidak bisa dihapus untuk menjaga jejak audit.
