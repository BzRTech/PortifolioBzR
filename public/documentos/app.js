// Documentos e Atendimento — protocolo de requerimentos, emissao e livro de emitidos.
/* global G */
const { el, esc } = G;
const S = { tab: 'atendimento', cat: null, sel: null };

function irPara(tab, arg) {
  S.tab = tab; S.arg = arg;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  history.replaceState(null, '', '#' + tab + (arg ? ':' + arg : ''));
  render();
}
document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => irPara(b.dataset.tab)));

async function render() {
  const v = el('view');
  v.innerHTML = '<div class="vazio">Carregando…</div>';
  try {
    if (!S.cat) S.cat = await G.api('/api/documentos/catalogo');
    await ({ atendimento, emitir, emitidos }[S.tab] || atendimento)(v);
  } catch (e) { v.innerHTML = `<div class="vazio">Erro: ${esc(e.message)}</div>`; }
  try { const r = await G.get('/api/requerimentos?status=abertos'); el('bd-req').textContent = r.length || ''; } catch { /* ok */ }
}
const cab = (k, t, p, a = '') => `<div class="g-head"><div><div class="kicker">${k}</div><h2>${t}</h2>${p ? `<p>${p}</p>` : ''}</div><div class="g-actions">${a}</div></div>`;
const abrirDoc = (id) => window.open('/documentos/ver.html?id=' + id, '_blank');

// ------------------------------------------------------------------ ATENDIMENTO
async function atendimento(v) {
  v.innerHTML = `${cab('Protocolo', 'Atendimento ao cidadão', 'Requerimentos com número de protocolo, prazo e tramitação. Ao deferir: certidões são emitidas na hora; revisões, inclusões, transferências e baixas viram eventos do ciclo mensal (e vão ao Sinter); vistorias viram demanda para a equipe de campo.',
    '<button class="b pri" id="bt-novo">＋ Novo requerimento</button>')}
    <div class="toolbar2"><select id="fst"><option value="abertos">Em aberto</option><option value="">Todos</option>${['protocolado', 'em_analise', 'pendente_documentacao', 'deferido', 'indeferido', 'concluido', 'arquivado'].map((s) => `<option value="${s}">${G.ROT[s]}</option>`).join('')}</select>
      <select id="ftp"><option value="">Todos os assuntos</option>${S.cat.requerimentos.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select>
      <input type="search" id="q" placeholder="Protocolo, requerente, inscrição…" /></div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Protocolo</th><th>Assunto</th><th>Requerente</th><th>Inscrição</th><th>Prazo</th><th>Status</th><th>Responsável</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const carregar = async () => {
    const qs = new URLSearchParams({ status: el('fst').value, tipo: el('ftp').value, q: el('q').value });
    const lista = await G.get('/api/requerimentos?' + qs);
    el('tb').innerHTML = lista.map((r) => `<tr class="click" data-id="${r.id}"><td class="mono"><strong>${esc(r.numero)}</strong><div class="dim small">${G.data(r.criadoEm)}</div></td>
      <td>${esc(r.tipoLabel)}${r.documentoTipo ? `<div class="dim small">${esc(S.cat.documentos.find((d) => d.id === r.documentoTipo)?.titulo || '')}</div>` : ''}</td>
      <td>${esc(r.requerenteNome)}<div class="dim small mono">${esc(r.requerenteDocMascarado)}</div></td><td class="mono">${esc(r.inscricao || '—')}</td>
      <td>${G.data(r.prazo)} ${r.atrasado ? G.pill('atrasado', 'atrasado') : ''}</td><td>${G.pill(r.status)}</td><td class="small">${esc(r.responsavelNome || '—')}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum requerimento.</td></tr>';
    v.querySelectorAll('tr[data-id]').forEach((tr) => (tr.onclick = () => detalheReq(lista.find((r) => r.id === Number(tr.dataset.id)), carregar)));
  };
  ['fst', 'ftp'].forEach((id) => (el(id).onchange = carregar));
  let deb; el('q').oninput = () => { clearTimeout(deb); deb = setTimeout(carregar, 300); };
  el('bt-novo').onclick = () => novoReq(carregar);
  await carregar();
}

