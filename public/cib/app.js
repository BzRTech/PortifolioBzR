// Modulo CIB/Sinter — painel, imoveis, ciclo mensal, remessas, conciliacao,
// vistoria por imagem, implantacao (5 etapas), PGV, configuracao e auditoria.
/* global G, L */
const { el, esc } = G;
const S = { tab: 'painel', cfg: null, mapas: [] };
const COR = { conciliado: '#0f7a3d', pronto: '#7fcf9c', aguardando_envio: '#f5c518', enviado: '#5b8fd4', pendente_correcao: '#d9534f', divergente: '#e8742c', baixado: '#9aa09a' };

// ------------------------------------------------------------------ roteamento
function irPara(tab, params = {}) {
  S.tab = tab; S.params = params;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  history.replaceState(null, '', '#' + tab);
  render();
}
document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => irPara(b.dataset.tab)));

async function render() {
  S.mapas.forEach((m) => m.remove()); S.mapas = [];
  const v = el('view');
  v.innerHTML = '<div class="vazio">Carregando…</div>';
  try {
    await ({ painel, imoveis, ciclo, remessas, conciliacao, vistoria, implantacao, pgv, config, auditoria }[S.tab] || painel)(v, S.params || {});
  } catch (e) { v.innerHTML = `<div class="vazio">Erro: ${esc(e.message)}</div>`; }
  atualizarBadges();
}

async function atualizarBadges() {
  try {
    const p = await G.get('/api/cib/painel');
    el('bd-imoveis').textContent = p.imoveis.com_erro || '';
    el('bd-ciclo').textContent = p.filas.validar || '';
    el('bd-conciliacao').textContent = p.filas.divergencias || '';
    el('bd-vistoria').textContent = p.filas.vistorias || '';
  } catch { /* ok */ }
}

function cabecalho(kicker, titulo, texto, acoes = '') {
  return `<div class="g-head"><div><div class="kicker">${kicker}</div><h2>${titulo}</h2>${texto ? `<p>${texto}</p>` : ''}</div><div class="g-actions">${acoes}</div></div>`;
}

function mapaBase(div, { altura } = {}) {
  if (altura) div.style.height = altura;
  const escuro = document.documentElement.getAttribute('data-theme') === 'dark';
  const m = L.map(div, { preferCanvas: true, zoomControl: true }).setView([-7.12, -34.86], 13);
  const claro = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 20 });
  const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 20 });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Imagery &copy; Esri', maxZoom: 20 });
  (escuro ? dark : claro).addTo(m);
  L.control.layers({ 'Mapa claro': claro, 'Mapa escuro': dark, 'Satélite': sat }, null, { position: 'topright' }).addTo(m);
  S.mapas.push(m);
  setTimeout(() => m.invalidateSize(), 80);
  return m;
}

// ------------------------------------------------------------------ PAINEL
async function painel(v) {
  const [p, mapa] = await Promise.all([G.get('/api/cib/painel'), G.get('/api/cib/mapa')]);
  const im = p.imoveis;
  const pct = im.ativos ? ((im.com_cib / im.ativos) * 100).toFixed(1).replace('.', ',') : '0';
  const prazo = p.prazoSinter.split('-');
  const ciclo = p.ciclo || {};
  const statusTxt = p.diasPrazo > 0 ? `Faltam <strong style="display:inline">${p.diasPrazo} dias</strong> para o prazo legal de integração ao Sinter.` : 'Prazo legal encerrado — a obrigação continua: cada mudança no imóvel precisa chegar ao Sinter.';
  v.innerHTML = `
    ${cabecalho('Painel do cadastro', `${esc(G.municipio || 'Município')}`, `Competência atual: ${esc(G.nomeComp(p.competencia))} · Implantação na etapa ${p.etapaImplantacao} de 5.`,
      `<button class="b" id="bt-diag">Diagnóstico</button><button class="b pri" id="bt-rel">Relatório mensal</button>`)}
    <div class="prazo-bar"><div class="cal"><small>${['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'][Number(prazo[1]) - 1]} · ${prazo[0]}</small><b>${prazo[2]}</b></div>
      <p><strong>O problema não é o prazo. É o dia seguinte a ele.</strong>${statusTxt}</p>
      <button class="b sm" data-go="implantacao">Ver implantação →</button></div>
    <div class="cards">
      <div class="kpi verde"><div class="l">imóveis com CIB</div><div class="v">${G.num(im.com_cib)}</div><div class="s">${pct}% de ${G.num(im.ativos)} ativos</div></div>
      <div class="kpi amarelo"><div class="l">pendências</div><div class="v">${G.num(p.pendencias)}</div><div class="s">${im.com_erro} cadastro · ${p.filas.divergencias} divergência · ${p.filas.vistorias} vistoria</div></div>
      <div class="kpi"><div class="l">alterações no mês</div><div class="v">${G.num(p.alteracoesMes)}</div><div class="s">eventos capturados em ${esc(G.nomeComp(p.competencia))}</div></div>
      <div class="kpi escuro"><div class="l">última remessa</div><div class="v">${p.ultimaRemessa ? String(p.ultimaRemessa.numero).padStart(2, '0') : '—'}</div><div class="s">${p.ultimaRemessa ? `${G.ROT[p.ultimaRemessa.status] || p.ultimaRemessa.status} · ${p.ultimaRemessa.qtd_itens} itens` : 'nenhuma enviada'}</div></div>
    </div>
    <div class="kicker" style="font:700 10px var(--font-mono);letter-spacing:.16em;color:var(--muted);margin:0 0 8px">O CICLO MENSAL</div>
    <div class="ciclo">
      <div class="passo" data-go="ciclo"><span class="n">01</span><strong>Capturar</strong><span class="d">ITBI, alvarás, habite-se, parcelamentos, BCI e vistoria.</span><span class="c">${(ciclo.capturada || 0) + (ciclo.validada || 0) + (ciclo.transmitida || 0) + (ciclo.conciliada || 0) + (ciclo.divergente || 0) + (ciclo.rejeitada || 0)}</span></div>
      <div class="passo" data-go="ciclo"><span class="n">02</span><strong>Validar</strong><span class="d">Geometria, chaves e atributos.</span><span class="c">${p.filas.validar} na fila</span></div>
      <div class="passo" data-go="remessas"><span class="n">03</span><strong>Transmitir</strong><span class="d">Inclusões, alterações, baixas e reativações.</span><span class="c">${p.filas.transmitir} p/ enviar</span></div>
      <div class="passo" data-go="conciliacao"><span class="n">04</span><strong>Conciliar</strong><span class="d">Retorno do Sinter conferido.</span><span class="c">${p.filas.divergencias} abertas</span></div>
      <div class="passo" id="passo-contas"><span class="n">05</span><strong>Prestar contas</strong><span class="d">Relatório mensal ao gestor.</span><span class="c">emitir →</span></div>
    </div>
    <div class="grid2">
      <div class="box"><h3>Mapa do cadastro <span class="dim small" style="text-transform:none;letter-spacing:0">${mapa.length} imóveis georreferenciados</span></h3>
        <div class="mapa" id="mp"></div>
        <div class="legenda">${Object.entries(COR).map(([k, c]) => `<span><i style="background:${c}"></i>${G.ROT[k]}</span>`).join('')}</div></div>
      <div>
        <div class="box"><h3>Últimas movimentações <button class="b sm" data-go="ciclo">ver todas</button></h3>
          <div class="feed">${p.ultimas.map((u) => `<div>${G.pill(u.tipo)}<span class="mono">${esc(u.inscricao)}</span><span class="dim small">${esc(G.ROT[u.origem] || u.origem)}</span><span class="when">${G.pill(u.status)} ${G.rel(u.criadoEm)}</span></div>`).join('') || '<div class="dim">Nenhuma movimentação ainda.</div>'}</div></div>
        <div class="box"><h3>Filas de trabalho</h3><div class="filas">
          <div class="fila" data-go="imoveis" data-p="pendente_correcao"><div class="v">${im.com_erro}</div><div class="l">imóveis a sanear</div></div>
          <div class="fila" data-go="ciclo"><div class="v">${p.filas.validar}</div><div class="l">eventos a validar</div></div>
          <div class="fila" data-go="remessas"><div class="v">${p.filas.transmitir}</div><div class="l">prontos p/ transmitir</div></div>
          <div class="fila" data-go="conciliacao"><div class="v">${p.filas.divergencias}</div><div class="l">divergências</div></div>
          <div class="fila" data-go="vistoria"><div class="v">${p.filas.vistorias}</div><div class="l">vistorias</div></div>
          <a class="fila ${p.filas.requerimentosAtrasados ? 'alerta' : ''}" href="/documentos/" style="text-decoration:none;color:inherit"><div class="v">${p.filas.requerimentos}</div><div class="l">requerimentos abertos${p.filas.requerimentosAtrasados ? ` · ${p.filas.requerimentosAtrasados} atrasado(s)` : ''}</div></a>
        </div></div>
      </div>
    </div>`;
  v.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => irPara(b.dataset.go, b.dataset.p ? { status: b.dataset.p } : {})));
  el('passo-contas').onclick = el('bt-rel').onclick = () => emitirDoc('relatorio_mensal', { campos: { competencia: G.compAtual() } });
  el('bt-diag').onclick = () => irPara('implantacao');
  const m = mapaBase(el('mp'));
  if (mapa.length) {
    const pts = mapa.map((x) => L.circleMarker([x.lat, x.lng], { radius: 4, weight: 0, fillOpacity: 0.9, fillColor: COR[x.status] || '#888' })
      .bindPopup(`<strong class="mono">${esc(x.inscricao)}</strong><br>${G.ROT[x.status] || x.status}${x.cib ? '<br>CIB ' + esc(x.cib) : ''}<br><a href="#" data-im="${x.id}">abrir ficha →</a>`));
    const g = L.featureGroup(pts).addTo(m);
    m.fitBounds(g.getBounds(), { padding: [20, 20] });
    m.on('popupopen', (e) => { const a = e.popup.getElement().querySelector('[data-im]'); if (a) a.onclick = (ev) => { ev.preventDefault(); fichaImovel(Number(a.dataset.im)); }; });
  }
}

/** Emite um documento (modulo Documentos) e abre a visualizacao. */
async function emitirDoc(tipo, { imovelId, campos } = {}) {
  try {
    const d = await G.post('/api/documentos', { tipo, imovelId, campos });
    G.toast(`${d.titulo} nº ${d.numero} emitido.`);
    window.open('/documentos/ver.html?id=' + d.id, '_blank');
  } catch (e) { G.falha(e); }
}

