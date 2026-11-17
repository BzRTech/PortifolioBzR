// Leiaute OFICIAL de envio ao Sinter — Módulo Urbano (CADURB), API v1.
// Fonte: Manual Operacional de Integração (Receita Federal/Serpro), versão 1.17
// de 03/11/2026 — https://docs.receitafederal.gov.br/sinter/literal/guide/ui/
//   • Modelo de Dados (Payload): grupos DadosGeraisImovel, AreaConstruidaCompl,
//     EnderecoImovel, Titular[], ServicoRegistroImovel, CartorioNotas, ITBI
//   • Recepção por arquivo: .zip com NDJSON, uma linha por registro:
//       {"ui": {...}, "operacao": "I" | "A" | "D"}
//     I = inclusão (UI completa) · A = alteração (cib + UI) · D = desativação
//     (inscricaoImobiliaria, cib, tipoDesativacao, motivoDesativacao, complemento)
//
// Toda remessa é validada contra este leiaute ANTES de gerar o arquivo: item
// com erro não entra no arquivo e volta para a fila com a falha apontada.
// Os códigos de falha (0001…0108) são os da tabela oficial "Códigos de Falhas".
//
// Observações sobre o manual (divergências internas do próprio documento):
//  - o percentual do titular aparece como "percTitular" na tabela do modelo e
//    como "percTitularidade" em todos os exemplos e no fluxo; usamos
//    percTitularidade (exemplos + consultas de retorno).
//  - temBairro fica em DadosGeraisImovel (tabela do modelo e falha 0014).
//  - a API v1.17 não tem operação de REATIVAÇÃO (só I, A, D).
import { MOTIVO_DESATIVACAO, TIPO_IMOVEL, TIPO_ARQUITETONICO, DESTINACAO, BICE, PADRAO_CONSTRUTIVO, TIPO_LOGRADOURO,
  TIPO_TITULARIDADE, DOC_TITULARIDADE, TIPO_DESATIVACAO, CODIGOS_FALHA, temCodigo } from './dominios.js';
import { normalizarNi, niValido, cnmValido, soDigitos, cnpjAlfanumerico } from '../ni.js';

export const LEIAUTE = Object.freeze({
  id: 'sinter-cadurb-v1',
  versaoManual: '1.17',
  dataManual: '2026-11-03',
  rotulo: 'Sinter CADURB API v1 · Manual Operacional 1.17',
  fonte: 'https://docs.receitafederal.gov.br/sinter/literal/guide/ui/modelo-dados-payload.html',
  maxPorRequisicaoSincrona: 200,
});

// ---------------------------------------------------------------- mapeamentos
export const TIPO_IMOVEL_LOCAL = { territorial: 1, predial: 2, especial: 3 };
export const PADRAO_LOCAL = { popular: 1, baixo: 2, normal: 3, medio: 3, alto: 4, luxo: 5 };
const ABREV_LOGRADOURO = [
  [/^(av\.?|avenida)\s+/i, 26], [/^(r\.?|rua)\s+/i, 250], [/^(tv\.?|trav\.?|travessa)\s+/i, 273], [/^(al\.?|alameda)\s+/i, 10],
  [/^(p[çc]a\.?|pra[çc]a)\s+/i, 215], [/^(est\.?|estrada)\s+/i, 117], [/^(rod\.?|rodovia)\s+/i, 247], [/^(lg\.?|largo)\s+/i, 153],
  [/^(ld\.?|ladeira)\s+/i, 148], [/^beco\s+/i, 42], [/^viela\s+/i, 297], [/^vila\s+/i, 298], [/^passagem\s+/i, 193],
];
/** Deduz o código do tipo de logradouro pelo prefixo do nome ("Rua …" → 250). */
export function tipoLogradouroDoNome(nome) {
  for (const [re, cod] of ABREV_LOGRADOURO) if (re.test(String(nome || '').trim())) return cod;
  return null;
}
/** Nome do logradouro sem o tipo ("Rua das Flores" + 250 → "das Flores"). */
export function nomeSemTipo(nome, tipoCod) {
  const n = String(nome || '').trim();
  for (const [re, cod] of ABREV_LOGRADOURO) if (cod === Number(tipoCod) && re.test(n)) return n.replace(re, '').trim() || n;
  const desc = TIPO_LOGRADOURO[String(tipoCod)];
  if (desc && n.toLowerCase().startsWith(desc.toLowerCase() + ' ')) return n.slice(desc.length).trim();
  return n;
}
/** Destinação a partir do texto de uso do cadastro municipal. */
export function destinacaoDoUso(uso) {
  const u = String(uso || '').toLowerCase();
  if (/misto/.test(u)) return 14;
  if (/resid/.test(u)) return 1;
  if (/com[eé]rc/.test(u)) return 2;
  if (/servi/.test(u)) return 3;
  if (/indust/.test(u)) return 4;
  if (/educa|escola/.test(u)) return 5;
  if (/relig/.test(u)) return 8;
  if (/institu|p[úu]blic/.test(u)) return 9;
  if (/sa[úu]de/.test(u)) return 12;
  return null;
}

