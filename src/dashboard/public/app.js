/* eslint-disable */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

let ROLE = null;
let CACHE_SIZE = 0;
let CACHE_LIMIT = 102400;

// ===== Theme =====
(function initTheme() {
  const saved = localStorage.getItem('yantoTheme') || 'dark';
  document.documentElement.dataset.theme = saved;
  updateThemeIcon();
})();
function updateThemeIcon() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $('#btn-theme').textContent = dark ? '\u263C' : '\u263D';
  $('#btn-theme').title = dark ? 'Switch to light' : 'Switch to dark';
}
$('#btn-theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('yantoTheme', next);
  updateThemeIcon();
};

// ===== Tabs =====
$$('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('nav.tabs button').forEach(b => b.classList.remove('active'));
    $$('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'audit')      loadAudit();
    if (btn.dataset.tab === 'logs')       resumeLogPolling();
    if (btn.dataset.tab === 'connection') loadConnection();
    if (btn.dataset.tab === 'monitor')    refreshSystem(true);
    if (btn.dataset.tab === 'roblox')     refreshRoblox(true);
  });
});

// ===== Modals =====
function askConfirm(msg = 'Yakin melakukan perubahan? Isi ulang user & password dev.') {
  return new Promise((resolve) => {
    const modal = $('#confirm-modal');
    $('#confirm-msg').textContent = msg;
    $('#confirm-user').value = ''; $('#confirm-pass').value = '';
    $('#confirm-error').hidden = true;
    modal.hidden = false;
    setTimeout(() => $('#confirm-user').focus(), 50);
    function close(r) {
      modal.hidden = true;
      $('#confirm-ok').onclick = null; $('#confirm-cancel').onclick = null;
      $('#confirm-user').onkeydown = null; $('#confirm-pass').onkeydown = null;
      resolve(r);
    }
    $('#confirm-ok').onclick = () => {
      const u = $('#confirm-user').value.trim(); const p = $('#confirm-pass').value;
      if (!u || !p) { $('#confirm-error').textContent = 'Wajib diisi.'; $('#confirm-error').hidden = false; return; }
      close({ user: u, pass: p });
    };
    $('#confirm-cancel').onclick = () => close(null);
    const onEnter = (ev) => { if (ev.key === 'Enter') $('#confirm-ok').onclick(); };
    $('#confirm-user').onkeydown = onEnter; $('#confirm-pass').onkeydown = onEnter;
  });
}
function askYesNo(message, title = 'Konfirmasi') {
  return new Promise((resolve) => {
    $('#yn-title').textContent = title;
    $('#yn-msg').textContent = message;
    const m = $('#yesno-modal'); m.hidden = false;
    const close = (v) => { m.hidden = true; resolve(v); };
    $('#yn-yes').onclick = () => close(true);
    $('#yn-no').onclick  = () => close(false);
  });
}
function askSuggestion({ message, options }) {
  return new Promise((resolve) => {
    $('#sg-msg').textContent = message;
    const wrap = $('#sg-options'); wrap.innerHTML = '';
    options.forEach(opt => {
      const btn = document.createElement('button');
      btn.textContent = opt.label; btn.className = opt.cls || '';
      btn.style.margin = '4px 4px 4px 0';
      btn.onclick = () => { $('#suggest-modal').hidden = true; resolve(opt.value); };
      wrap.appendChild(btn);
    });
    $('#sg-cancel').onclick = () => { $('#suggest-modal').hidden = true; resolve(null); };
    $('#suggest-modal').hidden = false;
  });
}
function showBusy(title, msg) {
  $('#busy-title').textContent = title; $('#busy-msg').textContent = msg || '';
  $('#busy-overlay').hidden = false;
}
function hideBusy() { $('#busy-overlay').hidden = true; }