// ------------------------------------------------------------------ IMOVEIS
async function imoveis(v, params) {
  const f = { q: params.q || '', status: params.status || '', situacao: params.situacao || '', regra: params.regra || '', offset: 0 };
  v.innerHTML = `${cabecalho('Cadastro imobiliário', 'Imóveis', 'Inscrição municipal ligada ao lote do CTM e ao CIB. Cada alteração em imóvel já conhecido do Sinter vira automaticamente uma movimentação a transmitir.',
    `<button class="b" id="bt-reval">↻ Revalidar base</button><button class="b" id="bt-imp">⬆ Importar base (CSV)</button><button class="b pri" id="bt-novo">＋ Novo imóvel</button>`)}
    <div class="toolbar2">
      <input type="search" id="q" placeholder="Inscrição, CIB, logradouro, contribuinte, CPF/CNPJ…" value="${esc(f.q)}" />
      <select id="fs"><option value="">Todo status Sinter</option>${['pendente_correcao', 'pronto', 'aguardando_envio', 'enviado', 'conciliado', 'divergente', 'baixado'].map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${G.ROT[s]}</option>`).join('')}</select>
      <select id="fsit"><option value="">Ativos e baixados</option><option value="ativo">Ativos</option><option value="baixado">Baixados</option></select>
      <select id="fr"><option value="">Qualquer pendência</option></select>
    </div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Inscrição</th><th>CIB</th><th>Endereço</th><th>Contribuinte</th><th class="num">Terreno</th><th class="num">Construída</th><th>Status Sinter</th><th>Pendências</th></tr></thead><tbody id="tb"></tbody></table></div>
    <div class="toolbar2" style="margin-top:10px;justify-content:space-between"><span class="dim small" id="tot"></span><span><button class="b sm" id="pg-a">← anterior</button> <button class="b sm" id="pg-p">próxima →</button></span></div>`;
  try {
    const d = await G.get('/api/cib/diagnostico');
    el('fr').innerHTML += d.porRegra.map((r) => `<option value="${esc(r.codigo)}" ${f.regra === r.codigo ? 'selected' : ''}>${esc(r.mensagem)} (${r.n})</option>`).join('');
  } catch { /* ok */ }
  const carregar = async () => {
    const qs = new URLSearchParams({ q: f.q, status: f.status, situacao: f.situacao, regra: f.regra, offset: f.offset, limit: 50 });
    const r = await G.get('/api/cib/imoveis?' + qs);
    el('tb').innerHTML = r.itens.map((i) => {
      const erros = i.pendencias.filter((p) => p.nivel === 'erro').length, alertas = i.pendencias.length - erros;
      return `<tr class="click" data-id="${i.id}"><td class="mono"><strong>${esc(i.inscricao)}</strong>${i.situacao === 'baixado' ? ' ' + G.pill('baixado') : ''}</td><td class="mono">${esc(i.cib) || '<span class="dim">—</span>'}</td>
        <td>${esc([i.logradouro, i.numero].filter(Boolean).join(', ') || '—')}<div class="dim small">${esc(i.bairro)}</div></td>
        <td>${esc(i.contribuinteNome || '—')}<div class="dim small mono">${esc(i.contribuinteDocMascarado)}</div></td>
        <td class="num">${G.num(i.areaTerreno)}</td><td class="num">${G.num(i.areaConstruida)}</td><td>${G.pill(i.sinterStatus)}</td>
        <td>${erros ? `<span class="pill p-divergente">${erros} erro${erros > 1 ? 's' : ''}</span> ` : ''}${alertas ? `<span class="pill p-pendente">${alertas} alerta${alertas > 1 ? 's' : ''}</span>` : ''}${!i.pendencias.length ? '<span class="dim small">—</span>' : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="8" class="vazio">Nenhum imóvel encontrado.</td></tr>';
    el('tot').textContent = `${r.total} imóveis · exibindo ${r.total ? r.offset + 1 : 0}–${Math.min(r.offset + r.limit, r.total)}`;
    el('pg-a').disabled = r.offset === 0; el('pg-p').disabled = r.offset + r.limit >= r.total;
    v.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => fichaImovel(Number(tr.dataset.id), carregar)));
  };
  let deb;
  el('q').oninput = () => { clearTimeout(deb); deb = setTimeout(() => { f.q = el('q').value; f.offset = 0; carregar(); }, 300); };
  el('fs').onchange = () => { f.status = el('fs').value; f.offset = 0; carregar(); };
  el('fsit').onchange = () => { f.situacao = el('fsit').value; f.offset = 0; carregar(); };
  el('fr').onchange = () => { f.regra = el('fr').value; f.offset = 0; carregar(); };
  el('pg-a').onclick = () => { f.offset = Math.max(0, f.offset - 50); carregar(); };
  el('pg-p').onclick = () => { f.offset += 50; carregar(); };
  el('bt-novo').onclick = () => formImovel(null, carregar);
  el('bt-imp').onclick = () => importarBase(carregar);
  el('bt-reval').onclick = async () => {
    try { const r = await G.post('/api/cib/revalidar'); G.toast(`${r.revalidados} imóveis revalidados · ${r.diagnostico.imoveis.pctProntos}% prontos para o Sinter.`); carregar(); }
    catch (e) { G.falha(e); }
  };
  await carregar();
}