// ------------------------------------------------------------------ helpers
const vazio = (v) => v === undefined || v === null || String(v).trim() === '';
const num4 = (v) => Math.round(Number(v) * 10000) / 10000;
const num2 = (v) => Math.round(Number(v) * 100) / 100;
const isoData = (v) => {
  if (vazio(v)) return null;
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  return String(v).slice(0, 10);
};
/** Cabe em "n inteiros + d decimais". */
function cabeDecimal(v, inteiros, decimais) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return false;
  const [i] = n.toFixed(decimais).split('.');
  return i.replace(/^0+/, '').length <= inteiros;
}
const dataValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

/**
 * Monta a UI (objeto do payload oficial) a partir de um imóvel (linha da
 * tabela `imoveis`). Devolve { ui, avisos } — avisos explicam grupos opcionais
 * que ficaram de fora por estarem incompletos.
 */
export function montarUI(im, { incluirCib = false } = {}) {
  const avisos = [];
  const tipoImovel = TIPO_IMOVEL_LOCAL[im.tipo] ?? null;
  const tipoLogr = im.tipo_logradouro != null ? Number(im.tipo_logradouro) : tipoLogradouroDoNome(im.logradouro);
  const temBairro = im.tem_bairro != null ? Boolean(im.tem_bairro) : !vazio(im.bairro);
  const d = {
    inscricaoImobiliaria: String(im.inscricao || '').trim(),
    tipoImovel,
    temBairro,
    areaTerreno: vazio(im.area_terreno_m2) ? null : num4(im.area_terreno_m2),
  };
  if (tipoImovel !== 1) {
    if (!vazio(im.tp_arquitetonico)) d.tpArquitetonico = Number(im.tp_arquitetonico);
    if (!vazio(im.area_construida_m2) && Number(im.area_construida_m2) > 0) d.areaConstruida = num4(im.area_construida_m2);
    if (!vazio(im.ano_construcao)) d.anoConstrutivo = Number(im.ano_construcao);
    const pad = PADRAO_LOCAL[String(im.padrao_construtivo || '').toLowerCase()];
    if (pad) d.padraoConstrutivo = pad;
  }
  const dest = !vazio(im.destinacao) ? Number(im.destinacao) : destinacaoDoUso(im.uso);
  if (dest != null) d.destinacaoImovel = dest;
  if (tipoImovel === 3 && !vazio(im.bice)) d.bice = Number(im.bice);
  if (!vazio(im.valor_venal_total) && Number(im.valor_venal_total) > 0) {
    d.valorVenal = num2(im.valor_venal_total);
    if (im.valor_venal_ano) d.dtUltimoValorVenal = `${im.valor_venal_ano}-01-01`;
  }

  const e = {
    tipoLogradouro: tipoLogr,
    nomeLogradouro: nomeSemTipo(im.logradouro, tipoLogr),
    cep: soDigitos(im.cep),
  };
  if (temBairro) e.bairro = String(im.bairro || '').trim();
  const numero = String(im.numero || '').trim();
  if (numero && !/^s\/?n$/i.test(numero)) e.numeroImovel = numero;
  if (!vazio(im.complemento)) e.complEndereco = String(im.complemento).trim();

  const ui = { DadosGeraisImovel: d, EnderecoImovel: e };
  if (incluirCib && im.cib) ui.cib = String(im.cib).trim();

  // Titular (opcional; se informado, o grupo precisa estar completo).
  const nome = String(im.contribuinte_nome || '').trim();
  if (nome) {
    const faltam = [];
    if (vazio(im.titular_tipo)) faltam.push('tipo de titularidade');
    if (vazio(im.titular_doc_tipo)) faltam.push('documento de titularidade');
    if (vazio(im.titular_dt_aquisicao)) faltam.push('data de aquisição');
    if (faltam.length) {
      avisos.push({ campo: 'Titular', codigo: '0108', nivel: 'alerta', mensagem: `Titular não enviado: falta ${faltam.join(', ')} (grupo opcional, não impede o CIB).` });
    } else {
      const t = { nomeTitular: nome.slice(0, 300), percTitularidade: vazio(im.titular_perc) ? 1 : Number(im.titular_perc),
        dtAquisicaoTitular: isoData(im.titular_dt_aquisicao), tipoTitularidade: Number(im.titular_tipo), docTitularidade: Number(im.titular_doc_tipo) };
      const ni = normalizarNi(im.contribuinte_doc);
      if (ni && niValido(ni)) {
        if (cnpjAlfanumerico(ni)) {
          avisos.push({ campo: 'Titular.niTitular', codigo: '0102', nivel: 'alerta',
            mensagem: 'CNPJ alfanumérico não enviado: o leiaute 1.17 ainda define niTitular como numérico. O titular segue só com o nome.' });
        } else t.niTitular = ni;
      }
      ui.Titular = [t];
    }
  }
  // Serviço de Registro de Imóveis: só com o CNM (os demais campos não existem no cadastro).
  if (!vazio(im.cnm_ri)) {
    if (cnmValido(im.cnm_ri)) {
      const r = { cnmRI: soDigitos(im.cnm_ri) };
      if (!vazio(im.matricula_cartorio)) r.numMatriculaRI = String(im.matricula_cartorio).slice(0, 15);
      if (!vazio(im.cns_ri)) r.cnsRI = Number(im.cns_ri);
      if (!vazio(im.cartorio)) r.nomeServentiaRI = String(im.cartorio).slice(0, 300);
      ui.ServicoRegistroImovel = r;
    } else {
      avisos.push({ campo: 'ServicoRegistroImovel.cnmRI', codigo: '0102', nivel: 'alerta', mensagem: 'CNM da matrícula inválido (16 dígitos, livro 2, DV módulo 97): grupo de registro não enviado.' });
    }
  } else if (!vazio(im.matricula_cartorio)) {
    avisos.push({ campo: 'ServicoRegistroImovel', codigo: '0108', nivel: 'alerta', mensagem: 'Matrícula sem CNM: o grupo de registro só é enviado com o Código Nacional de Matrícula.' });
  }
  return { ui, avisos };
}