function novoReq(depois) {
  const certs = S.cat.documentos.filter((d) => d.imovel === true);
  const m = G.modal({
    titulo: 'Novo requerimento', largo: true,
    corpo: `<div class="f">
      <label>Assunto<select id="r-tipo">${S.cat.requerimentos.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select></label>
      <label id="r-doc-l">Documento requerido<select id="r-doc">${certs.map((d) => `<option value="${d.id}">${esc(d.titulo)}</option>`).join('')}</select></label>
      <label>Nome do requerente *<input id="r-nome" /></label><label>CPF/CNPJ *<input id="r-cpf" inputmode="numeric" /></label>
      <label>E-mail<input id="r-email" type="email" /></label><label>Telefone<input id="r-tel" /></label>
      <label>Inscrição do imóvel<input id="r-insc" autocomplete="off" /><div class="sug" id="r-sug" hidden></div></label>
      <label>Prazo (opcional)<input id="r-prazo" type="date" /></label>
      <label class="full">Descrição / pedido<textarea id="r-desc"></textarea></label></div>
      <div class="small dim" id="r-ajuda" style="margin-top:8px"></div>`,
    rodape: `<span></span><div class="g-actions"><button class="b" data-a="c">Cancelar</button><button class="b pri" data-a="s">Protocolar</button></div>`,
  });
  const ajuda = {
    certidao: 'Ao deferir, o documento escolhido é emitido automaticamente com código de validação.',
    revisao_cadastral: 'Ao deferir, as alterações informadas viram um evento a validar no ciclo mensal e vão ao Sinter.',
    inclusao_imovel: 'Ao deferir, a inclusão é capturada no ciclo mensal (complete os dados do imóvel na validação).',
    transferencia: 'Ao deferir, a mudança de contribuinte (ITBI) é capturada no ciclo mensal.',
    baixa: 'Ao deferir, a baixa da inscrição é capturada no ciclo mensal.', reativacao: 'Ao deferir, a reativação é capturada no ciclo mensal.',
    numeracao_predial: 'Ao deferir, a Certidão de Numeração Predial é emitida.', vistoria: 'Ao deferir, uma demanda de vistoria é criada para a equipe de campo.',
    parcelamento: 'Registre o parcelamento no ciclo mensal do módulo CIB/Sinter depois da análise técnica.', outro: '',
  };
  const tog = () => { m.$('#r-doc-l').style.display = m.$('#r-tipo').value === 'certidao' ? '' : 'none'; m.$('#r-ajuda').textContent = ajuda[m.$('#r-tipo').value] || ''; };
  m.$('#r-tipo').onchange = tog; tog();
  autocompletar(m.$('#r-insc'), m.$('#r-sug'), async (id) => {
    try { const im = await G.api('/api/cib/imoveis/' + id); if (!m.$('#r-nome').value) m.$('#r-nome').value = im.contribuinteNome || ''; if (!m.$('#r-cpf').value) m.$('#r-cpf').value = im.contribuinteDoc || ''; } catch { /* ok */ }
  });
  m.$('[data-a=c]').onclick = m.fechar;
  m.$('[data-a=s]').onclick = async () => {
    try {
      const r = await G.post('/api/requerimentos', {
        tipo: m.$('#r-tipo').value, documentoTipo: m.$('#r-doc').value, requerenteNome: m.$('#r-nome').value, requerenteDoc: m.$('#r-cpf').value,
        requerenteEmail: m.$('#r-email').value, requerenteTelefone: m.$('#r-tel').value, inscricao: m.$('#r-insc').value.trim(), prazo: m.$('#r-prazo').value || undefined, descricao: m.$('#r-desc').value,
      });
      G.toast(`Protocolo ${r.numero} registrado.`);
      m.fechar(); depois && depois();
      window.open(`/documentos/ver.html?comprovante=${r.id}`, '_blank');
    } catch (e) { G.falha(e); }
  };
}