async function withConfirm(promptMsg, sender) {
  if (ROLE !== 'dev') { alert('Akun admin read-only.'); return null; }
  const creds = await askConfirm(promptMsg);
  if (!creds) return null;
  const res = await sender(creds);
  if (!res.ok && res.status !== 409 && res.status !== 400) {
    let msg = 'Gagal: ' + res.status;
    try { const j = await res.clone().json(); if (j && j.error) msg = j.error; }
    catch (_) { try { msg = await res.clone().text(); } catch (__) {} }
    alert(msg);
    return null;
  }
  return res;
}

// withConfirmAny: TIDAK cek role -- backend yg validate (dev ATAU admin OK).
// Dipakai utk persona overlay (admin punya hak edit).
async function withConfirmAny(promptMsg, sender) {
  const creds = await askConfirm(promptMsg);
  if (!creds) return null;
  const res = await sender(creds);
  if (!res.ok && res.status !== 409 && res.status !== 400) {
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

// ===== Bootstrap (role) =====
async function bootstrap() {
  try {
    const me = await fetch('/api/me').then(r => r.json());
    ROLE = me.role;
    $('#who').textContent = `Login: ${me.user} (${me.role})`;
    if (ROLE !== 'dev') {
      $$('.writer').forEach(el => el.classList.add('locked'));
      $$('.writer-input, .writer button, .writer input, .writer textarea, .writer select')
        .forEach(el => { el.disabled = true; });
      $('#btn-restart').disabled = true;
      $('#btn-shutdown').disabled = true;
      $('#btn-restart').title  = 'Read-only: hanya akun dev';
      $('#btn-shutdown').title = 'Read-only: hanya akun dev';
    }
  } catch (e) { console.error(e); }
}
bootstrap();

// ===== Header restart/shutdown =====
$('#btn-restart').onclick = async () => {
  if (ROLE !== 'dev') return;
  const ok = await jsonWrite('POST', '/api/restart', {},
    'Restart bot? Bot diam total ~3 detik lalu hidup lagi (TANPA pesan pamit). Setelah hidup ucap "hoamm...".');
  if (!ok) return;
  showBusy('Bot sedang restart...', 'Tunggu ~10 detik.');
  pollForReady();
};
$('#btn-shutdown').onclick = async () => {
  if (ROLE !== 'dev') return;
  const yes = await askYesNo(
    'Yakin matikan bot SECARA TOTAL? Bot ucap pamit lalu mati. Dashboard juga ikut mati.',
    'Matikan Bot Total?'
  );
  if (!yes) return;
  const ok = await jsonWrite('POST', '/api/shutdown', {}, 'Konfirmasi terakhir.');
  if (!ok) return;
  showBusy('Bot sedang dimatikan...', 'Bot ucap pamit ~5 detik lalu offline.');
};
async function pollForReady() {
  const start = Date.now();
  const tick = async () => {
    try { const r = await fetch('/api/me', { cache: 'no-store' }); if (r.ok) { hideBusy(); location.reload(); return; } }
    catch (_) {}
    if (Date.now() - start > 30000) { hideBusy(); alert('Bot tidak kunjung kembali. Cek log.'); return; }
    setTimeout(tick, 1500);
  };
  setTimeout(tick, 4000);
}

// ===== Status pill (header) =====
async function refreshStatus() {
  try {
    const r = await fetch('/api/status').then(r => r.json());
    const g = r.gemini;
    const last = g.lastUsedKey ? ` (active: ${g.lastUsedKey})` : '';
    $('#status').textContent =
      `Channel  : ${r.env.channelId || '-'}\n` +
      `Model    : ${r.env.model}${last}\n` +
      `Reserve  : ${g.reserveTokens || 0} token`;
  } catch (e) { $('#status').textContent = 'status err: ' + e.message; }
}
setInterval(refreshStatus, 5000);
refreshStatus();

// =================================================================
//  SYSTEM MONITOR (CPU / RAM / Disk realtime + 1% disk debounce)
// =================================================================
let lastDiskPercent = null;   // hanya update DOM kalau perubahan >= 1%

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B','KB','MB','GB','TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${u[i]}`;
}
function setBar(el, pct) {
  el.style.width = Math.max(0, Math.min(100, pct)).toFixed(2) + '%';
  el.classList.remove('bar-warn', 'bar-crit');
  if (pct >= 90) el.classList.add('bar-crit');
  else if (pct >= 70) el.classList.add('bar-warn');
}

async function refreshSystem(force = false) {
  if (!force && !$('#tab-monitor').classList.contains('active')) return;
  try {
    const r = await fetch('/api/system').then(r => r.json());
    // RAM
    const mp = r.memory.percent;
    $('#m-mem-pct').textContent = mp.toFixed(1);
    setBar($('#m-mem-bar'), mp);
    $('#m-mem-detail').textContent = `${fmtBytes(r.memory.used)} / ${fmtBytes(r.memory.total)} (free ${fmtBytes(r.memory.free)})`;
    // CPU process
    const cp = r.cpu.processPercent;
    $('#m-cpu-pct').textContent = cp.toFixed(1);
    setBar($('#m-cpu-bar'), cp);
    $('#m-cpu-detail').textContent = `${r.cpu.cores} cores - load avg: ${r.cpu.loadAvg.map(x => x.toFixed(2)).join(' / ')}`;
    // Disk -- hanya update DOM saat perubahan >= 1% kapasitas
    if (r.disk && r.disk.total > 0) {
      const dp = r.disk.percent;
      const shouldUpdate = lastDiskPercent === null || Math.abs(dp - lastDiskPercent) >= 1.0;
      if (shouldUpdate) {
        lastDiskPercent = dp;
        $('#m-disk-pct').textContent = dp.toFixed(1);
        setBar($('#m-disk-bar'), dp);
        $('#m-disk-detail').textContent = `${fmtBytes(r.disk.used)} / ${fmtBytes(r.disk.total)} (free ${fmtBytes(r.disk.free)})`;
      }
    } else {
      $('#m-disk-pct').textContent = 'n/a';
      $('#m-disk-detail').textContent = 'fs.statfsSync tidak tersedia di runtime ini';
    }
    // Process
    $('#m-rss').innerHTML = fmtBytes(r.memory.process.rss);
    $('#m-proc-detail').textContent =
      `pid ${r.proc.pid} - node ${r.proc.node} - ${r.proc.platform} - heap ${fmtBytes(r.memory.process.heapUsed)}/${fmtBytes(r.memory.process.heapTotal)}`;
    // Gemini
    const last = r.gemini.lastUsedKey;
    $('#prim-rpm').textContent = r.gemini.primary.rpm;
    $('#prim-rpd').textContent = r.gemini.primary.rpd;
    $('#prim-cd').textContent  = r.gemini.primary.cooldownMs > 0 ? `${(r.gemini.primary.cooldownMs/1000).toFixed(0)}s` : 'idle';
    $('#sec-rpm').textContent = r.gemini.secondary.rpm;
    $('#sec-rpd').textContent = r.gemini.secondary.rpd;
    $('#sec-cd').textContent  = r.gemini.secondary.cooldownMs > 0 ? `${(r.gemini.secondary.cooldownMs/1000).toFixed(0)}s` : 'idle';
    $('#prim-badge').hidden = last !== 'PRIMARY';
    $('#sec-badge').hidden  = last !== 'SECONDARY';
    $('#api-primary').classList.toggle('api-active', last === 'PRIMARY');
    $('#api-secondary').classList.toggle('api-active', last === 'SECONDARY');
  } catch (e) { /* swallow */ }
}
setInterval(() => refreshSystem(false), 2000);
refreshSystem(true);

// =================================================================
//  SERVER LOGS (polling 1.5s)
// =================================================================
let logsLastTs = 0;
let LOG_LINES = [];
const MAX_VIEWER_LINES = 1500;
let logsPollHandle = null;

function appendLogLine(e) {
  LOG_LINES.push(e);
  if (LOG_LINES.length > MAX_VIEWER_LINES) LOG_LINES.shift();
  renderOneLogLine(e);
}
function renderOneLogLine(e) {
  if (!matchesLogFilter(e)) return;
  const out = $('#logs-output');
  const div = document.createElement('div');
  div.className = 'log-line log-' + e.level;
  const dt = new Date(e.ts);
  const tsStr = `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:${String(dt.getSeconds()).padStart(2,'0')}`;
  div.textContent = `[${tsStr}] [${e.level.toUpperCase().padEnd(5)}] ${e.msg}`;
  out.appendChild(div);
  while (out.childNodes.length > MAX_VIEWER_LINES) out.removeChild(out.firstChild);
  if ($('#logs-autoscroll').checked) out.scrollTop = out.scrollHeight;
}
function matchesLogFilter(e) {
  const lvl = $('#logs-level').value;
  if (lvl !== 'all' && e.level !== lvl) return false;
  const f = $('#logs-filter').value.trim().toLowerCase();
  if (f && !e.msg.toLowerCase().includes(f)) return false;
  return true;
}
function rerenderLogs() {
  const out = $('#logs-output'); out.innerHTML = '';
  for (const e of LOG_LINES) renderOneLogLine(e);
}
async function pollLogs() {
  try {
    const r = await fetch('/api/logs?since=' + logsLastTs);
    const d = await r.json();
    for (const e of d.entries) {
      if (e.ts > logsLastTs) logsLastTs = e.ts;
      appendLogLine(e);
    }
  } catch (_) {}
}
function resumeLogPolling() {
  if (logsPollHandle) return;
  pollLogs();
  logsPollHandle = setInterval(() => {
    if ($('#tab-logs').classList.contains('active')) pollLogs();
  }, 1500);
}
$('#logs-level').addEventListener('change', rerenderLogs);
$('#logs-filter').addEventListener('input', () => { clearTimeout(window._lf); window._lf = setTimeout(rerenderLogs, 200); });
$('#logs-clear').onclick = () => { LOG_LINES = []; $('#logs-output').innerHTML = ''; };

// =================================================================
//  CONNECTION
// =================================================================
async function loadConnection() {
  try {
    const r = await fetch('/api/connection').then(r => r.json());
    $('#conn-channel').value = r.channelId || '';
    $('#conn-channel-cur').textContent = r.channelId
      ? `Aktif: ${r.channelId}`
      : 'Belum di-set. Bot akan TIDUR sampai ini diisi.';
    $('#conn-primary-cur').textContent  = r.primaryMask  ? `Aktif: ${r.primaryMask}`  : 'Belum di-set.';
    $('#conn-secondary-cur').textContent = r.secondaryMask ? `Aktif: ${r.secondaryMask}` : 'Belum di-set.';
    $('#conn-primary').value = '';
    $('#conn-secondary').value = '';
    $('#conn-errors').hidden = true;
  } catch (e) { console.error(e); }
}
$('#conn-reload').onclick = loadConnection;
$('#conn-form').onsubmit = async (e) => {
  e.preventDefault();
  if (ROLE !== 'dev') { alert('Akun admin read-only.'); return; }
  const payload = {};
  const ch = $('#conn-channel').value.trim();
  const pk = $('#conn-primary').value.trim();
  const sk = $('#conn-secondary').value.trim();
  if (ch) payload.channelId    = ch;
  if (pk) payload.primaryKey   = pk;
  if (sk) payload.secondaryKey = sk;
  if (!Object.keys(payload).length) { alert('Tidak ada perubahan.'); return; }

  $('#conn-errors').hidden = true;
  const ok = await jsonWrite('PUT', '/api/connection', payload,
    'Yakin update connection? Server akan VALIDASI dulu sebelum save. Jika valid, bot akan ucap "hello" di channel.');
  if (!ok) return;
  if (ok.status === 400) {
    const data = await ok.json();
    if (data.errors) {
      const msgs = Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join('\n');
      $('#conn-errors').textContent = 'Validasi gagal:\n' + msgs;
      $('#conn-errors').hidden = false;
      return;
    }
  }
  if (ok.ok) {
    const data = await ok.json();
    if (data.ok) {
      alert(`Connection tersimpan + tervalidasi. Bot ucap hello di channel.`);
    } else {
      alert(`Connection tersimpan tapi bot masih TIDUR. apiOk=${data.apiOk}, chOk=${data.chOk}. Cek Server Logs.`);
    }
    loadConnection();
  }
};

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
  const box = $('#history-editor'); box.hidden = false;
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
  const ok = await jsonWrite('DELETE', '/api/history', {}, 'Yakin HAPUS SEMUA cache?');
  if (ok) loadHistory();
};
loadHistory();

// =================================================================
//  PERSONALITY (overlay only, admin & dev keduanya bisa edit)
// =================================================================
async function loadPersonaOverlay() {
  try {
    const r = await fetch('/api/persona-overlay').then(r => r.json());
    const v = r.overlay || '';
    $('#po-content').value = v;
    updateOverlayStatus(v);
  } catch (e) { console.error(e); }
}
function updateOverlayStatus(v) {
  const el = $('#po-status');
  $('#po-counter').textContent = (v || '').length;
  if (v && v.trim()) {
    el.className = 'cache-info cache-ok';
    el.innerHTML = `<b>Overlay AKTIF</b> (${v.length}/500 char). Bot pakai BASE PERSONA + overlay ini.`;
  } else {
    el.className = 'cache-info';
    el.innerHTML = `<b>Overlay KOSONG</b>. Bot pakai BASE PERSONA dari script saja (default).`;
  }
}
$('#po-content').addEventListener('input', (e) => updateOverlayStatus(e.target.value));
$('#po-save').onclick = async () => {
  const overlay = $('#po-content').value;
  if (overlay.length > 500) { alert('Max 500 karakter.'); return; }
  // pakai withConfirmAny supaya admin juga bisa
  const ok = await withConfirmAny(
    'Yakin simpan overlay gaya bicara? Admin & dev keduanya boleh.',
    (creds) => fetch('/api/persona-overlay', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overlay, _confirm_user: creds.user, _confirm_pass: creds.pass }),
    })
  );
  if (ok) {
    alert('Overlay tersimpan. Bot otomatis pakai gaya bicara baru di pertanyaan berikutnya.');
    loadPersonaOverlay();
  }
};
$('#po-reset').onclick = async () => {
  const yes = await askYesNo('Hapus overlay -> bot kembali ke BASE PERSONA dari script. Lanjutkan?', 'Reset Overlay');
  if (!yes) return;
  const ok = await withConfirmAny(
    'Konfirmasi reset overlay (kosongkan).',
    (creds) => fetch('/api/persona-overlay', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overlay: '', _confirm_user: creds.user, _confirm_pass: creds.pass }),
    })
  );
  if (ok) {
    alert('Overlay di-reset. Bot kembali ke BASE PERSONA.');
    loadPersonaOverlay();
  }
};
$('#po-reload').onclick = loadPersonaOverlay;
loadPersonaOverlay();

// =================================================================
//  ROBLOX WATCHER (universe ID + status)
// =================================================================
async function loadRobloxConfig() {
  try {
    const r = await fetch('/api/roblox-config').then(r => r.json());
    $('#rb-uid').value = r.universeId || '';
  } catch (e) { console.error(e); }
}
$('#rb-reload').onclick = () => { loadRobloxConfig(); refreshRoblox(true); };
$('#rb-save').onclick = async () => {
  const universeId = $('#rb-uid').value.trim();
  if (universeId !== '' && !/^\d{1,20}$/.test(universeId)) {
    alert('Universe ID harus angka 1-20 digit (atau kosong utk disable).');
    return;
  }
  const ok = await jsonWrite('PUT', '/api/roblox-config', { universeId },
    universeId ? `Yakin set Universe ID = ${universeId}? Watcher akan dijalankan.`
               : 'Yakin disable watcher (kosongkan Universe ID)?');
  if (ok) {
    const d = await ok.json();
    alert(d.universeId ? `Watcher ON untuk universe ${d.universeId}` : 'Watcher OFF.');
    refreshRoblox(true);
  }
};

function fmtAgo(ms) {
  if (!ms) return 'belum pernah';
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return s + ' detik lalu';
  if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  return Math.floor(s / 86400) + ' hari lalu';
}
async function refreshRoblox(force = false) {
  if (!force && !$('#tab-roblox').classList.contains('active')) return;
  try {
    const s = await fetch('/api/roblox-status').then(r => r.json());
    const wrap = $('#rb-status');
    if (!s.enabled) {
      wrap.innerHTML = `
        <div class="metric-card" style="grid-column:1/-1;text-align:center;padding:32px">
          <div class="metric-label" style="justify-content:center">Watcher OFF</div>
          <div style="color:var(--text-muted);font-size:13px">Universe ID belum diset. Isi field di atas dan klik "Simpan &amp; Mulai Watch".</div>
        </div>`;
      $('#rb-error').hidden = true;
      return;
    }
    const playerStr = s.playing != null ? s.playing.toLocaleString() : '...';
    const visitsStr = s.visits  != null ? s.visits.toLocaleString()  : '...';
    const favStr    = s.favorited != null ? s.favorited.toLocaleString() : '-';
    wrap.innerHTML = `
      <div class="metric-card">
        <div class="metric-label">Map Name</div>
        <div class="metric-value" style="font-size:18px">${esc(s.name || 'loading...')}</div>
        <div class="metric-sub">Universe ID: <code>${esc(s.universeId)}</code></div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Players Online <span class="badge-active">live</span></div>
        <div class="metric-value">${playerStr}</div>
        <div class="metric-sub">update tiap 1 menit - terakhir: ${fmtAgo(s.lastPlayingUpdate)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total Visits</div>
        <div class="metric-value" style="font-size:24px">${visitsStr}</div>
        <div class="metric-sub">update tiap 1 jam - terakhir: ${fmtAgo(s.lastVisitsUpdate)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Favorited</div>
        <div class="metric-value" style="font-size:22px">${favStr}</div>
        <div class="metric-sub">started ${fmtAgo(s.startedAt)}</div>
      </div>`;
    if (s.error) {
      $('#rb-error').textContent = `[${fmtAgo(s.lastErrorAt)}] ${s.error}`;
      $('#rb-error').hidden = false;
    } else {
      $('#rb-error').hidden = true;
    }
  } catch (e) { /* swallow */ }
}
setInterval(() => refreshRoblox(false), 15000);
loadRobloxConfig();
refreshRoblox(true);

// =================================================================
//  CONFIG
// =================================================================
async function loadConfigFields() {
  const data = await fetch('/api/config-fields').then(r => r.json());
  CACHE_SIZE = data.cacheSizeBytes; CACHE_LIMIT = data.cacheLimitBytes;
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
    : `Cache ingatan saat ini: <b>${kb}KB</b> / batas ${limKb}KB.`;
}
async function saveConfig(force = false) {
  const payload = {
    name: $('#cfg-name').value.trim(),
    rpmLimit: Number($('#cfg-rpm').value),
    cooldownSec: Number($('#cfg-cd').value),
    reserveTokens: Number($('#cfg-reserve').value),
    similarityThreshold: Number($('#cfg-sim').value),
    maxContextMessages: Number($('#cfg-ctx').value),
    specificTriggers: $('#cfg-triggers').value,
    force,
  };
  return jsonWrite('PUT', '/api/config-fields', payload, 'Yakin simpan config?');
}
$('#config-save').onclick = async () => {
  const r = await saveConfig(false); if (!r) return;
  if (r.status === 409) {
    const data = await r.json();
    if (data.requiresForce) {
      const yes = await askYesNo(data.message, 'Cache > 100KB');
      if (!yes) { alert('Dibatalkan.'); return; }
      const r2 = await saveConfig(true);
      if (!r2 || !r2.ok) return;
      const d = await r2.json();
      alert(`Tersimpan. Cache dihapus: ${d.clearedRows || 0} baris.`);
      loadConfigFields(); loadHistory(); return;
    }
  }
  if (r.ok) {
    const d = await r.json();
    alert(`Tersimpan.${d.renamedRows ? ` Cache rewrite: ${d.renamedRows} baris.` : ''}`);
    loadConfigFields(); loadHistory();
  }
};
$('#config-reload').onclick = loadConfigFields;
loadConfigFields();

// =================================================================
//  FILE MANAGER
// =================================================================
let CURRENT_FILE = null;
async function loadFiles() {
  const data = await fetch('/api/files').then(r => r.json());
  const tbody = $('#files-table tbody'); tbody.innerHTML = '';
  data.files.forEach(f => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${esc(f.path)}</code>${f.protected ? ' <span class="tag-protected">protected</span>' : ''}</td>
      <td><small>${(f.size/1024).toFixed(2)} KB</small></td>
      <td class="act"><button class="secondary" data-open="${esc(f.path)}">Open</button></td>`;
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
    alert(`Tersimpan: ${d.path}${d.restarting ? ' - bot auto-restart.' : ''}`);
    if (d.restarting) { showBusy('Bot restart...', 'Bot ucap "hoamm..." setelah ~10 detik.'); pollForReady(); }
    loadFiles();
  }
};
$('#fe-delete').onclick = async () => {
  if (!CURRENT_FILE) return;
  const yes = await askYesNo(`Hapus file ${CURRENT_FILE.path}?`, 'Hapus File');
  if (!yes) return;
  const ok = await jsonWrite('DELETE', '/api/files/delete', { path: CURRENT_FILE.path }, `Konfirmasi hapus.`);
  if (ok) { $('#files-editor').hidden = true; CURRENT_FILE = null; loadFiles(); }
};
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
    { path: rel, content: $('#nf-content').value }, `Yakin buat: ${rel}?`);
  if (ok) {
    const d = await ok.json();
    alert(`Dibuat: ${d.path}`);
    loadFiles(); openFileEditor(d.path);
  }
};
$('#files-upload-btn').onclick = () => $('#files-upload-input').click();
$('#files-upload-input').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const dir = $('#files-upload-dir').value.trim();
  e.target.value = '';
  await runUpload(file, dir, 'auto', null);
};
async function runUpload(file, dir, mode, targetPath) {
  const creds = await askConfirm(`Yakin upload "${file.name}" (${(file.size/1024).toFixed(2)} KB) ke ${dir || 'root'}?`);
  if (!creds) return;
  const fd = new FormData();
  fd.append('file', file); fd.append('dir', dir); fd.append('mode', mode);
  if (targetPath) fd.append('target_path', targetPath);
  fd.append('_confirm_user', creds.user); fd.append('_confirm_pass', creds.pass);
  const r = await fetch('/api/files/upload', { method: 'POST', body: fd });
  if (r.ok) {
    const d = await r.json();
    alert(`Upload ${d.mode}: ${d.path}${d.restarting ? ' (auto-restart)' : ''}`);
    if (d.restarting) { showBusy('Bot restart...', 'Bot ucap "hoamm..." setelah ~10 detik.'); pollForReady(); }
    loadFiles();
    return;
  }
  if (r.status === 409) {
    const data = await r.json();
    let options = [];
    if (data.status === 'exists') {
      options = [{ label: `Update file existing (${data.targetPath})`, value: { mode: 'update', target_path: data.targetPath }, cls: 'danger' }];
    } else if (data.status === 'ambiguous') {
      options = [
        ...data.suggestions.map(s => ({
          label: `Update existing ${s.path} (Lev=${s.distance})`,
          value: { mode: 'update', target_path: s.path }, cls: 'secondary',
        })),
        { label: `Tambah file baru: ${data.targetPath}`, value: { mode: 'create', target_path: data.targetPath } },
      ];
    } else if (data.status === 'new') {
      options = [{ label: `Tambah file baru: ${data.targetPath}`, value: { mode: 'create', target_path: data.targetPath } }];
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
//  Quick Upload
// =================================================================
$('#upload-form').onsubmit = async (e) => {
  e.preventDefault();
  if (ROLE !== 'dev') { alert('Akun admin read-only.'); return; }
  const target = e.target.target.value;
  const file   = e.target.file.files[0];
  if (!file) return;
  const targetPathMap = { personality: 'src/ai/personality.js', config: 'config.json', bot: 'src/bot.js' };
  const expected = targetPathMap[target].split('/').pop().toLowerCase();
  if ((file.name || '').toLowerCase() !== expected) {
    alert(`Nama file harus persis "${expected}".`);
    return;
  }
  await runUpload(file, target === 'config' ? '' : (target === 'personality' ? 'src/ai' : 'src'), 'update', targetPathMap[target]);
  e.target.reset();
  loadPersonality(); loadConfigFields();
};

// =================================================================
//  AUDIT
// =================================================================
async function loadAudit(q = '') {
  const url = '/api/audit?limit=500' + (q ? '&q=' + encodeURIComponent(q) : '');
  const rows = await fetch(url).then(r => r.json());
  const tbody = $('#audit-table tbody'); tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    const dt = new Date(r.created_at * 1000);
    const dts = dt.toISOString().slice(0,19).replace('T',' ');
    tr.innerHTML = `
      <td><small>${dts}</small></td>
      <td><code>${esc(r.user)}</code></td>
      <td><span class="audit-action">${esc(r.action)}</span></td>
      <td><code>${esc(r.target || '-')}</code></td>
      <td><div class="cell"><small>${esc(r.details || '')}</small></div></td>`;
    tbody.appendChild(tr);
  });
  $('#audit-count').textContent = `${rows.length} entri`;
}
let auditTimer = null;
$('#audit-search').addEventListener('input', (e) => {
  clearTimeout(auditTimer);
  auditTimer = setTimeout(() => loadAudit(e.target.value.trim()), 250);
});
$('#audit-refresh').onclick = () => loadAudit($('#audit-search').value);

// =================================================================
//  DB Backup
// =================================================================
$('#db-export').onclick = async () => {
  try {
    const r = await fetch('/api/db/export'); if (!r.ok) { alert('export gagal: ' + r.status); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `yanto-db-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e) { alert('export error: ' + e.message); }
};
$('#db-import-form').onsubmit = async (e) => {
  e.preventDefault();
  if (ROLE !== 'dev') { alert('Akun admin read-only.'); return; }
  const f = e.target;
  const file = f.file.files[0]; if (!file) return;
  const mode = f.mode.value;
  const includeMaps    = f.includeMaps.checked;
  const includeHistory = f.includeHistory.checked;
  if (!includeMaps && !includeHistory) { alert('Pilih minimal 1 tabel.'); return; }
  if (mode === 'replace') {
    const yes = await askYesNo('Mode REPLACE akan menghapus data existing. Lanjutkan?', 'Replace DB');
    if (!yes) return;
  }
  let content;
  try { content = await file.text(); } catch (err) { alert(err.message); return; }
  try { JSON.parse(content); } catch (err) { alert('JSON invalid: ' + err.message); return; }
  const ok = await jsonWrite('POST', '/api/db/import',
    { content, mode, includeMaps, includeHistory },
    `Yakin import? Mode=${mode}.`);
  if (ok) {
    const d = await ok.json();
    $('#db-import-result').textContent = JSON.stringify(d, null, 2);
    alert(`Import sukses. +${d.mapInserted} maps, +${d.histInserted} history.`);
    loadMaps(); loadHistory();
  }
};

loadFiles();

// =================================================================
//  Helpers
// =================================================================
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