/**
 * Valida uma UI contra o Modelo de Dados oficial. Devolve a lista de falhas
 * { campo, codigo, nivel, mensagem }:
 *   nivel 'erro'   → o Sinter rejeita / não atribui CIB (campos da seção 4)
 *   nivel 'alerta' → campo opcional fora do padrão (o Sinter ignora o valor)
 */
export function validarUI(ui, operacao = 'I') {
  const f = [];
  const add = (campo, codigo, mensagem, nivel = 'erro') => f.push({ campo, codigo, nivel, mensagem: mensagem || CODIGOS_FALHA[codigo] || '' });
  const d = ui.DadosGeraisImovel || {}, e = ui.EnderecoImovel || {};
  const D = (c) => `DadosGeraisImovel.${c}`, E = (c) => `EnderecoImovel.${c}`;

  if (operacao === 'A' && vazio(ui.cib)) add('cib', '0001', 'Alteração exige o CIB da UI (aguarde o retorno da inclusão).');
  // DadosGeraisImovel
  if (vazio(d.inscricaoImobiliaria)) add(D('inscricaoImobiliaria'), '0001');
  else if (String(d.inscricaoImobiliaria).length > 45) add(D('inscricaoImobiliaria'), '0003', 'Inscrição imobiliária com mais de 45 caracteres.');
  if (d.tipoImovel == null) add(D('tipoImovel'), '0001');
  else if (!temCodigo(TIPO_IMOVEL, d.tipoImovel)) add(D('tipoImovel'), '0004');
  if (typeof d.temBairro !== 'boolean') add(D('temBairro'), '0001');
  if (d.areaTerreno == null) add(D('areaTerreno'), '0001');
  else if (!cabeDecimal(d.areaTerreno, 12, 4)) add(D('areaTerreno'), '0002', 'Área do terreno fora do formato (12 inteiros + 4 decimais).');
  else if (Number(d.areaTerreno) <= 0) add(D('areaTerreno'), '0005', 'Área do terreno deve ser maior que zero.');

  const t = Number(d.tipoImovel);
  if (t === 1) {
    if (d.tpArquitetonico != null || d.areaConstruida != null) add(D('tpArquitetonico'), '0011');
    if (d.anoConstrutivo != null) add(D('anoConstrutivo'), '0010', 'Imóvel territorial não deve informar ano de construção.', 'alerta');
  }
  if (t === 2) {
    if (d.tpArquitetonico == null || d.areaConstruida == null) add(d.tpArquitetonico == null ? D('tpArquitetonico') : D('areaConstruida'), '0012');
  }
  if (d.tpArquitetonico != null && !temCodigo(TIPO_ARQUITETONICO, d.tpArquitetonico)) add(D('tpArquitetonico'), '0004');
  if (d.areaConstruida != null && (!cabeDecimal(d.areaConstruida, 12, 4) || Number(d.areaConstruida) <= 0)) add(D('areaConstruida'), '0002', 'Área construída fora do formato ou zerada.');
  if (t === 2 || t === 3) {
    if (d.destinacaoImovel == null || !temCodigo(DESTINACAO, d.destinacaoImovel)) add(D('destinacaoImovel'), '0015');
  } else if (d.destinacaoImovel != null && !temCodigo(DESTINACAO, d.destinacaoImovel)) add(D('destinacaoImovel'), '0004', null, 'alerta');
  if (t === 3 && (d.bice == null || !temCodigo(BICE, d.bice))) add(D('bice'), '0013');
  if (d.anoConstrutivo != null && !/^\d{4}$/.test(String(d.anoConstrutivo))) add(D('anoConstrutivo'), '0102', 'Ano de construção com 4 dígitos.', 'alerta');
  if (d.padraoConstrutivo != null && !temCodigo(PADRAO_CONSTRUTIVO, d.padraoConstrutivo)) add(D('padraoConstrutivo'), '0104', null, 'alerta');
  if (d.valorVenal != null && !cabeDecimal(d.valorVenal, 18, 2)) add(D('valorVenal'), '0102', null, 'alerta');
  if (d.dtUltimoValorVenal != null && !dataValida(d.dtUltimoValorVenal)) add(D('dtUltimoValorVenal'), '0107', null, 'alerta');

  // EnderecoImovel
  if (e.tipoLogradouro == null) add(E('tipoLogradouro'), '0001', 'Tipo de logradouro não informado (Rua, Avenida, Travessa…).');
  else if (!temCodigo(TIPO_LOGRADOURO, e.tipoLogradouro)) add(E('tipoLogradouro'), '0004');
  if (vazio(e.nomeLogradouro)) add(E('nomeLogradouro'), '0001');
  else if (String(e.nomeLogradouro).length > 300) add(E('nomeLogradouro'), '0003');
  if (d.temBairro === true && vazio(e.bairro)) add(E('bairro'), '0014');
  if (!vazio(e.bairro) && String(e.bairro).length > 30) add(E('bairro'), '0003', 'Bairro com mais de 30 caracteres (limite do Sinter).');
  if (vazio(e.cep)) add(E('cep'), '0001', 'CEP não informado.');
  else if (!/^\d{8}$/.test(String(e.cep))) add(E('cep'), '0002', 'CEP deve ter 8 dígitos.');
  if (e.numeroImovel != null && String(e.numeroImovel).length > 8) add(E('numeroImovel'), '0103', 'Número com mais de 8 caracteres.', 'alerta');
  if (e.complNroImovel != null && String(e.complNroImovel).length > 30) add(E('complNroImovel'), '0103', null, 'alerta');
  if (e.complEndereco != null && String(e.complEndereco).length > 30) add(E('complEndereco'), '0103', 'Complemento com mais de 30 caracteres.', 'alerta');

  // Titular (opcional; grupo completo)
  for (const [i, ti] of (ui.Titular || []).entries()) {
    const T = (c) => `Titular[${i}].${c}`;
    if (ti.niTitular != null && (!/^\d{11}$|^\d{14}$/.test(String(ti.niTitular)) || !niValido(ti.niTitular))) add(T('niTitular'), '0106', null, 'alerta');
    if (ti.nomeTitular != null && String(ti.nomeTitular).length > 300) add(T('nomeTitular'), '0103', null, 'alerta');
    if (!(Number(ti.percTitularidade) > 0 && cabeDecimal(ti.percTitularidade, 1, 4) && Number(ti.percTitularidade) <= 1)) add(T('percTitularidade'), '0105', null, 'alerta');
    if (!dataValida(String(ti.dtAquisicaoTitular || ''))) add(T('dtAquisicaoTitular'), '0107', null, 'alerta');
    if (!temCodigo(TIPO_TITULARIDADE, ti.tipoTitularidade)) add(T('tipoTitularidade'), '0104', null, 'alerta');
    if (!temCodigo(DOC_TITULARIDADE, ti.docTitularidade)) add(T('docTitularidade'), '0104', null, 'alerta');
  }
  if ((ui.Titular || []).length > 1) {
    const soma = ui.Titular.reduce((s, x) => s + Number(x.percTitularidade || 0), 0);
    if (Math.abs(soma - 1) > 0.0001) add('Titular.percTitularidade', '0105', 'A soma dos percentuais dos titulares deve ser 100%.', 'alerta');
  }
  const r = ui.ServicoRegistroImovel;
  if (r) {
    if (r.cnmRI != null && !cnmValido(r.cnmRI)) add('ServicoRegistroImovel.cnmRI', '0102', null, 'alerta');
    if (r.numMatriculaRI != null && String(r.numMatriculaRI).length > 15) add('ServicoRegistroImovel.numMatriculaRI', '0103', null, 'alerta');
    if (r.cnsRI != null && !/^\d{1,6}$/.test(String(r.cnsRI))) add('ServicoRegistroImovel.cnsRI', '0102', null, 'alerta');
  }
  return f;
}

