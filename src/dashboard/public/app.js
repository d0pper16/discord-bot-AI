/* eslint-disable */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

let ROLE = null;
let BOUNDS = {};
let CACHE_SIZE = 0;
let CACHE_LIMIT = 102400;

// =================================================================
//  Tabs
// =================================================================
$$('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('nav.tabs button').forEach(b => b.classList.remove('active'));
    $$('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

// =================================================================
//  Modal: Konfirmasi user/pass
// =================================================================
function askConfirm(msg = 'Yakin melakukan perubahan? Isi ulang user & password dev.') {
  return new Promise((resolve) => {
    const modal = $('#confirm-modal');
    const userIn = $('#confirm-user');
    const passIn = $('#confirm-pass');
    const errEl  = $('#confirm-error');
    $('#confirm-msg').textContent = msg;
    userIn.value = ''; passIn.value = '';
    errEl.hidden = true;
    modal.hidden = false;
    setTimeout(() => userIn.focus(), 50);

    function close(result) {
      modal.hidden = true;
      $('#confirm-ok').onclick = null;
      $('#confirm-cancel').onclick = null;
      userIn.onkeydown = null;
      passIn.onkeydown = null;
      resolve(result);
    }
    $('#confirm-ok').onclick = () => {
      const u = userIn.value.trim();
      const p = passIn.value;
      if (!u || !p) {
        errEl.textContent = 'Username dan password wajib diisi.';
        errEl.hidden = false; return;
      }
      close({ user: u, pass: p });
    };
    $('#confirm-cancel').onclick = () => close(null);
    const onEnter = (ev) => { if (ev.key === 'Enter') $('#confirm-ok').onclick(); };
    userIn.onkeydown = onEnter;
    passIn.onkeydown = onEnter;
  });
}

// =================================================================
//  Modal: Yes/No
// =================================================================
function askYesNo(message, title = 'Konfirmasi') {
  return new Promise((resolve) => {
    $('#yn-title').textContent = title;
    $('#yn-msg').textContent = message;
    const m = $('#yesno-modal');
    m.hidden = false;
    const close = (v) => { m.hidden = true; resolve(v); };
    $('#yn-yes').onclick = () => close(true);
    $('#yn-no').onclick  = () => close(false);
  });
}

// =================================================================
//  Modal: Pilihan upload (typo guard / new)
// =================================================================
function askSuggestion({ message, options }) {
  return new Promise((resolve) => {
    $('#sg-msg').textContent = message;
    const wrap = $('#sg-options');
    wrap.innerHTML = '';
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.textContent = opt.label;
      btn.className = opt.cls || '';
      btn.style.margin = '4px 4px 4px 0';
      btn.onclick = () => { $('#suggest-modal').hidden = true; resolve(opt.value); };
      wrap.appendChild(btn);
    });
    $('#sg-cancel').onclick = () => { $('#suggest-modal').hidden = true; resolve(null); };
    $('#suggest-modal').hidden = false;
  });
}

// =================================================================
//  Busy overlay (untuk restart/shutdown)
// =================================================================
function showBusy(title, msg) {
  $('#busy-title').textContent = title;
  $('#busy-msg').textContent = msg || '';
  $('#busy-overlay').hidden = false;
}
function hideBusy() { $('#busy-overlay').hidden = true; }

// =================================================================
//  Helper: write request dgn konfirmasi
// =================================================================
async function withConfirm(promptMsg, sender) {
  if (ROLE !== 'dev') {
    alert('Akun admin read-only. Tidak boleh mengubah apa pun.');
    return null;
  }
  const creds = await askConfirm(promptMsg);
  if (!creds) return null;
  const res = await sender(creds);
  if (!res.ok && res.status !== 409) {
    let msg = 'Gagal: ' + res.status;
    try { const j = await res.clone().json(); if (j && j.error) msg = j.error; }
    catch (_) { try { msg = await res.clone().text(); } catch (__) {} }
    alert(msg);
    return null;
  }
  return res;
}
function jsonWrite(method, url, payload, promptMsg) {
  return withConfirm(promptMsg, (creds) =>
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, _confirm_user: creds.user, _confirm_pass: creds.pass }),
    })
  );
}

// =================================================================
//  Bootstrap
// =================================================================
async function bootstrap() {
  try {
    const me = await fetch('/api/me').then(r => r.json());
    ROLE = me.role;
    $('#who').textContent = `Login: ${me.user} (${me.role})`;
    if (ROLE !== 'dev') {
      $$('.writer').forEach(el => el.classList.add('locked'));
      $$('.writer-input, .writer button, .writer input, .writer textarea, .writer select')
        .forEach(el => { el.disabled = true; });
    }
  } catch (e) { console.error('me err', e); }
}
bootstrap();

