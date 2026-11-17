// Modelos dos documentos oficiais emitidos pela plataforma (certidoes,
// declaracoes, notificacoes, oficios e relatorios). Cada modelo tem:
//   - preparar(ctx): valida os pre-requisitos e monta o "conteudo" (snapshot
//     congelado no momento da emissao — o documento nao muda depois);
//   - corpo(conteudo, opts): HTML do corpo, a partir do snapshot.
// O cabecalho (brasao, prefeitura, secretaria), a data, a assinatura e o
// rodape de validacao (codigo + QR) sao comuns e montados em renderDocumento().
//
// IMPORTANTE: os textos sao modelos de referencia. Cada prefeitura deve
// revisa-los a luz do seu Codigo Tributario e da legislacao municipal.
import qrcode from 'qrcode-generator';
import { formatarDoc, mascararDoc, isoData } from './cib-validacao.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function dataExtenso(d) {
  const x = new Date(d);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(x);
  const g = (t) => Number(p.find((y) => y.type === t).value);
  return `${g('day')} de ${MESES[g('month') - 1]} de ${g('year')}`;
}
const dataCurta = (d) => {
  if (!d) return '—';
  const s = d instanceof Date ? isoData(d) : String(d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('/');
  return new Date(s).toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });
};
const m2 = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m²`);
const brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const nomeComp = (c) => { const [a, m] = String(c).split('-'); return `${MESES[Number(m) - 1]} de ${a}`; };
const SIT_SINTER = {
  pendente_correcao: 'pendente de correção cadastral', pronto: 'pronto para envio', aguardando_envio: 'aguardando transmissão',
  enviado: 'transmitido, aguardando retorno', conciliado: 'conciliado (CIB atribuído)', divergente: 'com divergência em conciliação', baixado: 'baixado',
};
const erro = (msg) => Object.assign(new Error(msg), { status: 422 });

function enderecoDe(im) {
  const l = [im.logradouro, im.numero ? `nº ${im.numero}` : ''].filter(Boolean).join(', ');
  return [l, im.complemento].filter(Boolean).join(' — ') || '—';
}

/** Tabela de identificacao do imovel (usada por varios modelos). */
function tabelaImovel(im, { mascarar, completa = true } = {}) {
  const doc = mascarar ? mascararDoc(im.contribuinteDoc) : formatarDoc(im.contribuinteDoc);
  const linhas = [
    ['Inscrição imobiliária', `<strong>${esc(im.inscricao)}</strong>`],
    ['CIB (Cadastro Imobiliário Brasileiro)', im.cib ? `<strong>${esc(im.cib)}</strong>` : 'ainda não atribuído'],
    ['Situação', im.situacao === 'baixado' ? 'BAIXADA' : 'ATIVA'],
    ['Endereço', esc(enderecoDe(im))],
    ['Bairro / CEP', `${esc(im.bairro || '—')}${im.cep ? ' · CEP ' + esc(String(im.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2')) : ''}`],
  ];
  if (completa) {
    linhas.push(
      ['Setor / Quadra / Lote', [im.setor, im.quadra, im.loteNum].map((x) => esc(x || '—')).join(' / ')],
      ['Tipo / Uso', `${im.tipo === 'territorial' ? 'Territorial' : 'Predial'}${im.uso ? ' · ' + esc(im.uso) : ''}`],
      ['Área do terreno', m2(im.areaTerreno)],
      ['Área construída', m2(im.areaConstruida)],
      ['Matrícula / Cartório', `${esc(im.matriculaCartorio || '—')}${im.cartorio ? ' · ' + esc(im.cartorio) : ''}`],
    );
  }
  linhas.push(['Contribuinte', `${esc(im.contribuinteNome || '—')}${doc ? ' · ' + esc(doc) : ''}`]);
  return `<table class="dados">${linhas.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
}

const exigirImovel = (ctx) => { if (!ctx.imovel) throw erro('Selecione o imóvel (inscrição) para este documento.'); return ctx.imovel; };
const snapImovel = (im) => (im ? JSON.parse(JSON.stringify(im)) : null);

export const TIPOS_DOC = {
  certidao_cadastral: {
    titulo: 'Certidão de Dados Cadastrais do Imóvel', grupo: 'Certidões', imovel: true, validade: true,
    preparar(ctx) { exigirImovel(ctx); return { imovel: snapImovel(ctx.imovel) }; },
    corpo(c, o) {
      return `<p>CERTIFICO, para os devidos fins, a requerimento de <strong>${esc(c.interessado || c.imovel.contribuinteNome)}</strong>,
        que, revendo os registros do Cadastro Imobiliário deste Município, consta o imóvel abaixo identificado, com os seguintes dados:</p>
        ${tabelaImovel(c.imovel, o)}
        <p class="nota">A presente certidão reflete os dados cadastrais vigentes na data de sua emissão. Não constitui prova de propriedade,
        que se faz pela matrícula no Registro de Imóveis, nem de quitação de tributos municipais.</p>`;
    },
  },
  declaracao_cib: {
    titulo: 'Declaração de Inscrição Imobiliária e CIB', grupo: 'Declarações', imovel: true,
    preparar(ctx) {
      const im = exigirImovel(ctx);
      if (!im.cib) throw erro('Este imóvel ainda não tem CIB atribuído. Conclua a transmissão e a conciliação com o Sinter antes de emitir.');
      return { imovel: snapImovel(im) };
    },
    corpo(c, o) {
      return `<p>DECLARAMOS, para os devidos fins, que o imóvel inscrito no Cadastro Imobiliário Municipal sob o nº
        <strong>${esc(c.imovel.inscricao)}</strong> está vinculado ao Código do Cadastro Imobiliário Brasileiro
        <strong>CIB nº ${esc(c.imovel.cib)}</strong>, atribuído no Sistema Nacional de Gestão de Informações Territoriais (Sinter),
        nos termos da Lei Complementar nº 214/2025 e da Instrução Normativa RFB nº 2.275/2025.</p>
        ${tabelaImovel(c.imovel, { ...o, completa: false })}
        <p>O vínculo acima foi conciliado entre o cadastro municipal e a base nacional${c.imovel.cibAtribuidoEm ? ' em ' + dataCurta(c.imovel.cibAtribuidoEm) : ''}.</p>`;
    },
  },
  certidao_numeracao: {
    titulo: 'Certidão de Numeração Predial', grupo: 'Certidões', imovel: true, validade: true,
    preparar(ctx) {
      const im = exigirImovel(ctx);
      if (!im.numero || /^s\/?n$/i.test(im.numero)) throw erro('O imóvel não tem numeração predial oficial cadastrada.');
      if (!im.logradouro) throw erro('O imóvel não tem logradouro cadastrado.');
      return { imovel: snapImovel(im) };
    },
    corpo(c, o) {
      return `<p>CERTIFICO, para os devidos fins, que ao imóvel inscrito no Cadastro Imobiliário Municipal sob o nº
        <strong>${esc(c.imovel.inscricao)}</strong> corresponde a numeração predial oficial
        <strong>nº ${esc(c.imovel.numero)}</strong>, no logradouro <strong>${esc(c.imovel.logradouro)}</strong>,
        bairro <strong>${esc(c.imovel.bairro || '—')}</strong>, neste Município.</p>
        ${tabelaImovel(c.imovel, { ...o, completa: false })}`;
    },
  },
  certidao_valor_venal: {
    titulo: 'Certidão de Valor Venal', grupo: 'Certidões', imovel: true, validade: true,
    preparar(ctx) {
      const im = exigirImovel(ctx);
      if (im.valorVenal == null || !im.valorVenalAno) throw erro('Valor venal não calculado: publique um exercício da Planta Genérica de Valores (PGV).');
      return { imovel: snapImovel(im), exercicio: im.valorVenalAno };
    },
    corpo(c, o) {
      const im = c.imovel;
      return `<p>CERTIFICO, para os devidos fins, que o imóvel abaixo identificado possui, para o exercício de <strong>${c.exercicio}</strong>,
        o valor venal apurado com base na Planta Genérica de Valores do Município:</p>
        ${tabelaImovel(im, { ...o, completa: false })}
        <table class="dados valores">
          <tr><th>Valor venal do terreno</th><td>${brl(im.valorVenalTerreno)}</td></tr>
          <tr><th>Valor venal da construção</th><td>${brl(im.valorVenalConstrucao)}</td></tr>
          <tr><th>Valor venal total</th><td><strong>${brl(im.valorVenal)}</strong></td></tr>
        </table>
        <p class="nota">Valor apurado segundo os parâmetros da PGV vigente (área do terreno ${m2(im.areaTerreno)}; área construída ${m2(im.areaConstruida)};
        padrão construtivo ${esc(im.padraoConstrutivo || '—')}).</p>`;
    },
  },
  declaracao_situacao: {
    titulo: 'Declaração de Situação Cadastral', grupo: 'Declarações', imovel: true, validade: true,
    preparar(ctx) { exigirImovel(ctx); return { imovel: snapImovel(ctx.imovel) }; },
    corpo(c, o) {
      const im = c.imovel;
      const pend = (im.pendencias || []).filter((p) => p.nivel === 'erro');
      return `<p>DECLARAMOS, para os devidos fins, que a inscrição imobiliária nº <strong>${esc(im.inscricao)}</strong> encontra-se
        <strong>${im.situacao === 'baixado' ? 'BAIXADA' : 'ATIVA'}</strong> no Cadastro Imobiliário Municipal${pend.length ? ', com as pendências cadastrais relacionadas abaixo' : ', sem pendências cadastrais'}.</p>
        ${tabelaImovel(im, { ...o, completa: false })}
        ${pend.length ? `<ul>${pend.map((p) => `<li>${esc(p.mensagem)}</li>`).join('')}</ul>` : ''}
        <p>Situação perante o Sinter (Receita Federal): <strong>${esc(SIT_SINTER[im.sinterStatus] || im.sinterStatus || '—')}</strong>${im.cib ? ` — CIB nº ${esc(im.cib)}` : ''}.</p>`;
    },
  },
  certidao_baixa: {
    titulo: 'Certidão de Baixa de Inscrição Imobiliária', grupo: 'Certidões', imovel: true,
    preparar(ctx) {
      const im = exigirImovel(ctx);
      if (im.situacao !== 'baixado') throw erro('A inscrição está ativa. Registre a baixa no cadastro antes de emitir a certidão.');
      return { imovel: snapImovel(im) };
    },
    corpo(c, o) {
      return `<p>CERTIFICO, para os devidos fins, que a inscrição imobiliária nº <strong>${esc(c.imovel.inscricao)}</strong> foi
        <strong>BAIXADA</strong> no Cadastro Imobiliário Municipal em <strong>${dataCurta(c.imovel.dataBaixa)}</strong>, pelo motivo:
        <em>${esc(c.imovel.motivoBaixa || 'não informado')}</em>.</p>
        ${tabelaImovel(c.imovel, { ...o, completa: false })}
        <p>A baixa foi comunicada ao Sinter na rotina de manutenção do cadastro.</p>`;
    },
  },
  notificacao_atualizacao: {
    titulo: 'Notificação para Atualização Cadastral', grupo: 'Notificações', imovel: true,
    campos: [{ id: 'motivo', label: 'Motivo da notificação', tipo: 'textarea', padrao: 'Divergência entre a área edificada identificada em imagem aérea recente e a área cadastrada.' },
      { id: 'prazoDias', label: 'Prazo para atendimento (dias)', tipo: 'number', padrao: 30 }],
    preparar(ctx) {
      exigirImovel(ctx);
      return { imovel: snapImovel(ctx.imovel), motivo: String(ctx.campos.motivo || '').slice(0, 2000), prazoDias: Number(ctx.campos.prazoDias) || 30 };
    },
    corpo(c, o) {
      return `<p>Fica o(a) contribuinte <strong>${esc(c.imovel.contribuinteNome || 'responsável pelo imóvel')}</strong> NOTIFICADO(A) a comparecer
        ao ${esc(o.cfg.setor)}, no prazo de <strong>${c.prazoDias} (${c.prazoDias === 30 ? 'trinta' : c.prazoDias}) dias</strong> contados do recebimento,
        munido(a) de documentação do imóvel, para atualização cadastral do imóvel abaixo identificado.</p>
        ${tabelaImovel(c.imovel, { ...o, completa: false })}
        <p><strong>Motivo:</strong> ${esc(c.motivo)}</p>
        <p class="nota">O não atendimento poderá ensejar a atualização de ofício, com base nas informações disponíveis à Administração,
        nos termos da legislação tributária municipal.</p>`;
    },
  },
  relatorio_mensal: {
    titulo: 'Relatório Mensal de Manutenção do Cadastro (CIB/Sinter)', grupo: 'Relatórios', imovel: false,
    campos: [{ id: 'competencia', label: 'Competência (AAAA-MM)', tipo: 'month' }],
    async preparar(ctx) { return { relatorio: await ctx.relatorioMensal(ctx.municipio, ctx.campos.competencia) }; },
    corpo(c) {
      const r = c.relatorio;
      const t = r.movimentacoes.porTipo, s = r.movimentacoes.porStatus;
      const rem = r.remessas.length ? `<table class="grade"><tr><th>Remessa</th><th>Modo</th><th>Protocolo</th><th>Itens</th><th>OK</th><th>Diverg.</th><th>Rejeit.</th><th>Situação</th></tr>
        ${r.remessas.map((x) => `<tr><td>${String(x.numero).padStart(2, '0')}</td><td>${esc(x.modo)}</td><td>${esc(x.protocolo || '—')}</td><td>${x.qtd_itens}</td><td>${x.qtd_ok}</td><td>${x.qtd_divergente}</td><td>${x.qtd_erro}</td><td>${esc(x.status)}</td></tr>`).join('')}</table>`
        : '<p>Nenhuma remessa transmitida na competência.</p>';
      const origens = Object.entries(r.movimentacoes.porOrigem).map(([k, v]) => `${esc(k.replace('_', '-'))}: ${v}`).join(' · ') || '—';
      return `<p>Prestação de contas da rotina de manutenção do cadastro imobiliário e de sua integração ao Sinter,
        referente à competência de <strong>${nomeComp(r.competencia)}</strong>.</p>
        <h3>1. Situação da base</h3>
        <table class="grade"><tr><th>Imóveis ativos</th><th>Com CIB</th><th>% com CIB</th><th>Com pendência</th></tr>
        <tr><td>${r.base.ativos}</td><td>${r.base.com_cib}</td><td>${r.base.ativos ? ((r.base.com_cib / r.base.ativos) * 100).toFixed(1) : '0,0'}%</td><td>${r.base.pendentes}</td></tr></table>
        <h3>2. Ciclo mensal — eventos capturados (${r.movimentacoes.total})</h3>
        <table class="grade"><tr><th>Inclusões</th><th>Alterações</th><th>Baixas</th><th>Reativações</th></tr>
        <tr><td>${t.inclusao}</td><td>${t.alteracao}</td><td>${t.baixa}</td><td>${t.reativacao}</td></tr></table>
        <p>Por origem: ${origens}.</p>
        <table class="grade"><tr><th>Capturadas</th><th>Validadas</th><th>Transmitidas</th><th>Conciliadas</th><th>Divergentes</th><th>Rejeitadas</th></tr>
        <tr><td>${s.capturada}</td><td>${s.validada}</td><td>${s.transmitida}</td><td>${s.conciliada}</td><td>${s.divergente}</td><td>${s.rejeitada}</td></tr></table>
        <h3>3. Transmissão ao Sinter</h3>${rem}
        <p>CIBs atribuídos na competência: <strong>${r.cibsAtribuidos}</strong>.</p>
        <h3>4. Conciliação</h3>
        <p>Divergências apontadas no mês: ${r.divergencias.abertas_mes} · resolvidas no mês: ${r.divergencias.resolvidas_mes} · em aberto: <strong>${r.divergencias.em_aberto}</strong>.</p>
        <h3>5. Vistoria (detecção por imagem)</h3>
        <p>Diferenças detectadas: ${r.vistorias.detectadas} · confirmadas em campo: ${r.vistorias.confirmadas} · pendentes: ${r.vistorias.pendentes}.</p>
        <h3>6. Atendimento</h3>
        <p>Requerimentos protocolados: ${r.requerimentos.protocolados} · concluídos: ${r.requerimentos.concluidos} · em aberto: ${r.requerimentos.emAberto}.
        Documentos emitidos: ${r.documentos.emitidos}.</p>`;
    },
  },
  relatorio_diagnostico: {
    titulo: 'Relatório de Diagnóstico da Base Cadastral', grupo: 'Relatórios', imovel: false,
    async preparar(ctx) { return { diagnostico: await ctx.diagnostico(ctx.municipio) }; },
    corpo(c) {
      const d = c.diagnostico, im = d.imoveis;
      return `<p>Raio-x da base cadastral do município para integração ao Sinter (etapa 1 da implantação do CIB).</p>
        <table class="grade"><tr><th>Imóveis ativos</th><th>Prontos para o Sinter</th><th>Precisam de correção</th><th>Sem vínculo com lote</th></tr>
        <tr><td>${im.ativos}</td><td>${im.prontos} (${im.pctProntos}%)</td><td>${im.com_erro} (${im.pctComErro}%)</td><td>${im.sem_lote}</td></tr></table>
        <table class="grade"><tr><th>Lotes no CTM</th><th>Lotes sem imóvel</th><th>Duplicidades</th><th>Logradouros sem nome</th></tr>
        <tr><td>${d.lotes.total}</td><td>${d.lotes.semImovel}</td><td>${d.duplicidades}</td><td>${d.logradourosSemNome}</td></tr></table>
        <h3>Pendências por regra</h3>
        ${d.porRegra.length ? `<table class="grade"><tr><th>Regra</th><th>Nível</th><th>Imóveis</th></tr>${d.porRegra.map((r) => `<tr><td>${esc(r.mensagem)}</td><td>${r.nivel === 'erro' ? 'bloqueia' : 'alerta'}</td><td>${r.n}</td></tr>`).join('')}</table>` : '<p>Nenhuma pendência encontrada.</p>'}
        <h3>Estimativa</h3>
        <p>Saneamento: <strong>${d.estimativa.semanasSaneamento} semana(s)</strong> · Integração: <strong>${d.estimativa.semanasIntegracao} semana(s)</strong> ·
        Prazo estimado total: <strong>${d.estimativa.semanasTotal} semana(s)</strong> (capacidade de referência: ${d.estimativa.capacidadeSemanal} correções/semana).</p>`;
    },
  },
  oficio_adesao_sinter: {
    titulo: 'Ofício — Adesão ao Convênio Sinter/CIB', grupo: 'Ofícios e termos', imovel: false, minuta: true,
    campos: [{ id: 'destinatario', label: 'Destinatário', tipo: 'text', padrao: 'Ao(À) Senhor(a) Delegado(a) da Receita Federal do Brasil' },
      { id: 'unidadeRfb', label: 'Unidade da RFB', tipo: 'text', padrao: 'Delegacia da Receita Federal do Brasil em João Pessoa/PB' }],
    preparar(ctx) {
      if (!ctx.cfg.prefeitoNome) throw erro('Informe o nome do(a) prefeito(a) na configuração do município.');
      return { destinatario: String(ctx.campos.destinatario || ''), unidadeRfb: String(ctx.campos.unidadeRfb || ''), transmissores: ctx.cfg.transmissores };
    },
    corpo(c, o) {
      const cfg = o.cfg;
      return `<p>${esc(c.destinatario)}<br>${esc(c.unidadeRfb)}</p>
        <p><strong>Assunto:</strong> Adesão ao Sistema Nacional de Gestão de Informações Territoriais (Sinter) e ao Cadastro Imobiliário Brasileiro (CIB).</p>
        <p>Senhor(a) Delegado(a),</p>
        <p>O <strong>${esc(cfg.nomeOficial)}</strong>${cfg.cnpj ? `, inscrito no CNPJ sob o nº ${esc(formatarDoc(cfg.cnpj))}` : ''}${cfg.codigoIbge ? `, código IBGE ${esc(cfg.codigoIbge)}` : ''},
        por seu(sua) Prefeito(a), vem manifestar o interesse em aderir ao convênio do Sinter, nos termos da Lei Complementar nº 214/2025 e da
        Instrução Normativa RFB nº 2.275/2025, com vistas ao compartilhamento dos dados do cadastro imobiliário urbano e à atribuição do CIB aos imóveis do Município.</p>
        <p>Para a operação do convênio, o Município indica como responsável técnico ${esc(cfg.responsavelNome || '[nome]')}, ${esc(cfg.responsavelCargo || '[cargo]')}
        ${c.transmissores ? `, e como transmissor(es) pessoa jurídica: ${esc(c.transmissores)}` : ''}, permanecendo o Município como titular do convênio e responsável pelo cadastro.</p>
        <p>Colocamo-nos à disposição para as providências necessárias.</p>`;
    },
    assinatura: (cfg) => ({ nome: cfg.prefeitoNome, cargo: 'Prefeito(a) Municipal' }),
  },
  termo_transmissor: {
    titulo: 'Termo de Indicação de Transmissor Pessoa Jurídica', grupo: 'Ofícios e termos', imovel: false, minuta: true,
    campos: [{ id: 'transmissorNome', label: 'Razão social do transmissor', tipo: 'text', padrao: 'BzR Technology' },
      { id: 'transmissorCnpj', label: 'CNPJ do transmissor', tipo: 'text' },
      { id: 'contrato', label: 'Instrumento contratual (nº)', tipo: 'text' }],
    preparar(ctx) {
      if (!ctx.campos.transmissorNome) throw erro('Informe a razão social do transmissor.');
      return { transmissorNome: String(ctx.campos.transmissorNome), transmissorCnpj: String(ctx.campos.transmissorCnpj || ''), contrato: String(ctx.campos.contrato || '') };
    },
    corpo(c, o) {
      return `<p>O <strong>${esc(o.cfg.nomeOficial)}</strong>, titular do convênio Sinter${o.cfg.convenioNumero ? ` nº ${esc(o.cfg.convenioNumero)}` : ''},
        INDICA a pessoa jurídica <strong>${esc(c.transmissorNome)}</strong>${c.transmissorCnpj ? `, CNPJ ${esc(formatarDoc(c.transmissorCnpj))}` : ''},
        como transmissora das informações do cadastro imobiliário municipal ao Sinter${c.contrato ? `, nos termos do contrato nº ${esc(c.contrato)}` : ''}.</p>
        <p>A transmissora fica responsável por operar a rotina de envio (inclusões, alterações, baixas e reativações), documentar cada remessa e
        prestar contas mensalmente ao Município, que permanece titular do convênio e responsável pelo conteúdo do cadastro.</p>
        <p>O convênio admite até 3 (três) transmissores pessoa jurídica por município (CNM, Nota Técnica nº 16/2026).</p>`;
    },
    assinatura: (cfg) => ({ nome: cfg.prefeitoNome || cfg.responsavelNome, cargo: cfg.prefeitoNome ? 'Prefeito(a) Municipal' : cfg.responsavelCargo }),
  },
  declaracao_livre: {
    titulo: 'Declaração', grupo: 'Declarações', imovel: 'opcional',
    campos: [{ id: 'titulo', label: 'Título do documento', tipo: 'text', padrao: 'Declaração' },
      { id: 'texto', label: 'Texto (parágrafos separados por linha em branco)', tipo: 'textarea' }],
    preparar(ctx) {
      if (!String(ctx.campos.texto || '').trim()) throw erro('Escreva o texto da declaração.');
      return { tituloLivre: String(ctx.campos.titulo || 'Declaração').slice(0, 120), texto: String(ctx.campos.texto).slice(0, 8000), imovel: snapImovel(ctx.imovel) };
    },
    corpo(c, o) {
      const paras = c.texto.split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
      return paras + (c.imovel ? tabelaImovel(c.imovel, { ...o, completa: false }) : '');
    },
  },
};

export function catalogoPublico() {
  return Object.entries(TIPOS_DOC).map(([id, t]) => ({
    id, titulo: t.titulo, grupo: t.grupo, imovel: t.imovel, validade: Boolean(t.validade), minuta: Boolean(t.minuta), campos: t.campos || [],
  }));
}

function qrSvg(texto) {
  try {
    const q = qrcode(0, 'M');
    q.addData(texto);
    q.make();
    return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
  } catch { return ''; }
}

const CSS = `
  @page { size: A4; margin: 18mm 18mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", Georgia, serif; color: #111; background: #e9e7e1; margin: 0; font-size: 12.5pt; line-height: 1.55; }
  .folha { background: #fff; width: 210mm; min-height: 297mm; margin: 16px auto; padding: 18mm 18mm 16mm; box-shadow: 0 4px 24px rgba(0,0,0,.15); position: relative; }
  .cab { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 10px; }
  .cab img { width: 64px; height: 64px; object-fit: contain; }
  .cab .brasao-vazio { width: 64px; height: 64px; border: 1px dashed #999; display: grid; place-items: center; font: 9px sans-serif; color: #999; text-align: center; }
  .cab .ent { line-height: 1.3; }
  .cab .ent strong { font-size: 14pt; text-transform: uppercase; letter-spacing: .02em; display: block; }
  .cab .ent span { font-size: 10.5pt; display: block; }
  h1 { font-size: 14pt; text-align: center; text-transform: uppercase; margin: 22px 0 2px; letter-spacing: .03em; }
  .num { text-align: center; font-size: 10.5pt; margin-bottom: 18px; font-family: ui-monospace, monospace; }
  p { text-align: justify; margin: 0 0 10px; }
  h3 { font-size: 11.5pt; margin: 16px 0 6px; text-transform: uppercase; }
  table.dados { width: 100%; border-collapse: collapse; margin: 10px 0 14px; font-size: 11pt; }
  table.dados th { text-align: left; font-weight: normal; color: #444; width: 38%; padding: 4px 8px; border: 1px solid #bbb; background: #f5f4f0; }
  table.dados td { padding: 4px 8px; border: 1px solid #bbb; }
  table.grade { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 10.5pt; }
  table.grade th, table.grade td { border: 1px solid #bbb; padding: 4px 6px; text-align: center; }
  table.grade th { background: #f5f4f0; font-weight: 600; }
  .nota { font-size: 10.5pt; color: #333; }
  .local { text-align: right; margin-top: 22px; }
  .assina { margin: 46px auto 0; width: 70%; text-align: center; border-top: 1px solid #111; padding-top: 4px; font-size: 11pt; line-height: 1.3; }
  .assina small { display: block; font-size: 9.5pt; color: #444; }
  .valida { display: flex; gap: 12px; align-items: center; margin-top: 28px; border-top: 1px solid #bbb; padding-top: 10px; font: 9pt/1.4 ui-sans-serif, system-ui, sans-serif; color: #333; }
  .valida svg { width: 84px; height: 84px; flex: 0 0 84px; }
  .valida code { font: 700 11pt ui-monospace, monospace; letter-spacing: .06em; }
  .rodape { font: 8.5pt/1.3 ui-sans-serif, system-ui, sans-serif; color: #555; margin-top: 8px; text-align: center; }
  .selo { position: absolute; top: 18mm; right: 18mm; font: 700 9pt ui-sans-serif, sans-serif; border: 2px solid; padding: 3px 8px; transform: rotate(4deg); }
  .selo.cancelado { color: #b4351e; } .selo.minuta { color: #a36a10; }
  .marca { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; font: 700 72pt sans-serif; color: rgba(180,53,30,.12); transform: rotate(-28deg); }
  .barra { width: 210mm; margin: 12px auto 0; display: flex; gap: 8px; justify-content: flex-end; font-family: system-ui, sans-serif; }
  .barra button { cursor: pointer; border: 1px solid #111; background: #111; color: #fff; padding: 8px 14px; font-size: 13px; }
  .barra button.sec { background: #fff; color: #111; }
  @media screen and (max-width: 820px) { .folha { width: auto; min-height: 0; margin: 8px; padding: 18px; } .barra { width: auto; margin: 8px; } }
  @media print { body { background: #fff; } .folha { box-shadow: none; margin: 0; width: auto; min-height: 0; padding: 0; } .barra { display: none; } }
`;

/**
 * Monta a pagina HTML completa (A4) de um documento emitido.
 * opts: { cfg (configuracao atual, para o brasao), origem (URL base), mascarar, barra }
 */
export function renderDocumento(doc, { cfg, origem = '', mascarar = false, barra = true, previa = false } = {}) {
  const t = TIPOS_DOC[doc.tipo];
  const c = doc.conteudo || {};
  const cfgDoc = { ...(c.cfg || {}), brasao: cfg?.brasao || '' };
  const titulo = c.tituloLivre || t?.titulo || doc.titulo;
  const corpo = t ? t.corpo(c, { cfg: cfgDoc, mascarar }) : '<p>Modelo não encontrado.</p>';
  const ass = t?.assinatura ? t.assinatura(cfgDoc) : { nome: c.emissor?.responsavelNome || cfgDoc.responsavelNome, cargo: cfgDoc.responsavelCargo };
  const urlValida = `${origem}/validar?codigo=${encodeURIComponent(doc.codigo_validacao)}`;
  const cidade = (cfgDoc.municipio || '').trim() || cfgDoc.nomeOficial;
  const validade = doc.validade ? ` · válido até ${dataCurta(doc.validade)}` : '';
  const brasao = cfgDoc.brasao ? `<img src="${esc(cfgDoc.brasao)}" alt="Brasão" />` : '<div class="brasao-vazio">brasão<br>do município</div>';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)} nº ${esc(doc.numero)}</title><style>${CSS}</style></head><body>
${barra ? `<div class="barra"><button class="sec" onclick="history.length>1?history.back():window.close()">Voltar</button><button onclick="window.print()">Imprimir / salvar PDF</button></div>` : ''}
<div class="folha">
  ${previa ? '<div class="marca" style="color:rgba(163,106,16,.12)">PRÉVIA</div><div class="selo minuta">PRÉVIA — SEM VALOR DE DOCUMENTO</div>' : doc.status === 'cancelado' ? '<div class="marca">CANCELADO</div><div class="selo cancelado">CANCELADO</div>' : (t?.minuta ? '<div class="selo minuta">MINUTA</div>' : '')}
  <div class="cab">${brasao}<div class="ent"><strong>${esc(cfgDoc.nomeOficial)}</strong><span>${esc(cfgDoc.secretaria)}</span><span>${esc(cfgDoc.setor)}</span>
    ${cfgDoc.cnpj ? `<span>CNPJ ${esc(formatarDoc(cfgDoc.cnpj))}</span>` : ''}</div></div>
  <h1>${esc(titulo)}</h1>
  <div class="num">Nº ${esc(doc.numero)}${doc.requerimento_numero ? ` · Protocolo ${esc(doc.requerimento_numero)}` : ''}</div>
  ${corpo}
  ${doc.status === 'cancelado' ? `<p class="nota"><strong>Documento cancelado</strong> em ${dataCurta(doc.cancelado_em)}: ${esc(doc.motivo_cancelamento)}</p>` : ''}
  <p class="local">${esc(cidade)}${cfgDoc.uf ? ' – ' + esc(cfgDoc.uf) : ''}, ${dataExtenso(doc.emitido_em)}.</p>
  <div class="assina"><strong>${esc(ass.nome || '________________________')}</strong><small>${esc(ass.cargo || '')}</small>
    <small>Emitido eletronicamente por ${esc(doc.emitido_por_nome || '—')}</small></div>
  ${previa ? '<div class="valida"><div>Prévia gerada para acompanhamento. Para valer como documento, emita o relatório (numerado, com código de validação).</div></div>' : `<div class="valida">${qrSvg(urlValida)}<div>Autenticidade: acesse <strong>${esc(urlValida.replace(/^https?:\/\//, ''))}</strong><br>
    ou informe o código <code>${esc(doc.codigo_validacao)}</code> na página de validação.<br>
    Emitido em ${new Date(doc.emitido_em).toLocaleString('pt-BR', { timeZone: 'America/Recife' })}${validade}.<br>
    Integridade (SHA-256/JCS): ${esc(String(doc.hash_conteudo || '').slice(0, 32))}…</div></div>`}
  <div class="rodape">${esc(cfgDoc.endereco || '')}${cfgDoc.telefone ? ' · ' + esc(cfgDoc.telefone) : ''}${cfgDoc.email ? ' · ' + esc(cfgDoc.email) : ''}
    ${cfgDoc.rodapeDocumentos ? '<br>' + esc(cfgDoc.rodapeDocumentos) : ''}</div>
</div></body></html>`;
}

/** Comprovante de protocolo de requerimento (sem validade juridica propria). */
export function renderComprovante(req, cfg, origem = '') {
  const url = `${origem}/validar?protocolo=${encodeURIComponent(req.numero)}`;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Protocolo ${esc(req.numero)}</title><style>${CSS}</style></head><body>
<div class="barra"><button class="sec" onclick="history.length>1?history.back():window.close()">Voltar</button><button onclick="window.print()">Imprimir</button></div>
<div class="folha" style="min-height:0">
  <div class="cab">${cfg.brasao ? `<img src="${esc(cfg.brasao)}" alt="Brasão" />` : '<div class="brasao-vazio">brasão</div>'}<div class="ent"><strong>${esc(cfg.nomeOficial)}</strong><span>${esc(cfg.secretaria)}</span><span>${esc(cfg.setor)}</span></div></div>
  <h1>Comprovante de Protocolo</h1><div class="num">Nº ${esc(req.numero)}</div>
  <table class="dados">
    <tr><th>Requerente</th><td>${esc(req.requerente_nome)} · ${esc(mascararDoc(req.requerente_doc))}</td></tr>
    <tr><th>Assunto</th><td>${esc(req.tipo_label)}</td></tr>
    ${req.inscricao ? `<tr><th>Inscrição imobiliária</th><td>${esc(req.inscricao)}</td></tr>` : ''}
    <tr><th>Descrição</th><td>${esc(req.descricao || '—')}</td></tr>
    <tr><th>Data do protocolo</th><td>${new Date(req.created_at).toLocaleString('pt-BR', { timeZone: 'America/Recife' })}</td></tr>
    <tr><th>Prazo previsto</th><td>${dataCurta(req.prazo)}</td></tr>
  </table>
  <div class="valida">${qrSvg(url)}<div>Acompanhe o andamento em <strong>${esc(url.replace(/^https?:\/\//, ''))}</strong><br>informando o número do protocolo e o CPF/CNPJ do requerente.</div></div>
</div></body></html>`;
}