/** Valida um registro de desativação (operação D). */
export function validarDesativacao(reg) {
  const f = [];
  const add = (campo, codigo, mensagem) => f.push({ campo, codigo, nivel: 'erro', mensagem: mensagem || CODIGOS_FALHA[codigo] });
  if (vazio(reg.inscricaoImobiliaria)) add('inscricaoImobiliaria', '0001');
  if (vazio(reg.cib)) add('cib', '0001', 'Desativação exige o CIB (imóvel que nunca recebeu CIB não precisa ser desativado no Sinter).');
  if (!temCodigo(TIPO_DESATIVACAO, reg.tipoDesativacao)) add('tipoDesativacao', '0004', 'Tipo de desativação inválido (1 Extinção, 2 Nulidade).');
  const m = MOTIVO_DESATIVACAO[String(Number(reg.motivoDesativacao))];
  if (!m) add('motivoDesativacao', '0004', 'Motivo de desativação inválido.');
  else if (!m.tipos.includes(Number(reg.tipoDesativacao))) add('motivoDesativacao', '0101', `O motivo "${m.descricao}" não aceita o tipo de desativação informado.`);
  if (reg.complemento != null && String(reg.complemento).length > 300) add('complemento', '0003');
  return f;
}

/**
 * Monta o registro NDJSON de uma movimentação — {"ui": …, "operacao": …} —
 * e valida. `im` = estado atual do imóvel (para I/A a UI vai completa).
 * Devolve { registro, falhas (erros+alertas), ok }.
 */