// =================================================================
//  Header buttons: Restart / Shutdown
// =================================================================
$('#btn-restart').onclick = async () => {
  const ok = await jsonWrite('POST', '/api/restart', {},
    'Restart bot? Bot akan diam total selama ~3 detik lalu hidup lagi (TANPA pesan pamit). Setelah hidup, bot ucap "hoamm...".');
  if (!ok) return;
  showBusy('Bot sedang restart...', 'Tunggu ~10 detik. Dashboard ikut down sebentar lalu kembali otomatis.');
  pollForReady();
};
$('#btn-shutdown').onclick = async () => {
  const yes = await askYesNo(
    'Yakin matikan bot SECARA TOTAL? Bot akan ucap pamit, lalu mati. Dashboard juga ikut mati. Untuk menghidupkan lagi, jalankan "npm start" di server.',
    'Matikan Bot Total?'
  );
  if (!yes) return;
  const ok = await jsonWrite('POST', '/api/shutdown', {},
    'Konfirmasi terakhir: matikan bot.');
  if (!ok) return;
  showBusy('Bot sedang dimatikan...', 'Bot ucap pamit selama 5 detik lalu proses berakhir. Dashboard akan offline.');
};

async function pollForReady() {
  const start = Date.now();
  const tick = async () => {
    try {
      const r = await fetch('/api/me', { cache: 'no-store' });
      if (r.ok) { hideBusy(); location.reload(); return; }
    } catch (_) {}
    if (Date.now() - start > 30000) { hideBusy(); alert('Bot tidak kunjung kembali. Cek log server.'); return; }
    setTimeout(tick, 1500);
  };
  setTimeout(tick, 4000);
}

// =================================================================
//  Status polling
// =================================================================
async function refreshStatus() {
  try {
    const r = await fetch('/api/status').then(r => r.json());
    const g = r.gemini;
    $('#status').textContent =
      `Channel  : ${r.env.channelId || '-'}\n` +
      `Model    : ${r.env.model}\n` +
      `Reserve  : ${g.reserveTokens || 0} token\n` +
      `PRIMARY  : rpm=${g.primary.rpm}  rpd=${g.primary.rpd}  cd=${g.primary.cooldownMs}ms\n` +
      `SECONDARY: rpm=${g.secondary.rpm}  rpd=${g.secondary.rpd}  cd=${g.secondary.cooldownMs}ms`;
  } catch (e) { $('#status').textContent = 'status err: ' + e.message; }
}
setInterval(refreshStatus, 5000);
refreshStatus();

