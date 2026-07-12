// Ficha de BCI: formulário dinâmico + GPS + fotos + fluxo de aprovação.
const TOKEN = localStorage.getItem('bzr_token');
const qs = new URLSearchParams(location.search);
let BCI_ID = qs.get('id') ? Number(qs.get('id')) : null;

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_LABEL = { rascunho: 'Rascunho', enviado: 'Enviado p/ aprovação', aprovado: 'Aprovado', rejeitado: 'Rejeitado', arquivado: 'Arquivado' };

const S = { def: null, campos: {}, bci: null, ponto: null, precisao: null };

async function api(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, { ...opts, headers });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || ('HTTP ' + r.status));
  return r.json();
}
function toast(msg) { const t = el('toast'); t.textContent = msg; t.style.display = 'block'; setTimeout(() => (t.style.display = 'none'), 2200); }

// ---- render das seções dinâmicas ----
function campoHtml(c) {
  const id = 'f_' + c.key;
  const req = c.obrigatorio ? ' <span class="req">*</span>' : '';
  if (c.tipo === 'booleano') return `<div class="fld bool"><input type="checkbox" id="${id}" /><label for="${id}">${esc(c.label)}</label></div>`;
  let input;
  if (c.tipo === 'select') {
    input = `<select id="${id}"><option value="">—</option>${(c.opcoes || []).map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
  } else if (c.tipo === 'inteiro') input = `<input id="${id}" inputmode="numeric" />`;
  else if (c.tipo === 'decimal') input = `<input id="${id}" inputmode="decimal" />`;
  else if (c.tipo === 'data') input = `<input id="${id}" type="date" />`;
  else input = `<input id="${id}" />`;
  return `<div class="fld"><label for="${id}">${esc(c.label)}${req}</label>${input}</div>`;
}
function renderSecoes() {
  el('secoes').innerHTML = (S.def.secoes || []).map((s) => `
    <div class="card"><h2><span class="n">${esc(s.id)}</span> ${esc(s.titulo)}</h2>
      <div class="grid">${(s.campos || []).map(campoHtml).join('')}</div></div>`).join('');
}

// ---- ler / preencher valores ----
function setCampo(c, v) {
  const e = el('f_' + c.key); if (!e) return;
  if (c.tipo === 'booleano') e.checked = v === true || v === 'true';
  else e.value = v == null ? '' : v;
}
function getCampo(c) {
  const e = el('f_' + c.key); if (!e) return undefined;
  if (c.tipo === 'booleano') return e.checked;
  const v = e.value.trim();
  if (v === '') return undefined;
  if (c.tipo === 'inteiro') return parseInt(v, 10);
  if (c.tipo === 'decimal') return Number(v.replace(',', '.'));
  return v;
}
function coletarDados() {
  const dados = {};
  for (const key in S.campos) { const val = getCampo(S.campos[key]); if (val !== undefined && val !== '') dados[key] = val; }
  return dados;
}

function preencher(b) {
  S.bci = b;
  el('titulo').textContent = 'BCI · ' + (b.inscricao || '');
  el('status-pill').textContent = STATUS_LABEL[b.status] || b.status;
  el('status-pill').className = 'st-pill st-' + b.status;
  el('meta').textContent = b.tecnicoNome ? ('Técnico: ' + b.tecnicoNome) : '';
  el('inscricao').value = b.inscricao || '';
  el('municipio').value = b.municipio || '';
  el('bairro').value = b.bairro || '';
  el('uso').value = b.uso || '';
  el('areaTerreno').value = b.areaTerreno ?? '';
  el('areaConstruida').value = b.areaConstruida ?? '';
  el('observacoes').value = b.observacoes || '';
  if (b.ponto) { S.ponto = b.ponto; S.precisao = b.precisaoGps; el('gps-info').textContent = `${b.ponto.lat.toFixed(6)}, ${b.ponto.lng.toFixed(6)}` + (b.precisaoGps ? ` (±${Math.round(b.precisaoGps)}m)` : ''); }
  for (const key in S.campos) if (b.dados && key in b.dados) setCampo(S.campos[key], b.dados[key]);
  // ajuste
  el('aj-geom').checked = !!b.ajuste?.geom;
  el('aj-tipo').value = b.ajuste?.tipo || '';
  el('aj-inscricoes').value = b.ajuste?.inscricoes || '';
  el('aj-obs').value = b.ajuste?.obs || '';
  el('aj-campos').style.display = b.ajuste?.geom ? 'grid' : 'none';
  renderAjusteStatus(b);
  // rejeição
  el('rejeicao').innerHTML = (b.status === 'rejeitado' && b.motivoRejeicao)
    ? `<div class="card" style="border-color:rgba(192,57,43,.4);background:rgba(192,57,43,.08)"><strong style="color:#ef6c60">Rejeitado:</strong> ${esc(b.motivoRejeicao)}</div>` : '';
  renderFotos(b.fotos || []);
  el('fotos-hint').textContent = '';
  el('fotos-acoes').style.display = '';
  aplicarReadonly(b.status);
  renderActions(b.status);
}

function renderAjusteStatus(b) {
  const box = el('aj-status');
  if (b.ajuste?.geom && !b.ajuste?.resolvido) {
    box.innerHTML = `<div style="margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span class="st-pill" style="background:rgba(245,169,74,.16);color:#f6a94a">Ajuste pendente</span>
      <button type="button" class="btn2" id="btn-resolver">✓ Marcar como resolvido</button></div>`;
    el('btn-resolver').addEventListener('click', async () => {
      try { const nb = await api(`/api/bci/${b.id}/ajuste`, { method: 'PATCH', body: JSON.stringify({ resolvido: true }) }); toast('Ajuste marcado como resolvido.'); preencher({ ...nb, fotos: b.fotos }); } catch (e) { alert(e.message); }
    });
  } else if (b.ajuste?.geom && b.ajuste?.resolvido) {
    box.innerHTML = `<div style="margin-top:12px"><span class="st-pill st-aprovado">Ajuste resolvido</span></div>`;
  } else box.innerHTML = '';
}

// ---- read-only por status ----
function aplicarReadonly(status) {
  const ro = ['aprovado', 'arquivado'].includes(status);
  document.querySelectorAll('.wrap input, .wrap select, .wrap textarea').forEach((e) => { e.disabled = ro; });
  document.querySelector('.wrap').classList.toggle('ro', ro);
  el('fotos-acoes').style.display = ro ? 'none' : (BCI_ID ? '' : 'none');
}

// ---- GPS ----
el('btn-gps').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('GPS não disponível neste dispositivo.');
  el('gps-info').textContent = 'Capturando…';
  navigator.geolocation.getCurrentPosition(
    (pos) => { S.ponto = { lat: pos.coords.latitude, lng: pos.coords.longitude }; S.precisao = pos.coords.accuracy; el('gps-info').textContent = `${S.ponto.lat.toFixed(6)}, ${S.ponto.lng.toFixed(6)} (±${Math.round(S.precisao)}m)`; },
    (err) => { el('gps-info').textContent = 'Falha ao capturar GPS: ' + err.message; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// ---- ajuste toggle ----
el('aj-geom').addEventListener('change', () => { el('aj-campos').style.display = el('aj-geom').checked ? 'grid' : 'none'; });

// ---- montar corpo ----
function corpo() {
  return {
    loteId: S.bci?.loteId || null,
    inscricao: el('inscricao').value.trim(),
    municipio: el('municipio').value.trim(),
    bairro: el('bairro').value.trim(),
    uso: el('uso').value,
    areaTerreno: el('areaTerreno').value,
    areaConstruida: el('areaConstruida').value,
    observacoes: el('observacoes').value.trim(),
    dados: coletarDados(),
    ponto: S.ponto,
    precisaoGps: S.precisao,
    ajuste: { geom: el('aj-geom').checked, tipo: el('aj-tipo').value, obs: el('aj-obs').value.trim(), inscricoes: el('aj-inscricoes').value.trim() },
  };
}

async function salvar(enviar) {
  const b = corpo();
  if (!b.inscricao) { el('inscricao').focus(); return toast('Informe a inscrição do lote.'); }
  try {
    let saved;
    if (BCI_ID) {
      saved = await api('/api/bci/' + BCI_ID, { method: 'PUT', body: JSON.stringify(b) });
      if (enviar) saved = await api(`/api/bci/${BCI_ID}/status`, { method: 'PATCH', body: JSON.stringify({ acao: 'enviar' }) });
      toast(enviar ? 'BCI enviado para aprovação.' : 'Rascunho salvo.');
      const full = await api('/api/bci/' + BCI_ID); preencher(full);
    } else {
      saved = await api('/api/bci', { method: 'POST', body: JSON.stringify({ ...b, status: enviar ? 'enviado' : 'rascunho' }) });
      BCI_ID = saved.id;
      history.replaceState(null, '', '/bci/ficha.html?id=' + BCI_ID);
      toast(enviar ? 'BCI enviado para aprovação.' : 'Rascunho criado. Agora você pode anexar fotos.');
      const full = await api('/api/bci/' + BCI_ID); preencher(full);
    }
  } catch (e) { alert(e.message); }
}

async function acao(nome, extra = {}) {
  try {
    await api(`/api/bci/${BCI_ID}/status`, { method: 'PATCH', body: JSON.stringify({ acao: nome, ...extra }) });
    const full = await api('/api/bci/' + BCI_ID); preencher(full);
    toast('Status atualizado.');
  } catch (e) { alert(e.message); }
}

function renderActions(status) {
  const bar = el('actionbar');
  const btn = (txt, cls, fn) => { const b = document.createElement('button'); b.className = 'btn2 ' + cls; b.textContent = txt; b.onclick = fn; return b; };
  bar.innerHTML = '';
  const voltar = btn('← Lista', '', () => (location.href = '/bci/'));
  bar.appendChild(voltar);
  const sp = document.createElement('div'); sp.className = 'spacer'; bar.appendChild(sp);

  if (!BCI_ID) {
    bar.appendChild(btn('Salvar rascunho', '', () => salvar(false)));
    bar.appendChild(btn('Enviar p/ aprovação', 'primary', () => salvar(true)));
    return;
  }
  if (['rascunho', 'rejeitado'].includes(status)) {
    bar.appendChild(btn('Excluir', 'danger', excluir));
    bar.appendChild(btn('Salvar', '', () => salvar(false)));
    bar.appendChild(btn('Enviar p/ aprovação', 'primary', () => salvar(true)));
  } else if (status === 'enviado') {
    bar.appendChild(btn('Salvar', '', () => salvar(false)));
    bar.appendChild(btn('Rejeitar', 'danger', () => { const m = prompt('Motivo da rejeição:'); if (m !== null) acao('rejeitar', { motivo: m }); }));
    bar.appendChild(btn('✓ Aprovar', 'primary', () => acao('aprovar')));
  } else if (status === 'aprovado') {
    bar.appendChild(btn('Arquivar', 'warn', () => acao('arquivar')));
  } else if (status === 'arquivado') {
    bar.appendChild(btn('Reabrir', '', () => acao('reabrir')));
  }
}

async function excluir() {
  if (!confirm('Excluir este BCI?')) return;
  try { await api('/api/bci/' + BCI_ID, { method: 'DELETE' }); location.href = '/bci/'; } catch (e) { alert(e.message); }
}

// ---- fotos ----
function renderFotos(fotos) {
  el('lista-fotos').innerHTML = (fotos || []).map((f) => `
    <div class="foto"><span class="tp">${f.tipo === 'croqui' ? 'Croqui' : 'Geral'}</span>
      ${S.bci && !['aprovado', 'arquivado'].includes(S.bci.status) ? `<button class="rm" data-fid="${f.id}">✕</button>` : ''}
      <img src="${f.imagem}" alt="${esc(f.legenda || '')}" /></div>`).join('');
  el('lista-fotos').querySelectorAll('.rm').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remover foto?')) return;
    try { await api(`/api/bci/${BCI_ID}/fotos/${b.dataset.fid}`, { method: 'DELETE' }); const full = await api('/api/bci/' + BCI_ID); renderFotos(full.fotos); } catch (e) { alert(e.message); }
  }));
}

function reduzir(file) {
  return new Promise((resolve) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1200; let { width: w, height: h } = img;
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
async function enviarFotos(files, tipo) {
  if (!BCI_ID) return toast('Salve o rascunho antes de anexar fotos.');
  const fotos = [];
  for (const f of [...files].slice(0, 10)) { const imagem = await reduzir(f); if (imagem) fotos.push({ imagem, tipo, lat: S.ponto?.lat, lng: S.ponto?.lng }); }
  if (!fotos.length) return;
  try { await api(`/api/bci/${BCI_ID}/fotos`, { method: 'POST', body: JSON.stringify({ fotos }) }); const full = await api('/api/bci/' + BCI_ID); renderFotos(full.fotos); toast(`${fotos.length} foto(s) anexada(s).`); } catch (e) { alert(e.message); }
}
el('in-geral').addEventListener('change', (e) => { enviarFotos(e.target.files, 'geral'); e.target.value = ''; });
el('in-croqui').addEventListener('change', (e) => { enviarFotos(e.target.files, 'croqui'); e.target.value = ''; });

// ---- init ----
async function init() {
  // Formulário do município (prefill via query ?municipio= / ?lote=).
  const muni = qs.get('municipio') || '';
  try { const f = await api('/api/bci/formulario' + (muni ? '?municipio=' + encodeURIComponent(muni) : '')); S.def = f.definicao; }
  catch (e) { el('secoes').innerHTML = `<div class="card">Erro ao carregar formulário: ${esc(e.message)}</div>`; return; }
  S.campos = {}; (S.def.secoes || []).forEach((s) => (s.campos || []).forEach((c) => (S.campos[c.key] = c)));
  renderSecoes();

  if (BCI_ID) {
    try { const b = await api('/api/bci/' + BCI_ID); preencher(b); }
    catch (e) { alert('BCI não encontrado.'); location.href = '/bci/'; return; }
  } else {
    if (qs.get('lote')) el('inscricao').value = qs.get('lote');
    if (muni) el('municipio').value = muni;
    if (qs.get('bairro')) el('bairro').value = qs.get('bairro');
    el('fotos-hint').textContent = '— salve o rascunho para anexar fotos';
    renderActions(null);
  }
}
init();
