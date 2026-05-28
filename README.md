# Yanto - Discord Bot AI (Gemini + SQLite + Dashboard)

Bot Discord dengan kepribadian sendiri (default "Yanto", bisa di-rename),
sumber jawaban dari database map Roblox (SQLite), 2 API key Gemini
(utama + fallback), cache riwayat chat, rate-limit dance + spam timeout,
dan dashboard web untuk edit semuanya secara realtime.

## Fitur Inti

- **Persona dinamis**: nama bot (mis. "Yanto" / "Dandi") diatur di Config.
  Mengubah nama otomatis mengganti keyword pemicu, sapaan masuk/keluar/restart,
  dan referensi diri di prompt.
- **Trigger**: hanya merespon pesan di channel `YANTO_CHANNEL_ID` yang
  mengandung kata `keyword` (default `yanto`, ikut nama bot).
- **Sumber kebenaran**: tabel `map_data` di SQLite (`better-sqlite3`).
  Bot dilarang mengarang - hanya menjawab dari konten DB.
- **2 API Gemini bergiliran**:
  - PRIMARY selalu prioritas; otomatis fallback ke SECONDARY saat
    rate-limit / cooldown.
  - Reserve token: `N` token RPM dicadangkan untuk balasan setelah
    "sabar ya kak..." (default `N=1`).
- **Cache jawaban**:
  - Baru -> Gemini -> simpan.
  - Mirip -> langsung cache (tanpa request Gemini).
  - "lebih detail / spesifik" -> regenerate -> replace cache.
- **Rate-limit dance**:
  - 1x kena limit -> bot balas `"sabar ya kak, kasih aku mikir dulu 1 menit yaa"`,
    setelah 60 detik bot menjawab pertanyaan asli pakai reserve token.
  - 2x masih maksa -> `"jika kamu tidak bisa bersabar maka akan {nama} bungkam ya @user"`.
  - 3x maksa -> Discord-timeout user 5 menit + `"maaf yah @user {nama} bungkam, kamu gasabaran sih jadi manusia, {nama} robot bukan nabi boyyy..."`.
- **Sapaan startup**:
  - Cold start: 5 detik validasi token Gemini.
    Sukses -> `"halo, kenalin aku {nama} aku adalah AI paling ganteng sedunia..."`.
    Gagal -> `"maaf yah, token/API kamu salah/error nih, aku gagal mendarat"` (retry 1x).
  - Restart (setelah upload bot.js): 4 detik jeda lalu
    `"hoamm... enak banget tidurnya walaupun gak lama, udah siap bantu jawab pertanyaan kalian lagi nih @everyone"`.
  - Sebelum restart: `"{Nama} capek, {nama} tidur dulu yaa, babay semua... @everyone"` lalu diam total 5 detik sebelum exit.
- **Sleeping mode**: saat bot lagi pamit / sebelum validasi sukses,
  bot SAMA SEKALI tidak merespon walau di-spam keyword.
- **Dashboard web** dengan 2 role:
  - `dev` / `devtbiapril2026` -> full administrator.
  - `admin` / `admintbi2025` -> read-only (tombol disabled, tanpa banner).
  - Setiap aksi tulis butuh re-konfirmasi user/pass dev (modal).
- **Auto-restart bot.js**: upload `bot.js` -> bot pamit 5 detik ->
  `process.exit(42)` -> supervisor `runner.js` respawn 2 detik ->
  bot bangun & sapa.
- **Rename guard**: ganti nama bot dicek dulu ukuran cache.
  Cache > 100KB -> ditolak, harus dihapus dulu. < 100KB -> rename
  juga dilakukan di seluruh row `chat_history`.

## Struktur

