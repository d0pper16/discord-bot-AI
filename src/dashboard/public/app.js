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
    if (btn.dataset.tab === 'chatlog')    { loadChatLog(); loadChatStats(); }
    if (btn.dataset.tab === 'custmem')    loadCustomMemory();
    if (btn.dataset.tab === 'connection') loadConnection();
    if (btn.dataset.tab === 'monitor')    refreshSystem(true);
    if (btn.dataset.tab === 'roblox')     refreshRoblox(true);
    if (btn.dataset.tab === 'maps')       loadMaps();
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
    const apiActive = g.activeKeyNum ? `API ke-${g.activeKeyNum}` : '-';
    $('#status').textContent =
      `Channel  : ${r.env.channelId || '-'}\n` +
      `Model    : ${r.env.model}\n` +
      `Active   : ${apiActive}  (keys configured: ${g.keysConfigured}/5)\n` +
      `Total RPM: ${g.totalRpm} / ${g.rpmBudget}  |  RPD: ${g.totalRpd} / ${g.rpdBudget}`;
  } catch (e) { $('#status').textContent = 'status err: ' + e.message; }
}
setInterval(refreshStatus, 10000);
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
  if (!force && document.hidden) return;
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
    // Gemini per-key status (5 slots)
    const g = r.gemini;
    if (g && Array.isArray(g.keys) && g.keys.length === 5 && $('#api-grid')) {
      $('#api-grid').innerHTML = g.keys.map((k) => {
        if (!k.configured) {
          return `
            <div class="metric-card api-card">
              <div class="metric-label">API ke-${k.num} <span style="color:var(--text-dim);font-size:10px">empty</span></div>
              <div class="metric-sub" style="text-align:center;padding:8px 0">slot kosong</div>
            </div>`;
        }
        const active = g.activeKey === k.id;
        const badge = active ? '<span class="badge-active">active</span>'
                    : k.banned ? '<span style="background:var(--danger);color:white;padding:1px 6px;border-radius:3px;font-size:10px">banned</span>'
                    : k.cooldownMs > 0 ? `<span style="background:var(--warning);color:#1e293b;padding:1px 6px;border-radius:3px;font-size:10px">cooldown ${(k.cooldownMs/1000).toFixed(0)}s</span>`
                    : k.lastError ? '<span style="background:var(--warning);color:#1e293b;padding:1px 6px;border-radius:3px;font-size:10px">error</span>'
                    : '<span style="background:var(--success);color:white;padding:1px 6px;border-radius:3px;font-size:10px">ok</span>';
        return `
          <div class="metric-card api-card${active ? ' api-active' : ''}">
            <div class="metric-label">API ke-${k.num} ${badge}</div>
            <div class="metric-row"><span>RPM</span><b>${k.rpm}</b></div>
            <div class="metric-row"><span>RPD</span><b>${k.rpd}</b></div>
            ${k.lastError ? `<div class="metric-sub" style="color:var(--danger);font-size:10px">${esc(k.lastError.msg.slice(0, 60))}</div>` : ''}
          </div>`;
      }).join('');
    }
    if ($('#api-summary')) {
      $('#api-summary').textContent =
        `Total RPM: ${g.totalRpm} / ${g.rpmBudget} (sisa ${g.rpmBudget - g.totalRpm}). ` +
        `Total RPD: ${g.totalRpd} / ${g.rpdBudget} (sisa ${g.rpdBudget - g.totalRpd}). ` +
        `Active: ${g.activeKeyNum ? 'API ke-' + g.activeKeyNum : '-'}.`;
    }
  } catch (e) { /* swallow */ }
}
setInterval(() => refreshSystem(false), 5000);
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
    for (let i = 1; i <= 5; i++) {
      const inp  = $(`#conn-key${i}`);
      const cur  = $(`#conn-key${i}-cur`);
      if (inp) inp.value = '';
      const mask = r[`key${i}Mask`];
      if (cur) cur.textContent = mask ? `Aktif: ${mask}` : 'Slot kosong (tidak ter-konfigurasi)';
    }
    $('#conn-errors').hidden = true;
  } catch (e) { console.error(e); }
}
$('#conn-reload').onclick = loadConnection;
$('#conn-form').onsubmit = async (e) => {
  e.preventDefault();
  if (ROLE !== 'dev') { alert('Akun admin read-only.'); return; }
  const payload = {};
  const ch = $('#conn-channel').value.trim();
  if (ch) payload.channelId = ch;
  for (let i = 1; i <= 5; i++) {
    const v = $(`#conn-key${i}`).value.trim();
    if (v) payload[`key${i}`] = v;
  }
  if (!Object.keys(payload).length) { alert('Tidak ada perubahan.'); return; }

  $('#conn-errors').hidden = true;
  const ok = await jsonWrite('PUT', '/api/connection', payload,
    'Yakin update connection? Server akan VALIDASI tiap key sebelum save. Jika valid, bot akan ucap "hello" di channel.');
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
    id ? `Yakin update map id=${id}?` : `Yakin simpan map "${data.topic}"? (auto-replace kalau topic sama sudah ada)`);
  if (ok) { fillMapForm({}); loadMaps(); }
};
$('#map-clear-all').onclick = async () => {
  const yes = await askYesNo(
    'Yakin HAPUS SEMUA MAP? DB jadi kosong. Bot akan respon "database kosong" utk pertanyaan map spesifik (Roblox umum tetap dijawab).',
    'Kosongkan DB Map'
  );
  if (!yes) return;
  const ok = await jsonWrite('DELETE', '/api/maps', {}, 'Konfirmasi: hapus semua map.');
  if (ok) {
    const d = await ok.json();
    alert(`${d.deleted} map dihapus. DB sekarang kosong.`);
    loadMaps();
  }
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

/**
 * Format compact ala Indonesia:
 *   142 -> "142", 1234 -> "1.2 rb", 5234123 -> "5.2 jt",
 *   1234000000 -> "1.2 m", 999999 -> "999 rb"
 */
function fmtCompact(n) {
  if (typeof n !== 'number' || isNaN(n)) return '...';
  if (n < 1000) return String(n);
  const units = [
    { v: 1e12, s: 't'  },
    { v: 1e9,  s: 'm'  },
    { v: 1e6,  s: 'jt' },
    { v: 1e3,  s: 'rb' },
  ];
  for (const u of units) {
    if (n >= u.v) {
      const x = n / u.v;
      const str = x >= 100 ? Math.floor(x).toString()
                : x.toFixed(1).replace(/\.0$/, '');
      return str + ' ' + u.s;
    }
  }
  return String(n);
}
async function refreshRoblox(force = false) {
  if (!force && !$('#tab-roblox').classList.contains('active')) return;
  if (!force && document.hidden) return;
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
      $('#rb-header').hidden = true;
      return;
    }

    // Header card with image + map name
    const header = $('#rb-header');
    if (header) {
      header.hidden = false;
      const placeUrl = s.rootPlaceId ? `https://www.roblox.com/games/${s.rootPlaceId}` : '#';
      $('#rb-icon').src = s.iconUrl || '';
      $('#rb-icon').alt = s.name || 'map';
      $('#rb-icon').style.display = s.iconUrl ? '' : 'none';
      $('#rb-icon-skel').style.display = s.iconUrl ? 'none' : '';
      $('#rb-name').textContent = s.name || 'loading...';
      $('#rb-name-link').href = placeUrl;
      $('#rb-uid-display').textContent = s.universeId || '-';
      $('#rb-uptime').textContent = fmtAgo(s.startedAt);
      $('#rb-desc').textContent = s.description || '';
      $('#rb-thumbnail').src = s.thumbnailUrl || '';
      $('#rb-thumbnail').style.display = s.thumbnailUrl ? '' : 'none';
    }

    // Metrics: compact + raw
    const playing = s.playing;
    const visits  = s.visits;
    const fav     = s.favorited;
    wrap.innerHTML = `
      <div class="metric-card">
        <div class="metric-label">Current Players <span class="badge-active">live</span></div>
        <div class="metric-value">${playing != null ? playing.toLocaleString() : '...'}</div>
        <div class="metric-sub">${playing != null ? `<b>${esc(fmtCompact(playing))}</b> player online` : '-'} - update tiap 1 menit</div>
        <div class="metric-sub">terakhir: ${fmtAgo(s.lastPlayingUpdate)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total Visits</div>
        <div class="metric-value" style="font-size:24px">${visits != null ? visits.toLocaleString() : '...'}</div>
        <div class="metric-sub">${visits != null ? `<b>${esc(fmtCompact(visits))}</b> total visit` : '-'} - update tiap 1 jam</div>
        <div class="metric-sub">terakhir: ${fmtAgo(s.lastVisitsUpdate)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Favorited</div>
        <div class="metric-value" style="font-size:22px">${fav != null ? fav.toLocaleString() : '...'}</div>
        <div class="metric-sub">${fav != null ? `<b>${esc(fmtCompact(fav))}</b> favorit` : '-'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Quick Status</div>
        <div class="metric-value" style="font-size:14px;line-height:1.4">
          current players: <b>${playing != null ? playing.toLocaleString() : '...'}</b><br>
          total visits: ${visits != null ? `+${esc(fmtCompact(visits))}` : '...'}
        </div>
        <div class="metric-sub" style="margin-top:8px">summary card</div>
      </div>`;

    if (s.error) {
      $('#rb-error').textContent = `[${fmtAgo(s.lastErrorAt)}] ${s.error}`;
      $('#rb-error').hidden = false;
    } else {
      $('#rb-error').hidden = true;
    }
  } catch (e) { /* swallow */ }
}
setInterval(() => refreshRoblox(false), 60000);  // 1 menit, match server-side tickPlayer
loadRobloxConfig();
refreshRoblox(true);