// =================================================================
//  MAPS
// =================================================================
async function loadMaps() {
  const rows = await fetch('/api/maps').then(r => r.json());
  const tbody = $('#map-table tbody'); tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.id}</td>
      <td><b>${esc(r.topic)}</b><br><small>${esc((r.content||'').slice(0,140))}${r.content && r.content.length>140?'...':''}</small></td>
      <td>${esc(r.tags || '')}</td>
      <td class="act">
        <button class="secondary" data-edit="${r.id}">Edit</button>
        <button class="danger writer" data-del="${r.id}" ${ROLE!=='dev'?'disabled':''}>Hapus</button>
      </td>`;
    tr.querySelector('[data-edit]').onclick = () => fillMapForm(r);
    const del = tr.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      const ok = await jsonWrite('DELETE', `/api/maps/${r.id}`, {}, `Yakin hapus map "${r.topic}"?`);
      if (ok) loadMaps();
    };
    tbody.appendChild(tr);
  });
}
function fillMapForm(r) {
  const f = $('#map-form');
  f.id.value = r.id || ''; f.topic.value = r.topic || '';
  f.tags.value = r.tags || ''; f.content.value = r.content || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#map-reset').onclick = () => fillMapForm({});
$('#map-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const data = { topic: f.topic.value.trim(), tags: f.tags.value.trim(), content: f.content.value };
  const id = f.id.value;
  const url = id ? '/api/maps/' + id : '/api/maps';
  const method = id ? 'PUT' : 'POST';
  const ok = await jsonWrite(method, url, data,
    id ? `Yakin update map id=${id}?` : 'Yakin tambah map baru?');
  if (ok) { fillMapForm({}); loadMaps(); }
};
loadMaps();

// =================================================================
//  HISTORY
// =================================================================
let HISTORY_ROWS = [];
async function loadHistory(q = '') {
  const url = '/api/history?limit=500' + (q ? '&q=' + encodeURIComponent(q) : '');
  HISTORY_ROWS = await fetch(url).then(r => r.json());
  renderHistory();
  try {
    const cs = await fetch('/api/cache-size').then(r => r.json());
    CACHE_SIZE = cs.bytes; CACHE_LIMIT = cs.limit;
    renderCacheInfo();
  } catch (_) {}
}
function renderHistory() {
  const tbody = $('#history-table tbody'); tbody.innerHTML = '';
  HISTORY_ROWS.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.id}</td>
      <td><code>${esc(r.user_id)}</code></td>
      <td><div class="cell">${esc(r.question)}</div></td>
      <td><div class="cell">${esc((r.answer||'').slice(0,250))}${r.answer && r.answer.length>250?'...':''}</div></td>
      <td><small>${esc(r.source)}</small></td>
      <td class="act">
        <button class="secondary" data-edit="${r.id}">Edit</button>
        <button class="danger writer" data-del="${r.id}" ${ROLE!=='dev'?'disabled':''}>Hapus</button>
      </td>`;
    tr.querySelector('[data-edit]').onclick = () => openHistoryEditor(r);
    const del = tr.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      const ok = await jsonWrite('DELETE', `/api/history/${r.id}`, {}, `Yakin hapus entry cache id=${r.id}?`);
      if (ok) loadHistory($('#history-search').value);
    };
    tbody.appendChild(tr);
  });
  $('#history-count').textContent = `${HISTORY_ROWS.length} baris`;
}
function openHistoryEditor(r) {
  if (ROLE !== 'dev') return;
  const box = $('#history-editor');
  box.hidden = false;
  $('#he-id').textContent = '#' + r.id;
  $('#he-question').value = r.question || '';
  $('#he-answer').value   = r.answer   || '';
  $('#he-question').dataset.id = r.id;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#he-cancel').onclick = () => { $('#history-editor').hidden = true; };
$('#he-save').onclick = async () => {
  const id = $('#he-question').dataset.id;
  const ok = await jsonWrite('PUT', `/api/history/${id}`,
    { question: $('#he-question').value, answer: $('#he-answer').value },
    `Yakin simpan perubahan entry cache id=${id}?`);
  if (ok) { $('#history-editor').hidden = true; loadHistory($('#history-search').value); }
};
let searchTimer = null;
$('#history-search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadHistory(e.target.value.trim()), 250);
});
$('#history-refresh').onclick = () => loadHistory($('#history-search').value);
$('#history-clear').onclick = async () => {
  const ok = await jsonWrite('DELETE', '/api/history', {},
    'Yakin HAPUS SEMUA cache riwayat chat? Tindakan tidak bisa dibatalkan.');
  if (ok) loadHistory();
};
loadHistory();

// =================================================================
//  PERSONALITY
// =================================================================
async function loadPersonality() {
  $('#personality-editor').value = await fetch('/api/personality').then(r => r.text());
}
$('#personality-save').onclick = async () => {
  const ok = await jsonWrite('PUT', '/api/personality',
    { content: $('#personality-editor').value },
    'Yakin simpan perubahan personality.js? Hot-reload langsung aktif.');
  if (ok) alert('Tersimpan. Persona baru sudah aktif.');
};
$('#personality-reload').onclick = loadPersonality;
loadPersonality();

// =================================================================
//  CONFIG
// =================================================================
async function loadConfigFields() {
  const data = await fetch('/api/config-fields').then(r => r.json());
  BOUNDS = data.bounds; CACHE_SIZE = data.cacheSizeBytes; CACHE_LIMIT = data.cacheLimitBytes;
  const v = data.values;
  $('#cfg-name').value     = v.name;
  $('#cfg-rpm').value      = v.rpmLimit;
  $('#cfg-rpd').value      = v.rpdLimit;
  $('#cfg-cd').value       = v.cooldownSec;
  $('#cfg-reserve').value  = v.reserveTokens;
  $('#cfg-sim').value      = v.similarityThreshold;
  $('#cfg-ctx').value      = v.maxContextMessages;
  $('#cfg-triggers').value = (v.specificTriggers || []).join('\n');
  renderCacheInfo();
}
function renderCacheInfo() {
  const el = $('#cfg-cache-info'); if (!el) return;
  const kb = (CACHE_SIZE / 1024).toFixed(1);
  const limKb = (CACHE_LIMIT / 1024).toFixed(0);
  const over = CACHE_SIZE > CACHE_LIMIT;
  el.className = 'cache-info ' + (over ? 'cache-over' : 'cache-ok');
  el.innerHTML = over
    ? `<b>Peringatan:</b> Cache ${kb}KB > ${limKb}KB. Ganti nama akan menghapus cache ingatan (akan diminta konfirmasi Yes/No).`
    : `Cache ingatan saat ini: <b>${kb}KB</b> / batas ${limKb}KB. Aman untuk rename (cache otomatis di-rewrite ke nama baru).`;
}

