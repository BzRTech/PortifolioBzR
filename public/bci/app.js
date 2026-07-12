// Lista de BCIs com mapa dos LOTES importados, coloridos por status de cadastro.
// Clicar num lote abre (ou inicia) o BCI daquele lote.
const TOKEN = localStorage.getItem('bzr_token');
const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_LABEL = { rascunho: 'Rascunho', enviado: 'Enviado', aprovado: 'Aprovado', rejeitado: 'Rejeitado', arquivado: 'Arquivado' };
const COR = { rascunho: '#9AA6A0', enviado: '#7fb5f0', aprovado: '#1FBF63', rejeitado: '#ef6c60', arquivado: '#94a3b8' };
const COR_SEM = '#2A362E';

const S = { municipio: '', bcis: [], inscMap: new Map(), loteLayers: new Map() };

async function api(url) {
  const headers = {}; if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

// ---- mapa ----
let map, renderer, lotesLayer;
function initMapa() {
  map = L.map('mapa', { zoomControl: true, preferCanvas: true }).setView([-7.12, -34.86], 12);

  // Camadas base (troca pelo controle no canto superior direito).
  const escuro = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 20 });
  const claro = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 });
  const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Imagery &copy; Esri', maxZoom: 20 });
  escuro.addTo(map);
  L.control.layers({ 'Mapa escuro': escuro, 'Mapa claro': claro, 'Satélite': satelite }, null, { position: 'topright' }).addTo(map);

  renderer = L.canvas({ padding: 0.5 });
  window.addEventListener('resize', () => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 60);
}

function statusDoLote(codigo) { return S.inscMap.get(String(codigo || '')); }
function corDoLote(codigo) {
  const b = statusDoLote(codigo);
  if (!b) return COR_SEM;
  return b.ajuste ? '#f6a94a' : (COR[b.status] || COR_SEM);
}
function estiloLote(f) {
  const cod = f.properties?.codigo;
  const b = statusDoLote(cod);
  const cor = corDoLote(cod);
  return { color: b ? cor : '#3a4a40', weight: b ? 1.1 : 0.5, fillColor: cor, fillOpacity: b ? 0.55 : 0.28 };
}
function popupLote(p) {
  const b = statusDoLote(p.codigo);
  const q = new URLSearchParams();
  if (p.codigo) q.set('lote', p.codigo);
  if (p.municipio) q.set('municipio', p.municipio);
  if (p.bairro) q.set('bairro', p.bairro);
  const acao = b
    ? `<a href="/bci/ficha.html?id=${b.id}">Abrir BCI (${STATUS_LABEL[b.status] || b.status})${b.ajuste ? ' · ⚠ ajuste' : ''} →</a>`
    : `<a href="/bci/ficha.html?${q.toString()}">🏠 Preencher BCI →</a>`;
  return `<div style="font-weight:700;margin-bottom:4px">Lote ${esc(p.codigo || '')}</div>`
    + `<div style="font-size:12px;color:var(--text-dim)">${esc(p.bairro || '')}${p.uso ? ' · ' + esc(p.uso) : ''}</div>`
    + `<div style="margin-top:6px">${acao}</div>`;
}

async function carregarLotes() {
  if (lotesLayer) { map.removeLayer(lotesLayer); lotesLayer = null; }
  S.loteLayers.clear();
  if (!S.municipio) return;
  el('lista').classList.add('carregando');
  try {
    const fc = await api(`/api/layers/lotes?municipio=${encodeURIComponent(S.municipio)}&simplify=0.00003`);
    lotesLayer = L.geoJSON(fc, {
      renderer, style: estiloLote,
      onEachFeature: (feat, layer) => {
        const cod = String(feat.properties?.codigo || '');
        if (cod) S.loteLayers.set(cod, layer);
        layer.bindPopup(popupLote(feat.properties || {}), { maxWidth: 260 });
      },
    }).addTo(map);
    // enquadra
    try { const { extent } = await api(`/api/extent?municipio=${encodeURIComponent(S.municipio)}`); if (extent) map.fitBounds([[extent[1], extent[0]], [extent[3], extent[2]]], { padding: [20, 20], maxZoom: 16 }); }
    catch { if (lotesLayer.getBounds().isValid()) map.fitBounds(lotesLayer.getBounds(), { padding: [20, 20] }); }
  } catch (e) { console.error('lotes:', e.message); }
  el('lista').classList.remove('carregando');
}

// ---- dados BCI ----
async function carregarBcis() {
  S.bcis = await api('/api/bci');
  S.inscMap = new Map();
  for (const b of S.bcis) {
    const chave = String(b.inscricao || '');
    if (chave) S.inscMap.set(chave, { id: b.id, status: b.status, ajuste: b.ajuste?.geom && !b.ajuste?.resolvido });
  }
}
function recolorir() { if (lotesLayer) lotesLayer.setStyle(estiloLote); }

