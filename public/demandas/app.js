// App de Gestão de Demandas — Kanban, Lista, Minhas, Calendário.
// Login é opcional: quando AUTH_ENABLED está desligado no servidor, o app abre
// direto (sem tela de login) e esconde os elementos ligados a sessão.
let TOKEN = localStorage.getItem('bzr_token');
let AUTH = false;
const NEXT = encodeURIComponent('/demandas/');

const STATUS = [
  { id: 'pendente', label: 'Pendente', dot: '#9AA6A0' },
  { id: 'em_andamento', label: 'Em andamento', dot: '#f6a94a' },
  { id: 'concluida', label: 'Concluída', dot: '#6ee7a8' },
  { id: 'cancelada', label: 'Cancelada', dot: '#ef6c60' },
];
const STATUS_LABEL = Object.fromEntries(STATUS.map((s) => [s.id, s.label]));
const PRIO_LABEL = { urgente: 'Urgente', alta: 'Alta', media: 'Média', baixa: 'Baixa' };

const S = { view: 'kanban', demandas: [], usuarios: [], user: null, editId: null, respSel: new Set() };
const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iniciais = (nome) => (nome || '?').trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

async function authFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, { ...opts, headers });
  if (r.status === 401 && AUTH) { localStorage.removeItem('bzr_token'); location.replace('/login?next=' + NEXT); throw new Error('Sessão expirada'); }
  return r;
}
async function jget(url) { const r = await authFetch(url); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); }

// ---- datas ----
const hoje = () => new Date(new Date().toDateString());
function fmtData(d) { if (!d) return '—'; const x = new Date(d); return x.toLocaleDateString('pt-BR'); }
function atrasada(dem) { return dem.prazo && ['pendente', 'em_andamento'].includes(dem.status) && new Date(dem.prazo) < hoje(); }

// ---- filtros ----
function filtroQS() {
  const p = new URLSearchParams();
  if (el('f-equipe').value) p.set('equipe', el('f-equipe').value);
  if (el('f-prioridade').value) p.set('prioridade', el('f-prioridade').value);
  if (S.view === 'minhas') p.set('responsavel', 'me');
  const q = p.toString();
  return q ? '?' + q : '';
}

// ---- carga ----
async function carregar() {
  const [dem, resumo] = await Promise.all([jget('/api/demandas' + filtroQS()), jget('/api/demandas/resumo')]);
  S.demandas = dem;
  renderResumo(resumo);
  render();
}

function renderResumo(r) {
  const porStatus = Object.fromEntries((r.porStatus || []).map((x) => [x.status, x.n]));
  const abertas = (porStatus.pendente || 0) + (porStatus.em_andamento || 0);
  const minhas = AUTH ? `<div class="stat minhas"><div class="v">${r.minhasAbertas || 0}</div><div class="l">Minhas abertas</div></div>` : '';
  el('resumo').innerHTML = `
    <div class="stat"><div class="v">${abertas}</div><div class="l">Abertas</div></div>
    ${minhas}
    <div class="stat alerta"><div class="v">${r.atrasadas || 0}</div><div class="l">Atrasadas</div></div>
    <div class="stat"><div class="v">${porStatus.concluida || 0}</div><div class="l">Concluídas</div></div>`;
}

// ---- render por view ----
function render() {
  const v = el('view');
  if (!S.demandas.length && S.view !== 'calendario') {
    v.innerHTML = `<div class="empty">Nenhuma demanda ${S.view === 'minhas' ? 'atribuída a você ' : ''}com os filtros atuais.<br>Clique em <strong>＋ Nova demanda</strong> para começar.</div>`;
    return;
  }
  if (S.view === 'kanban' || S.view === 'minhas') return renderKanban();
  if (S.view === 'lista') return renderLista();
  if (S.view === 'calendario') return renderCalendario();
}

function cardHtml(d) {
  const resp = (d.responsaveis || []).map((r) => `<div class="resp" title="${esc(r.nome)}">${esc(iniciais(r.nome))}</div>`).join('');
  const loteRef = [d.municipio, d.loteBairro || d.loteCodigo].filter(Boolean).join(' · ');
  return `<div class="dcard p-${d.prioridade}" draggable="true" data-id="${d.id}">
    <div class="tit">${esc(d.titulo) || '(sem título)'}</div>
    <div class="meta">
      <span class="tag prio-${d.prioridade}">${PRIO_LABEL[d.prioridade]}</span>
      ${d.equipe ? `<span class="tag equipe">${esc(d.equipe)}</span>` : ''}
      ${d.prazo ? `<span class="prazo ${atrasada(d) ? 'atrasado' : ''}">🗓 ${fmtData(d.prazo)}</span>` : ''}
    </div>
    ${loteRef ? `<div class="lote-ref">📍 ${esc(loteRef)}</div>` : ''}
    ${resp ? `<div class="resp-row">${resp}</div>` : ''}
  </div>`;
}