export function montarRegistro(mov, im) {
  if (mov.tipo === 'reativacao') {
    return { registro: null, ok: false, falhas: [{ campo: 'operacao', codigo: '0005', nivel: 'erro',
      mensagem: 'A API do Sinter (manual 1.17) não tem operação de reativação. Trate a reativação com o suporte do Sinter ou inclua a UI novamente.' }] };
  }
  if (mov.tipo === 'baixa') {
    const ui = { inscricaoImobiliaria: String(mov.inscricao || im?.inscricao || ''), cib: String(im?.cib || ''),
      tipoDesativacao: Number(mov.desativacao_tipo), motivoDesativacao: Number(mov.desativacao_motivo) };
    if (!vazio(mov.descricao)) ui.complemento = String(mov.descricao).slice(0, 300);
    const falhas = validarDesativacao(ui);
    return { registro: { ui, operacao: 'D' }, falhas, ok: !falhas.some((x) => x.nivel === 'erro') };
  }
  if (!im) return { registro: null, ok: false, falhas: [{ campo: 'imovel', codigo: '0007', nivel: 'erro', mensagem: 'Imóvel não encontrado no cadastro municipal.' }] };
  const operacao = mov.tipo === 'inclusao' && !im.cib ? 'I' : 'A';
  if (mov.tipo === 'inclusao' && im.cib) {
    return { registro: null, ok: false, falhas: [{ campo: 'cib', codigo: '0006', nivel: 'erro', mensagem: 'Imóvel já tem CIB: registre uma alteração, não uma inclusão.' }] };
  }
  const { ui, avisos } = montarUI(im, { incluirCib: operacao === 'A' });
  const falhas = [...validarUI(ui, operacao), ...avisos];
  return { registro: { ui, operacao }, falhas, ok: !falhas.some((x) => x.nivel === 'erro') };
}