async function carregarResumo() {
  try {
    const r = await api('/api/bci/resumo');
    const por = Object.fromEntries((r.porStatus || []).map((x) => [x.status, x.n]));
    const total = Object.values(por).reduce((s, n) => s + n, 0);
    el('resumo').innerHTML = `
      <div class="stat total" data-f=""><div class="v">${total}</div><div class="l">Total de BCIs</div></div>
      <div class="stat enviado" data-f="enviado"><div class="v">${por.enviado || 0}</div><div class="l">Aguardando aprovação</div></div>
      <div class="stat aprovado" data-f="aprovado"><div class="v">${por.aprovado || 0}</div><div class="l">Aprovados</div></div>
      <div class="stat" data-f="rejeitado"><div class="v">${por.rejeitado || 0}</div><div class="l">Rejeitados</div></div>
      <div class="stat ajuste" data-aj="1"><div class="v">${r.ajustesAbertos || 0}</div><div class="l">Ajustes de geometria</div></div>`;
    el('resumo').querySelectorAll('.stat').forEach((s) => s.addEventListener('click', () => {
      if (s.dataset.aj) { el('f-ajuste').checked = true; el('f-status').value = ''; }
      else { el('f-status').value = s.dataset.f || ''; el('f-ajuste').checked = false; }
      carregarLista();
    }));
  } catch { /* ignore */ }
}

function focarLote(codigo) {
  const layer = S.loteLayers.get(String(codigo));
  if (layer) { try { map.fitBounds(layer.getBounds(), { maxZoom: 18, padding: [40, 40] }); layer.openPopup(); } catch { /* ponto */ } }
}

async function carregarLista() {
  const p = new URLSearchParams();
  if (S.municipio) p.set('municipio', S.municipio);
  if (el('f-status').value) p.set('status', el('f-status').value);
  if (el('f-ajuste').checked) p.set('ajuste', '1');
  if (el('q').value.trim()) p.set('q', el('q').value.trim());
  try {
    const lista = await api('/api/bci?' + p.toString());
    if (!lista.length) { el('lista').innerHTML = `<div class="empty">Nenhum BCI ${p.toString() ? 'com esses filtros' : 'cadastrado'}.<br><br>Clique num lote no mapa para iniciar, ou em <strong>＋ Novo BCI</strong>.</div>`; return; }
    el('lista').innerHTML = lista.map((b) => `
      <div class="bcard" data-cod="${esc(b.inscricao)}" data-id="${b.id}">
        <div class="top"><span class="insc">${esc(b.inscricao) || '(sem inscrição)'}</span><span class="st-pill st-${b.status}">${STATUS_LABEL[b.status]}</span></div>
        <div class="loc">📍 ${esc([b.bairro].filter(Boolean).join(' · ')) || '—'}${b.uso ? ' · ' + esc(b.uso) : ''}</div>
        <div class="foot">
          ${b.tecnicoNome ? `<span>👤 ${esc(b.tecnicoNome)}</span>` : ''}
          ${b.nFotos ? `<span>📷 ${b.nFotos}</span>` : ''}
          ${b.ponto ? '<span>📌 GPS</span>' : ''}
          ${b.ajuste?.geom && !b.ajuste?.resolvido ? '<span class="tag-aj">⚠ ajuste geom.</span>' : ''}
        </div>
      </div>`).join('');
    el('lista').querySelectorAll('.bcard').forEach((c) => {
      c.addEventListener('click', (e) => {
        // clique simples foca no lote; clique no título abre o BCI
        if (e.detail === 2) { location.href = '/bci/ficha.html?id=' + c.dataset.id; return; }
        el('lista').querySelectorAll('.bcard').forEach((x) => x.classList.remove('hl'));
        c.classList.add('hl');
        focarLote(c.dataset.cod);
      });
      c.addEventListener('dblclick', () => (location.href = '/bci/ficha.html?id=' + c.dataset.id));
    });
  } catch (e) { el('lista').innerHTML = `<div class="empty">Erro: ${esc(e.message)}</div>`; }
}

async function trocarMunicipio() {
  S.municipio = el('municipio').value;
  const novoBtn = '/bci/ficha.html' + (S.municipio ? '?municipio=' + encodeURIComponent(S.municipio) : '');
  el('btn-novo').href = novoBtn;
  await carregarBcis();
  recolorir();
  await carregarLotes();
  recolorir();
  await carregarLista();
}

async function init() {
  initMapa();
  let municipios = [];
  try { municipios = await api('/api/municipios'); } catch { municipios = []; }
  if (municipios.length) {
    el('municipio').innerHTML = municipios.map((m) => `<option>${esc(m)}</option>`).join('');
    S.municipio = municipios[0];
    el('municipio').value = S.municipio;
  } else {
    el('municipio').innerHTML = '<option value="">(sem lotes importados)</option>';
  }
  el('municipio').addEventListener('change', trocarMunicipio);
  el('f-status').addEventListener('change', carregarLista);
  el('f-ajuste').addEventListener('change', carregarLista);
  let t; el('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(carregarLista, 300); });

  await carregarResumo();
  await carregarBcis();
  await carregarLotes();
  recolorir();
  await carregarLista();
}
init();