// Pause polling saat tab browser tidak aktif (hemat CPU/bandwidth/battery).
// Resume + fetch sekali saat tab kembali visible.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && $('#tab-roblox').classList.contains('active')) {
    refreshRoblox(true);
  }
});

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
let REPLACE_TARGET_PATH = null; // path untuk per-row Replace flow

async function loadFiles() {
  const data = await fetch('/api/files').then(r => r.json());
  const tbody = $('#files-table tbody'); tbody.innerHTML = '';
  data.files.forEach(f => {
    const tr = document.createElement('tr');
    const protBadge = f.protected ? ' <span class="tag-protected" title="restart auto saat replace">protected</span>' : '';
    tr.innerHTML = `
      <td><code>${esc(f.path)}</code>${protBadge}</td>
      <td><small>${(f.size/1024).toFixed(2)} KB</small></td>
      <td class="act">
        <button class="secondary" data-open="${esc(f.path)}">Open</button>
        <button class="writer" data-replace="${esc(f.path)}" ${ROLE!=='dev'?'disabled':''} title="Upload file pengganti (nama harus sama)">Replace</button>
      </td>`;
    tr.querySelector('[data-open]').onclick = () => openFileEditor(f.path);
    const repBtn = tr.querySelector('[data-replace]');
    if (repBtn) repBtn.onclick = () => {
      REPLACE_TARGET_PATH = f.path;
      $('#files-replace-input').click();
    };
    tbody.appendChild(tr);
  });
}
$('#files-refresh').onclick = loadFiles;