function camposForm(im) {
  const val = (k) => esc(im?.[k] ?? '');
  const sel = (k, ops) => `<select name="${k}">${ops.map(([v, l]) => `<option value="${v}" ${String(im?.[k] ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  return `<div class="f c3">
    <label>Inscrição *<input name="inscricao" value="${val('inscricao')}" required /></label>
    <label>Código do lote (CTM)<input name="lote_codigo" value="${val('lote_codigo')}" placeholder="vincula a geometria" /></label>
    <label>Tipo${sel('tipo', [['predial', 'Predial'], ['territorial', 'Territorial']])}</label>
    <label>Uso<input name="uso" value="${val('uso')}" list="usos" /></label>
    <label>Setor<input name="setor" value="${val('setor')}" /></label>
    <label>Quadra / Lote<span style="display:flex;gap:6px"><input name="quadra" value="${val('quadra')}" style="flex:1" /><input name="lote_num" value="${val('lote_num')}" style="flex:1" /></span></label>
    <label class="full" style="grid-column:span 2">Logradouro *<input name="logradouro" value="${val('logradouro')}" /></label>
    <label>Número<input name="numero" value="${val('numero')}" placeholder="ou S/N" /></label>
    <label>Complemento<input name="complemento" value="${val('complemento')}" /></label>
    <label>Bairro *<input name="bairro" value="${val('bairro')}" /></label>
    <label>CEP<input name="cep" value="${val('cep')}" inputmode="numeric" /></label>
    <label class="full" style="grid-column:span 2">Contribuinte *<input name="contribuinte_nome" value="${val('contribuinte_nome')}" /></label>
    <label>CPF/CNPJ *<input name="contribuinte_doc" value="${val('contribuinte_doc')}" inputmode="numeric" /></label>
    <label>E-mail<input name="contribuinte_email" value="${val('contribuinte_email')}" type="email" /></label>
    <label>Telefone<input name="contribuinte_telefone" value="${val('contribuinte_telefone')}" /></label>
    <label>Matrícula / Cartório<span style="display:flex;gap:6px"><input name="matricula_cartorio" value="${val('matricula_cartorio')}" style="flex:1" /><input name="cartorio" value="${val('cartorio')}" style="flex:1.4" /></span></label>
    <label>Área do terreno (m²) *<input name="area_terreno_m2" value="${val('area_terreno_m2')}" inputmode="decimal" /></label>
    <label>Área construída (m²)<input name="area_construida_m2" value="${val('area_construida_m2')}" inputmode="decimal" /></label>
    <label>Testada (m)<input name="testada_m" value="${val('testada_m')}" inputmode="decimal" /></label>
    <label>Pavimentos<input name="n_pavimentos" value="${val('n_pavimentos')}" inputmode="numeric" /></label>
    <label>Padrão construtivo${sel('padrao_construtivo', [['baixo', 'Baixo'], ['medio', 'Médio'], ['alto', 'Alto'], ['luxo', 'Luxo']])}</label>
    <label>Ano de construção<input name="ano_construcao" value="${val('ano_construcao')}" inputmode="numeric" /></label>
    <label class="full">Observações<textarea name="observacoes">${val('observacoes')}</textarea></label>
  </div><datalist id="usos"><option>Residencial</option><option>Comercial</option><option>Misto</option><option>Industrial</option><option>Institucional</option><option>Terreno vazio</option></datalist>`;
}
const lerForm = (raiz) => Object.fromEntries([...raiz.querySelectorAll('[name]')].map((i) => [i.name, i.value]));
// Converte o imovel (camelCase da API) para os nomes de coluna do formulario.
const paraForm = (i) => i && ({
  inscricao: i.inscricao, lote_codigo: i.loteCodigo, tipo: i.tipo, uso: i.uso, setor: i.setor, quadra: i.quadra, lote_num: i.loteNum,
  logradouro: i.logradouro, numero: i.numero, complemento: i.complemento, bairro: i.bairro, cep: i.cep,
  contribuinte_nome: i.contribuinteNome, contribuinte_doc: i.contribuinteDoc, contribuinte_email: i.contribuinteEmail, contribuinte_telefone: i.contribuinteTelefone,
  matricula_cartorio: i.matriculaCartorio, cartorio: i.cartorio, area_terreno_m2: i.areaTerreno, area_construida_m2: i.areaConstruida,
  testada_m: i.testada, n_pavimentos: i.nPavimentos, padrao_construtivo: i.padraoConstrutivo, ano_construcao: i.anoConstrucao, observacoes: i.observacoes,
});

function formImovel(im, depois) {
  const m = G.modal({
    titulo: im ? `Editar imóvel ${esc(im.inscricao)}` : 'Novo imóvel', largo: true, corpo: camposForm(paraForm(im)),
    rodape: `<span class="dim small">${im && (im.transmitido || im.cib) ? 'Este imóvel já está no Sinter: a alteração entra na fila de transmissão.' : 'Campos com * são exigidos pelo Sinter.'}</span>
      <div class="g-actions"><button class="b" data-a="c">Cancelar</button><button class="b pri" data-a="s">Salvar</button></div>`,
  });
  m.$('[data-a=c]').onclick = m.fechar;
  m.$('[data-a=s]').onclick = async () => {
    try {
      const body = lerForm(m.el);
      const r = im ? await G.put('/api/cib/imoveis/' + im.id, body) : await G.post('/api/cib/imoveis', body);
      G.toast(r.movimentacaoId ? 'Imóvel atualizado — alteração registrada para transmissão ao Sinter.' : 'Imóvel salvo.');
      m.fechar(); depois && depois(); if (im) fichaImovel(im.id, depois);
    } catch (e) { G.falha(e); }
  };
}

async function fichaImovel(id, depois) {
  let im;
  try { im = await G.api('/api/cib/imoveis/' + id); } catch (e) { return G.falha(e); }
  const linhas = [
    ['Inscrição', `<strong class="mono">${esc(im.inscricao)}</strong>`], ['CIB', im.cib ? `<strong class="mono">${esc(im.cib)}</strong> <span class="dim small">desde ${G.data(im.cibAtribuidoEm)}</span>` : '<span class="dim">não atribuído</span>'],
    ['Status Sinter', G.pill(im.sinterStatus)], ['Situação', im.situacao === 'baixado' ? `${G.pill('baixado')} ${G.data(im.dataBaixa)} · ${esc(im.motivoBaixa)}` : G.pill('valido', 'ativo')],
    ['Endereço', esc([im.logradouro, im.numero, im.complemento].filter(Boolean).join(', ') || '—') + `<div class="dim small">${esc(im.bairro)} ${im.cep ? '· CEP ' + esc(im.cep) : ''}</div>`],
    ['Setor/Quadra/Lote', esc([im.setor, im.quadra, im.loteNum].map((x) => x || '—').join(' / '))],
    ['Lote do CTM', im.loteId ? `<span class="mono">${esc(im.loteCodigo || im.loteId)}</span> · área geométrica ${G.m2(im.loteArea)} ${im.centroide ? `· <a href="/territorio" class="small">ver no mapa</a>` : ''}` : '<span class="dim">sem vínculo</span>'],
    ['Contribuinte', `${esc(im.contribuinteNome || '—')} <span class="mono dim">${esc(im.contribuinteDoc || '')}</span>`],
    ['Matrícula', `${esc(im.matriculaCartorio || '—')} ${im.cartorio ? '· ' + esc(im.cartorio) : ''}`],
    ['Áreas', `Terreno ${G.m2(im.areaTerreno)} · Construída ${G.m2(im.areaConstruida)} · ${im.nPavimentos || '—'} pav.`],
    ['Tipo / Uso / Padrão', `${esc(im.tipo)} · ${esc(im.uso || '—')} · ${esc(im.padraoConstrutivo || '—')}`],
    ['Valor venal (PGV)', im.valorVenal != null ? `<strong>${G.brl(im.valorVenal)}</strong> <span class="dim small">terreno ${G.brl(im.valorVenalTerreno)} + construção ${G.brl(im.valorVenalConstrucao)}</span>` : '<span class="dim">PGV não cadastrada</span>'],
  ];
  const DOCS = [['certidao_cadastral', 'Certidão cadastral'], ['declaracao_cib', 'Declaração CIB'], ['certidao_numeracao', 'Numeração predial'], ['certidao_valor_venal', 'Valor venal'], ['declaracao_situacao', 'Situação cadastral'], ['certidao_baixa', 'Certidão de baixa'], ['notificacao_atualizacao', 'Notificação']];
  const m = G.modal({
    titulo: `Imóvel <span class="mono">${esc(im.inscricao)}</span>`, largo: true,
    corpo: `<div class="subtabs"><button class="on" data-st="dados">Dados</button><button data-st="pend">Pendências (${im.pendencias.length})</button><button data-st="hist">Histórico Sinter (${im.movimentacoes.length})</button><button data-st="docs">Documentos (${im.documentos.length})</button></div>
      <div data-sv="dados"><table class="t">${linhas.map(([k, val]) => `<tr><th style="width:190px">${k}</th><td>${val}</td></tr>`).join('')}</table>
        ${im.divergencias.filter((d) => d.status === 'aberta').length ? `<div class="box" style="margin-top:12px;border-color:#e8742c"><h3>Divergência em aberto</h3>${im.divergencias.filter((d) => d.status === 'aberta').map((d) => `<div class="small">${esc(G.ROTULO_CAMPO[d.campo] || d.campo)}: município <strong>${esc(d.valor_municipio)}</strong> × ${esc(d.fonte)} <strong>${esc(d.valor_externo)}</strong> — ${esc(d.mensagem)}</div>`).join('')}</div>` : ''}</div>
      <div data-sv="pend" hidden>${im.pendencias.map((p) => `<div class="pend ${p.nivel}"><b>${p.nivel === 'erro' ? 'BLOQUEIA' : 'ALERTA'}</b><span>${esc(p.mensagem)}</span></div>`).join('') || '<div class="vazio">Sem pendências — pronto para o Sinter.</div>'}</div>
      <div data-sv="hist" hidden>${im.movimentacoes.length ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>Data</th><th>Tipo</th><th>Origem</th><th>Status</th><th>Remessa</th><th>Detalhe</th></tr></thead><tbody>${im.movimentacoes.map((x) => `<tr><td class="small">${G.dataHora(x.criadoEm)}</td><td>${G.pill(x.tipo)}</td><td class="small">${esc(G.ROT[x.origem] || x.origem)}${x.documentoRef ? `<div class="dim">${esc(x.documentoRef)}</div>` : ''}</td><td>${G.pill(x.status)}</td><td class="mono">${x.remessaNumero ? String(x.remessaNumero).padStart(2, '0') : '—'}</td><td class="small">${esc(x.descricao)}${difs(x)}${x.retornoMsg ? `<div class="dim">Sinter: ${esc(x.retornoMsg)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vazio">Ainda não foi ao Sinter.</div>'}</div>
      <div data-sv="docs" hidden><div class="g-actions" style="margin-bottom:10px">${DOCS.map(([t, l]) => `<button class="b sm" data-doc="${t}">＋ ${l}</button>`).join('')}</div>
        ${im.documentos.length ? `<table class="t">${im.documentos.map((d) => `<tr><td>${esc(d.titulo)}</td><td class="mono">${esc(d.numero)}</td><td class="small">${G.data(d.emitido_em)}</td><td>${G.pill(d.status)}</td><td><a class="b sm" href="/documentos/ver.html?id=${d.id}" target="_blank">abrir</a></td></tr>`).join('')}</table>` : '<div class="vazio">Nenhum documento emitido.</div>'}</div>`,
    rodape: `<div class="g-actions">${im.situacao === 'ativo' ? '<button class="b danger" data-a="baixa">Baixar inscrição</button>' : '<button class="b ok" data-a="reat">Reativar</button>'}<button class="b" data-a="cib">Informar CIB</button></div>
      <div class="g-actions"><a class="b" href="/bci/ficha.html?inscricao=${encodeURIComponent(im.inscricao)}&municipio=${encodeURIComponent(im.municipio)}">BCI de campo</a><button class="b pri" data-a="edit">Editar dados</button></div>`,
  });
  m.$$('.subtabs button').forEach((b) => (b.onclick = () => {
    m.$$('.subtabs button').forEach((x) => x.classList.toggle('on', x === b));
    m.$$('[data-sv]').forEach((s) => (s.hidden = s.dataset.sv !== b.dataset.st));
  }));
  m.$$('[data-doc]').forEach((b) => (b.onclick = () => emitirDoc(b.dataset.doc, { imovelId: im.id, campos: b.dataset.doc === 'notificacao_atualizacao' ? { prazoDias: 30, motivo: 'Atualização dos dados cadastrais do imóvel.' } : {} })));
  m.$('[data-a=edit]').onclick = () => { m.fechar(); formImovel(im, depois); };
  m.$('[data-a=cib]').onclick = async () => {
    const v = await G.confirmar('Informar CIB', 'Use quando o CIB foi consultado diretamente no portal do Sinter. Normalmente ele chega pelo retorno da remessa.', { campo: 'Código CIB', rotulo: 'Salvar' });
    if (v == null) return;
    try { await G.patch(`/api/cib/imoveis/${im.id}/cib`, { cib: v.trim() }); G.toast('CIB registrado.'); m.fechar(); fichaImovel(im.id, depois); depois && depois(); } catch (e) { G.falha(e); }
  };
  const b = m.$('[data-a=baixa]');
  if (b) b.onclick = async () => {
    const motivo = await G.confirmar('Baixar inscrição', `A baixa de <strong>${esc(im.inscricao)}</strong> será registrada e transmitida ao Sinter.`, { campo: 'Motivo (ex.: demolição, unificação de lotes)', rotulo: 'Baixar' });
    if (!motivo) return;
    try { await G.post(`/api/cib/imoveis/${im.id}/baixa`, { motivo }); G.toast('Baixa registrada.'); m.fechar(); fichaImovel(im.id, depois); depois && depois(); } catch (e) { G.falha(e); }
  };
  const r = m.$('[data-a=reat]');
  if (r) r.onclick = async () => {
    const motivo = await G.confirmar('Reativar inscrição', `Reativar <strong>${esc(im.inscricao)}</strong>?`, { campo: 'Motivo', rotulo: 'Reativar' });
    if (motivo == null) return;
    try { await G.post(`/api/cib/imoveis/${im.id}/reativar`, { motivo }); G.toast('Inscrição reativada.'); m.fechar(); fichaImovel(im.id, depois); depois && depois(); } catch (e) { G.falha(e); }
  };
}
function difs(x) {
  const ks = Object.keys(x.dadosDepois || {});
  if (!ks.length) return '';
  return `<div class="dim">${ks.slice(0, 4).map((k) => `${esc(G.ROTULO_CAMPO[k] || k)}: ${x.dadosAntes?.[k] != null && x.dadosAntes[k] !== '' ? esc(x.dadosAntes[k]) + ' → ' : ''}<strong>${esc(x.dadosDepois[k])}</strong>`).join(' · ')}${ks.length > 4 ? ' …' : ''}</div>`;
}

// Importacao da base cadastral (CSV exportado do sistema tributario).
const ALIASES = {
  inscricao: ['inscricao', 'inscricao_imobiliaria', 'insc', 'inscricao_municipal', 'cod_imovel', 'codigo_imovel'],
  lote_codigo: ['lote_codigo', 'codigo_lote', 'cod_lote', 'id_lote'],
  tipo: ['tipo', 'tipo_imovel'], uso: ['uso', 'uso_imovel', 'utilizacao'],
  logradouro: ['logradouro', 'endereco', 'rua', 'nome_logradouro'], numero: ['numero', 'num', 'n', 'numero_predial'],
  complemento: ['complemento', 'compl'], bairro: ['bairro'], cep: ['cep'], setor: ['setor'], quadra: ['quadra'], lote_num: ['lote', 'lote_num'],
  contribuinte_nome: ['contribuinte', 'contribuinte_nome', 'proprietario', 'nome_contribuinte', 'nome'],
  contribuinte_doc: ['cpf', 'cnpj', 'cpf_cnpj', 'documento', 'contribuinte_doc', 'cpf_cnpj_contribuinte'],
  matricula_cartorio: ['matricula', 'matricula_cartorio'], cartorio: ['cartorio'],
  area_terreno_m2: ['area_terreno', 'area_terreno_m2', 'at', 'area_lote'], area_construida_m2: ['area_construida', 'area_construida_m2', 'ac', 'area_edificada'],
  testada_m: ['testada', 'testada_m'], n_pavimentos: ['pavimentos', 'n_pavimentos'], padrao_construtivo: ['padrao', 'padrao_construtivo'], ano_construcao: ['ano_construcao', 'ano'],
};
function importarBase(depois) {
  const m = G.modal({
    titulo: 'Importar base cadastral', largo: true,
    corpo: `<p class="small dim" style="margin-top:0">Envie o CSV exportado do sistema tributário (separador ; , ou tab). As colunas são reconhecidas pelo nome
      (inscrição, logradouro, número, bairro, contribuinte, CPF/CNPJ, área do terreno, área construída…). Imóveis existentes são atualizados pela inscrição;
      o vínculo com o lote do CTM é feito pelo código do lote (ou pela própria inscrição). A validação Sinter roda em seguida.</p>
      <input type="file" id="arq" accept=".csv,.txt,.tsv" /><div id="prev" style="margin-top:12px"></div>`,
    rodape: `<span class="dim small" id="st"></span><div class="g-actions"><button class="b" data-a="c">Fechar</button><button class="b pri" data-a="s" disabled>Importar</button></div>`,
  });
  let itens = [];
  m.$('[data-a=c]').onclick = m.fechar;
  m.$('#arq').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    let txt = await f.text();
    if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(await f.arrayBuffer());
    const { cab, linhas } = G.parseCsv(txt);
    const mapa = cab.map((h) => { const n = G.norm(h); return Object.keys(ALIASES).find((k) => ALIASES[k].includes(n)) || null; });
    itens = linhas.map((l) => Object.fromEntries(mapa.map((k, i) => [k, l[i]]).filter(([k]) => k)));
    m.$('#prev').innerHTML = `<div class="small" style="margin-bottom:6px"><strong>${itens.length}</strong> linhas · colunas reconhecidas:
      ${cab.map((h, i) => mapa[i] ? `<span class="pill p-conciliado">${esc(h)} → ${esc(G.ROTULO_CAMPO[mapa[i]] || mapa[i])}</span>` : `<span class="pill p-baixa">${esc(h)} (ignorada)</span>`).join(' ')}</div>
      ${mapa.includes('inscricao') ? '' : '<div class="pend erro"><b>ERRO</b><span>Nenhuma coluna de inscrição encontrada.</span></div>'}`;
    m.$('[data-a=s]').disabled = !mapa.includes('inscricao') || !itens.length;
  };
  m.$('[data-a=s]').onclick = async () => {
    m.$('[data-a=s]').disabled = true;
    let ins = 0, at = 0, ig = 0;
    try {
      for (let i = 0; i < itens.length; i += 1000) {
        m.$('#st').textContent = `Enviando ${i + 1}–${Math.min(i + 1000, itens.length)} de ${itens.length}…`;
        const r = await G.post('/api/cib/imoveis/importar', { itens: itens.slice(i, i + 1000) });
        ins += r.inseridos; at += r.atualizados; ig += r.ignorados;
      }
      m.$('#st').textContent = `Concluído: ${ins} inseridos, ${at} atualizados, ${ig} ignorados.`;
      G.toast('Base importada e validada.'); depois && depois();
    } catch (e) { G.falha(e); m.$('[data-a=s]').disabled = false; }
  };
}

// ------------------------------------------------------------------ CICLO MENSAL
async function ciclo(v, params) {
  const f = { competencia: params.competencia || G.compAtual(), status: params.status || '' };
  v.innerHTML = `${cabecalho('Fase 2 · Manutenção contínua', 'Ciclo mensal', 'Cada inclusão, alteração, baixa e reativação precisa chegar ao Sinter. Capture o evento (ITBI, alvará, habite-se, parcelamento, BCI), valide — o dado é aplicado no cadastro municipal — e ele entra na fila da próxima remessa.',
    `<button class="b" id="bt-parc">⧉ Parcelamento</button><button class="b" id="bt-val">✓ Validar todas</button><button class="b pri" id="bt-ev">＋ Registrar evento</button>`)}
    <div class="toolbar2"><label class="small dim">Competência <input type="month" id="comp" value="${esc(f.competencia)}" /></label>
      <select id="fst"><option value="">Todos os status</option>${['capturada', 'validada', 'transmitida', 'conciliada', 'divergente', 'rejeitada', 'descartada'].map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${G.ROT[s]}</option>`).join('')}</select>
      <label class="small dim"><input type="checkbox" id="pend" /> só pendentes (qualquer mês)</label>
      <input type="search" id="q" placeholder="Inscrição…" /></div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Data</th><th>Inscrição</th><th>Tipo</th><th>Origem / documento</th><th>Alteração</th><th>Status</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const carregar = async () => {
    const qs = new URLSearchParams();
    if (el('pend').checked) qs.set('status', 'capturada,rejeitada');
    else { qs.set('competencia', el('comp').value); if (el('fst').value) qs.set('status', el('fst').value); }
    if (el('q').value) qs.set('q', el('q').value);
    const lista = await G.get('/api/cib/movimentacoes?' + qs);
    el('tb').innerHTML = lista.map((x) => `<tr><td class="small">${G.dataHora(x.criadoEm)}</td><td class="mono"><a href="#" data-im="${x.imovelId || ''}">${esc(x.inscricao)}</a></td><td>${G.pill(x.tipo)}</td>
      <td class="small">${esc(G.ROT[x.origem] || x.origem)}<div class="dim">${esc(x.documentoRef)}</div></td>
      <td class="small">${esc(x.descricao)}${difs(x)}${x.erros.length ? x.erros.map((e) => `<div class="pend erro"><b>ERRO</b><span>${esc(e.mensagem)}</span></div>`).join('') : ''}${x.retornoMsg ? `<div class="dim">Sinter: ${esc(x.retornoMsg)}</div>` : ''}</td>
      <td>${G.pill(x.status)}${x.remessaNumero ? `<div class="dim small mono">rem. ${String(x.remessaNumero).padStart(2, '0')}</div>` : ''}</td>
      <td style="white-space:nowrap">${x.status === 'capturada' ? `<button class="b sm ok" data-v="${x.id}">Validar</button> <button class="b sm" data-e="${x.id}">Editar</button> <button class="b sm" data-d="${x.id}">✕</button>` : ''}
        ${x.status === 'rejeitada' ? `<button class="b sm" data-r="${x.id}">Reenviar</button> <button class="b sm" data-e="${x.id}">Corrigir</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhuma movimentação nesta competência.</td></tr>';
    v.querySelectorAll('[data-im]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); if (a.dataset.im) fichaImovel(Number(a.dataset.im)); }));
    v.querySelectorAll('[data-v]').forEach((b) => (b.onclick = async () => {
      try { await G.post(`/api/cib/movimentacoes/${b.dataset.v}/validar`); G.toast('Validada e aplicada no cadastro. Entrou na fila de transmissão.'); }
      catch (e) { G.toast('Não validou: ' + ((e.data?.erros || []).map((x) => x.mensagem).join('; ') || e.message), true); }
      carregar(); atualizarBadges();
    }));
    v.querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => {
      const mot = await G.confirmar('Descartar evento', 'O evento não será aplicado nem transmitido.', { campo: 'Motivo', rotulo: 'Descartar' });
      if (mot == null) return;
      try { await G.post(`/api/cib/movimentacoes/${b.dataset.d}/descartar`, { motivo: mot }); carregar(); } catch (e) { G.falha(e); }
    }));
    v.querySelectorAll('[data-r]').forEach((b) => (b.onclick = async () => { try { await G.post(`/api/cib/movimentacoes/${b.dataset.r}/reenviar`); G.toast('Voltou para a fila de transmissão.'); carregar(); } catch (e) { G.falha(e); } }));
    v.querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => editarMov(lista.find((x) => x.id === Number(b.dataset.e)), carregar)));
  };
  ['comp', 'fst', 'pend'].forEach((id) => (el(id).onchange = carregar));
  let deb; el('q').oninput = () => { clearTimeout(deb); deb = setTimeout(carregar, 300); };
  el('bt-ev').onclick = () => registrarEvento(carregar);
  el('bt-parc').onclick = () => parcelamento(carregar);
  el('bt-val').onclick = async () => {
    try { const r = await G.post('/api/cib/movimentacoes/validar-lote'); G.toast(`${r.validadas} validadas · ${r.comErros} com erro (corrija e valide de novo).`); carregar(); atualizarBadges(); } catch (e) { G.falha(e); }
  };
  await carregar();
}

