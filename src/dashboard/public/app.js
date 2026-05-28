/* eslint-disable */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

// ===== Tabs =====
$$('nav.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('nav.tabs button').forEach(b => b.classList.remove('active'));
    $$('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ===== Status =====
async function refreshStatus() {
  try {
    const r = await fetch('/api/status').then(r => r.json());
    const g = r.gemini;
    $('#status').textContent =
      `Channel: ${r.env.channelId || '-'}  |  Model: ${r.env.model}\n` +
      `PRIMARY   rpm=${g.primary.rpm}  rpd=${g.primary.rpd}  cd=${g.primary.cooldownMs}ms\n` +
      `SECONDARY rpm=${g.secondary.rpm}  rpd=${g.secondary.rpd}  cd=${g.secondary.cooldownMs}ms`;
  } catch (e) { $('#status').textContent = 'status err: ' + e.message; }
}
setInterval(refreshStatus, 5000);
refreshStatus();

// ===== MAPS =====
async function loadMaps() {
  const rows = await fetch('/api/maps').then(r => r.json());
  const tbody = $('#map-table tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.id}</td>
      <td><b>${escapeHtml(r.topic)}</b><br><small>${escapeHtml((r.content||'').slice(0,120))}...</small></td>
      <td>${escapeHtml(r.tags || '')}</td>
      <td class="act">
        <button data-edit="${r.id}">Edit</button>
        <button class="danger" data-del="${r.id}">Hapus</button>
      </td>`;
    tr.querySelector('[data-edit]').onclick = () => fillMapForm(r);
    tr.querySelector('[data-del]').onclick = async () => {
      if (!confirm('Hapus map "' + r.topic + '"?')) return;
      await fetch('/api/maps/' + r.id, { method: 'DELETE' });
      loadMaps();
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
  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) { alert('gagal: ' + (await res.text())); return; }
  fillMapForm({});
  loadMaps();
};
loadMaps();

// ===== HISTORY =====
async function loadHistory() {
  const rows = await fetch('/api/history?limit=200').then(r => r.json());
  const tbody = $('#history-table tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.id}</td>
      <td>${escapeHtml(r.user_id)}</td>
      <td>${escapeHtml(r.question)}</td>
      <td>${escapeHtml((r.answer||'').slice(0,200))}${r.answer && r.answer.length>200?'...':''}</td>
      <td>${escapeHtml(r.source)}</td>
      <td><button class="danger" data-del="${r.id}">Hapus</button></td>`;
    tr.querySelector('[data-del]').onclick = async () => {
      await fetch('/api/history/' + r.id, { method: 'DELETE' });
      loadHistory();
    };
    tbody.appendChild(tr);
  });
}
$('#history-refresh').onclick = loadHistory;
$('#history-clear').onclick = async () => {
  if (!confirm('Hapus SEMUA riwayat chat?')) return;
  await fetch('/api/history', { method: 'DELETE' });
  loadHistory();
};
loadHistory();

// ===== PERSONALITY =====
async function loadPersonality() {
  $('#personality-editor').value = await fetch('/api/personality').then(r => r.text());
}
$('#personality-save').onclick = async () => {
  const r = await fetch('/api/personality', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: $('#personality-editor').value }),
  });
  alert(r.ok ? 'tersimpan, hot-reload aktif.' : 'gagal: ' + await r.text());
};
$('#personality-reload').onclick = loadPersonality;
loadPersonality();

// ===== CONFIG =====
async function loadConfig() {
  $('#config-editor').value = await fetch('/api/config').then(r => r.text());
}
$('#config-save').onclick = async () => {
  const r = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: $('#config-editor').value }),
  });
  alert(r.ok ? 'tersimpan, hot-reload aktif.' : 'gagal: ' + await r.text());
};
$('#config-reload').onclick = loadConfig;
loadConfig();

// ===== UPLOAD =====
$('#upload-form').onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const r = await fetch('/api/upload', { method: 'POST', body: fd });
  const out = await r.text();
  $('#upload-result').textContent = out;
  if (r.ok) {
    loadPersonality(); loadConfig();
  }
};

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