async function saveConfig(force = false) {
  const payload = {
    name: $('#cfg-name').value.trim(),
    rpmLimit: Number($('#cfg-rpm').value),
    rpdLimit: Number($('#cfg-rpd').value),
    cooldownSec: Number($('#cfg-cd').value),
    reserveTokens: Number($('#cfg-reserve').value),
    similarityThreshold: Number($('#cfg-sim').value),
    maxContextMessages: Number($('#cfg-ctx').value),
    specificTriggers: $('#cfg-triggers').value,
    force,
  };
  return jsonWrite('PUT', '/api/config-fields', payload,
    'Yakin simpan config bot? Beberapa field berlaku langsung tanpa restart.');
}

$('#config-save').onclick = async () => {
  const r = await saveConfig(false);
  if (!r) return;
  if (r.status === 409) {
    const data = await r.json();
    if (data.requiresForce) {
      const yes = await askYesNo(data.message, 'Cache > 100KB');
      if (!yes) { alert('Perubahan dibatalkan.'); return; }
      // Re-submit dengan force=true (butuh konfirmasi user/pass lagi)
      const r2 = await saveConfig(true);
      if (!r2 || !r2.ok) return;
      const d = await r2.json();
      alert(`Config tersimpan. Nama bot diganti, cache dihapus (${d.clearedRows || 0} baris).`);
      loadConfigFields(); loadHistory(); return;
    }
  }
  if (r.ok) {
    const d = await r.json();
    let txt = 'Config tersimpan.';
    if (d.renamedRows) txt += ` Cache di-rewrite: ${d.renamedRows} baris.`;
    alert(txt);
    loadConfigFields(); loadHistory();
  }
};
$('#config-reload').onclick = loadConfigFields;
loadConfigFields();

// =================================================================
//  FILE MANAGER
// =================================================================
let FILES = [];
let CURRENT_FILE = null;