function renderKanban() {
  const cols = STATUS.map((s) => {
    const itens = S.demandas.filter((d) => d.status === s.id);
    return `<div class="col" data-status="${s.id}">
      <div class="col-head"><span><span class="dot" style="background:${s.dot}"></span>${s.label}</span><span class="col-count">${itens.length}</span></div>
      <div class="col-body">${itens.map(cardHtml).join('')}</div>
    </div>`;
  }).join('');
  el('view').innerHTML = `<div class="kanban">${cols}</div>`;
  ligarDragDrop();
  el('view').querySelectorAll('.dcard').forEach((c) => c.addEventListener('click', () => abrirModal(Number(c.dataset.id))));
}

function ligarDragDrop() {
  let arrastando = null;
  el('view').querySelectorAll('.dcard').forEach((c) => {
    c.addEventListener('dragstart', (e) => { arrastando = Number(c.dataset.id); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => (c.style.opacity = '.4'), 0); });
    c.addEventListener('dragend', () => (c.style.opacity = '1'));
  });
  el('view').querySelectorAll('.col').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('drag-over');
      const status = col.dataset.status;
      const dem = S.demandas.find((d) => d.id === arrastando);
      if (!dem || dem.status === status) return;
      dem.status = status; // otimista
      renderKanban();
      try {
        await authFetch(`/api/demandas/${arrastando}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
        carregar();
      } catch { carregar(); }
    });
  });
}

function renderLista() {
  const linhas = S.demandas.map((d) => `<tr data-id="${d.id}">
    <td><strong>${esc(d.titulo) || '(sem título)'}</strong>${d.loteBairro ? `<div style="font-size:11px;color:var(--text-dim)">📍 ${esc(d.loteBairro)}</div>` : ''}</td>
    <td><span class="tag prio-${d.prioridade}">${PRIO_LABEL[d.prioridade]}</span></td>
    <td>${esc(d.equipe) || '—'}</td>
    <td>${(d.responsaveis || []).map((r) => esc(r.nome)).join(', ') || '—'}</td>
    <td class="${atrasada(d) ? 'prazo atrasado' : ''}">${fmtData(d.prazo)}</td>
    <td><span class="st-pill st-${d.status}">${STATUS_LABEL[d.status]}</span></td>
  </tr>`).join('');
  el('view').innerHTML = `<table class="lista">
    <thead><tr><th>Demanda</th><th>Prioridade</th><th>Equipe</th><th>Responsáveis</th><th>Prazo</th><th>Status</th></tr></thead>
    <tbody>${linhas}</tbody></table>`;
  el('view').querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => abrirModal(Number(tr.dataset.id))));
}

function renderCalendario() {
  const ref = hoje();
  const ano = ref.getFullYear(), mes = ref.getMonth();
  const primeiro = new Date(ano, mes, 1);
  const inicio = new Date(primeiro); inicio.setDate(1 - ((primeiro.getDay() + 6) % 7)); // começa na segunda
  const dows = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const porDia = {};
  S.demandas.filter((d) => d.prazo).forEach((d) => { const k = String(d.prazo).slice(0, 10); (porDia[k] = porDia[k] || []).push(d); });
  const corPrio = { urgente: '#ef6c60', alta: '#f6a94a', media: '#7fb5f0', baixa: '#6ee7a8' };
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const dia = new Date(inicio); dia.setDate(inicio.getDate() + i);
    const k = dia.toISOString().slice(0, 10);
    const fora = dia.getMonth() !== mes;
    const eHoje = dia.getTime() === ref.getTime();
    const evs = (porDia[k] || []).map((d) => `<div class="ev" data-id="${d.id}" style="background:${corPrio[d.prioridade]}22;color:${corPrio[d.prioridade]}" title="${esc(d.titulo)}">${esc(d.titulo)}</div>`).join('');
    cells += `<div class="cell ${fora ? 'fora' : ''} ${eHoje ? 'hoje' : ''}"><div class="dnum">${dia.getDate()}</div>${evs}</div>`;
  }
  el('view').innerHTML = `<div style="font-weight:700;margin-bottom:10px;text-transform:capitalize">${ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</div>
    <div class="cal">${dows.map((d) => `<div class="dow">${d}</div>`).join('')}${cells}</div>`;
  el('view').querySelectorAll('.ev').forEach((ev) => ev.addEventListener('click', () => abrirModal(Number(ev.dataset.id))));
}

// ---- modal ----
function pintarResp() {
  el('m-resp').innerHTML = S.usuarios.map((u) =>
    `<div class="resp-opt ${S.respSel.has(u.id) ? 'on' : ''}" data-id="${u.id}">${esc(u.nome)}${u.equipe ? ' · ' + esc(u.equipe) : ''}</div>`
  ).join('') || '<span style="font-size:12px;color:var(--text-dim)">Nenhum usuário cadastrado.</span>';
  el('m-resp').querySelectorAll('.resp-opt').forEach((o) => o.addEventListener('click', () => {
    const id = Number(o.dataset.id);
    if (S.respSel.has(id)) S.respSel.delete(id); else S.respSel.add(id);
    o.classList.toggle('on');
  }));
}

function abrirModal(id) {
  S.editId = id || null;
  S.respSel = new Set();
  const d = id ? S.demandas.find((x) => x.id === id) : null;
  el('modal-titulo').textContent = d ? 'Editar demanda' : 'Nova demanda';
  el('m-titulo').value = d?.titulo || '';
  el('m-descricao').value = d?.descricao || '';
  el('m-equipe').value = d?.equipe || '';
  el('m-prioridade').value = d?.prioridade || 'media';
  el('m-status').value = d?.status || 'pendente';
  el('m-prazo').value = d?.prazo ? String(d.prazo).slice(0, 10) : '';
  el('m-municipio').value = d?.municipio || '';
  el('m-lote').value = d?.loteBairro || d?.loteCodigo || '';
  (d?.responsaveis || []).forEach((r) => S.respSel.add(r.id));
  pintarResp();
  el('m-excluir').style.display = d ? '' : 'none';
  el('overlay').classList.add('open');
}
function fecharModal() { el('overlay').classList.remove('open'); }

async function salvar() {
  const body = {
    titulo: el('m-titulo').value.trim(),
    descricao: el('m-descricao').value.trim(),
    equipe: el('m-equipe').value.trim(),
    prioridade: el('m-prioridade').value,
    status: el('m-status').value,
    prazo: el('m-prazo').value || null,
    municipio: el('m-municipio').value.trim(),
    loteBairro: el('m-lote').value.trim(),
    responsaveis: [...S.respSel].map((id) => ({ id, nome: (S.usuarios.find((u) => u.id === id) || {}).nome || '' })),
  };
  if (!body.titulo) { el('m-titulo').focus(); return; }
  el('m-salvar').disabled = true;
  try {
    const url = S.editId ? '/api/demandas/' + S.editId : '/api/demandas';
    const r = await authFetch(url, { method: S.editId ? 'PUT' : 'POST', body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json()).error || 'Falha ao salvar');
    fecharModal(); await carregar();
  } catch (e) { alert(e.message); }
  el('m-salvar').disabled = false;
}

async function excluir() {
  if (!S.editId || !confirm('Excluir esta demanda?')) return;
  try {
    const r = await authFetch('/api/demandas/' + S.editId, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).error || 'Falha ao excluir');
    fecharModal(); await carregar();
  } catch (e) { alert(e.message); }
}

// ---- init ----
async function init() {
  try { AUTH = (await (await fetch('/api/auth/config')).json()).authEnabled; } catch { AUTH = false; }
  if (AUTH && !TOKEN) { location.replace('/login?next=' + NEXT); return; }

  if (AUTH) {
    try {
      const me = await jget('/api/auth/me');
      S.user = me.user;
      el('userchip').innerHTML = `<div class="avatar" title="${esc(S.user.nome)}">${esc(iniciais(S.user.nome))}</div><span>${esc(S.user.nome.split(' ')[0])} · ${esc(S.user.role)}</span>`;
    } catch { return; }
  } else {
    // Sem login: esconde chip, botao de sair e a aba/atalho "Minhas".
    el('userchip').style.display = 'none';
    el('btn-logout').style.display = 'none';
    const mb = el('views').querySelector('button[data-view="minhas"]');
    if (mb) mb.style.display = 'none';
  }
  try { S.usuarios = await jget('/api/usuarios'); } catch { S.usuarios = []; }

  el('views').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    S.view = b.dataset.view;
    el('views').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    carregar();
  }));
  el('f-equipe').addEventListener('change', carregar);
  el('f-prioridade').addEventListener('change', carregar);
  el('btn-nova').addEventListener('click', () => abrirModal(null));
  el('m-cancelar').addEventListener('click', fecharModal);
  el('modal-fechar').addEventListener('click', fecharModal);
  el('m-salvar').addEventListener('click', salvar);
  el('m-excluir').addEventListener('click', excluir);
  el('overlay').addEventListener('click', (e) => { if (e.target === el('overlay')) fecharModal(); });
  el('btn-logout').addEventListener('click', () => { localStorage.removeItem('bzr_token'); localStorage.removeItem('bzr_user'); location.replace('/login'); });

  await carregar();
}
init();