function seletorCampos(prefixo = 'ev') {
  const ops = G.CAMPOS.filter(([k]) => k !== 'inscricao').map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  return `<div id="${prefixo}-campos"></div><button class="b sm" type="button" id="${prefixo}-add">＋ campo alterado</button><template id="${prefixo}-tpl"><div class="f" style="margin-bottom:6px;grid-template-columns:1fr 1fr auto"><select class="k">${ops}</select><input class="vv" placeholder="novo valor" /><button class="b sm" type="button">✕</button></div></template>`;
}
function ligarCampos(m, prefixo = 'ev', inicial = {}) {
  const add = (k, val) => {
    const n = m.$(`#${prefixo}-tpl`).content.firstElementChild.cloneNode(true);
    if (k) n.querySelector('.k').value = k;
    if (val != null) n.querySelector('.vv').value = val;
    n.querySelector('button').onclick = () => n.remove();
    m.$(`#${prefixo}-campos`).appendChild(n);
  };
  m.$(`#${prefixo}-add`).onclick = () => add();
  Object.entries(inicial).forEach(([k, val]) => add(k, val));
  return () => Object.fromEntries([...m.$$(`#${prefixo}-campos .f`)].map((r) => [r.querySelector('.k').value, r.querySelector('.vv').value]));
}

