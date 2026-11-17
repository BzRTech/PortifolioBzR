// Validação do cadastro imobiliário para o Sinter/CIB.
//
// Uma única fonte de verdade: as pendências de um imóvel são
//   (a) as falhas do LEIAUTE OFICIAL (src/sinter/leiaute.js) — o que o Sinter
//       rejeitaria ou que impediria a atribuição do CIB → nivel 'erro';
//       campos opcionais fora do padrão → nivel 'alerta';
//   (b) regras de QUALIDADE do cadastro municipal (geometria, matrícula,
//       contribuinte) → nivel 'alerta' (não bloqueiam o envio).
// "Pronto para o Sinter" = nenhuma pendência de nivel 'erro'.
import { montarUI, validarUI } from './sinter/leiaute.js';
import { normalizarNi, niValido } from './ni.js';

export { soDigitos, cpfValido, cnpjValido, niValido, docValido, mascararDoc, formatarDoc, normalizarNi, cnmValido } from './ni.js';

const ROTULO_SINTER = {
  inscricaoImobiliaria: 'Inscrição imobiliária', tipoImovel: 'Tipo do imóvel', temBairro: 'Indicador de bairro', areaTerreno: 'Área do terreno',
  areaConstruida: 'Área construída', tpArquitetonico: 'Tipo arquitetônico', destinacaoImovel: 'Destinação', bice: 'BICE',
  anoConstrutivo: 'Ano de construção', padraoConstrutivo: 'Padrão construtivo', tipoLogradouro: 'Tipo de logradouro',
  nomeLogradouro: 'Logradouro', bairro: 'Bairro', cep: 'CEP', numeroImovel: 'Número', complEndereco: 'Complemento',
  niTitular: 'CPF/CNPJ do titular', percTitularidade: 'Percentual do titular', dtAquisicaoTitular: 'Data de aquisição',
  tipoTitularidade: 'Tipo de titularidade', docTitularidade: 'Documento de titularidade', cnmRI: 'CNM da matrícula',
  Titular: 'Titular', ServicoRegistroImovel: 'Registro de imóveis',
};
const rotulo = (campo) => ROTULO_SINTER[String(campo).split('.').pop().replace(/\[\d+\]/, '')] || campo;

export const REGRAS = {
  SEM_GEOMETRIA: 'Imóvel sem vínculo com lote do CTM (sem geometria)',
  AREA_DIVERGENTE: 'Área do terreno diverge mais de 10% da área geométrica do lote',
  SEM_MATRICULA: 'Matrícula do cartório não informada',
  TERRITORIAL_COM_AREA: 'Imóvel territorial com área construída cadastrada: confira o tipo (a área não vai ao Sinter para territorial)',
  CONTRIBUINTE_VAZIO: 'Contribuinte (nome) ausente',
  DOC_AUSENTE: 'CPF/CNPJ do contribuinte ausente',
  DOC_INVALIDO: 'CPF/CNPJ do contribuinte inválido (dígito verificador)',
};

/**
 * Valida um imóvel (linha da tabela `imoveis`, mais `lote_area_m2` quando houver
 * lote vinculado). Cada pendência: { codigo, campo, nivel, mensagem }.
 */
export function validarImovel(im) {
  const out = [];
  const operacao = im.cib ? 'A' : 'I';
  const { ui, avisos } = montarUI(im, { incluirCib: operacao === 'A' });
  for (const f of [...validarUI(ui, operacao), ...avisos]) {
    if (f.campo === 'cib') continue; // CIB vem do Sinter; não é pendência do cadastro
    out.push({ codigo: `SINTER_${f.codigo}_${String(f.campo).split('.').pop().replace(/\[\d+\]/, '')}`, campo: f.campo, nivel: f.nivel,
      mensagem: `${rotulo(f.campo)}: ${f.mensagem}`, falhaSinter: f.codigo });
  }
  const add = (codigo, campo) => out.push({ codigo, campo, nivel: 'alerta', mensagem: REGRAS[codigo] });
  const vazio = (v) => v === undefined || v === null || String(v).trim() === '';
  if (!im.lote_id) add('SEM_GEOMETRIA', 'lote_id');
  else if (Number(im.lote_area_m2) > 0 && Number(im.area_terreno_m2) > 0
    && Math.abs(Number(im.area_terreno_m2) - Number(im.lote_area_m2)) / Number(im.lote_area_m2) > 0.10) add('AREA_DIVERGENTE', 'area_terreno_m2');
  if (im.tipo === 'territorial' && Number(im.area_construida_m2) > 0) add('TERRITORIAL_COM_AREA', 'tipo');
  if (vazio(im.matricula_cartorio) && vazio(im.cnm_ri)) add('SEM_MATRICULA', 'matricula_cartorio');
  if (vazio(im.contribuinte_nome)) add('CONTRIBUINTE_VAZIO', 'contribuinte_nome');
  if (vazio(im.contribuinte_doc)) add('DOC_AUSENTE', 'contribuinte_doc');
  else if (!niValido(normalizarNi(im.contribuinte_doc))) add('DOC_INVALIDO', 'contribuinte_doc');
  return out;
}

export const temErro = (pendencias) => (pendencias || []).some((p) => p.nivel === 'erro');

/** Normaliza DATE do Postgres (Date local do servidor ou string) para 'AAAA-MM-DD'. */
export function isoData(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

/**
 * Canonicalização JSON para os hashes de integridade dos documentos:
 * JCS — JSON Canonicalization Scheme (RFC 8785). Chaves ordenadas por
 * unidades de código UTF-16 (ordem padrão do Array#sort do JavaScript),
 * números e strings serializados como no ECMAScript (JSON.stringify), sem
 * espaços. `undefined` é omitido (como no JSON). Rejeita NaN/Infinity.
 * O hash é SHA-256 sobre os bytes UTF-8 desta forma (hash_alg = 'sha256/jcs-rfc8785').
 */
export function jcs(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('JCS: número não finito');
    return Object.is(v, -0) ? '0' : JSON.stringify(v);
  }
  if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : jcs(x))).join(',')}]`;
  const ks = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${ks.map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}`;
}
export const jsonCanonico = jcs; // nome antigo