```
discord-bot-AI/
├── runner.js               supervisor: respawn pada exit code 42
├── package.json            "start": "node runner.js"
├── config.json             tuning runtime (di-edit lewat dashboard)
├── .env.example
├── data/
│   └── bot.db              SQLite (map_data, chat_history, api_usage)
└── src/
    ├── index.js            entry: dashboard + bot + watcher
    ├── bot.js              Discord handler (sleeping, sabar, spam timeout)
    ├── ai/
    │   ├── gemini.js       rotasi 2 API + allowReserve + validate()
    │   └── personality.js  persona (parameterized by name)
    ├── db/
    │   ├── database.js     init SQLite (WAL)
    │   ├── mapData.js      CRUD map Roblox + buildContext
    │   └── chatHistory.js  cache + Jaccard similarity + search
    ├── dashboard/
    │   ├── server.js       REST API (role-based + confirm + form-fields config)
    │   └── public/         UI
    └── utils/
        ├── hotReload.js    chokidar + bus event
        └── logger.js
```

## Setup

```bash
cd discord-bot-AI
cp .env.example .env
# edit .env -> isi token & API key
npm install
npm start                    # menjalankan via supervisor (auto-restart)
# atau:
npm run start:once           # tanpa supervisor (single proses)
```

Dashboard: `http://localhost:3000`.

## Config Bot (form fields, dengan validasi min/max)

Semua kolom punya batas keras supaya tidak merusak sistem:

| Field | Min | Max | Default | Catatan |
|------|-----|-----|---------|---------|
| Nama Bot | 2 | 20 char | Yanto | alfanumerik, awal huruf |
| RPM Limit | 2 | 60 | 14 | request/menit per key |
| RPD Limit | 100 | 50000 | 1400 | request/hari per key |
| Cooldown switch API | 10 dtk | 300 dtk | 30 dtk | UI: detik. File: ms. |
| Reserve token | 0 | 3 | 1 | dipakai setelah "sabar". Harus < RPM Limit. |
| Threshold cache | 0.5 | 1.0 | 0.82 | similarity Jaccard |
| Memori pesan | 0 | 30 | 10 | Q/A terakhir dikirim ke AI |
| Pemicu detail | - | 50 item | (preset) | satu frasa per baris |

Bot yang menulis `config.json` (dashboard cuma perantara). Penulisan **atomic**
(`.tmp` -> rename) supaya bot tidak baca file setengah jadi.

## Login Dashboard

| Role | User | Pass | Hak |
|------|------|------|-----|
| dev | `dev` | `devtbiapril2026` | Full edit/upload/hapus |
| admin | `admin` | `admintbi2025` | Read-only (tombol disabled) |

Setiap aksi tulis -> modal "Yakin? Isi ulang user/pass dev".

## Update File via Dashboard (tanpa Git/SSH)

Tab **Upload Script**:

| Target | Nama file wajib | Perilaku setelah upload |
|--------|-----------------|--------------------------|
| personality | `personality.js` | hot-reload, langsung aktif |
| config | `config.json` | hot-reload (validasi JSON dulu) |
| bot | `bot.js` | bot pamit 5 dtk -> exit 42 -> supervisor respawn 2 dtk -> bot sapa "hoamm..." |

Hanya **1 file** yang di-replace per upload. DB, cache, file lain tidak tersentuh.

## Permissions Discord (penting untuk timeout user)

Bot butuh permission **`Moderate Members`** + role bot harus lebih tinggi
dari role user yang akan di-timeout. Tanpa ini, fitur timeout 5 menit
fallback ke "internal mute" (bot mengabaikan user, tapi Discord tidak men-timeout).

## Catatan Operasional

- DB `data/bot.db` & `chat_history` tidak pernah di-rewrite saat hot-reload.
- Saat bot.js di-upload, koneksi Discord di-destroy dulu sebelum exit
  supaya pesan pamit ter-flush.
- Cache > 100KB & user mau ganti nama? Hapus dulu di tab "Riwayat Chat"
  (search "yanto" / "Yanto" -> hapus terkait, atau Hapus Semua).