async function loadFiles() {
  const data = await fetch('/api/files').then(r => r.json());
  FILES = data.files;
  const tbody = $('#files-table tbody'); tbody.innerHTML = '';
  FILES.forEach(f => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${esc(f.path)}</code>${f.protected ? ' <span class="tag-protected" title="dilindungi: tidak bisa dihapus">protected</span>' : ''}</td>
      <td><small>${(f.size/1024).toFixed(2)} KB</small></td>
      <td class="act">
        <button class="secondary" data-open="${esc(f.path)}">Open</button>
      </td>`;
    tr.querySelector('[data-open]').onclick = () => openFileEditor(f.path);
    tbody.appendChild(tr);
  });
}
$('#files-refresh').onclick = loadFiles;

async function openFileEditor(rel) {
  const data = await fetch('/api/files/read?path=' + encodeURIComponent(rel)).then(r => r.json());
  if (data.error) { alert(data.error); return; }
  CURRENT_FILE = { path: data.path, protected: data.protected };
  $('#fe-path').textContent = data.path;
  $('#fe-meta').textContent = `${(data.size/1024).toFixed(2)} KB${data.protected ? ' - protected' : ''}`;
  $('#fe-content').value = data.content;
  $('#fe-delete').disabled = data.protected || ROLE !== 'dev';
  $('#files-editor').hidden = false;
  $('#files-editor').scrollIntoView({ behavior: 'smooth' });
}
$('#fe-close').onclick = () => { $('#files-editor').hidden = true; CURRENT_FILE = null; };
$('#fe-save').onclick = async () => {
  if (!CURRENT_FILE) return;
  const ok = await jsonWrite('PUT', '/api/files/save',
    { path: CURRENT_FILE.path, content: $('#fe-content').value },
    `Yakin simpan ${CURRENT_FILE.path}?${CURRENT_FILE.path === 'src/bot.js' ? ' (akan auto-restart bot)' : ''}`);
  if (ok) {
    const d = await ok.json();
    alert(`Tersimpan: ${d.path}${d.restarting ? ' - bot akan auto-restart.' : ''}`);
    if (d.restarting) { showBusy('Bot restart...', 'Bot ucap "hoamm..." setelah ~10 detik.'); pollForReady(); }
    loadFiles();
  }
};
$('#fe-delete').onclick = async () => {
  if (!CURRENT_FILE) return;
  const yes = await askYesNo(`Hapus file ${CURRENT_FILE.path}? File yang sudah dihapus tidak bisa dikembalikan.`, 'Hapus File');
  if (!yes) return;
  const ok = await jsonWrite('DELETE', '/api/files/delete',
    { path: CURRENT_FILE.path },
    `Konfirmasi hapus ${CURRENT_FILE.path}.`);
  if (ok) { $('#files-editor').hidden = true; CURRENT_FILE = null; loadFiles(); }
};

// New file
$('#files-new').onclick = () => {
  $('#nf-path').value = ''; $('#nf-content').value = '';
  $('#newfile-modal').hidden = false;
  setTimeout(() => $('#nf-path').focus(), 50);
};
$('#nf-cancel').onclick = () => { $('#newfile-modal').hidden = true; };
$('#nf-create').onclick = async () => {
  const rel = $('#nf-path').value.trim();
  if (!rel) { alert('Path wajib'); return; }
  $('#newfile-modal').hidden = true;
  const ok = await jsonWrite('POST', '/api/files/create',
    { path: rel, content: $('#nf-content').value },
    `Yakin buat file baru: ${rel}?`);
  if (ok) {
    const d = await ok.json();
    alert(`File dibuat: ${d.path}`);
    loadFiles(); openFileEditor(d.path);
  }
};

// Upload file (typo guard)
$('#files-upload-btn').onclick = () => $('#files-upload-input').click();
$('#files-upload-input').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const dir = $('#files-upload-dir').value.trim();
  e.target.value = '';
  await runUpload(file, dir, 'auto', null);
};

async function runUpload(file, dir, mode, targetPath) {
  const creds = await askConfirm(`Yakin upload "${file.name}" (${(file.size/1024).toFixed(2)} KB) ke ${dir || 'root'}?`);
  if (!creds) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('dir', dir);
  fd.append('mode', mode);
  if (targetPath) fd.append('target_path', targetPath);
  fd.append('_confirm_user', creds.user);
  fd.append('_confirm_pass', creds.pass);
  const r = await fetch('/api/files/upload', { method: 'POST', body: fd });

  if (r.ok) {
    const d = await r.json();
    alert(`Upload ${d.mode}: ${d.path}${d.restarting ? ' (bot auto-restart)' : ''}`);
    if (d.restarting) { showBusy('Bot restart...', 'Bot ucap "hoamm..." setelah ~10 detik.'); pollForReady(); }
    loadFiles();
    return;
  }

  if (r.status === 409) {
    const data = await r.json();
    let options = [];
    if (data.status === 'exists') {
      options = [
        { label: `Update file existing (${data.targetPath})`, value: { mode: 'update', target_path: data.targetPath }, cls: 'danger' },
      ];
    } else if (data.status === 'ambiguous') {
      options = [
        ...data.suggestions.map(s => ({
          label: `Update existing ${s.path} (Lev=${s.distance})`,
          value: { mode: 'update', target_path: s.path },
          cls: 'secondary',
        })),
        { label: `Tambah file baru: ${data.targetPath}`, value: { mode: 'create', target_path: data.targetPath }, cls: '' },
      ];
    } else if (data.status === 'new') {
      options = [
        { label: `Tambah file baru: ${data.targetPath}`, value: { mode: 'create', target_path: data.targetPath } },
      ];
    }
    const choice = await askSuggestion({ message: data.message, options });
    if (!choice) return;
    return runUpload(file, dir, choice.mode, choice.target_path);
  }

  let msg = 'Gagal upload: ' + r.status;
  try { const j = await r.json(); if (j.error) msg = j.error; } catch (_) {}
  alert(msg);
}

// =================================================================
//  Quick Upload (legacy: 3 target tetap)
// =================================================================
$('#upload-form').onsubmit = async (e) => {
  e.preventDefault();
  if (ROLE !== 'dev') { alert('Akun admin read-only.'); return; }
  const target = e.target.target.value;
  const file   = e.target.file.files[0];
  if (!file) return;
  const targetPathMap = {
    personality: 'src/ai/personality.js',
    config:      'config.json',
    bot:         'src/bot.js',
  };
  const expected = targetPathMap[target].split('/').pop().toLowerCase();
  if ((file.name || '').toLowerCase() !== expected) {
    alert(`Nama file harus persis "${expected}". Kamu upload "${file.name}".`);
    return;
  }
  await runUpload(file, target === 'config' ? '' : 'src/' + (target === 'personality' ? 'ai' : ''), 'update', targetPathMap[target]);
  e.target.reset();
  loadPersonality(); loadConfigFields();
};

// init Files tab
loadFiles();

// =================================================================
//  Helpers
// =================================================================
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