/** NDJSON compacto (UTF-8, uma linha por registro, sem quebras desnecessárias). */
export function gerarNdjson(registros) {
  return registros.map((r) => JSON.stringify(r)).join('\n') + (registros.length ? '\n' : '');
}

/** Campo do leiaute → coluna do cadastro municipal (para apontar a correção). */
export const CAMPO_LOCAL = {
  'DadosGeraisImovel.inscricaoImobiliaria': 'inscricao', 'DadosGeraisImovel.tipoImovel': 'tipo', 'DadosGeraisImovel.temBairro': 'tem_bairro',
  'DadosGeraisImovel.areaTerreno': 'area_terreno_m2', 'DadosGeraisImovel.areaConstruida': 'area_construida_m2',
  'DadosGeraisImovel.tpArquitetonico': 'tp_arquitetonico', 'DadosGeraisImovel.destinacaoImovel': 'destinacao',
  'DadosGeraisImovel.bice': 'bice', 'DadosGeraisImovel.anoConstrutivo': 'ano_construcao', 'DadosGeraisImovel.padraoConstrutivo': 'padrao_construtivo',
  'EnderecoImovel.tipoLogradouro': 'tipo_logradouro', 'EnderecoImovel.nomeLogradouro': 'logradouro', 'EnderecoImovel.bairro': 'bairro',
  'EnderecoImovel.cep': 'cep', 'EnderecoImovel.numeroImovel': 'numero', 'EnderecoImovel.complEndereco': 'complemento',
  'Titular': 'titular_tipo', 'ServicoRegistroImovel': 'cnm_ri', 'ServicoRegistroImovel.cnmRI': 'cnm_ri', 'Titular.niTitular': 'contribuinte_doc',
};
export function campoLocal(campoSinter) {
  const c = String(campoSinter || '').replace(/\[\d+\]/g, '');
  if (CAMPO_LOCAL[c]) return CAMPO_LOCAL[c];
  const ult = c.split('.').pop();
  const k = Object.keys(CAMPO_LOCAL).find((x) => x.toLowerCase().endsWith('.' + ult.toLowerCase()));
  return k ? CAMPO_LOCAL[k] : '';
}