const PRESETS = {
  itbi: { tipo: 'alteracao', campos: ['contribuinte_nome', 'contribuinte_doc', 'matricula_cartorio'], desc: 'Transferência de titularidade (ITBI)' },
  habite_se: { tipo: 'alteracao', campos: ['area_construida_m2', 'n_pavimentos', 'tipo'], desc: 'Construção/ampliação concluída (habite-se)' },
  alvara: { tipo: 'alteracao', campos: ['uso', 'area_construida_m2'], desc: 'Alvará (construção/funcionamento)' },
  bci: { tipo: 'alteracao', campos: ['area_construida_m2', 'uso'], desc: 'Atualização por coleta de campo' },
  manual: { tipo: 'alteracao', campos: [], desc: '' },
};
function registrarEvento(depois) {
  const m = G.modal({
    titulo: 'Registrar evento (Capturar)', largo: true,
    corpo: `<div class="f c3">
      <label>Origem<select id="e-orig">${['itbi', 'habite_se', 'alvara', 'bci', 'requerimento', 'manual'].map((o) => `<option value="${o}">${G.ROT[o]}</option>`).join('')}</select></label>
      <label>Tipo<select id="e-tipo">${['alteracao', 'inclusao', 'baixa', 'reativacao'].map((t) => `<option value="${t}">${G.ROT[t]}</option>`).join('')}</select></label>
      <label>Nº do documento de origem<input id="e-ref" placeholder="ITBI 2026/123, Habite-se 45/2026…" /></label>
      <label>Inscrição *<input id="e-insc" placeholder="ex.: 01.03.0127" autocomplete="off" /><div class="sug" id="e-sug" hidden></div></label>
      <label class="full" style="grid-column:span 2">Descrição<input id="e-desc" /></label>
      <div class="full"><div class="small dim" style="margin:6px 0">Campos alterados (para inclusão, informe todos os dados do imóvel)</div>${seletorCampos('ev')}</div></div>`,
    rodape: `<span class="dim small">O evento só altera o cadastro depois de validado.</span><div class="g-actions"><button class="b" data-a="c">Cancelar</button><button class="b" data-a="s">Capturar</button><button class="b pri" data-a="sv">Capturar e validar</button></div>`,
  });
  const lerCampos = ligarCampos(m, 'ev');
  const preset = () => {
    const p = PRESETS[m.$('#e-orig').value];
    if (!p) return;
    m.$('#e-tipo').value = p.tipo; m.$('#e-desc').value = p.desc;
    m.$('#ev-campos').innerHTML = ''; p.campos.forEach((k) => m.$('#ev-add').click() || (m.$$('#ev-campos .k')[m.$$('#ev-campos .k').length - 1].value = k));
  };
  m.$('#e-orig').onchange = preset; preset();
  autocompletarInscricao(m.$('#e-insc'), m.$('#e-sug'));
  m.$('[data-a=c]').onclick = m.fechar;
  const enviar = async (validar) => {
    try {
      const mov = await G.post('/api/cib/movimentacoes', { tipo: m.$('#e-tipo').value, origem: m.$('#e-orig').value, inscricao: m.$('#e-insc').value.trim(), documentoRef: m.$('#e-ref').value, descricao: m.$('#e-desc').value, dadosDepois: lerCampos() });
      if (validar) {
        try { await G.post(`/api/cib/movimentacoes/${mov.id}/validar`); G.toast('Evento capturado, validado e aplicado no cadastro.'); }
        catch (e) { G.toast('Capturado, mas não validou: ' + ((e.data?.erros || []).map((x) => x.mensagem).join('; ') || e.message), true); }
      } else G.toast('Evento capturado. Valide para aplicar no cadastro.');
      m.fechar(); depois && depois(); atualizarBadges();
    } catch (e) { G.falha(e); }
  };
  m.$('[data-a=s]').onclick = () => enviar(false);
  m.$('[data-a=sv]').onclick = () => enviar(true);
}
function editarMov(x, depois) {
  const m = G.modal({
    titulo: `Completar evento · ${esc(x.inscricao)}`, largo: true,
    corpo: `<div class="f"><label>Documento de origem<input id="m-ref" value="${esc(x.documentoRef)}" /></label><label>Descrição<input id="m-desc" value="${esc(x.descricao)}" /></label>
      <div class="full">${seletorCampos('em')}</div></div>`,
    rodape: `<span></span><div class="g-actions"><button class="b" data-a="c">Cancelar</button><button class="b pri" data-a="s">Salvar e validar</button></div>`,
  });
  const ler = ligarCampos(m, 'em', x.dadosDepois || {});
  m.$('[data-a=c]').onclick = m.fechar;
  m.$('[data-a=s]').onclick = async () => {
    try {
      await G.put('/api/cib/movimentacoes/' + x.id, { dadosDepois: ler(), documentoRef: m.$('#m-ref').value, descricao: m.$('#m-desc').value });
      try { await G.post(`/api/cib/movimentacoes/${x.id}/validar`); G.toast('Validada.'); } catch (e) { G.toast('Salvo, mas ainda não valida: ' + ((e.data?.erros || []).map((y) => y.mensagem).join('; ') || e.message), true); }
      m.fechar(); depois && depois();
    } catch (e) { G.falha(e); }
  };
}
function parcelamento(depois) {
  const m = G.modal({
    titulo: 'Parcelamento do solo', largo: true,
    corpo: `<p class="small dim" style="margin-top:0">Desmembramento, remembramento, desdobro ou loteamento: as inscrições de origem são baixadas e as novas incluídas, num único ato — tudo vai ao Sinter na próxima remessa.</p>
      <div class="f c3"><label>Modalidade<select id="p-mod"><option value="desmembramento">Desmembramento</option><option value="remembramento">Remembramento</option><option value="desdobro">Desdobro</option><option value="loteamento">Loteamento</option></select></label>
      <label>Inscrição(ões) de origem<input id="p-orig" placeholder="01.03.0127 (separe por vírgula)" /></label><label>Ato / processo<input id="p-ref" placeholder="Decreto 14/2026" /></label></div>
      <div class="small dim" style="margin:12px 0 6px">Novas unidades (logradouro, bairro e contribuinte são herdados da origem)</div>
      <table class="t" id="p-tab"><thead><tr><th>Nova inscrição</th><th>Lote (CTM)</th><th>Número</th><th>Área do terreno (m²)</th><th></th></tr></thead><tbody></tbody></table>
      <button class="b sm" id="p-add" style="margin-top:6px">＋ unidade</button>`,
    rodape: `<span></span><div class="g-actions"><button class="b" data-a="c">Cancelar</button><button class="b pri" data-a="s">Registrar parcelamento</button></div>`,
  });
  const linha = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input class="pi" style="width:100%" /></td><td><input class="pl" style="width:100%" /></td><td><input class="pn" style="width:100%" /></td><td><input class="pa" style="width:100%" inputmode="decimal" /></td><td><button class="b sm">✕</button></td>`;
    tr.querySelector('button').onclick = () => tr.remove();
    m.$('#p-tab tbody').appendChild(tr);
  };
  linha(); linha();
  m.$('#p-add').onclick = linha;
  m.$('[data-a=c]').onclick = m.fechar;
  m.$('[data-a=s]').onclick = async () => {
    const novas = [...m.$$('#p-tab tbody tr')].map((tr) => ({ inscricao: tr.querySelector('.pi').value.trim(), lote_codigo: tr.querySelector('.pl').value.trim(), numero: tr.querySelector('.pn').value.trim(), area_terreno_m2: tr.querySelector('.pa').value }))
      .filter((n) => n.inscricao).map((n) => Object.fromEntries(Object.entries(n).filter(([, val]) => val !== '')));
    try {
      const r = await G.post('/api/cib/movimentacoes/parcelamento', { modalidade: m.$('#p-mod').value, origens: m.$('#p-orig').value, documentoRef: m.$('#p-ref').value, novas });
      G.toast(`${r.length} eventos capturados. Complete e valide as inclusões.`); m.fechar(); depois && depois();
    } catch (e) { G.falha(e); }
  };
}
function autocompletarInscricao(input, box, aoEscolher) {
  let deb;
  input.oninput = () => {
    clearTimeout(deb);
    deb = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { box.hidden = true; return; }
      try {
        const r = await G.get('/api/cib/imoveis?limit=8&q=' + encodeURIComponent(q));
        box.innerHTML = r.itens.map((i) => `<div data-i="${esc(i.inscricao)}" data-id="${i.id}"><strong class="mono">${esc(i.inscricao)}</strong> · ${esc(i.logradouro)} ${esc(i.numero)} · <span class="dim">${esc(i.contribuinteNome)}</span></div>`).join('') || '<div class="dim">Nenhum imóvel (para inclusão, digite a nova inscrição).</div>';
        box.hidden = false;
        box.querySelectorAll('[data-i]').forEach((d) => (d.onclick = () => { input.value = d.dataset.i; box.hidden = true; aoEscolher && aoEscolher(Number(d.dataset.id)); }));
      } catch { box.hidden = true; }
    }, 250);
  };
  input.onblur = () => setTimeout(() => (box.hidden = true), 200);
}
window.autocompletarInscricao = autocompletarInscricao;

// ------------------------------------------------------------------ REMESSAS
async function remessas(v) {
  const [lista, p, cfg] = await Promise.all([G.get('/api/cib/remessas'), G.get('/api/cib/painel'), G.get('/api/cib/config')]);
  v.innerHTML = `${cabecalho('Transmitir', 'Remessas ao Sinter', 'Movimentações validadas viram uma remessa numerada. Envie por API ou em lote (arquivo para o portal), registre o protocolo e processe o retorno: cada item é conciliado, rejeitado ou vira divergência. O hash SHA-256 de cada arquivo fica na auditoria.',
    `<button class="b" id="bt-carga">Carga inicial (implantação)</button><button class="b pri" id="bt-prep" ${p.filas.transmitir ? '' : 'disabled'}>Preparar remessa (${p.filas.transmitir})</button>`)}
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Nº</th><th>Competência</th><th>Status</th><th>Modo / protocolo</th><th class="num">Itens</th><th class="num">OK</th><th class="num">Diverg.</th><th class="num">Rejeit.</th><th>Enviada</th><th></th></tr></thead>
    <tbody>${lista.map((r) => `<tr><td class="mono"><strong>${String(r.numero).padStart(2, '0')}</strong></td><td>${esc(r.competencia)}</td><td>${G.pill(r.status)}</td>
      <td class="small">${esc(r.modo)}${r.protocolo ? `<div class="mono">${esc(r.protocolo)}</div>` : ''}</td><td class="num">${r.qtd_itens}</td><td class="num">${r.qtd_ok}</td><td class="num">${r.qtd_divergente}</td><td class="num">${r.qtd_erro}</td>
      <td class="small">${G.dataHora(r.enviada_em)}</td>
      <td style="white-space:nowrap"><button class="b sm" data-j="${r.id}" data-n="${r.numero}">JSON</button> <button class="b sm" data-c="${r.id}" data-n="${r.numero}">CSV</button> <button class="b sm" data-it="${r.id}">itens</button>
        ${r.status === 'preparada' ? `<button class="b sm pri" data-env="${r.id}">Enviar</button>` : ''}
        ${['enviada', 'parcial'].includes(r.status) ? `<button class="b sm" data-ret="${r.id}">Importar retorno</button>${cfg.simulacao ? ` <button class="b sm" data-sim="${r.id}" title="Somente demonstração">Simular retorno</button>` : ''}` : ''}</td></tr>`).join('') || '<tr><td colspan="10" class="vazio">Nenhuma remessa ainda. Faça a carga inicial e prepare a primeira.</td></tr>'}</tbody></table></div>
    <div class="box" style="margin-top:16px"><h3>Como operamos</h3><p class="small" style="margin:0">O convênio Sinter permite até 3 transmissores pessoa jurídica por município. O município continua titular do convênio e responsável pelo cadastro; a rotina é operada,
      documentada a cada envio e prestada em relatório mensal. ${cfg.transmissores ? `Transmissor(es): <strong>${esc(cfg.transmissores)}</strong>.` : ''} O layout do arquivo segue <span class="mono">BzR-Sinter/1.0</span> e é ajustável ao layout oficial do Manual Operacional.</p></div>`;
  el('bt-prep').onclick = async () => { try { const r = await G.post('/api/cib/remessas'); G.toast(`Remessa ${r.numero} preparada com ${r.qtd_itens} itens.`); remessas(v); } catch (e) { G.falha(e); } };
  el('bt-carga').onclick = async () => {
    if (!(await G.confirmar('Carga inicial', 'Coloca na fila de transmissão todo imóvel ativo, sem pendência bloqueante, que nunca foi ao Sinter.', { rotulo: 'Enfileirar' }))) return;
    try { const r = await G.post('/api/cib/movimentacoes/carga-inicial'); G.toast(`${r.enfileirados} imóveis enfileirados.`); remessas(v); } catch (e) { G.falha(e); }
  };
  v.querySelectorAll('[data-j]').forEach((b) => (b.onclick = () => G.baixar(`/api/cib/remessas/${b.dataset.j}/arquivo`, `remessa-sinter-${b.dataset.n}.json`).catch(G.falha)));
  v.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => G.baixar(`/api/cib/remessas/${b.dataset.c}/arquivo?formato=csv`, `remessa-sinter-${b.dataset.n}.csv`).catch(G.falha)));
  v.querySelectorAll('[data-it]').forEach((b) => (b.onclick = () => itensRemessa(Number(b.dataset.it)).catch(G.falha)));
  v.querySelectorAll('[data-env]').forEach((b) => (b.onclick = async () => {
    const m = G.modal({
      titulo: 'Enviar remessa',
      corpo: `<div class="f"><label>Modo<select id="md"><option value="lote">Em lote (arquivo enviado no portal do Sinter)</option><option value="api">Via API (requer SINTER_API_URL)</option></select></label>
        <label>Protocolo do Sinter<input id="pr" placeholder="gerado automaticamente se vazio" /></label></div><p class="small dim">No envio em lote, baixe o arquivo (JSON/CSV), transmita no portal e informe o protocolo recebido.</p>`,
      rodape: `<span></span><div class="g-actions"><button class="b" data-a="c">Cancelar</button><button class="b pri" data-a="s">Marcar como enviada</button></div>`,
    });
    m.$('[data-a=c]').onclick = m.fechar;
    m.$('[data-a=s]').onclick = async () => { try { await G.post(`/api/cib/remessas/${b.dataset.env}/enviar`, { modo: m.$('#md').value, protocolo: m.$('#pr').value }); G.toast('Remessa enviada.'); m.fechar(); remessas(v); } catch (e) { G.falha(e); } };
  }));
  v.querySelectorAll('[data-sim]').forEach((b) => (b.onclick = async () => { try { const r = await G.post(`/api/cib/remessas/${b.dataset.sim}/simular-retorno`); G.toast(`Retorno (simulado): ${r.ok} ok, ${r.divergentes} divergentes, ${r.rejeitadas} rejeitadas.`); remessas(v); } catch (e) { G.falha(e); } }));
  v.querySelectorAll('[data-ret]').forEach((b) => (b.onclick = () => importarRetorno(Number(b.dataset.ret), () => remessas(v))));
}
async function itensRemessa(id) {
  const lista = await G.get('/api/cib/movimentacoes?remessa=' + id);
  G.modal({ titulo: `Itens da remessa (${lista.length})`, largo: true, corpo: `<div class="tbl-wrap"><table class="t"><thead><tr><th>Inscrição</th><th>Tipo</th><th>Origem</th><th>Status</th><th>Retorno</th></tr></thead><tbody>${lista.map((x) => `<tr><td class="mono">${esc(x.inscricao)}</td><td>${G.pill(x.tipo)}</td><td class="small">${esc(G.ROT[x.origem] || x.origem)}</td><td>${G.pill(x.status)}</td><td class="small">${esc(x.retornoMsg)}</td></tr>`).join('')}</tbody></table></div>` });
}
function importarRetorno(id, depois) {
  const m = G.modal({
    titulo: 'Importar retorno do Sinter', largo: true,
    corpo: `<p class="small dim" style="margin-top:0">CSV com as colunas <span class="mono">inscricao; situacao (ok | divergente | erro); cib; campo; valor_externo; mensagem</span>. Aceita também JSON (lista de objetos).</p>
      <input type="file" id="arq" accept=".csv,.txt,.json" /><div id="prev" class="small" style="margin-top:10px"></div>`,
    rodape: `<span></span><div class="g-actions"><button class="b" data-a="c">Cancelar</button><button class="b pri" data-a="s" disabled>Processar retorno</button></div>`,
  });
  let itens = [];
  m.$('[data-a=c]').onclick = m.fechar;
  m.$('#arq').onchange = async (e) => {
    const txt = await e.target.files[0].text();
    try {
      if (txt.trim().startsWith('[') || txt.trim().startsWith('{')) { const j = JSON.parse(txt); itens = Array.isArray(j) ? j : (j.itens || []); }
      else {
        const { cab, linhas } = G.parseCsv(txt);
        const ks = cab.map((h) => ({ inscricao_municipal: 'inscricao', valor_sinter: 'valorExterno', valor_externo: 'valorExterno', valor_municipio: 'valorMunicipio', status: 'situacao' }[G.norm(h)] || G.norm(h)));
        itens = linhas.map((l) => Object.fromEntries(ks.map((k, i) => [k, l[i]])));
      }
      const cont = itens.reduce((a, x) => ((a[String(x.situacao || 'ok').toLowerCase()] = (a[String(x.situacao || 'ok').toLowerCase()] || 0) + 1), a), {});
      m.$('#prev').innerHTML = `${itens.length} itens · ${Object.entries(cont).map(([k, n]) => `${esc(k)}: ${n}`).join(' · ')}`;
      m.$('[data-a=s]').disabled = !itens.length;
    } catch (err) { m.$('#prev').textContent = 'Arquivo inválido: ' + err.message; }
  };
  m.$('[data-a=s]').onclick = async () => {
    try { const r = await G.post(`/api/cib/remessas/${id}/retorno`, { itens }); G.toast(`Retorno: ${r.ok} conciliados, ${r.divergentes} divergentes, ${r.rejeitadas} rejeitados, ${r.ignorados} ignorados.`); m.fechar(); depois(); } catch (e) { G.falha(e); }
  };
}

// ------------------------------------------------------------------ CONCILIACAO
async function conciliacao(v) {
  const st = (S.params && S.params.status) || 'aberta';
  const lista = await G.get('/api/cib/divergencias?status=' + st);
  v.innerHTML = `${cabecalho('Conciliar', 'Divergências', 'Cruzamento entre o cadastro municipal, o Sinter e os cartórios. Para cada divergência: adotar o dado externo (o cadastro é ajustado e a alteração retransmitida), manter o dado municipal (retransmite com justificativa) ou desconsiderar.',
    `<select id="fst" class="b"><option value="aberta" ${st === 'aberta' ? 'selected' : ''}>Abertas</option><option value="resolvida" ${st === 'resolvida' ? 'selected' : ''}>Resolvidas</option><option value="ignorada" ${st === 'ignorada' ? 'selected' : ''}>Desconsideradas</option></select>`)}
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Inscrição</th><th>Fonte</th><th>Campo</th><th>Município</th><th>Externo</th><th>Mensagem</th><th>Remessa</th><th></th></tr></thead><tbody>
    ${lista.map((d) => `<tr><td class="mono"><a href="#" data-im="${d.imovel_id}">${esc(d.inscricao)}</a><div class="dim small">${esc(d.logradouro)} ${esc(d.numero)}</div></td><td>${esc(d.fonte)}</td><td>${esc(G.ROTULO_CAMPO[d.campo] || d.campo || '—')}</td>
      <td><strong>${esc(d.valor_municipio || '—')}</strong></td><td><strong>${esc(d.valor_externo || '—')}</strong></td><td class="small">${esc(d.mensagem)}${d.resolucao ? `<div class="dim">${esc(d.resolucao)} — ${esc(d.resolvido_por_nome)}</div>` : ''}</td>
      <td class="mono">${d.remessa_numero ? String(d.remessa_numero).padStart(2, '0') : '—'}</td>
      <td style="white-space:nowrap">${d.status === 'aberta' ? `<button class="b sm ok" data-a="adotar_externo" data-id="${d.id}">Adotar externo</button> <button class="b sm" data-a="manter_municipio" data-id="${d.id}">Manter municipal</button> <button class="b sm" data-a="ignorar" data-id="${d.id}">Desconsiderar</button>` : G.pill(d.status)}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Nenhuma divergência.</td></tr>'}
    </tbody></table></div>`;
  el('fst').onchange = () => irPara('conciliacao', { status: el('fst').value });
  v.querySelectorAll('[data-im]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); fichaImovel(Number(a.dataset.im)); }));
  v.querySelectorAll('button[data-a]').forEach((b) => (b.onclick = async () => {
    const txt = { adotar_externo: 'O cadastro municipal será ajustado para o valor externo e a alteração entra na próxima remessa.', manter_municipio: 'O dado municipal será retransmitido com justificativa.', ignorar: 'A divergência será desconsiderada.' }[b.dataset.a];
    const just = await G.confirmar('Resolver divergência', txt, { campo: 'Justificativa (fica na auditoria)', rotulo: 'Confirmar' });
    if (just == null) return;
    try { await G.post(`/api/cib/divergencias/${b.dataset.id}/resolver`, { acao: b.dataset.a, resolucao: just }); G.toast('Divergência resolvida.'); conciliacao(v); atualizarBadges(); } catch (e) { G.falha(e); }
  }));
}

// ------------------------------------------------------------------ VISTORIA (IA)
async function vistoria(v) {
  const lista = await G.get('/api/cib/vistorias');
  const pend = lista.filter((x) => ['pendente', 'agendada'].includes(x.status));
  const novas = pend.filter((x) => x.tipo === 'edificacao_nova').length, ampl = pend.filter((x) => x.tipo === 'ampliacao').length;
  v.innerHTML = `${cabecalho('Tecnologia · inteligência artificial', 'E se o mapa avisasse quando surge uma casa nova?', 'As edificações extraídas da ortofoto (visão computacional → camada de edificações do Território) são cruzadas com o cadastro. O que existe no chão e não existe no cadastro vira lista de vistoria — com conferência em campo antes de qualquer lançamento.',
    `<button class="b pri" id="bt-det">🛰 Detectar diferenças</button>`)}
    <div class="cards" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      <div class="kpi amarelo"><div class="l">diferenças a vistoriar</div><div class="v">${pend.length}</div><div class="s">${novas} novas · ${ampl} ampliações · ${pend.length - novas - ampl} outras</div></div>
      <div class="kpi verde"><div class="l">confirmadas em campo</div><div class="v">${lista.filter((x) => x.status === 'confirmada').length}</div><div class="s">viraram movimentação no ciclo mensal</div></div>
      <div class="kpi"><div class="l">descartadas</div><div class="v">${lista.filter((x) => x.status === 'descartada').length}</div><div class="s">falso positivo / já regular</div></div>
    </div>
    <div class="grid2"><div class="box"><h3>Mapa das diferenças</h3><div class="mapa" id="mp" style="height:420px"></div>
      <div class="legenda"><span><i style="background:#0f7a3d"></i>nova, fora do cadastro</span><span><i style="background:#f5c518"></i>ampliação</span><span><i style="background:#9aa09a"></i>possível demolição</span></div></div>
    <div class="box"><h3>Lista de vistoria <select id="fst" class="small"><option value="ab">pendentes</option><option value="todas">todas</option></select></h3><div id="lv" style="max-height:470px;overflow-y:auto"></div></div></div>
    <div class="box" style="margin-top:16px"><h3>Como funciona</h3><div class="filas" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="fila"><div class="v">1</div><div class="l"><strong>Ortofoto</strong> — imagem aérea recente (drone) no Território.</div></div>
      <div class="fila"><div class="v">2</div><div class="l"><strong>IA</strong> — extrai o contorno de cada edificação (importado como camada).</div></div>
      <div class="fila"><div class="v">3</div><div class="l"><strong>Cruzamento</strong> — compara a área edificada com lotes e unidades cadastradas.</div></div>
      <div class="fila"><div class="v">4</div><div class="l"><strong>Vistoria</strong> — conferência em campo antes de qualquer lançamento.</div></div></div></div>`;
  const cor = { edificacao_nova: '#0f7a3d', ampliacao: '#f5c518', demolicao: '#9aa09a' };
  const m = mapaBase(el('mp'));
  const pts = pend.filter((x) => x.lat != null).map((x) => L.circleMarker([x.lat, x.lng], { radius: 8, color: '#111', weight: 1.5, dashArray: '3', fillColor: cor[x.tipo], fillOpacity: 0.9 }).bindPopup(`<strong>Lote ${esc(x.lote_codigo)}</strong><br>${G.ROT[x.tipo]}<br>edificada ${G.m2(x.area_detectada_m2)} · cadastrada ${G.m2(x.area_cadastrada_m2)}`));
  if (pts.length) { const g = L.featureGroup(pts).addTo(m); m.fitBounds(g.getBounds(), { padding: [30, 30] }); }
  const pintar = () => {
    const arr = el('fst').value === 'todas' ? lista : pend;
    el('lv').innerHTML = arr.map((x) => `<div class="check" style="cursor:default;align-items:flex-start"><input type="checkbox" ${x.status === 'confirmada' ? 'checked' : ''} disabled />
      <div style="flex:1"><strong>Lote ${esc(x.lote_codigo)}</strong> · ${esc(G.ROT[x.tipo])} ${G.pill(x.status)}<div class="dim small">${esc(x.bairro)} · ${x.inscricao ? 'insc. ' + esc(x.inscricao) : 'sem inscrição'} · edificada ${G.m2(x.area_detectada_m2)} × cadastrada ${G.m2(x.area_cadastrada_m2)}${x.demanda_id ? ` · <a href="/demandas/">demanda #${x.demanda_id}</a>` : ''}</div>
      ${['pendente', 'agendada'].includes(x.status) ? `<div class="g-actions" style="margin-top:6px">${x.status === 'pendente' ? `<button class="b sm" data-ag="${x.id}">Agendar vistoria</button>` : ''}<button class="b sm ok" data-cf="${x.id}">Confirmar</button><button class="b sm" data-ds="${x.id}">Descartar</button>${x.imovel_id ? `<button class="b sm" data-nt="${x.imovel_id}">Notificar</button>` : ''}</div>` : (x.obs ? `<div class="dim small">${esc(x.obs)}</div>` : '')}</div></div>`).join('') || '<div class="vazio">Nada a vistoriar. Rode a detecção após importar edificações recentes.</div>';
    el('lv').querySelectorAll('[data-ag]').forEach((b) => (b.onclick = async () => { try { const r = await G.patch('/api/cib/vistorias/' + b.dataset.ag, { acao: 'agendar' }); G.toast(`Vistoria agendada · demanda #${r.demanda_id} criada para a equipe de campo.`); vistoria(v); } catch (e) { G.falha(e); } }));
    el('lv').querySelectorAll('[data-cf]').forEach((b) => (b.onclick = async () => {
      const x = lista.find((y) => y.id === Number(b.dataset.cf));
      const area = await G.confirmar('Confirmar em campo', `A diferença foi confirmada na vistoria? Informe a área construída conferida (m²). ${x.imovel_id ? 'Será capturada uma alteração.' : 'Será capturada uma inclusão (complete os dados do contribuinte no ciclo mensal).'}`, { campo: 'Área construída conferida (m²)', placeholder: String(x.area_detectada_m2), rotulo: 'Confirmar' });
      if (area == null) return;
      try { await G.patch('/api/cib/vistorias/' + x.id, { acao: 'confirmar', areaConstruida: area || x.area_detectada_m2 }); G.toast('Confirmada — evento capturado no ciclo mensal.'); vistoria(v); } catch (e) { G.falha(e); }
    }));
    el('lv').querySelectorAll('[data-ds]').forEach((b) => (b.onclick = async () => { const obs = await G.confirmar('Descartar', 'Marcar como falso positivo?', { campo: 'Observação', rotulo: 'Descartar' }); if (obs == null) return; try { await G.patch('/api/cib/vistorias/' + b.dataset.ds, { acao: 'descartar', obs }); vistoria(v); } catch (e) { G.falha(e); } }));
    el('lv').querySelectorAll('[data-nt]').forEach((b) => (b.onclick = () => emitirDoc('notificacao_atualizacao', { imovelId: Number(b.dataset.nt), campos: { prazoDias: 30, motivo: 'Divergência entre a área edificada identificada em imagem aérea recente e a área cadastrada.' } })));
  };
  el('fst').onchange = pintar; pintar();
  el('bt-det').onclick = async () => { try { const r = await G.post('/api/cib/vistorias/detectar'); G.toast(`${r.analisados} lotes analisados · ${r.diferencas} diferenças · ${r.novas} novas na lista.`); vistoria(v); } catch (e) { G.falha(e); } };
}

// ------------------------------------------------------------------ IMPLANTACAO
async function implantacao(v) {
  const [imp, d] = await Promise.all([G.get('/api/cib/implantacao'), G.get('/api/cib/diagnostico')]);
  const di = d.imoveis;
  v.innerHTML = `${cabecalho('Módulo central · Fase 1', 'Cinco etapas até o CIB', 'Do cadastro de hoje ao código nacional de cada imóvel. Os indicadores de cada etapa são calculados em tempo real a partir da base.',
    `<button class="b" id="bt-rdiag">Relatório de diagnóstico</button><button class="b" id="bt-oficio">Ofício de adesão (minuta)</button><button class="b" id="bt-termo">Termo de transmissor</button>`)}
    <div class="box"><div class="stepper">${imp.etapas.map((e, i) => `${i ? `<div class="ln ${e.status !== 'a_fazer' ? 'on' : ''}"></div>` : ''}<div class="st ${e.status}"><i>${e.status === 'concluida' ? '✓' : e.n}</i>${esc(e.titulo)}</div>`).join('')}</div>
      <div class="small"><strong>Etapa ${imp.etapaAtual} de 5 · ${esc(imp.etapas[imp.etapaAtual - 1].titulo)} em andamento</strong></div></div>
    <div class="grid2" style="margin-top:16px"><div>${imp.etapas.map((e) => `<div class="etapa ${e.status}"><div class="n">0${e.n}</div><div><h4>${esc(e.titulo)} ${G.pill(e.status === 'concluida' ? 'conciliado' : (e.status === 'em_andamento' ? 'pendente' : 'baixa'), e.status === 'concluida' ? 'concluída' : (e.status === 'em_andamento' ? 'em andamento' : 'a fazer'))}</h4>
        <p>${esc(e.descricao)}</p><p style="margin-top:6px;color:var(--ink)"><strong>${esc(e.metrica.texto)}</strong></p><div class="barra"><span style="width:${Math.min(100, Math.max(0, e.metrica.progresso))}%"></span></div>
        <textarea data-obs="${e.id}" placeholder="Observações da etapa" style="width:100%;max-width:520px;margin-top:8px;background:var(--card);color:var(--ink);border:1px solid var(--line);padding:6px 8px;font:12.5px var(--font-ui);min-height:34px">${esc(e.obs || '')}</textarea></div>
        <div>${e.n === imp.etapaAtual && e.n < 5 ? `<button class="b sm pri" data-av="${e.n + 1}">Concluir etapa →</button>` : ''}${e.n === imp.etapaAtual && e.n > 1 ? ` <button class="b sm" data-av="${e.n - 1}">← voltar</button>` : ''}</div></div>`).join('')}</div>
      <div><div class="box"><h3>Adesão ao convênio Sinter</h3>${imp.checklist.map((c) => `<label class="check"><input type="checkbox" data-ck="${c.id}" ${c.feito ? 'checked' : ''} />${esc(c.label)}</label>`).join('')}
        <p class="small dim" style="margin-bottom:0"><strong>Importante:</strong> a adesão ao convênio é ato do prefeito. A plataforma gera as minutas e a BzR apoia a configuração dos perfis de acesso.</p>
        <button class="b pri sm" id="bt-salvar" style="margin-top:10px">Salvar implantação</button></div>
        <div class="box"><h3>Raio-x da base · diagnóstico</h3>
          <div class="cards" style="grid-template-columns:1fr 1fr;margin-bottom:10px"><div class="kpi verde"><div class="l">prontos para o Sinter</div><div class="v">${String(di.pctProntos).replace('.', ',')}%</div><div class="s">${di.prontos} de ${di.ativos}</div></div>
          <div class="kpi amarelo"><div class="l">precisam de correção</div><div class="v">${String(di.pctComErro).replace('.', ',')}%</div><div class="s">${di.com_erro} imóveis</div></div></div>
          <table class="t small">${d.porRegra.map((r) => `<tr class="click" data-rg="${esc(r.codigo)}"><td><span class="pill ${r.nivel === 'erro' ? 'p-divergente' : 'p-pendente'}">${r.nivel === 'erro' ? 'bloqueia' : 'alerta'}</span></td><td>${esc(r.mensagem)}</td><td class="num"><strong>${r.n}</strong></td></tr>`).join('') || '<tr><td>Nenhuma pendência.</td></tr>'}
            <tr><td></td><td>Lotes do CTM sem inscrição (lacunas)</td><td class="num"><strong>${d.lotes.semImovel}</strong></td></tr>
            <tr><td></td><td>Possíveis duplicidades (mesmo contribuinte e endereço)</td><td class="num"><strong>${d.duplicidades}</strong></td></tr>
            <tr><td></td><td>Logradouros sem nome na base cartográfica</td><td class="num"><strong>${d.logradourosSemNome}</strong></td></tr></table>
          <p class="small" style="margin-bottom:0">Prazo estimado de integração: <strong>${d.estimativa.semanasTotal} semana(s)</strong> (saneamento ${d.estimativa.semanasSaneamento} + integração ${d.estimativa.semanasIntegracao}).</p></div></div></div>`;
  const salvar = async (etapa) => {
    const checklist = Object.fromEntries([...v.querySelectorAll('[data-ck]')].map((c) => [c.dataset.ck, c.checked]));
    const etapas = Object.fromEntries([...v.querySelectorAll('[data-obs]')].map((t) => [t.dataset.obs, { obs: t.value }]));
    try { await G.put('/api/cib/implantacao', { etapaAtual: etapa || imp.etapaAtual, checklist, etapas }); G.toast('Implantação atualizada.'); implantacao(v); } catch (e) { G.falha(e); }
  };
  el('bt-salvar').onclick = () => salvar();
  v.querySelectorAll('[data-av]').forEach((b) => (b.onclick = () => salvar(Number(b.dataset.av))));
  v.querySelectorAll('[data-rg]').forEach((tr) => (tr.onclick = () => irPara('imoveis', { regra: tr.dataset.rg })));
  el('bt-rdiag').onclick = () => emitirDoc('relatorio_diagnostico');
  el('bt-oficio').onclick = () => emitirDoc('oficio_adesao_sinter', { campos: { destinatario: 'Ao(À) Senhor(a) Delegado(a) da Receita Federal do Brasil', unidadeRfb: '' } });
  el('bt-termo').onclick = () => { location.href = '/documentos/#emitir:termo_transmissor'; };
}

// ------------------------------------------------------------------ PGV
async function pgv(v) {
  const d = await G.get('/api/cib/pgv');
  const val = (t, k) => d.valores.find((x) => x.tipo === t && x.chave.toUpperCase() === String(k).toUpperCase())?.valor ?? '';
  const ano = d.valores[0]?.ano || new Date().getFullYear();
  v.innerHTML = `${cabecalho('Serviço complementar', 'Planta Genérica de Valores', 'Valores de referência por m² de terreno (por bairro/zona) e de construção (por padrão construtivo). Ao salvar, o valor venal de todos os imóveis é recalculado — e passa a sair na Certidão de Valor Venal.',
    `<label class="small dim">Exercício <input id="ano" type="number" value="${ano}" style="width:90px" class="b" /></label><button class="b pri" id="bt-salvar">Salvar e recalcular</button>`)}
    <div class="grid2 eq"><div class="box"><h3>Terreno · R$/m² por bairro</h3><table class="t" id="tt">
      ${[...d.bairros, '*'].map((b) => `<tr><td>${b === '*' ? '<em>demais (padrão)</em>' : esc(b)}</td><td><input data-t="terreno" data-k="${esc(b)}" value="${val('terreno', b)}" inputmode="decimal" style="width:120px" class="b" /></td></tr>`).join('')}</table></div>
    <div class="box"><h3>Construção · R$/m² por padrão</h3><table class="t">${d.padroes.map((p) => `<tr><td>${esc(p)}</td><td><input data-t="construcao" data-k="${p}" value="${val('construcao', p)}" inputmode="decimal" style="width:120px" class="b" /></td></tr>`).join('')}</table>
      <h3 style="margin-top:18px">Valor venal por bairro</h3><table class="t small"><thead><tr><th>Bairro</th><th class="num">Imóveis</th><th class="num">Médio</th><th class="num">Total</th></tr></thead>
      ${d.resumo.map((r) => `<tr><td>${esc(r.bairro)}</td><td class="num">${r.n}</td><td class="num">${G.brl(r.medio)}</td><td class="num">${G.brl(r.total)}</td></tr>`).join('')}</table></div></div>`;
  el('bt-salvar').onclick = async () => {
    const pega = (t) => [...v.querySelectorAll(`[data-t=${t}]`)].filter((i) => i.value !== '').map((i) => ({ chave: i.dataset.k, valor: i.value }));
    try { await G.put('/api/cib/pgv', { ano: Number(el('ano').value), terreno: pega('terreno'), construcao: pega('construcao') }); G.toast('PGV salva e valores venais recalculados.'); pgv(v); } catch (e) { G.falha(e); }
  };
}

// ------------------------------------------------------------------ CONFIG
async function config(v) {
  const c = await G.get('/api/cib/config');
  const f = (k, l, extra = '') => `<label>${l}<input name="${k}" value="${esc(c[k] ?? '')}" ${extra} /></label>`;
  v.innerHTML = `${cabecalho('Configuração', 'Dados do município', 'Usados no cabeçalho, na assinatura e no rodapé de todas as certidões, declarações e relatórios, e no arquivo de remessa ao Sinter.', '<button class="b pri" id="bt-salvar">Salvar</button>')}
    <div class="grid2"><div class="box"><h3>Órgão emissor</h3><div class="f">
      ${f('nomeOficial', 'Nome oficial')}${f('cnpj', 'CNPJ da prefeitura')}${f('secretaria', 'Secretaria')}${f('setor', 'Setor')}${f('uf', 'UF', 'maxlength=2')}${f('codigoIbge', 'Código IBGE')}
      <label class="full">Endereço<input name="endereco" value="${esc(c.endereco)}" /></label>${f('telefone', 'Telefone')}${f('email', 'E-mail')}${f('site', 'Site')}${f('validadeCertidaoDias', 'Validade das certidões (dias)', 'type=number')}
      <label class="full">Rodapé dos documentos<input name="rodapeDocumentos" value="${esc(c.rodapeDocumentos)}" /></label></div></div>
    <div><div class="box"><h3>Assinaturas</h3><div class="f">${f('prefeitoNome', 'Prefeito(a)')}${f('responsavelNome', 'Responsável técnico')}${f('responsavelCargo', 'Cargo do responsável')}</div></div>
      <div class="box"><h3>Convênio Sinter</h3><div class="f">${f('convenioNumero', 'Nº do convênio')}${f('convenioData', 'Data de adesão', 'type=date')}${f('prazoSinter', 'Prazo legal de integração', 'type=date')}
        <label class="full">Transmissores PJ (até 3)<input name="transmissores" value="${esc(c.transmissores)}" /></label></div></div>
      <div class="box"><h3>Brasão</h3><div style="display:flex;gap:12px;align-items:center"><img id="br" src="${esc(c.brasao)}" alt="" style="width:72px;height:72px;object-fit:contain;border:1px dashed var(--line-2)" />
        <div><input type="file" id="brf" accept="image/png,image/jpeg,image/svg+xml" /><div class="small dim">PNG/JPG/SVG até ~300 KB.</div><button class="b sm" id="brx">remover</button></div></div></div></div></div>`;
  let brasao = c.brasao;
  el('brf').onchange = (e) => { const fl = e.target.files[0]; if (!fl) return; if (fl.size > 300000) return G.toast('Imagem muito grande.', true); const r = new FileReader(); r.onload = () => { brasao = r.result; el('br').src = brasao; }; r.readAsDataURL(fl); };
  el('brx').onclick = () => { brasao = ''; el('br').removeAttribute('src'); };
  el('bt-salvar').onclick = async () => {
    const body = lerForm(v); body.brasao = brasao;
    try { await G.put('/api/cib/config', body); G.toast('Configuração salva.'); } catch (e) { G.falha(e); }
  };
}

// ------------------------------------------------------------------ AUDITORIA
async function auditoria(v) {
  const lista = await G.get('/api/cib/auditoria?limit=500');
  v.innerHTML = `${cabecalho('Tudo documentado', 'Trilha de auditoria', 'Cada importação, edição, validação, remessa (com hash do arquivo), retorno, conciliação, documento e mudança de etapa — com data e responsável. A rotina sobrevive à troca de equipe.',
    '<input type="search" id="q" placeholder="Filtrar…" class="b" />')}
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Quando</th><th>Entidade</th><th>Ação</th><th>Detalhe</th><th>Responsável</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const pintar = () => {
    const q = G.norm(el('q').value);
    el('tb').innerHTML = lista.filter((a) => !q || G.norm(`${a.entidade} ${a.acao} ${a.detalhe} ${a.usuario_nome}`).includes(q))
      .map((a) => `<tr><td class="small" style="white-space:nowrap">${G.dataHora(a.created_at)}</td><td>${esc(a.entidade)}</td><td><span class="pill p-pronto">${esc(a.acao)}</span></td><td class="small">${esc(a.detalhe)}</td><td class="small">${esc(a.usuario_nome)}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Sem registros.</td></tr>';
  };
  el('q').oninput = pintar; pintar();
}

// ------------------------------------------------------------------ boot
window.addEventListener('hashchange', () => {
  const [t, a] = location.hash.slice(1).split(':');
  if (t && t !== S.tab && document.querySelector(`#tabs [data-tab="${t}"]`)) irPara(t, a);
});

(async () => {
  if (!(await G.iniciar({ aoTrocar: () => render() }))) return;
  const h = location.hash.slice(1);
  const q = new URLSearchParams(location.search).get('q');
  if (q) return irPara('imoveis', { q });
  irPara(['painel', 'imoveis', 'ciclo', 'remessas', 'conciliacao', 'vistoria', 'implantacao', 'pgv', 'config', 'auditoria'].includes(h) ? h : 'painel');
})();