// Per-file Replace flow (button per row -> hidden input file -> POST /api/files/replace)
$('#files-replace-input').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !REPLACE_TARGET_PATH) { REPLACE_TARGET_PATH = null; return; }
  const target = REPLACE_TARGET_PATH;
  REPLACE_TARGET_PATH = null;

  const expectedName = target.split('/').pop();
  if (file.name.toLowerCase() !== expectedName.toLowerCase()) {
    alert(`Nama file tidak cocok.\nTarget : ${expectedName}\nUpload : ${file.name}\n\nUntuk REPLACE, nama file harus persis sama. Rename file kamu lalu coba lagi.`);
    return;
  }

  const creds = await askConfirm(`Yakin REPLACE ${target} dengan "${file.name}" (${(file.size/1024).toFixed(2)} KB)?`);
  if (!creds) return;

  const fd = new FormData();
  fd.append('file', file);
  fd.append('target_path', target);
  fd.append('_confirm_user', creds.user);
  fd.append('_confirm_pass', creds.pass);

  const r = await fetch('/api/files/replace', { method: 'POST', body: fd });
  if (!r.ok) {
    let msg = 'Gagal replace: ' + r.status;
    try { const j = await r.json(); if (j.error) msg = j.error; } catch (_) {}
    alert(msg);
    return;
  }
  const d = await r.json();
  alert(d.message || `${d.path} berhasil di-replace.`);
  if (d.restarting) {
    showBusy('Bot restart (file protected)...', 'Bot otomatis restart setelah replace file core. Tunggu ~10 detik.');
    pollForReady();
  }
  loadFiles();
};

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
    `Yakin simpan ${CURRENT_FILE.path}?${CURRENT_FILE.protected ? ' (file protected, akan auto-restart bot)' : ''}`);
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

