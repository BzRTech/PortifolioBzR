// Portal do Cidadão — front. A sessão do cidadão (30 min) fica só nesta aba
// (sessionStorage) e é diferente do login da equipe da prefeitura.
(function () {
  const CHAVE = 'bzr_cidadao';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');
  const S = { cfg: null, eu: null, aba: 'imoveis' };

  const token = { get: () => { try { return sessionStorage.getItem(CHAVE); } catch { return null; } }, set: (t) => { try { sessionStorage.setItem(CHAVE, t); } catch { /* ok */ } }, del: () => { try { sessionStorage.removeItem(CHAVE); } catch { /* ok */ } } };

  async function api(url, { method = 'GET', body, texto = false } = {}) {
    const h = { 'Content-Type': 'application/json' };
    const t = token.get();
    if (t) h.Authorization = 'Bearer ' + t;
    const r = await fetch('/api/cidadao' + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && t) { token.del(); S.eu = null; entrada('Sua sessão expirou. Entre novamente.'); throw new Error('Sessão expirada.'); }
    if (texto) { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Falha.'); return r.text(); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Falha (${r.status}).`);
    return j;
  }

  // ---- formatação ---------------------------------------------------------
  const brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
  const m2 = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m²`);
  const data = (d) => (d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '—');
  const dataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const mascCpf = (v) => { const d = String(v || '').replace(/\D/g, '').slice(0, 14); if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'); return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2'); };
  const STATUS = {
    protocolado: ['Recebida', 'p-protocolado'], em_analise: ['Em análise', 'p-em_analise'], pendente_documentacao: ['Aguardando seus documentos', 'p-pendente_documentacao'],
    deferido: ['Deferida', 'p-deferido'], indeferido: ['Indeferida', 'p-indeferido'], concluido: ['Concluída', 'p-concluido'], arquivado: ['Arquivada', 'p-arquivado'],
  };
  const pillStatus = (s) => `<span class="pill ${STATUS[s]?.[1] || ''}">${esc(STATUS[s]?.[0] || s)}</span>`;

  function toast(msg, erro = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (erro ? ' erro' : '');
    t.textContent = msg;
    Object.assign(t.style, { position: 'fixed', left: '50%', bottom: '22px', transform: 'translateX(-50%)', background: erro ? 'var(--danger)' : 'var(--ink)', color: erro ? '#fff' : 'var(--paper)', padding: '11px 16px', zIndex: 3000, fontSize: '14px', maxWidth: 'calc(100vw - 32px)' });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }
  function modal({ titulo, corpo, rodape = '' }) {
    const ov = document.createElement('div');
    ov.className = 'ov open';
    ov.innerHTML = `<div class="mdl lg" role="dialog" aria-modal="true" aria-label="${esc(titulo)}"><div class="mdl-h"><strong>${esc(titulo)}</strong><button class="x" aria-label="Fechar">✕</button></div><div class="mdl-b">${corpo}</div>${rodape ? `<div class="mdl-f">${rodape}</div>` : ''}</div>`;
    document.body.appendChild(ov);
    const fechar = () => { ov.remove(); document.removeEventListener('keydown', k); };
    const k = (e) => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('keydown', k);
    ov.querySelector('.x').onclick = fechar;
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) fechar(); });
    return { el: ov, fechar, $: (s) => ov.querySelector(s), $$: (s) => [...ov.querySelectorAll(s)] };
  }
  // Abre HTML autenticado numa nova aba (a janela abre antes do fetch: sem bloqueio de pop-up).
  async function abrirHtml(url) {
    const w = window.open('', '_blank');
    try { const html = await api(url, { texto: true }); w.document.open(); w.document.write(html); w.document.close(); }
    catch (e) { w && w.close(); toast(e.message, true); }
  }

  // ---- ENTRADA --------------------------------------------------------------
  function entrada(msgErro = '') {
    $('#sair').hidden = true; $('#sessao').hidden = true;
    const c = S.cfg, metodos = c.metodos;
    const ROT = { govbr: 'gov.br', email: 'Código por e-mail', inscricao: 'CPF + inscrição' };
    app.innerHTML = `<section class="cid-hero"><div class="kick">${esc(c.nomeOficial || c.municipio || 'Prefeitura')}</div>
      <h1>Seus imóveis, documentos e solicitações, num só lugar.</h1>
      <p>Veja os imóveis cadastrados no seu CPF ou CNPJ, emita certidões e declarações na hora e faça pedidos à prefeitura, como atualização cadastral, transferência ou vistoria, acompanhando cada um pelo protocolo.</p></section>
      <div class="entrada"><div class="cartao"><h2>Entrar</h2><p class="sub">Por segurança, além do CPF/CNPJ pedimos uma confirmação de que é você.</p>
        ${metodos.length > 1 ? `<div class="metodos" role="tablist">${metodos.map((m, i) => `<button role="tab" data-m="${m}" class="${i ? '' : 'on'}">${ROT[m]}</button>`).join('')}</div>` : ''}
        <div id="form-entrada"></div><p class="msg erro" id="msg" role="alert">${esc(msgErro)}</p></div>
      <aside><div class="porque"><h3>Por que não basta o CPF?</h3>O CPF não é segredo: ele aparece em notas fiscais, boletos e cadastros. Se só ele bastasse, qualquer pessoa poderia ver os seus imóveis. Por isso confirmamos que é você
        ${metodos.includes('govbr') ? 'pela sua conta <b>gov.br</b>, ' : ''}${metodos.includes('email') ? 'com um código enviado ao <b>e-mail que já está no cadastro</b>, ' : ''}${metodos.includes('inscricao') ? 'ou pela <b>inscrição de um dos seus imóveis</b> (está no carnê do IPTU)' : ''}.
        <ul><li>A sessão dura ${c.sessaoMin} minutos e fica só nesta aba.</li><li>Cada acesso fica registrado, conforme a LGPD.</li></ul></div>
        <div class="atalhos"><a href="/validar">Validar um documento <span>↗</span></a><a href="/validar#protocolo">Consultar protocolo sem entrar <span>↗</span></a></div></aside></div>`;
    const pintar = (m) => {
      const f = $('#form-entrada');
      if (m === 'govbr') {
        f.innerHTML = `<p style="font-size:14px;margin:0 0 12px">Entre com a sua conta gov.br — a mesma do Meu INSS, da CNH digital e da Receita Federal.</p><a class="b grande govbr" href="/api/cidadao/govbr/entrar">Entrar com gov.br</a>`;
      } else if (m === 'email') {
        f.innerHTML = `<form id="fe1"><label class="campo">CPF ou CNPJ<input id="e-doc" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" required /></label>
          <button class="b pri grande">Enviar código para o meu e-mail</button></form>
          <form id="fe2" hidden><label class="campo">Código de 6 dígitos<input id="e-cod" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" required /><small id="e-onde"></small></label>
          <button class="b pri grande">Entrar</button><p class="msg"><a href="#" id="e-volta">Não recebeu? Pedir outro código</a></p></form><div id="e-demo"></div>`;
        const doc = $('#e-doc');
        doc.oninput = () => (doc.value = mascCpf(doc.value));
        $('#fe1').onsubmit = async (ev) => {
          ev.preventDefault(); $('#msg').textContent = '';
          try {
            const r = await api('/entrar/codigo', { method: 'POST', body: { doc: doc.value } });
            $('#fe1').hidden = true; $('#fe2').hidden = false; $('#e-onde').textContent = r.mensagem; $('#e-cod').focus();
            if (r.demonstracao) $('#e-demo').innerHTML = `<div class="demo">${esc(r.demonstracao.aviso)}<br>Enviado para ${esc(r.demonstracao.email)}: <code>${esc(r.demonstracao.codigo)}</code></div>`;
          } catch (e) { $('#msg').textContent = e.message; }
        };
        $('#fe2').onsubmit = async (ev) => {
          ev.preventDefault(); $('#msg').textContent = '';
          try { const r = await api('/entrar/confirmar', { method: 'POST', body: { doc: doc.value, codigo: $('#e-cod').value } }); token.set(r.token); carregar(); }
          catch (e) { $('#msg').textContent = e.message; }
        };
        $('#e-volta').onclick = (ev) => { ev.preventDefault(); $('#fe2').hidden = true; $('#fe1').hidden = false; $('#e-demo').innerHTML = ''; };
      } else {
        f.innerHTML = `<form id="fi"><label class="campo">CPF ou CNPJ<input id="i-doc" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" required /></label>
          <label class="campo">Inscrição imobiliária<input id="i-ins" autocomplete="off" placeholder="Ex.: 03.01.0001" required /><small>Está no carnê do IPTU. Basta a de um dos seus imóveis.</small></label>
          <button class="b pri grande">Entrar</button></form>`;
        $('#i-doc').oninput = (e) => (e.target.value = mascCpf(e.target.value));
        $('#fi').onsubmit = async (ev) => {
          ev.preventDefault(); $('#msg').textContent = '';
          try { const r = await api('/entrar/inscricao', { method: 'POST', body: { doc: $('#i-doc').value, inscricao: $('#i-ins').value } }); token.set(r.token); carregar(); }
          catch (e) { $('#msg').textContent = e.message; }
        };
      }
    };
    $$('.metodos button').forEach((b) => (b.onclick = () => { $$('.metodos button').forEach((x) => x.classList.toggle('on', x === b)); $('#msg').textContent = ''; pintar(b.dataset.m); }));
    if (metodos.length) pintar(metodos[0]); else $('#form-entrada').innerHTML = '<p>O portal está temporariamente indisponível. Procure o atendimento da prefeitura.</p>';
  }

  // ---- ÁREA DO CIDADÃO ---------------------------------------------------------
  let relogio = null;
  async function carregar(aba) {
    try { S.eu = await api('/eu'); } catch (e) { if (token.get()) toast(e.message, true); return; }
    if (aba) S.aba = aba;
    $('#sair').hidden = false;
    clearInterval(relogio);
    const fim = new Date(S.eu.expiraEm).getTime();
    const tick = () => { const min = Math.max(0, Math.ceil((fim - Date.now()) / 60000)); $('#sessao').hidden = false; $('#sessao').textContent = `sessão: ${min} min`; if (min <= 0) { clearInterval(relogio); token.del(); entrada('Sua sessão expirou. Entre novamente.'); } };
    tick(); relogio = setInterval(tick, 30000);
    pintarArea();
  }

  function pintarArea() {
    const eu = S.eu;
    const pend = eu.solicitacoes.filter((s) => s.status === 'pendente_documentacao').length;
    const abertas = eu.solicitacoes.filter((s) => s.podeAnexar).length;
    const primeiro = (eu.nome || '').split(/\s+/)[0];
    app.innerHTML = `<div class="ola"><div><div class="kick">${esc(S.cfg.nomeOficial || S.cfg.municipio)}</div><h1>Olá${primeiro ? ', ' + esc(primeiro) : ''}</h1>
        <p>${esc(eu.doc)} · ${eu.imoveis.length} imóve${eu.imoveis.length === 1 ? 'l' : 'is'} no seu nome</p></div>
        <button class="b pri" id="nova">＋ Nova solicitação</button></div>
      <nav class="abas" role="tablist"><button data-a="imoveis">🏠 Meus imóveis <span class="n">${eu.imoveis.length}</span></button>
        <button data-a="solicitacoes">📥 Solicitações <span class="n ${pend ? 'alerta' : ''}">${pend ? pend + ' pendente' + (pend > 1 ? 's' : '') : abertas}</span></button>
        <button data-a="documentos">📄 Documentos <span class="n">${eu.documentos.length}</span></button></nav>
      <section id="conteudo"></section>`;
    $$('.abas button').forEach((b) => { b.classList.toggle('on', b.dataset.a === S.aba); b.onclick = () => { S.aba = b.dataset.a; pintarArea(); }; });
    $('#nova').onclick = () => novaSolicitacao();
    ({ imoveis: abaImoveis, solicitacoes: abaSolicitacoes, documentos: abaDocumentos }[S.aba] || abaImoveis)($('#conteudo'));
  }

  function abaImoveis(v) {
    const eu = S.eu;
    if (!eu.imoveis.length) {
      v.innerHTML = `<div class="vazio-cid"><b>Não encontramos imóveis no cadastro com o seu CPF/CNPJ.</b><br>Se você comprou um imóvel recentemente ou ele está no nome de outra pessoa, peça a atualização.
        <div style="margin-top:12px"><button class="b pri" id="pedir">Pedir inclusão ou transferência</button></div></div>`;
      $('#pedir').onclick = () => novaSolicitacao({ tipo: 'transferencia' });
      return;
    }
    v.innerHTML = eu.imoveis.map((im) => `<article class="imovel">
      <div class="topo"><div><div class="insc">INSCRIÇÃO ${esc(im.inscricao)}</div><h3>${esc(im.endereco || 'Endereço não informado')}</h3><div class="bairro">${esc(im.bairro || '')}${im.cep ? ' · CEP ' + esc(im.cep) : ''}</div></div>
        <div class="selos">${im.situacao === 'baixado' ? '<span class="pill p-baixado">baixado</span>' : '<span class="pill p-valido">ativo</span>'}
          <span class="pill ${im.cib ? 'p-pronto' : 'p-pendente'}">${im.cib ? 'CIB ' + esc(im.cib) : 'CIB em atribuição'}</span>
          <span class="pill p-baixa">${im.tipo === 'territorial' ? 'terreno' : 'edificado'}</span></div></div>
      <div class="fatos"><div><span>Terreno</span><b>${m2(im.areaTerreno)}</b></div><div><span>Construída</span><b>${m2(im.areaConstruida)}</b></div>
        <div><span>Valor venal${im.valorVenalAno ? ' ' + im.valorVenalAno : ''}</span><b>${brl(im.valorVenal)}</b></div><div><span>Matrícula</span><b>${esc(im.matricula || '—')}</b></div></div>
      <div class="docs"><h4>Emitir agora — sai na hora, com validação pelo QR</h4><div class="lista-docs">
        ${im.documentos.map((d) => `<button class="doc-btn" data-emitir="${d.id}" data-im="${im.id}" ${d.disponivel ? '' : 'disabled'}><span>${esc(d.titulo)}${d.disponivel ? '' : `<span class="motivo">${esc(d.motivo)}</span>`}</span><span class="acao">${d.disponivel ? 'EMITIR →' : 'indisponível'}</span></button>`).join('')}
      </div></div>
      <div class="rodape-im"><button class="b" data-sol="${im.id}">Fazer solicitação sobre este imóvel</button>${im.centroide ? `<a class="b" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${im.centroide.lat}&mlon=${im.centroide.lng}#map=19/${im.centroide.lat}/${im.centroide.lng}">Ver no mapa ↗</a>` : ''}</div>
    </article>`).join('');
    $$('[data-emitir]', v).forEach((b) => (b.onclick = () => emitir(Number(b.dataset.im), b.dataset.emitir, b)));
    $$('[data-sol]', v).forEach((b) => (b.onclick = () => novaSolicitacao({ imovelId: Number(b.dataset.sol) })));
  }

  async function emitir(imovelId, tipo, botao) {
    botao.disabled = true;
    const rot = botao.querySelector('.acao'); const antes = rot.textContent; rot.textContent = 'emitindo…';
    try {
      const d = await api('/documentos', { method: 'POST', body: { imovelId, tipo } });
      const m = modal({ titulo: 'Documento emitido', corpo: `<div class="sucesso"><div>${esc(d.titulo)}</div><div class="grande">nº ${esc(d.numero)}</div>
        <div>Código de validação <span class="codigo">${esc(d.codigo)}</span></div>${d.validade ? `<p class="meta" style="color:var(--muted);font-size:13px">Válido até ${data(d.validade)}</p>` : ''}
        <p style="font-size:13.5px;color:var(--ink-2)">Quem receber o documento confere a autenticidade pelo QR ou em <b>${esc(location.host)}/validar</b>.</p></div>`,
        rodape: `<span></span><div class="g-actions"><button class="b" data-x>Fechar</button><button class="b pri" data-abrir>Abrir / imprimir</button></div>` });
      m.$('[data-x]').onclick = m.fechar;
      m.$('[data-abrir]').onclick = () => abrirHtml(`/documentos/${d.id}/html`);
      await carregar();
    } catch (e) { toast(e.message, true); rot.textContent = antes; botao.disabled = false; }
  }

  function passos(s) {
    const ord = ['protocolado', 'em_analise', 'deferido', 'concluido'];
    const i = s.status === 'pendente_documentacao' ? 1 : s.status === 'indeferido' ? 2 : Math.max(0, ord.indexOf(s.status));
    return `<div class="passos">${ord.map((_, k) => `<i class="${k < i || (k === i) ? (k === i && s.status === 'pendente_documentacao' ? 'alerta' : k === i && s.status === 'indeferido' ? 'nao' : 'on') : ''}"></i>`).join('')}</div>
      <div class="passos-rot"><span>recebida</span><span>análise</span><span>decisão</span><span>concluída</span></div>`;
  }
  function abaSolicitacoes(v) {
    const l = S.eu.solicitacoes;
    if (!l.length) { v.innerHTML = '<div class="vazio-cid">Você ainda não fez solicitações. Use <b>＋ Nova solicitação</b>.</div>'; return; }
    v.innerHTML = l.map((s) => `<article class="item"><div class="l1"><div><span class="num">Protocolo ${esc(s.numero)}</span><h3>${esc(s.assunto)}</h3>
        <div class="meta">${s.inscricao ? 'Inscrição ' + esc(s.inscricao) + ' · ' : ''}aberta em ${data(s.criadoEm)} · prazo ${data(s.prazo)}${s.atrasado ? ' · <b style="color:var(--danger)">em atraso</b>' : ''}${s.qtdAnexos ? ` · ${s.qtdAnexos} anexo(s)` : ''}</div></div>${pillStatus(s.status)}</div>
      ${passos(s)}
      ${s.status === 'pendente_documentacao' ? `<div class="pedido"><b>A prefeitura pediu</b>${esc(s.parecer || 'Envie os documentos solicitados.')}</div>` : (s.parecer ? `<div class="parecer">${esc(s.parecer)}</div>` : '')}
      <div class="acoes">${s.podeAnexar ? `<button class="b ${s.status === 'pendente_documentacao' ? 'pri' : ''}" data-anexar="${s.id}">📎 Enviar documentos</button>` : ''}
        ${s.documentoId ? `<button class="b pri" data-doc="${s.documentoId}">Abrir documento emitido</button>` : ''}
        <button class="b" data-comp="${s.id}">Comprovante</button><button class="b" data-hist="${s.id}">Andamento</button></div></article>`).join('');
    $$('[data-anexar]', v).forEach((b) => (b.onclick = () => anexar(Number(b.dataset.anexar))));
    $$('[data-doc]', v).forEach((b) => (b.onclick = () => abrirHtml(`/documentos/${b.dataset.doc}/html`)));
    $$('[data-comp]', v).forEach((b) => (b.onclick = () => abrirHtml(`/solicitacoes/${b.dataset.comp}/comprovante`)));
    $$('[data-hist]', v).forEach((b) => (b.onclick = async () => {
      const s = l.find((x) => x.id === Number(b.dataset.hist));
      let anexos = [];
      try { anexos = await api(`/solicitacoes/${s.id}/anexos`); } catch { /* segue */ }
      const m = modal({ titulo: `Protocolo ${s.numero}`, corpo: `<div class="timeline">${s.historico.map((h) => `<div><strong>${esc(STATUS[h.status]?.[0] || h.status)}</strong> · ${dataHora(h.em)}</div>`).join('')}</div>
        ${anexos.length ? `<h4 style="margin:16px 0 4px;font-size:13px">Documentos enviados</h4><ul class="anexos-lista">${anexos.map((a) => `<li><span>${esc(a.nome)}</span><span class="dim">${(a.tamanho / 1024).toFixed(0)} KB · ${dataHora(a.enviadoEm)}</span></li>`).join('')}</ul>` : ''}`,
        rodape: '<span></span><button class="b" data-x>Fechar</button>' });
      m.$('[data-x]').onclick = m.fechar;
    }));
  }

  function abaDocumentos(v) {
    const l = S.eu.documentos;
    if (!l.length) { v.innerHTML = '<div class="vazio-cid">Nenhum documento ainda. Emita certidões e declarações na aba <b>Meus imóveis</b>.</div>'; return; }
    v.innerHTML = l.map((d) => `<article class="item"><div class="l1"><div><span class="num">nº ${esc(d.numero)}</span><h3>${esc(d.titulo)}</h3>
        <div class="meta">${d.inscricao ? 'Inscrição ' + esc(d.inscricao) + ' · ' : ''}emitido em ${dataHora(d.emitidoEm)}${d.validade ? ' · válido até ' + data(d.validade) : ''}${d.canal === 'portal' ? ' · pelo portal' : ' · pela prefeitura'}</div></div>
        ${d.status === 'valido' ? '<span class="pill p-valido">válido</span>' : '<span class="pill p-cancelado">cancelado</span>'}</div>
      <div class="acoes"><button class="b pri" data-abrir="${d.id}">Abrir / imprimir</button><span class="codigo" style="align-self:center">${esc(d.codigo)}</span><a class="b" href="/validar?codigo=${encodeURIComponent(d.codigo)}" target="_blank">Validar ↗</a></div></article>`).join('');
    $$('[data-abrir]', v).forEach((b) => (b.onclick = () => abrirHtml(`/documentos/${b.dataset.abrir}/html`)));
  }

  // ---- anexos ---------------------------------------------------------------
  const lerArquivo = (f) => new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok({ nome: f.name, base64: String(r.result) }); r.onerror = () => falha(new Error('Não foi possível ler ' + f.name)); r.readAsDataURL(f); });
  function seletorArquivos(m, id) {
    const inp = m.$('#' + id), ul = m.$('#' + id + '-lista');
    const conferir = () => {
      const fs = [...inp.files];
      const problemas = [];
      if (fs.length > 5) problemas.push('No máximo 5 arquivos por envio.');
      fs.forEach((f) => { if (f.size > 5 * 1024 * 1024) problemas.push(`${f.name} passa de 5 MB.`); if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) problemas.push(`${f.name}: use PDF, JPG ou PNG.`); });
      if (fs.reduce((s, f) => s + f.size, 0) > 15 * 1024 * 1024) problemas.push('Total acima de 15 MB: envie em partes.');
      ul.innerHTML = fs.map((f) => `<li><span>${esc(f.name)}</span><span class="dim">${(f.size / 1024).toFixed(0)} KB</span></li>`).join('') + problemas.map((p) => `<li style="color:var(--danger)">${esc(p)}</li>`).join('');
      return problemas.length ? null : fs;
    };
    inp.onchange = conferir;
    return async () => { const fs = conferir(); if (!fs) throw new Error('Confira os arquivos.'); return Promise.all(fs.map(lerArquivo)); };
  }
  const campoArquivos = (id) => `<label class="campo">Documentos (opcional)<input type="file" id="${id}" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" /><small>PDF, JPG ou PNG · até 5 arquivos de 5 MB. Ex.: escritura, contrato, planta, fotos.</small></label><ul class="anexos-lista" id="${id}-lista"></ul>`;

  function anexar(id) {
    const s = S.eu.solicitacoes.find((x) => x.id === id);
    const m = modal({ titulo: `Enviar documentos — protocolo ${s.numero}`, corpo: `${s.status === 'pendente_documentacao' ? `<div class="pedido" style="margin:0 0 12px"><b>A prefeitura pediu</b>${esc(s.parecer)}</div>` : ''}${campoArquivos('ax')}<p class="msg erro" id="ax-msg"></p>`,
      rodape: '<span></span><div class="g-actions"><button class="b" data-x>Cancelar</button><button class="b pri" data-ok>Enviar</button></div>' });
    const ler = seletorArquivos(m, 'ax');
    m.$('[data-x]').onclick = m.fechar;
    m.$('[data-ok]').onclick = async (ev) => {
      ev.target.disabled = true;
      try { const anexos = await ler(); if (!anexos.length) throw new Error('Escolha ao menos um arquivo.'); await api(`/solicitacoes/${id}/anexos`, { method: 'POST', body: { anexos } }); m.fechar(); toast('Documentos enviados. A prefeitura foi avisada no protocolo.'); carregar('solicitacoes'); }
      catch (e) { m.$('#ax-msg').textContent = e.message; ev.target.disabled = false; }
    };
  }

  // ---- nova solicitação -------------------------------------------------------
  function novaSolicitacao({ imovelId = null, tipo = '' } = {}) {
    const c = S.cfg, eu = S.eu;
    const m = modal({ titulo: 'Nova solicitação', corpo: `<form id="ns">
      <label class="campo">Assunto<select id="ns-tipo" required><option value="">Escolha…</option>${c.solicitacoes.map((t) => `<option value="${t.id}" ${t.id === tipo ? 'selected' : ''}>${esc(t.label)} — até ${t.prazoDias} dias</option>`).join('')}</select></label>
      <label class="campo" id="ns-cert-c" hidden>Qual documento<select id="ns-cert">${c.certidoes.map((d) => `<option value="${d.id}">${esc(d.titulo)}</option>`).join('')}</select><small>Os que estão disponíveis em "Meus imóveis" saem na hora, sem solicitação.</small></label>
      <label class="campo" id="ns-im-c">Imóvel<select id="ns-im"><option value="">${eu.imoveis.length ? 'Escolha…' : 'Nenhum imóvel no seu nome'}</option>${eu.imoveis.map((im) => `<option value="${im.id}" ${im.id === imovelId ? 'selected' : ''}>${esc(im.inscricao)} — ${esc(im.endereco)}</option>`).join('')}</select></label>
      <label class="campo" id="ns-end-c" hidden>Endereço do imóvel<input id="ns-end" placeholder="Rua, número, bairro" /></label>
      <label class="campo">Descreva o pedido<textarea id="ns-desc" required minlength="10" placeholder="Conte o que precisa. Ex.: construí uma varanda de 18 m² e quero atualizar a área."></textarea></label>
      <div class="f" style="margin-bottom:12px"><label class="campo" style="margin:0">E-mail para contato<input id="ns-email" type="email" autocomplete="email" /></label><label class="campo" style="margin:0">Telefone / WhatsApp<input id="ns-tel" type="tel" autocomplete="tel" /></label></div>
      ${campoArquivos('ns-arq')}<p class="msg erro" id="ns-msg"></p></form>`,
      rodape: '<span class="dim small">Você recebe o número de protocolo na hora.</span><div class="g-actions"><button class="b" data-x>Cancelar</button><button class="b pri" data-ok>Enviar solicitação</button></div>' });
    const ler = seletorArquivos(m, 'ns-arq');
    const ajustar = () => {
      const t = c.solicitacoes.find((x) => x.id === m.$('#ns-tipo').value);
      m.$('#ns-cert-c').hidden = m.$('#ns-tipo').value !== 'certidao';
      m.$('#ns-im-c').querySelector('select').required = Boolean(t?.exigeImovel);
      m.$('#ns-end-c').hidden = !(t && !t.exigeImovel);
    };
    m.$('#ns-tipo').onchange = ajustar; ajustar();
    m.$('[data-x]').onclick = m.fechar;
    m.$('[data-ok]').onclick = async (ev) => {
      const f = m.$('#ns');
      if (!f.reportValidity()) return;
      ev.target.disabled = true; m.$('#ns-msg').textContent = '';
      try {
        const anexos = await ler();
        const r = await api('/solicitacoes', { method: 'POST', body: {
          tipo: m.$('#ns-tipo').value, documentoTipo: m.$('#ns-cert').value, imovelId: Number(m.$('#ns-im').value) || null, endereco: m.$('#ns-end').value,
          descricao: m.$('#ns-desc').value, email: m.$('#ns-email').value, telefone: m.$('#ns-tel').value, anexos } });
        m.fechar();
        const ok = modal({ titulo: 'Solicitação recebida', corpo: `<div class="sucesso"><div>${esc(r.assunto)}</div><div class="grande">Protocolo ${esc(r.numero)}</div>
          <p style="font-size:14px">Prazo de resposta: até <b>${data(r.prazo)}</b>.${r.qtdAnexos ? ` ${r.qtdAnexos} documento(s) anexado(s).` : ''}<br>Acompanhe aqui, na aba Solicitações, ou em ${esc(location.host)}/validar com o protocolo e o seu CPF.</p></div>`,
          rodape: `<span></span><div class="g-actions"><button class="b" data-comp>Comprovante</button><button class="b pri" data-x>OK</button></div>` });
        ok.$('[data-x]').onclick = ok.fechar;
        ok.$('[data-comp]').onclick = () => abrirHtml(`/solicitacoes/${r.id}/comprovante`);
        carregar('solicitacoes');
      } catch (e) { m.$('#ns-msg').textContent = e.message; ev.target.disabled = false; }
    };
  }

  // ---- início ---------------------------------------------------------------------
  $('#sair').onclick = () => { token.del(); S.eu = null; clearInterval(relogio); entrada(); };
  (async () => {
    try { S.cfg = await api('/config'); } catch (e) { app.innerHTML = `<div class="vazio-cid">${esc(e.message)}</div>`; return; }
    $('#orgao').textContent = S.cfg.nomeOficial || S.cfg.municipio || 'Cadastro imobiliário municipal';
    document.title = `Portal do Cidadão — ${S.cfg.nomeOficial || S.cfg.municipio || ''}`;
    $('#rodape').innerHTML = `<b>${esc(S.cfg.nomeOficial || '')}</b>${S.cfg.secretaria ? ' · ' + esc(S.cfg.secretaria) : ''}${S.cfg.setor ? ' · ' + esc(S.cfg.setor) : ''}<br>
      ${[S.cfg.endereco, S.cfg.telefone, S.cfg.email].filter(Boolean).map(esc).join(' · ')}<br>Seus dados são tratados conforme a LGPD (Lei 13.709/2018): você vê só os imóveis do seu CPF/CNPJ e cada acesso é registrado.`;
    // Volta do gov.br: #t=<sessão> ou #erro=<mensagem> (fragmento não vai ao servidor).
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('t') || h.get('erro')) history.replaceState(null, '', location.pathname);
    if (h.get('t')) token.set(h.get('t'));
    if (token.get()) carregar(); else entrada(h.get('erro') || '');
  })();
})();
