// Utilitarios compartilhados dos modulos de gestao (CIB/Sinter e Documentos):
// sessao (login opcional), chamadas a API, municipio ativo, modais, toasts e
// formatacao. Exposto em window.G.
(function () {
  const TOKEN_KEY = 'bzr_token';
  const MUNI_KEY = 'bzr-municipio-gestao';
  const G = {
    token: localStorage.getItem(TOKEN_KEY),
    auth: false,
    user: null,
    municipio: '',
    el: (id) => document.getElementById(id),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  };

  G.api = async function (url, { method = 'GET', body, raw = false } = {}) {
    const headers = {};
    if (G.token) headers.Authorization = 'Bearer ' + G.token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    if (r.status === 401 && G.auth) {
      localStorage.removeItem(TOKEN_KEY);
      location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
      throw new Error('Sessão expirada');
    }
    if (raw) { if (!r.ok) throw new Error((await r.text()) || r.statusText); return r; }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || r.statusText); e.data = data; e.status = r.status; throw e; }
    return data;
  };
  /** Acrescenta ?municipio= (ou &municipio=) a uma URL. */
  G.m = (url) => url + (url.includes('?') ? '&' : '?') + 'municipio=' + encodeURIComponent(G.municipio);
  G.get = (url) => G.api(G.m(url));
  G.post = (url, body = {}) => G.api(url, { method: 'POST', body: { municipio: G.municipio, ...body } });
  G.put = (url, body = {}) => G.api(url, { method: 'PUT', body: { municipio: G.municipio, ...body } });
  G.patch = (url, body = {}) => G.api(url, { method: 'PATCH', body: { municipio: G.municipio, ...body } });

  // ---- formatacao ----
  G.num = (v, d = 0) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
  G.m2 = (v) => (v == null || v === '' ? '—' : G.num(v, 2) + ' m²');
  G.brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  G.data = (d) => {
    if (!d) return '—';
    const s = String(d);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('/');
    return new Date(s).toLocaleDateString('pt-BR');
  };
  G.dataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  G.rel = (d) => {
    if (!d) return '';
    const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 60) return 'agora';
    if (s < 3600) return Math.floor(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + ' h';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' d';
    return G.data(d);
  };
  G.compAtual = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Recife' }).slice(0, 7);
  G.nomeComp = (c) => { const [a, m] = String(c).split('-'); return new Date(Number(a), Number(m) - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); };
  G.pill = (v, label) => `<span class="pill p-${G.esc(v)}">${G.esc(label ?? G.ROT[v] ?? v)}</span>`;
  G.ROT = {
    inclusao: 'inclusão', alteracao: 'alteração', baixa: 'baixa', reativacao: 'reativação',
    capturada: 'capturada', validada: 'validada', transmitida: 'transmitida', conciliada: 'conciliada', divergente: 'divergente', rejeitada: 'rejeitada', descartada: 'descartada',
    pendente_correcao: 'pendente de correção', pronto: 'pronto p/ Sinter', aguardando_envio: 'aguardando envio', enviado: 'enviado', conciliado: 'conciliado', baixado: 'baixado',
    preparada: 'preparada', enviada: 'enviada', processada: 'processada', processada_com_erros: 'com rejeições', parcial: 'retorno parcial',
    aberta: 'aberta', resolvida: 'resolvida', ignorada: 'ignorada',
    pendente: 'pendente', agendada: 'agendada', confirmada: 'confirmada',
    protocolado: 'protocolado', em_analise: 'em análise', pendente_documentacao: 'pendente de documentação', deferido: 'deferido', indeferido: 'indeferido', concluido: 'concluído', arquivado: 'arquivado',
    valido: 'válido', cancelado: 'cancelado',
    itbi: 'ITBI', alvara: 'Alvará', habite_se: 'Habite-se', parcelamento: 'Parcelamento', bci: 'BCI (campo)', ia_vistoria: 'Vistoria (IA)', requerimento: 'Requerimento', manual: 'Manual', implantacao: 'Carga inicial', conciliacao: 'Conciliação',
    edificacao_nova: 'edificação nova', ampliacao: 'ampliação', demolicao: 'possível demolição',
  };
  G.CAMPOS = [
    ['inscricao', 'Inscrição imobiliária'], ['lote_codigo', 'Código do lote (CTM)'], ['tipo', 'Tipo'], ['uso', 'Uso'],
    ['logradouro', 'Logradouro'], ['numero', 'Número'], ['complemento', 'Complemento'], ['bairro', 'Bairro'], ['cep', 'CEP'],
    ['setor', 'Setor'], ['quadra', 'Quadra'], ['lote_num', 'Lote'],
    ['contribuinte_nome', 'Contribuinte'], ['contribuinte_doc', 'CPF/CNPJ'], ['contribuinte_email', 'E-mail'], ['contribuinte_telefone', 'Telefone'],
    ['matricula_cartorio', 'Matrícula'], ['cartorio', 'Cartório'],
    ['area_terreno_m2', 'Área do terreno (m²)'], ['area_construida_m2', 'Área construída (m²)'], ['testada_m', 'Testada (m)'], ['n_pavimentos', 'Pavimentos'],
    ['padrao_construtivo', 'Padrão construtivo'], ['ano_construcao', 'Ano de construção'], ['observacoes', 'Observações'],
  ];
  G.ROTULO_CAMPO = Object.fromEntries(G.CAMPOS);

  // ---- UI ----
  let toastT;
  G.toast = (msg, erro = false) => {
    let t = document.getElementById('g-toast');
    if (!t) { t = document.createElement('div'); t.id = 'g-toast'; t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'toast show' + (erro ? ' err' : '');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), erro ? 6500 : 3500);
  };
  G.falha = (e) => G.toast(e?.message || String(e), true);
  /** Abre um modal; devolve { el, fechar }. */
  G.modal = ({ titulo, corpo, rodape = '', largo = false, aoFechar }) => {
    const ov = document.createElement('div');
    ov.className = 'ov open';
    ov.innerHTML = `<div class="mdl ${largo ? 'lg' : ''}" role="dialog" aria-modal="true"><div class="mdl-h"><strong>${titulo}</strong><button class="x" aria-label="Fechar">✕</button></div>
      <div class="mdl-b">${corpo}</div>${rodape ? `<div class="mdl-f">${rodape}</div>` : ''}</div>`;
    document.body.appendChild(ov);
    const fechar = () => { ov.remove(); document.removeEventListener('keydown', esc); aoFechar && aoFechar(); };
    const esc = (e) => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('keydown', esc);
    ov.querySelector('.x').onclick = fechar;
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) fechar(); });
    return { el: ov, fechar, $: (sel) => ov.querySelector(sel), $$: (sel) => ov.querySelectorAll(sel) };
  };
  G.confirmar = (titulo, texto, { campo = false, rotulo = 'Confirmar', placeholder = '' } = {}) => new Promise((resolve) => {
    const m = G.modal({
      titulo, corpo: `<p style="margin:0 0 10px">${texto}</p>${campo ? `<div class="f"><label class="full">${G.esc(campo)}<textarea id="cf-v" placeholder="${G.esc(placeholder)}"></textarea></label></div>` : ''}`,
      rodape: `<span></span><div class="g-actions"><button class="b" data-a="n">Cancelar</button><button class="b pri" data-a="s">${G.esc(rotulo)}</button></div>`,
      aoFechar: () => resolve(null),
    });
    m.$('[data-a=n]').onclick = () => m.fechar();
    m.$('[data-a=s]').onclick = () => { const v = campo ? m.$('#cf-v').value : true; resolve(v); m.fechar(); };
  });
  G.baixar = async (url, nome) => {
    const r = await G.api(url, { raw: true });
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nome; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  /** CSV/TSV simples (aspas, ; , ou tab). */
  G.parseCsv = (texto) => {
    texto = texto.replace(/^﻿/, '');
    const primeira = texto.split(/\r?\n/)[0] || '';
    const sep = [';', '\t', ','].sort((a, b) => primeira.split(b).length - primeira.split(a).length)[0];
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (q) { if (c === '"' && texto[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
      if (c === '"') q = true;
      else if (c === sep) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    const cab = (rows.shift() || []).map((h) => h.trim());
    return { cab, linhas: rows.filter((r) => r.some((x) => String(x).trim())) };
  };
  G.norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  // ---- sessao + municipio ----
  G.iniciar = async function ({ seletor = 'muni', aoTrocar } = {}) {
    try { const c = await fetch('/api/auth/config').then((r) => r.json()); G.auth = !!c.authEnabled; } catch { G.auth = false; }
    if (G.auth) {
      if (!G.token) { location.replace('/login?next=' + encodeURIComponent(location.pathname)); return false; }
      try { G.user = (await G.api('/api/auth/me')).user; } catch { return false; }
      const chip = G.el('userchip');
      if (chip) chip.innerHTML = `<span class="avatar">${G.esc((G.user.nome || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase())}</span><span class="btn-label">${G.esc(G.user.nome)} · ${G.esc(G.user.role)}</span>`;
      const sair = G.el('btn-logout');
      if (sair) { sair.hidden = false; sair.onclick = () => { localStorage.removeItem(TOKEN_KEY); location.replace('/login'); }; }
    } else {
      const sair = G.el('btn-logout'); if (sair) sair.hidden = true;
    }
    const sel = G.el(seletor);
    let lista = [];
    try { lista = await G.api('/api/cib/municipios'); } catch (e) { G.falha(e); }
    const salvo = new URLSearchParams(location.search).get('municipio') ?? localStorage.getItem(MUNI_KEY);
    const comDados = lista.filter((x) => x);
    G.municipio = lista.includes(salvo) ? salvo : (comDados[0] ?? lista[0] ?? '');
    if (sel) {
      const pintar = () => {
        sel.innerHTML = lista.map((x) => `<option value="${G.esc(x)}" ${x === G.municipio ? 'selected' : ''}>${G.esc(x || '(sem município)')}</option>`).join('')
          + '<option value="__novo">＋ Novo município…</option>';
      };
      pintar();
      sel.onchange = async () => {
        if (sel.value === '__novo') {
          const nome = await G.confirmar('Novo município', 'Informe o nome do município (como aparece nos dados do Território, se houver).', { campo: 'Nome do município', rotulo: 'Criar' });
          if (nome && nome.trim()) {
            try { await G.api('/api/cib/config', { method: 'PUT', body: { municipio: nome.trim(), nomeOficial: 'Prefeitura Municipal de ' + nome.trim() } }); lista.push(nome.trim()); G.municipio = nome.trim(); }
            catch (e) { G.falha(e); }
          }
          pintar();
        } else G.municipio = sel.value;
        localStorage.setItem(MUNI_KEY, G.municipio);
        aoTrocar && aoTrocar(G.municipio);
      };
    }
    localStorage.setItem(MUNI_KEY, G.municipio);
    return true;
  };

  window.G = G;
})();
