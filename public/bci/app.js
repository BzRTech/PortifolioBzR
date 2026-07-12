// Lista de BCIs: resumo, filtros, mapa dos pontos coletados.
const TOKEN = localStorage.getItem('bzr_token');
const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_LABEL = { rascunho: 'Rascunho', enviado: 'Enviado', aprovado: 'Aprovado', rejeitado: 'Rejeitado', arquivado: 'Arquivado' };
const COR = { rascunho: '#9AA6A0', enviado: '#7fb5f0', aprovado: '#1FBF63', rejeitado: '#ef6c60', arquivado: '#94a3b8' };

async function api(url) {
  const headers = {}; if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

let map, camada;
function initMapa() {
  map = L.map('mapa', { zoomControl: true }).setView([-7.12, -34.86], 12);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 20 }).addTo(map);
  camada = L.layerGroup().addTo(map);
  // Recalcula o tamanho após o grid assentar (evita render fora da célula).
  setTimeout(() => map.invalidateSize(), 60);
  window.addEventListener('resize', () => map.invalidateSize());
}
async function carregarMapa() {
  try {
    const pts = await api('/api/bci/mapa');
    camada.clearLayers();
    const bounds = [];
    for (const p of pts) {
      const cor = p.ajuste ? '#f6a94a' : (COR[p.status] || '#9AA6A0');
      L.circleMarker([p.lat, p.lng], { radius: 7, color: '#0A0F0C', weight: 1.5, fillColor: cor, fillOpacity: 0.95 })
        .bindPopup(`<b>${esc(p.inscricao)}</b><br>${STATUS_LABEL[p.status] || p.status}${p.ajuste ? ' · ⚠ ajuste' : ''}<br><a href="/bci/ficha.html?id=${p.id}">Abrir BCI →</a>`)
        .addTo(camada);
      bounds.push([p.lat, p.lng]);
    }
    map.invalidateSize();
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  } catch { /* mapa vazio */ }
}

async function carregarResumo() {
  try {
    const r = await api('/api/bci/resumo');
    const por = Object.fromEntries((r.porStatus || []).map((x) => [x.status, x.n]));
    const total = Object.values(por).reduce((s, n) => s + n, 0);
    el('resumo').innerHTML = `
      <div class="stat" data-f=""><div class="v">${total}</div><div class="l">Total de BCIs</div></div>
      <div class="stat enviado" data-f="enviado"><div class="v">${por.enviado || 0}</div><div class="l">Aguardando aprovação</div></div>
      <div class="stat aprovado" data-f="aprovado"><div class="v">${por.aprovado || 0}</div><div class="l">Aprovados</div></div>
      <div class="stat rejeitado" data-f="rejeitado"><div class="v">${por.rejeitado || 0}</div><div class="l">Rejeitados</div></div>
      <div class="stat ajuste" data-aj="1"><div class="v">${r.ajustesAbertos || 0}</div><div class="l">Ajustes de geometria</div></div>`;
    el('resumo').querySelectorAll('.stat').forEach((s) => s.addEventListener('click', () => {
      if (s.dataset.aj) { el('f-ajuste').checked = true; el('f-status').value = ''; }
      else { el('f-status').value = s.dataset.f || ''; el('f-ajuste').checked = false; }
      carregarLista();
    }));
  } catch { /* ignore */ }
}

async function carregarLista() {
  const p = new URLSearchParams();
  if (el('f-status').value) p.set('status', el('f-status').value);
  if (el('f-ajuste').checked) p.set('ajuste', '1');
  if (el('q').value.trim()) p.set('q', el('q').value.trim());
  const q = p.toString();
  try {
    const lista = await api('/api/bci' + (q ? '?' + q : ''));
    if (!lista.length) { el('lista').innerHTML = `<div class="empty" style="grid-column:1/-1">Nenhum BCI ${q ? 'com esses filtros' : 'cadastrado'}.<br><a class="btn2 primary" style="margin-top:12px" href="/bci/ficha.html">＋ Novo BCI</a></div>`; return; }
    el('lista').innerHTML = lista.map((b) => `
      <div class="bcard" onclick="location.href='/bci/ficha.html?id=${b.id}'">
        <div class="top"><span class="insc">${esc(b.inscricao) || '(sem inscrição)'}</span><span class="st-pill st-${b.status}">${STATUS_LABEL[b.status]}</span></div>
        <div class="loc">📍 ${esc([b.municipio, b.bairro].filter(Boolean).join(' · ')) || '—'}${b.uso ? ' · ' + esc(b.uso) : ''}</div>
        <div class="foot">
          ${b.tecnicoNome ? `<span>👤 ${esc(b.tecnicoNome)}</span>` : ''}
          ${b.nFotos ? `<span>📷 ${b.nFotos}</span>` : ''}
          ${b.ponto ? '<span>📌 GPS</span>' : ''}
          ${b.ajuste?.geom && !b.ajuste?.resolvido ? '<span class="tag-aj">⚠ ajuste geom.</span>' : ''}
        </div>
      </div>`).join('');
  } catch (e) { el('lista').innerHTML = `<div class="empty" style="grid-column:1/-1">Erro: ${esc(e.message)}</div>`; }
}

let buscaTimer;
el('q').addEventListener('input', () => { clearTimeout(buscaTimer); buscaTimer = setTimeout(carregarLista, 300); });
el('f-status').addEventListener('change', carregarLista);
el('f-ajuste').addEventListener('change', carregarLista);

initMapa();
carregarResumo();
carregarLista();
carregarMapa();
