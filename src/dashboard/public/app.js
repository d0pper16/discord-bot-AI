/* eslint-disable */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

let ROLE = null; // 'dev' | 'admin'

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
//  Setiap aksi tulis (PUT/POST/DELETE) wajib lewat sini.
// =================================================================
function askConfirm(msg = 'Yakin melakukan perubahan? Isi ulang user & password dev.') {
  return new Promise((resolve) => {
    const modal = $('#confirm-modal');
    const userIn = $('#confirm-user');
    const passIn = $('#confirm-pass');
    const errEl  = $('#confirm-error');
    $('#confirm-msg').textContent = msg;
    userIn.value = '';
    passIn.value = '';
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

/**
 * Wrapper: minta konfirmasi → kirim request dengan _confirm_user/_confirm_pass.
 * - Untuk JSON: tambah ke body.
 * - Untuk multipart (FormData): append ke FormData.
 *
 * @param {string} promptMsg
 * @param {()=>Promise<Response>} sender (creds) => fetch
 */
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
    catch (_) { try { msg = await res.text(); } catch(__) {} }
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
//  Bootstrap: cek role -> sembunyikan kontrol tulis untuk admin
// =================================================================
async function bootstrap() {
  try {
    const me = await fetch('/api/me').then(r => r.json());
    ROLE = me.role;
    $('#who').textContent = `Login sebagai: ${me.user} (${me.role})`;
    if (ROLE !== 'dev') {
      // Sembunyikan/disable semua elemen .writer
      $$('.writer').forEach(el => el.classList.add('locked'));
      $$('.writer input, .writer textarea, .writer select, .writer button')
        .forEach(el => { el.disabled = true; });
      // Tambahkan banner read-only
      const ban = document.createElement('div');
      ban.className = 'readonly-banner';
      ban.textContent =
        'Mode READ-ONLY (admin). Hanya bisa memantau, tidak bisa mengubah apa pun.';
      document.body.insertBefore(ban, document.querySelector('header').nextSibling);
    }
  } catch (e) {
    console.error('me err', e);
  }
}
bootstrap();

// =================================================================
//  Status (polling 5dtk)
// =================================================================
async function refreshStatus() {
  try {
    const r = await fetch('/api/status').then(r => r.json());
    const g = r.gemini;
    $('#status').textContent =
      `Channel  : ${r.env.channelId || '-'}\n` +
      `Model    : ${r.env.model}\n` +
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
      <td><b>${esc(r.topic)}</b><br><small>${esc((r.content||'').slice(0,140))}${r.content && r.content.length>140?'…':''}</small></td>
      <td>${esc(r.tags || '')}</td>
      <td class="act">
        <button class="secondary"  data-edit="${r.id}">Edit</button>
        <button class="danger writer" data-del="${r.id}" ${ROLE!=='dev'?'disabled':''}>Hapus</button>
      </td>`;
    tr.querySelector('[data-edit]').onclick = () => fillMapForm(r);
    const delBtn = tr.querySelector('[data-del]');
    if (delBtn) delBtn.onclick = async () => {
      const ok = await jsonWrite('DELETE', `/api/maps/${r.id}`, {},
        `Yakin hapus map "${r.topic}"?`);
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
  const data = {
    topic: f.topic.value.trim(),
    tags: f.tags.value.trim(),
    content: f.content.value,
  };
  const id = f.id.value;
  const url = id ? '/api/maps/' + id : '/api/maps';
  const method = id ? 'PUT' : 'POST';
  const ok = await jsonWrite(method, url, data,
    id ? `Yakin update map id=${id}?` : 'Yakin tambah map baru?');
  if (ok) { fillMapForm({}); loadMaps(); }
};
loadMaps();

// =================================================================
//  HISTORY (search + scroll + edit + delete)
// =================================================================
let HISTORY_ROWS = [];

async function loadHistory(q = '') {
  const url = '/api/history?limit=500' + (q ? '&q=' + encodeURIComponent(q) : '');
  HISTORY_ROWS = await fetch(url).then(r => r.json());
  renderHistory();
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
      <td><div class="cell">${esc((r.answer||'').slice(0,250))}${r.answer && r.answer.length>250?'…':''}</div></td>
      <td><small>${esc(r.source)}</small></td>
      <td class="act">
        <button class="secondary" data-edit="${r.id}">Edit</button>
        <button class="danger writer" data-del="${r.id}" ${ROLE!=='dev'?'disabled':''}>Hapus</button>
      </td>`;
    tr.querySelector('[data-edit]').onclick = () => openHistoryEditor(r);
    const delBtn = tr.querySelector('[data-del]');
    if (delBtn) delBtn.onclick = async () => {
      const ok = await jsonWrite('DELETE', `/api/history/${r.id}`, {},
        `Yakin hapus entry cache id=${r.id}?`);
      if (ok) loadHistory($('#history-search').value);
    };
    tbody.appendChild(tr);
  });
  $('#history-count').textContent = `${HISTORY_ROWS.length} baris`;
}

function openHistoryEditor(r) {
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
  if (ok) alert('Tersimpan. Yanto sudah pakai persona baru.');
};
$('#personality-reload').onclick = loadPersonality;
loadPersonality();

// =================================================================
//  CONFIG
// =================================================================
async function loadConfig() {
  $('#config-editor').value = await fetch('/api/config').then(r => r.text());
}
$('#config-save').onclick = async () => {
  const ok = await jsonWrite('PUT', '/api/config',
    { content: $('#config-editor').value },
    'Yakin simpan perubahan config.json?');
  if (ok) alert('Tersimpan. Hot-reload aktif.');
};
$('#config-reload').onclick = loadConfig;
loadConfig();

// =================================================================
//  UPLOAD
// =================================================================
$('#upload-form').onsubmit = async (e) => {
  e.preventDefault();
  if (ROLE !== 'dev') {
    alert('Akun admin read-only.');
    return;
  }
  const creds = await askConfirm('Yakin upload & replace file ini?');
  if (!creds) return;

  const fd = new FormData(e.target);
  fd.append('_confirm_user', creds.user);
  fd.append('_confirm_pass', creds.pass);

  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  const out = await r.text();
  $('#upload-result').textContent = out;
  if (r.ok) {
    e.target.reset();
    loadPersonality(); loadConfig();
  }
};

// =================================================================
//  helpers
// =================================================================
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