// Upload File BARU (typo guard tetap aktif, untuk file yang belum ada)
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
      // File sudah ada -> arahkan ke tombol Replace per file (bukan auto update)
      alert(`File ${data.targetPath} sudah ada.\n\nGunakan tombol REPLACE pada file tsb di tabel.\n(Upload File hanya untuk menambah file BARU.)`);
      return;
    } else if (data.status === 'ambiguous') {
      options = [
        ...data.suggestions.map(s => ({
          label: `Replace existing ${s.path} (typo? Lev=${s.distance})`,
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

// (Quick Upload tab dihapus per req. user -- Replace per file lewat tombol di File Manager)

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
//  DB Backup -- per tabel terpisah, format BERBEDA per tabel
//    map_data    -> .json
//    chat_history-> .csv
//    raw bot.db  -> .db (binary SQLite)
// =================================================================
function downloadFromUrl(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}
async function downloadResp(endpoint, defaultName) {
  try {
    const r = await fetch(endpoint);
    if (!r.ok) { alert(`Download gagal: ${r.status}`); return; }
    // Extract filename dari Content-Disposition kalau ada
    let filename = defaultName;
    const cd = r.headers.get('Content-Disposition');
    if (cd) {
      const m = cd.match(/filename="([^"]+)"/);
      if (m) filename = m[1];
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    downloadFromUrl(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) { alert('Download error: ' + e.message); }
}

$('#db-export-maps').onclick    = () => downloadResp('/api/db/backup/maps',    'map_data.json');
$('#db-export-history').onclick = () => downloadResp('/api/db/backup/history', 'chat_history.csv');
$('#db-export-raw').onclick     = () => downloadResp('/api/db/backup/raw',     'bot.db');

// Import map_data (JSON)
$('#db-import-maps-form').onsubmit = async (e) => {
  e.preventDefault();
  if (ROLE !== 'dev') { alert('Akun admin read-only.'); return; }
  const f = e.target;
  const file = f.file.files[0]; if (!file) return;
  const mode = f.mode.value;
  if (mode === 'replace') {
    const yes = await askYesNo('Mode REPLACE akan menghapus SEMUA map_data existing. Lanjutkan?', 'Replace map_data');
    if (!yes) return;
  }
  let content;
  try { content = await file.text(); } catch (err) { alert(err.message); return; }
  try { JSON.parse(content); } catch (err) { alert('JSON invalid: ' + err.message); return; }
  const ok = await jsonWrite('POST', '/api/db/import/maps',
    { content, mode },
    `Yakin import map_data? Mode=${mode}.`);
  if (ok) {
    const d = await ok.json();
    $('#db-import-maps-result').textContent = JSON.stringify(d, null, 2);
    alert(`Import map_data sukses. +${d.inserted} rows${d.cleared ? `, replaced ${d.cleared}` : ''}.`);
    loadMaps();
  }
};

// Import chat_history (CSV atau JSON)
$('#db-import-history-form').onsubmit = async (e) => {
  e.preventDefault();
  if (ROLE !== 'dev') { alert('Akun admin read-only.'); return; }
  const f = e.target;
  const file = f.file.files[0]; if (!file) return;
  const mode = f.mode.value;
  if (mode === 'replace') {
    const yes = await askYesNo('Mode REPLACE akan menghapus SEMUA chat_history existing. Lanjutkan?', 'Replace chat_history');
    if (!yes) return;
  }
  let content;
  try { content = await file.text(); } catch (err) { alert(err.message); return; }
  const ok = await jsonWrite('POST', '/api/db/import/history',
    { content, mode },
    `Yakin import chat_history? Mode=${mode}.`);
  if (ok) {
    const d = await ok.json();
    $('#db-import-history-result').textContent = JSON.stringify(d, null, 2);
    alert(`Import chat_history sukses. +${d.inserted} rows${d.cleared ? `, replaced ${d.cleared}` : ''}.`);
    loadHistory();
  }
};

loadFiles();

// =================================================================
//  CHAT LOG + Top 10 Chart (req. user)
// =================================================================
async function loadChatStats() {
  try {
    const data = await fetch('/api/chat-stats').then(r => r.json());
    const wrap = $('#chatlog-chart');
    if (!data.topUsers || !data.topUsers.length) {
      wrap.innerHTML = '<div class="hint">Belum ada chat log. Top 10 akan muncul setelah ada pertanyaan.</div>';
      return;
    }
    const max = Math.max(...data.topUsers.map(u => u.count));
    wrap.innerHTML = data.topUsers.map((u, i) => {
      const pct = max > 0 ? (u.count / max) * 100 : 0;
      const lastDt = u.last_asked ? new Date(u.last_asked * 1000) : null;
      const lastStr = lastDt ? lastDt.toISOString().slice(0, 16).replace('T', ' ') : '-';
      return `
        <div class="chart-row">
          <div class="chart-rank">#${i + 1}</div>
          <div class="chart-name">
            <b>${esc(u.username)}</b>
            <small><code>${esc(u.discord_id)}</code></small>
          </div>
          <div class="chart-bar-wrap">
            <div class="chart-bar" style="width:${pct.toFixed(1)}%"></div>
            <span class="chart-count">${u.count} pertanyaan</span>
          </div>
          <div class="chart-meta"><small>terakhir: ${lastStr}</small></div>
        </div>`;
    }).join('');
  } catch (e) { console.error(e); }
}

async function loadChatLog(q = '') {
  const url = '/api/chat-log?limit=500' + (q ? '&q=' + encodeURIComponent(q) : '');
  const data = await fetch(url).then(r => r.json());
  const tbody = $('#chatlog-table tbody');
  tbody.innerHTML = '';
  for (const r of data.entries) {
    const askedDt    = new Date((r.asked_at || 0) * 1000);
    const answeredDt = new Date((r.answered_at || 0) * 1000);
    const askHHMM    = `${String(askedDt.getHours()).padStart(2,'0')}:${String(askedDt.getMinutes()).padStart(2,'0')}`;
    const ansHHMM    = `${String(answeredDt.getHours()).padStart(2,'0')}:${String(answeredDt.getMinutes()).padStart(2,'0')}`;
    const askFull    = askedDt.toISOString().slice(0, 19).replace('T', ' ');
    const ansFull    = answeredDt.toISOString().slice(0, 19).replace('T', ' ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${esc(askFull)}"><b>${askHHMM}</b></td>
      <td title="${esc(ansFull)}"><b>${ansHHMM}</b></td>
      <td>${esc(r.username || '-')}</td>
      <td><code style="font-size:11px">${esc(r.discord_id || '-')}</code></td>
      <td><div class="cell">${esc(r.question)}</div></td>
      <td><div class="cell">${esc((r.answer || '').slice(0, 250))}${r.answer && r.answer.length > 250 ? '...' : ''}</div></td>
      <td><small>${esc(r.source || '-')}</small></td>`;
    tbody.appendChild(tr);
  }
  $('#chatlog-count').textContent = `${data.entries.length} ditampilkan / ${data.total} total (max 1000)`;
}
let chatlogTimer = null;
$('#chatlog-search').addEventListener('input', (e) => {
  clearTimeout(chatlogTimer);
  chatlogTimer = setTimeout(() => loadChatLog(e.target.value.trim()), 250);
});
$('#chatlog-refresh').onclick = () => { loadChatLog($('#chatlog-search').value); loadChatStats(); };
$('#chatlog-clear').onclick = async () => {
  const yes = await askYesNo(
    'Yakin hapus SEMUA chat log? Persistent data di SQLite akan dihapus permanen. Tindakan ini tidak bisa di-undo.',
    'Hapus Semua Chat Log'
  );
  if (!yes) return;
  const ok = await jsonWrite('DELETE', '/api/chat-log', {}, 'Konfirmasi terakhir: hapus semua chat log.');
  if (ok) {
    const d = await ok.json();
    alert(`${d.deleted} entries dihapus.`);
    loadChatLog();
    loadChatStats();
  }
};
loadChatLog();
loadChatStats();

// =================================================================
//  CUSTOM MEMORY (Ingatan Buatan)
// =================================================================
let CUSTMEM_ROWS = [];

async function loadCustomMemory(q = '') {
  const url = '/api/custom-memory' + (q ? '?q=' + encodeURIComponent(q) : '');
  const data = await fetch(url).then(r => r.json());
  CUSTMEM_ROWS = data.entries || [];
  const tbody = $('#custmem-table tbody');
  tbody.innerHTML = '';
  CUSTMEM_ROWS.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.id}</td>
      <td><div class="cell">${esc(r.question)}</div></td>
      <td><div class="cell">${esc((r.answer || '').slice(0, 250))}${r.answer && r.answer.length > 250 ? '...' : ''}</div></td>
      <td>${esc(r.tags || '')}</td>
      <td class="act">
        <button class="secondary" data-edit="${r.id}">Edit</button>
        <button class="danger writer" data-del="${r.id}" ${ROLE !== 'dev' ? 'disabled' : ''}>Hapus</button>
      </td>`;
    tr.querySelector('[data-edit]').onclick = () => fillCustMemForm(r);
    const del = tr.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      const ok = await jsonWrite('DELETE', `/api/custom-memory/${r.id}`, {},
        `Yakin hapus ingatan buatan id=${r.id}?`);
      if (ok) loadCustomMemory($('#custmem-search').value);
    };
    tbody.appendChild(tr);
  });
  $('#custmem-count').textContent = `${CUSTMEM_ROWS.length} ingatan / ${data.total} total`;
}
function fillCustMemForm(r) {
  const f = $('#custmem-form');
  f.id.value       = r.id || '';
  f.question.value = r.question || '';
  f.answer.value   = r.answer || '';
  f.tags.value     = r.tags || '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#custmem-reset').onclick = () => fillCustMemForm({});
$('#custmem-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const data = {
    question: f.question.value.trim(),
    answer:   f.answer.value.trim(),
    tags:     f.tags.value.trim(),
  };
  if (!data.question || !data.answer) { alert('Pertanyaan & jawaban wajib.'); return; }
  const id = f.id.value;
  const url = id ? `/api/custom-memory/${id}` : '/api/custom-memory';
  const method = id ? 'PUT' : 'POST';
  const ok = await jsonWrite(method, url, data,
    id ? `Yakin update ingatan buatan id=${id}?` : 'Yakin tambah ingatan buatan baru?');
  if (ok) {
    fillCustMemForm({});
    loadCustomMemory($('#custmem-search').value);
  }
};
let custmemTimer = null;
$('#custmem-search').addEventListener('input', (e) => {
  clearTimeout(custmemTimer);
  custmemTimer = setTimeout(() => loadCustomMemory(e.target.value.trim()), 250);
});
$('#custmem-refresh').onclick = () => loadCustomMemory($('#custmem-search').value);
loadCustomMemory();

// =================================================================
//  Helpers
// =================================================================
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