function detalheReq(r, depois) {
  const aberto = ['protocolado', 'em_analise', 'pendente_documentacao'].includes(r.status);
  const precisaDados = ['revisao_cadastral', 'inclusao_imovel', 'transferencia'].includes(r.tipo);
  const ops = G.CAMPOS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  const m = G.modal({
    titulo: `Protocolo <span class="mono">${esc(r.numero)}</span> ${G.pill(r.status)}`, largo: true,
    corpo: `<div class="grid2"><div><table class="t">
      <tr><th style="width:150px">Assunto</th><td>${esc(r.tipoLabel)}</td></tr>
      <tr><th>Requerente</th><td>${esc(r.requerenteNome)} <span class="mono dim">${esc(r.requerenteDoc)}</span><div class="dim small">${esc([r.requerenteEmail, r.requerenteTelefone].filter(Boolean).join(' · '))}</div></td></tr>
      <tr><th>Inscrição</th><td class="mono">${esc(r.inscricao || '—')}</td></tr><tr><th>Prazo</th><td>${G.data(r.prazo)} ${r.atrasado ? G.pill('atrasado', 'atrasado') : ''}</td></tr>
      <tr><th>Pedido</th><td>${esc(r.descricao || '—')}</td></tr>${r.parecer ? `<tr><th>Parecer</th><td>${esc(r.parecer)}</td></tr>` : ''}
      ${r.documentoId ? `<tr><th>Documento</th><td><button class="b sm" id="ver-doc">abrir documento emitido</button></td></tr>` : ''}
      ${r.movimentacaoId ? `<tr><th>Cadastro</th><td>Evento #${r.movimentacaoId} no <a href="/cib/#ciclo">ciclo mensal</a></td></tr>` : ''}
      ${r.demandaId ? `<tr><th>Campo</th><td><a href="/demandas/">Demanda #${r.demandaId}</a></td></tr>` : ''}</table>
      ${aberto ? `<div class="f" style="margin-top:12px"><label class="full">Parecer / despacho<textarea id="d-par" placeholder="Fundamentação da decisão ou pendência"></textarea></label>
        <label>Responsável<input id="d-resp" value="${esc(r.responsavelNome)}" /></label></div>
        ${precisaDados ? `<div class="small dim" style="margin:10px 0 6px">Dados a alterar no cadastro (aplicados ao validar no ciclo mensal)</div><div id="d-campos"></div><button class="b sm" id="d-add">＋ campo</button>
          <template id="d-tpl"><div class="f" style="margin-bottom:6px;grid-template-columns:1fr 1fr auto"><select class="k">${ops}</select><input class="vv" placeholder="novo valor" /><button class="b sm" type="button">✕</button></div></template>` : ''}` : ''}</div>
      <div><div class="box"><h3>Tramitação</h3><div class="timeline">${(r.historico || []).map((h) => `<div><strong>${esc(G.ROT[h.status] || h.status)}</strong> · ${G.dataHora(h.em)}<div class="dim">${esc(h.por || '')}${h.obs ? ' — ' + esc(h.obs) : ''}</div></div>`).join('')}</div></div></div></div>`,
    rodape: `<div class="g-actions"><button class="b" id="d-comp">Comprovante</button></div>
      <div class="g-actions">${aberto ? `<button class="b" data-ac="analisar">Em análise</button><button class="b" data-ac="pendenciar">Pendência documental</button><button class="b danger" data-ac="indeferir">Indeferir</button><button class="b pri" data-ac="deferir">Deferir</button>`
        : `${['deferido', 'indeferido'].includes(r.status) ? '<button class="b ok" data-ac="concluir">Concluir (entregue)</button>' : ''}<button class="b" data-ac="arquivar">Arquivar</button>${r.status !== 'deferido' ? '<button class="b" data-ac="reabrir">Reabrir</button>' : ''}`}</div>`,
  });
  if (precisaDados && aberto) {
    m.$('#d-add').onclick = () => { const n = m.$('#d-tpl').content.firstElementChild.cloneNode(true); n.querySelector('button').onclick = () => n.remove(); m.$('#d-campos').appendChild(n); };
    Object.entries(r.dados?.dadosDepois || {}).forEach(([k, val]) => { m.$('#d-add').click(); const rows = m.$$('#d-campos .f'); const last = rows[rows.length - 1]; last.querySelector('.k').value = k; last.querySelector('.vv').value = val; });
  }
  if (m.$('#ver-doc')) m.$('#ver-doc').onclick = () => abrirDoc(r.documentoId);
  m.$('#d-comp').onclick = () => window.open(`/documentos/ver.html?comprovante=${r.id}`, '_blank');
  m.$$('[data-ac]').forEach((b) => (b.onclick = async () => {
    const body = { acao: b.dataset.ac, parecer: m.$('#d-par')?.value || '', responsavelNome: m.$('#d-resp')?.value || '' };
    if (precisaDados && m.$('#d-campos')) body.dadosDepois = Object.fromEntries([...m.$$('#d-campos .f')].map((x) => [x.querySelector('.k').value, x.querySelector('.vv').value]));
    try {
      const out = await G.post(`/api/requerimentos/${r.id}/tramitar`, body);
      G.toast(`${G.ROT[out.status] || out.status}${out.efeito ? ' · ' + out.efeito : ''}`);
      m.fechar(); depois && depois();
      if (b.dataset.ac === 'deferir' && out.documentoId) abrirDoc(out.documentoId);
    } catch (e) { G.falha(e); }
  }));
}

function autocompletar(input, box, aoEscolher) {
  let deb;
  input.oninput = () => {
    clearTimeout(deb);
    deb = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { box.hidden = true; return; }
      try {
        const r = await G.get('/api/cib/imoveis?limit=8&q=' + encodeURIComponent(q));
        box.innerHTML = r.itens.map((i) => `<div data-i="${esc(i.inscricao)}" data-id="${i.id}"><strong class="mono">${esc(i.inscricao)}</strong> · ${esc(i.logradouro)} ${esc(i.numero)} · <span class="dim">${esc(i.contribuinteNome)}</span>${i.cib ? ` · CIB <span class="mono">${esc(i.cib)}</span>` : ''}</div>`).join('') || '<div class="dim">Nenhum imóvel encontrado.</div>';
        box.hidden = false;
        box.querySelectorAll('[data-i]').forEach((d) => (d.onclick = () => { input.value = d.dataset.i; box.hidden = true; aoEscolher && aoEscolher(Number(d.dataset.id)); }));
      } catch { box.hidden = true; }
    }, 250);
  };
  input.onblur = () => setTimeout(() => (box.hidden = true), 200);
}

// ------------------------------------------------------------------ EMITIR
async function emitir(v) {
  const grupos = {};
  S.cat.documentos.forEach((d) => (grupos[d.grupo] = grupos[d.grupo] || []).push(d));
  const pre = S.arg && S.cat.documentos.find((d) => d.id === S.arg) ? S.arg : null;
  v.innerHTML = `${cab('Emissão', 'Emitir documento', 'Escolha o modelo. O conteúdo é congelado na emissão (snapshot), numerado por tipo e ano, e recebe código de validação, QR e hash de integridade. Modelos de referência — revise os textos conforme a legislação municipal.')}
    <div class="grid2"><div>${Object.entries(grupos).map(([g, ds]) => `<div class="grupo-t">${esc(g)}</div><div class="cat">${ds.map((d) => `<div class="item ${d.id === pre ? 'on' : ''}" data-t="${d.id}"><strong>${esc(d.titulo)}</strong><span>${d.imovel === true ? 'por imóvel' : (d.imovel === 'opcional' ? 'imóvel opcional' : 'do município')}${d.validade ? ' · com validade' : ''}${d.minuta ? ' · minuta' : ''}</span></div>`).join('')}</div>`).join('')}</div>
    <div class="box" id="form" style="position:sticky;top:120px;align-self:start"><div class="vazio">Selecione um modelo ao lado.</div></div></div>`;
  const abrir = (tid) => {
    v.querySelectorAll('.cat .item').forEach((x) => x.classList.toggle('on', x.dataset.t === tid));
    const d = S.cat.documentos.find((x) => x.id === tid);
    let imovelId = null;
    el('form').innerHTML = `<h3>${esc(d.titulo)}</h3><div class="f">
      ${d.imovel ? `<label class="full">Imóvel (inscrição, CIB, endereço ou contribuinte)${d.imovel === true ? ' *' : ''}<input id="e-insc" autocomplete="off" /><div class="sug" id="e-sug" hidden></div></label><div class="full small" id="e-im"></div>` : ''}
      ${d.imovel ? '<label class="full">Interessado / requerente<input id="e-int" placeholder="padrão: contribuinte do imóvel" /></label>' : ''}
      ${(d.campos || []).map((c) => `<label class="full">${esc(c.label)}${c.tipo === 'textarea' ? `<textarea data-c="${c.id}">${esc(c.padrao ?? '')}</textarea>` : `<input data-c="${c.id}" type="${c.tipo === 'number' ? 'number' : (c.tipo === 'month' ? 'month' : 'text')}" value="${esc(c.padrao ?? (c.tipo === 'month' ? G.compAtual() : ''))}" />`}</label>`).join('')}
    </div><div class="g-actions" style="margin-top:14px;justify-content:flex-end"><button class="b pri" id="e-ok">Emitir</button></div>`;
    if (d.imovel) {
      autocompletar(el('e-insc'), el('e-sug'), async (id) => {
        imovelId = id;
        try {
          const im = await G.api('/api/cib/imoveis/' + id);
          el('e-im').innerHTML = `<div class="box" style="padding:10px"><strong class="mono">${esc(im.inscricao)}</strong> ${G.pill(im.sinterStatus)} ${im.cib ? `· CIB <span class="mono">${esc(im.cib)}</span>` : ''}<div class="dim">${esc([im.logradouro, im.numero].filter(Boolean).join(', '))} · ${esc(im.bairro)} · ${esc(im.contribuinteNome)}</div></div>`;
        } catch { /* ok */ }
      });
      el('e-insc').addEventListener('input', () => { imovelId = null; el('e-im').innerHTML = ''; });
    }
    el('e-ok').onclick = async () => {
      const campos = Object.fromEntries([...el('form').querySelectorAll('[data-c]')].map((i) => [i.dataset.c, i.value]));
      const body = { tipo: tid, campos, interessado: el('e-int')?.value || '' };
      if (imovelId) body.imovelId = imovelId; else if (el('e-insc')?.value) body.inscricao = el('e-insc').value.trim();
      try { const doc = await G.post('/api/documentos', body); G.toast(`${doc.titulo} nº ${doc.numero} emitido · código ${doc.codigoValidacao}`); abrirDoc(doc.id); }
      catch (e) { G.falha(e); }
    };
  };
  v.querySelectorAll('.cat .item').forEach((x) => (x.onclick = () => abrir(x.dataset.t)));
  if (pre) abrir(pre);
}

// ------------------------------------------------------------------ EMITIDOS
async function emitidos(v) {
  v.innerHTML = `${cab('Livro de registro', 'Documentos emitidos', 'Numeração sequencial por tipo e ano. Documentos não são editados: em caso de erro, cancele com justificativa e emita outro — o cancelamento aparece na validação pública.')}
    <div class="toolbar2"><select id="ftp"><option value="">Todos os tipos</option>${S.cat.documentos.map((d) => `<option value="${d.id}">${esc(d.titulo)}</option>`).join('')}</select>
      <select id="fst"><option value="">Válidos e cancelados</option><option value="valido">Válidos</option><option value="cancelado">Cancelados</option></select>
      <input type="search" id="q" placeholder="Número, inscrição, interessado, código…" /></div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Documento</th><th>Nº</th><th>Inscrição</th><th>Interessado</th><th>Emissão</th><th>Validade</th><th>Código</th><th>Status</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const carregar = async () => {
    const lista = await G.get('/api/documentos?' + new URLSearchParams({ tipo: el('ftp').value, status: el('fst').value, q: el('q').value }));
    el('tb').innerHTML = lista.map((d) => `<tr><td>${esc(d.titulo)}</td><td class="mono">${esc(d.numero)}</td><td class="mono">${esc(d.inscricao || '—')}</td><td class="small">${esc(d.interessado || '—')}</td>
      <td class="small">${G.dataHora(d.emitidoEm)}<div class="dim">${esc(d.emitidoPorNome)}</div></td><td class="small">${G.data(d.validade)}</td><td class="mono small">${esc(d.codigoValidacao)}</td><td>${G.pill(d.status)}</td>
      <td style="white-space:nowrap"><button class="b sm" data-ver="${d.id}">Abrir</button> <button class="b sm" data-lk="${esc(d.codigoValidacao)}" title="Copiar link de validação">🔗</button> ${d.status === 'valido' ? `<button class="b sm danger" data-cx="${d.id}">Cancelar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="vazio">Nenhum documento.</td></tr>';
    v.querySelectorAll('[data-ver]').forEach((b) => (b.onclick = () => abrirDoc(b.dataset.ver)));
    v.querySelectorAll('[data-lk]').forEach((b) => (b.onclick = async () => { const u = `${location.origin}/validar?codigo=${b.dataset.lk}`; try { await navigator.clipboard.writeText(u); G.toast('Link copiado: ' + u); } catch { G.toast(u); } }));
    v.querySelectorAll('[data-cx]').forEach((b) => (b.onclick = async () => {
      const mot = await G.confirmar('Cancelar documento', 'O documento continuará registrado, marcado como CANCELADO, e a validação pública mostrará o motivo.', { campo: 'Motivo do cancelamento', rotulo: 'Cancelar documento' });
      if (!mot) return;
      try { await G.post(`/api/documentos/${b.dataset.cx}/cancelar`, { motivo: mot }); G.toast('Documento cancelado.'); carregar(); } catch (e) { G.falha(e); }
    }));
  };
  ['ftp', 'fst'].forEach((id) => (el(id).onchange = carregar));
  let deb; el('q').oninput = () => { clearTimeout(deb); deb = setTimeout(carregar, 300); };
  await carregar();
}

window.addEventListener('hashchange', () => {
  const [t, a] = location.hash.slice(1).split(':');
  if (t && t !== S.tab && document.querySelector(`#tabs [data-tab="${t}"]`)) irPara(t, a);
});

(async () => {
  if (!(await G.iniciar({ aoTrocar: () => render() }))) return;
  const [tab, arg] = location.hash.slice(1).split(':');
  irPara(['atendimento', 'emitir', 'emitidos'].includes(tab) ? tab : 'atendimento', arg);
})();
