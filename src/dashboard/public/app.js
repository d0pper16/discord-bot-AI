/* eslint-disable */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

let ROLE = null;       // 'dev' | 'admin'
let BOUNDS = {};       // dari /api/config-fields
let CACHE_SIZE = 0;    // bytes
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
//  Modal Konfirmasi
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
        errEl.hidden = false;
        return;
      }
      close({ user: u, pass: p });
    };
    $('#confirm-cancel').onclick = () => close(null);
    const onEnter = (ev) => { if (ev.key === 'Enter') $('#confirm-ok').onclick(); };
    userIn.onkeydown = onEnter;
    passIn.onkeydown = onEnter;
  });
}

async function withConfirm(promptMsg, sender) {
  if (ROLE !== 'dev') {
    alert('Akun admin read-only. Tidak boleh mengubah apa pun.');
    return null;
  }
  const creds = await askConfirm(promptMsg);
  if (!creds) return null;
  const res = await sender(creds);
  if (!res.ok) {
    let msg = 'Gagal: ' + res.status;
    try { const j = await res.json(); if (j && j.error) msg = j.error; }
    catch (_) { try { msg = await res.text(); } catch (__) {} }
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
      body: JSON.stringify({
        ...payload,
        _confirm_user: creds.user,
        _confirm_pass: creds.pass,
      }),
    })
  );
}

// =================================================================
//  Bootstrap (role)
// =================================================================
async function bootstrap() {
  try {
    const me = await fetch('/api/me').then(r => r.json());
    ROLE = me.role;
    $('#who').textContent = `Login: ${me.user} (${me.role})`;
    if (ROLE !== 'dev') {
      // Disable semua kontrol tulis. Tidak ada banner kuning.
      $$('.writer').forEach(el => { el.classList.add('locked'); });
      $$('.writer-input, .writer button, .writer input, .writer textarea, .writer select')
        .forEach(el => { el.disabled = true; });
      $$('button.writer').forEach(el => { el.disabled = true; });
    }
  } catch (e) {
    console.error('me err', e);
  }
}
bootstrap();

// =================================================================
//  Status (polling)
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
  const tbody = $('#map-table tbody');
  tbody.innerHTML = '';
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
    const delBtn = tr.querySelector('[data-del]');
    if (delBtn) delBtn.onclick = async () => {
      const ok = await jsonWrite('DELETE', `/api/maps/${r.id}`, {}, `Yakin hapus map "${r.topic}"?`);
      if (ok) loadMaps();
    };
    tbody.appendChild(tr);
  });
}
function fillMapForm(r) {
  const f = $('#map-form');
  f.id.value = r.id || '';
  f.topic.value = r.topic || '';
  f.tags.value = r.tags || '';
  f.content.value = r.content || '';
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
  // Refresh cache size info (utk tab Config)
  try {
    const cs = await fetch('/api/cache-size').then(r => r.json());
    CACHE_SIZE = cs.bytes; CACHE_LIMIT = cs.limit;
    renderCacheInfo();
  } catch (_) {}
}
function renderHistory() {
  const tbody = $('#history-table tbody');
  tbody.innerHTML = '';
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
    const delBtn = tr.querySelector('[data-del]');
    if (delBtn) delBtn.onclick = async () => {
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
  if (ok) {
    $('#history-editor').hidden = true;
    loadHistory($('#history-search').value);
  }
};
let searchTimer = null;
$('#history-search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadHistory(e.target.value.trim()), 250);
});
$('#history-refresh').onclick = () => loadHistory($('#history-search').value);
$('#history-clear').onclick = async () => {
  const ok = await jsonWrite('DELETE', '/api/history', {},
    'Yakin HAPUS SEMUA cache riwayat chat? Tindakan ini tidak bisa dibatalkan.');
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
//  CONFIG (form fields)
// =================================================================
async function loadConfigFields() {
  const data = await fetch('/api/config-fields').then(r => r.json());
  BOUNDS = data.bounds;
  CACHE_SIZE = data.cacheSizeBytes;
  CACHE_LIMIT = data.cacheLimitBytes;
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
  const el = $('#cfg-cache-info');
  if (!el) return;
  const kb = (CACHE_SIZE / 1024).toFixed(1);
  const limKb = (CACHE_LIMIT / 1024).toFixed(0);
  const over = CACHE_SIZE > CACHE_LIMIT;
  el.className = 'cache-info ' + (over ? 'cache-over' : 'cache-ok');
  el.innerHTML = over
    ? `<b>Peringatan:</b> Cache ingatan ${kb}KB > ${limKb}KB. Ganti nama bot DITOLAK sampai cache dihapus di tab "Riwayat Chat".`
    : `Cache ingatan saat ini: <b>${kb}KB</b> / batas ${limKb}KB. Aman untuk rename.`;
}

$('#config-save').onclick = async () => {
  const payload = {
    name: $('#cfg-name').value.trim(),
    rpmLimit: Number($('#cfg-rpm').value),
    rpdLimit: Number($('#cfg-rpd').value),
    cooldownSec: Number($('#cfg-cd').value),
    reserveTokens: Number($('#cfg-reserve').value),
    similarityThreshold: Number($('#cfg-sim').value),
    maxContextMessages: Number($('#cfg-ctx').value),
    specificTriggers: $('#cfg-triggers').value,
  };
  const ok = await jsonWrite('PUT', '/api/config-fields', payload,
    'Yakin simpan config bot? Beberapa field (nama, keyword, threshold) berlaku langsung tanpa restart.');
  if (ok) {
    const r = await ok.json();
    let txt = 'Config tersimpan.';
    if (r.renamedRows) txt += `\nNama bot direname & ${r.renamedRows} baris cache di-update.`;
    alert(txt);
    loadConfigFields();
  }
};
$('#config-reload').onclick = loadConfigFields;
loadConfigFields();

// =================================================================
//  UPLOAD
// =================================================================
$('#upload-form').onsubmit = async (e) => {
  e.preventDefault();
  if (ROLE !== 'dev') { alert('Akun admin read-only.'); return; }
  const target = e.target.target.value;
  const msg = target === 'bot'
    ? 'Yakin upload bot.js? Bot akan pamit lalu auto-restart.'
    : 'Yakin upload & replace file ini?';
  const creds = await askConfirm(msg);
  if (!creds) return;
  const fd = new FormData(e.target);
  fd.append('_confirm_user', creds.user);
  fd.append('_confirm_pass', creds.pass);
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  const out = await r.text();
  $('#upload-result').textContent = out;
  if (r.ok) {
    e.target.reset();
    loadPersonality(); loadConfigFields();
    if (target === 'bot') {
      alert('Upload sukses. Bot akan pamit & restart dalam ~7 detik. Cek channel Discord.');
    }
  }
};

// =================================================================
//  Helpers
// =================================================================
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
