// Modulo CIB/SINTER — o "modulo central" da BzR para a Reforma Tributaria.
//
// Cobre as duas fases do servico:
//   Fase 1 — Implantacao: Diagnostico -> Saneamento -> Integracao ->
//            Conciliacao -> Internalizacao (5 etapas acompanhadas por municipio)
//   Fase 2 — Manutencao continua (ciclo mensal): Capturar (ITBI, alvara,
//            habite-se, parcelamento, BCI, IA) -> Validar -> Transmitir
//            (remessas de inclusao/alteracao/baixa/reativacao) -> Conciliar
//            (retorno do Sinter, divergencias) -> Prestar contas (relatorio).
//
// Alem disso: cadastro fiscal de imoveis (inscricao <-> lote do CTM <-> CIB),
// Planta Generica de Valores (valor venal), deteccao de edificacoes nao
// cadastradas (cruzamento edificacoes extraidas x cadastro -> lista de
// vistoria), configuracao do municipio (dados usados nos documentos) e
// trilha de auditoria ("tudo documentado").
import { Router } from 'express';
import crypto from 'crypto';
import { query, withTransaction, isConfigured } from './db.js';
import { requireAuth, requireRole } from './auth.js';
import { validarImovel, temErro, mascararDoc, isoData } from './cib-validacao.js';
import { normalizarNi, soDigitos } from './ni.js';
import { MUNICIPIO_FIXO, SIMULACAO_SINTER } from './env.js';
import { muniDe, nomeUsuario, erro, num, competenciaDe, rotaAsync, TZ, mascararCampos } from './util.js';
import { carregarPgvVigente, calcularValorVenal } from './pgv.js';
import { registrarAcesso, PERFIS_DADOS_PESSOAIS } from './lgpd.js';
import { MOTIVO_DESATIVACAO } from './sinter/dominios.js';
import { tipoLogradouroDoNome, destinacaoDoUso } from './sinter/leiaute.js';
export { competenciaDe };

export const TIPOS_MOV = ['inclusao', 'alteracao', 'baixa', 'reativacao'];
export const ORIGENS = ['itbi', 'alvara', 'habite_se', 'parcelamento', 'bci', 'ia_vistoria', 'requerimento', 'manual', 'implantacao', 'conciliacao', 'sistema_tributario'];
export const STATUS_MOV = ['capturada', 'validada', 'transmitida', 'conciliada', 'divergente', 'rejeitada', 'descartada', 'nao_transmissivel'];
export const ETAPAS = [
  { n: 1, id: 'diagnostico', titulo: 'Diagnóstico', descricao: 'Raio-x da base atual: inscrições, lotes, logradouros, duplicidades e lacunas.' },
  { n: 2, id: 'saneamento', titulo: 'Saneamento', descricao: 'Correção de geometria, chaves e atributos, no padrão do Manual Operacional do Sinter.' },
  { n: 3, id: 'integracao', titulo: 'Integração', descricao: 'Envio por API ou em lote, com controle e registro de cada remessa.' },
  { n: 4, id: 'conciliacao', titulo: 'Conciliação', descricao: 'Cruzamento entre o cadastro municipal e o CIB, com correção de cada divergência.' },
  { n: 5, id: 'internalizacao', titulo: 'Internalização', descricao: 'Código CIB ligado à inscrição imobiliária no sistema e nos documentos da prefeitura.' },
];
export const CHECKLIST_ADESAO = [
  { id: 'convenio', label: 'Convênio Sinter assinado pelo prefeito' },
  { id: 'perfis', label: 'Perfis de acesso ao Sinter configurados' },
  { id: 'transmissor', label: 'Transmissor(es) pessoa jurídica indicados (até 3)' },
  { id: 'base', label: 'Base cadastral exportada do sistema tributário' },
  { id: 'ctm', label: 'Base cartográfica (lotes/quadras) carregada no Território' },
  { id: 'equipe', label: 'Equipe municipal capacitada na rotina mensal' },
];

// Campos editaveis do imovel (whitelist usada em edicao, importacao e movimentacoes).
export const CAMPOS_IMOVEL = {
  inscricao: 'texto', lote_codigo: 'texto', cib: 'texto', tipo: 'texto', uso: 'texto',
  logradouro: 'texto', numero: 'texto', complemento: 'texto', bairro: 'texto', cep: 'texto',
  quadra: 'texto', lote_num: 'texto', setor: 'texto',
  contribuinte_nome: 'texto', contribuinte_doc: 'texto', contribuinte_email: 'texto', contribuinte_telefone: 'texto',
  matricula_cartorio: 'texto', cartorio: 'texto',
  area_terreno_m2: 'num', area_construida_m2: 'num', testada_m: 'num', n_pavimentos: 'int',
  padrao_construtivo: 'texto', ano_construcao: 'int', observacoes: 'texto',
  // Leiaute oficial do Sinter (Manual Operacional 1.17) — códigos de domínio:
  tipo_logradouro: 'int', tp_arquitetonico: 'int', destinacao: 'int', bice: 'int', tem_bairro: 'bool',
  titular_tipo: 'int', titular_doc_tipo: 'int', titular_dt_aquisicao: 'data', titular_perc: 'num', cnm_ri: 'texto', cns_ri: 'int',
};
export const ROTULOS = {
  inscricao: 'Inscrição', lote_codigo: 'Código do lote', cib: 'CIB', tipo: 'Tipo', uso: 'Uso',
  logradouro: 'Logradouro', numero: 'Número', complemento: 'Complemento', bairro: 'Bairro', cep: 'CEP',
  quadra: 'Quadra', lote_num: 'Lote', setor: 'Setor',
  contribuinte_nome: 'Contribuinte', contribuinte_doc: 'CPF/CNPJ', contribuinte_email: 'E-mail', contribuinte_telefone: 'Telefone',
  matricula_cartorio: 'Matrícula', cartorio: 'Cartório',
  area_terreno_m2: 'Área do terreno (m²)', area_construida_m2: 'Área construída (m²)', testada_m: 'Testada (m)',
  n_pavimentos: 'Pavimentos', padrao_construtivo: 'Padrão construtivo', ano_construcao: 'Ano de construção', observacoes: 'Observações',
  tipo_logradouro: 'Tipo de logradouro', tp_arquitetonico: 'Tipo arquitetônico', destinacao: 'Destinação', bice: 'BICE', tem_bairro: 'Tem bairro',
  titular_tipo: 'Tipo de titularidade', titular_doc_tipo: 'Documento de titularidade', titular_dt_aquisicao: 'Data de aquisição',
  titular_perc: 'Percentual do titular', cnm_ri: 'CNM (matrícula)', cns_ri: 'CNS do cartório',
};
export const PADROES = ['popular', 'baixo', 'normal', 'alto', 'luxo'];

const PRAZO_PADRAO = process.env.CIB_PRAZO_SINTER || '2026-12-31';
const CAPACIDADE_SEMANAL = Number(process.env.CIB_CAPACIDADE_SEMANAL) || 400; // correcoes/semana (estimativa)

/** Normaliza um objeto de campos do imovel conforme a whitelist. */
export function normalizarCampos(src = {}) {
  const out = {};
  for (const [k, tipo] of Object.entries(CAMPOS_IMOVEL)) {
    if (!(k in src)) continue;
    const v = src[k];
    if (tipo === 'num') out[k] = num(v);
    else if (tipo === 'int') { const n = num(v); out[k] = n == null ? null : Math.round(n); }
    else if (tipo === 'bool') out[k] = v === '' || v == null ? null : ['true', '1', 'sim', 's', 'yes'].includes(String(v).trim().toLowerCase());
    else if (tipo === 'data') out[k] = /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : (/^\d{2}\/\d{2}\/\d{4}$/.test(String(v || '').trim()) ? String(v).trim().split('/').reverse().join('-') : null);
    else out[k] = v == null ? '' : String(v).trim().slice(0, 300);
  }
  if ('tipo' in out) out.tipo = ['territorial', 'especial'].includes(String(out.tipo).toLowerCase()) ? String(out.tipo).toLowerCase() : 'predial';
  if ('contribuinte_doc' in out) out.contribuinte_doc = normalizarNi(out.contribuinte_doc);
  if ('cep' in out) out.cep = soDigitos(out.cep);
  if ('cnm_ri' in out) out.cnm_ri = soDigitos(out.cnm_ri);
  if ('inscricao' in out) out.inscricao = out.inscricao.slice(0, 45);
  if ('padrao_construtivo' in out) { const pc = out.padrao_construtivo.toLowerCase(); out.padrao_construtivo = pc === 'medio' || pc === 'médio' ? 'normal' : pc; }
  return out;
}

/** Completa códigos do Sinter dedutíveis com segurança (tipo de logradouro, destinação, bairro). */
export function completarDerivados(c) {
  if (c.tipo_logradouro == null && c.logradouro) { const t = tipoLogradouroDoNome(c.logradouro); if (t) c.tipo_logradouro = t; }
  if (c.destinacao == null && c.uso) { const d = destinacaoDoUso(c.uso); if (d) c.destinacao = d; }
  if (c.tem_bairro == null && 'bairro' in c) c.tem_bairro = String(c.bairro || '').trim() !== '';
  return c;
}

const asyncRoute = rotaAsync('cib');

export async function auditar(db, { municipio = '', entidade, entidadeId = null, acao, detalhe = '', usuario = '' }) {
  try {
    await (db || { query }).query(
      `INSERT INTO cib_auditoria (municipio, entidade, entidade_id, acao, detalhe, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6)`,
      [municipio, entidade, entidadeId, acao, String(detalhe).slice(0, 2000), usuario]
    );
  } catch (e) { console.error('[cib] auditoria:', e.message); }
}

// ---- schema ----------------------------------------------------------------
export async function ensureCibSchema() {
  if (!isConfigured) return false;
  const S = [
    `CREATE TABLE IF NOT EXISTS municipio_config (
       municipio            TEXT PRIMARY KEY,
       nome_oficial         TEXT NOT NULL DEFAULT '',
       uf                   TEXT NOT NULL DEFAULT 'PB',
       codigo_ibge          TEXT NOT NULL DEFAULT '',
       cnpj                 TEXT NOT NULL DEFAULT '',
       secretaria           TEXT NOT NULL DEFAULT 'Secretaria Municipal de Finanças',
       setor                TEXT NOT NULL DEFAULT 'Setor de Cadastro Imobiliário',
       endereco             TEXT NOT NULL DEFAULT '',
       telefone             TEXT NOT NULL DEFAULT '',
       email                TEXT NOT NULL DEFAULT '',
       site                 TEXT NOT NULL DEFAULT '',
       prefeito_nome        TEXT NOT NULL DEFAULT '',
       responsavel_nome     TEXT NOT NULL DEFAULT '',
       responsavel_cargo    TEXT NOT NULL DEFAULT '',
       convenio_numero      TEXT NOT NULL DEFAULT '',
       convenio_data        DATE,
       prazo_sinter         DATE,
       transmissores        TEXT NOT NULL DEFAULT '',
       validade_certidao_dias INTEGER NOT NULL DEFAULT 90,
       brasao               TEXT NOT NULL DEFAULT '',
       rodape_documentos    TEXT NOT NULL DEFAULT '',
       updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS imoveis (
       id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       municipio            TEXT NOT NULL DEFAULT '',
       inscricao            TEXT NOT NULL,
       lote_id              BIGINT REFERENCES lotes(id) ON DELETE SET NULL,
       lote_codigo          TEXT NOT NULL DEFAULT '',
       cib                  TEXT NOT NULL DEFAULT '',
       cib_atribuido_em     TIMESTAMPTZ,
       situacao             TEXT NOT NULL DEFAULT 'ativo',
       data_baixa           DATE,
       motivo_baixa         TEXT NOT NULL DEFAULT '',
       tipo                 TEXT NOT NULL DEFAULT 'predial',
       uso                  TEXT NOT NULL DEFAULT '',
       setor                TEXT NOT NULL DEFAULT '',
       quadra               TEXT NOT NULL DEFAULT '',
       lote_num             TEXT NOT NULL DEFAULT '',
       logradouro           TEXT NOT NULL DEFAULT '',
       numero               TEXT NOT NULL DEFAULT '',
       complemento          TEXT NOT NULL DEFAULT '',
       bairro               TEXT NOT NULL DEFAULT '',
       cep                  TEXT NOT NULL DEFAULT '',
       contribuinte_nome    TEXT NOT NULL DEFAULT '',
       contribuinte_doc     TEXT NOT NULL DEFAULT '',
       contribuinte_email   TEXT NOT NULL DEFAULT '',
       contribuinte_telefone TEXT NOT NULL DEFAULT '',
       matricula_cartorio   TEXT NOT NULL DEFAULT '',
       cartorio             TEXT NOT NULL DEFAULT '',
       area_terreno_m2      DOUBLE PRECISION,
       area_construida_m2   DOUBLE PRECISION,
       testada_m            DOUBLE PRECISION,
       n_pavimentos         INTEGER,
       padrao_construtivo   TEXT NOT NULL DEFAULT 'medio',
       ano_construcao       INTEGER,
       observacoes          TEXT NOT NULL DEFAULT '',
       valor_venal_terreno  NUMERIC(14,2),
       valor_venal_construcao NUMERIC(14,2),
       valor_venal_total    NUMERIC(14,2),
       pendencias           JSONB NOT NULL DEFAULT '[]'::jsonb,
       tem_erro             BOOLEAN NOT NULL DEFAULT TRUE,
       sinter_status        TEXT NOT NULL DEFAULT 'pendente_correcao',
       transmitido          BOOLEAN NOT NULL DEFAULT FALSE,
       created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_imoveis_insc ON imoveis (municipio, inscricao)`,
    `CREATE INDEX IF NOT EXISTS idx_imoveis_lote ON imoveis (lote_id)`,
    `CREATE INDEX IF NOT EXISTS idx_imoveis_status ON imoveis (municipio, sinter_status)`,
    `CREATE INDEX IF NOT EXISTS idx_imoveis_cib ON imoveis (cib) WHERE cib <> ''`,

    `CREATE TABLE IF NOT EXISTS cib_remessas (
       id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       municipio       TEXT NOT NULL DEFAULT '',
       numero          INTEGER NOT NULL,
       competencia     TEXT NOT NULL,
       status          TEXT NOT NULL DEFAULT 'preparada',
       modo            TEXT NOT NULL DEFAULT 'lote',
       protocolo       TEXT NOT NULL DEFAULT '',
       qtd_itens       INTEGER NOT NULL DEFAULT 0,
       qtd_ok          INTEGER NOT NULL DEFAULT 0,
       qtd_divergente  INTEGER NOT NULL DEFAULT 0,
       qtd_erro        INTEGER NOT NULL DEFAULT 0,
       hash_arquivo    TEXT NOT NULL DEFAULT '',
       obs             TEXT NOT NULL DEFAULT '',
       criado_por_nome TEXT NOT NULL DEFAULT '',
       enviada_em      TIMESTAMPTZ,
       processada_em   TIMESTAMPTZ,
       created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_remessa_num ON cib_remessas (municipio, numero)`,

    `CREATE TABLE IF NOT EXISTS cib_movimentacoes (
       id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       municipio       TEXT NOT NULL DEFAULT '',
       imovel_id       BIGINT REFERENCES imoveis(id) ON DELETE SET NULL,
       inscricao       TEXT NOT NULL DEFAULT '',
       tipo            TEXT NOT NULL,
       origem          TEXT NOT NULL DEFAULT 'manual',
       documento_ref   TEXT NOT NULL DEFAULT '',
       descricao       TEXT NOT NULL DEFAULT '',
       dados_antes     JSONB NOT NULL DEFAULT '{}'::jsonb,
       dados_depois    JSONB NOT NULL DEFAULT '{}'::jsonb,
       status          TEXT NOT NULL DEFAULT 'capturada',
       erros           JSONB NOT NULL DEFAULT '[]'::jsonb,
       retorno_msg     TEXT NOT NULL DEFAULT '',
       remessa_id      BIGINT REFERENCES cib_remessas(id) ON DELETE SET NULL,
       competencia     TEXT NOT NULL,
       criado_por_nome TEXT NOT NULL DEFAULT '',
       validado_em     TIMESTAMPTZ,
       transmitido_em  TIMESTAMPTZ,
       conciliado_em   TIMESTAMPTZ,
       created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_mov_muni_comp ON cib_movimentacoes (municipio, competencia)`,
    `CREATE INDEX IF NOT EXISTS idx_mov_status ON cib_movimentacoes (municipio, status)`,
    `CREATE INDEX IF NOT EXISTS idx_mov_imovel ON cib_movimentacoes (imovel_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mov_remessa ON cib_movimentacoes (remessa_id)`,

    `CREATE TABLE IF NOT EXISTS cib_divergencias (
       id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       municipio        TEXT NOT NULL DEFAULT '',
       imovel_id        BIGINT REFERENCES imoveis(id) ON DELETE CASCADE,
       movimentacao_id  BIGINT REFERENCES cib_movimentacoes(id) ON DELETE SET NULL,
       remessa_id       BIGINT REFERENCES cib_remessas(id) ON DELETE SET NULL,
       fonte            TEXT NOT NULL DEFAULT 'sinter',
       campo            TEXT NOT NULL DEFAULT '',
       valor_municipio  TEXT NOT NULL DEFAULT '',
       valor_externo    TEXT NOT NULL DEFAULT '',
       mensagem         TEXT NOT NULL DEFAULT '',
       status           TEXT NOT NULL DEFAULT 'aberta',
       resolucao        TEXT NOT NULL DEFAULT '',
       resolvido_por_nome TEXT NOT NULL DEFAULT '',
       resolvido_em     TIMESTAMPTZ,
       created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_div_status ON cib_divergencias (municipio, status)`,
    `CREATE INDEX IF NOT EXISTS idx_div_imovel ON cib_divergencias (imovel_id)`,

    `CREATE TABLE IF NOT EXISTS cib_vistorias (
       id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       municipio          TEXT NOT NULL DEFAULT '',
       lote_id            BIGINT REFERENCES lotes(id) ON DELETE CASCADE,
       lote_codigo        TEXT NOT NULL DEFAULT '',
       imovel_id          BIGINT REFERENCES imoveis(id) ON DELETE SET NULL,
       inscricao          TEXT NOT NULL DEFAULT '',
       bairro             TEXT NOT NULL DEFAULT '',
       tipo               TEXT NOT NULL,
       area_detectada_m2  DOUBLE PRECISION,
       area_cadastrada_m2 DOUBLE PRECISION,
       lat                DOUBLE PRECISION,
       lng                DOUBLE PRECISION,
       status             TEXT NOT NULL DEFAULT 'pendente',
       demanda_id         BIGINT,
       movimentacao_id    BIGINT,
       obs                TEXT NOT NULL DEFAULT '',
       resolvido_por_nome TEXT NOT NULL DEFAULT '',
       resolvido_em       TIMESTAMPTZ,
       created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_vist_status ON cib_vistorias (municipio, status)`,

    `CREATE TABLE IF NOT EXISTS cib_implantacao (
       municipio   TEXT PRIMARY KEY,
       etapa_atual INTEGER NOT NULL DEFAULT 1,
       etapas      JSONB NOT NULL DEFAULT '{}'::jsonb,
       checklist   JSONB NOT NULL DEFAULT '{}'::jsonb,
       updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,

    `CREATE TABLE IF NOT EXISTS pgv_valores (
       id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       municipio    TEXT NOT NULL DEFAULT '',
       tipo         TEXT NOT NULL,
       chave        TEXT NOT NULL,
       valor_m2     NUMERIC(12,2) NOT NULL DEFAULT 0,
       ano          INTEGER NOT NULL DEFAULT 2026,
       UNIQUE (municipio, tipo, chave)
     )`,

    `CREATE TABLE IF NOT EXISTS cib_auditoria (
       id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
       municipio    TEXT NOT NULL DEFAULT '',
       entidade     TEXT NOT NULL,
       entidade_id  BIGINT,
       acao         TEXT NOT NULL,
       detalhe      TEXT NOT NULL DEFAULT '',
       usuario_nome TEXT NOT NULL DEFAULT '',
       created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_aud_muni ON cib_auditoria (municipio, created_at DESC)`,
  ];
  for (const s of S) await query(s);
  return true;
}

// ---- configuracao do municipio --------------------------------------------
const CONFIG_CAMPOS = ['nome_oficial', 'uf', 'codigo_ibge', 'cnpj', 'secretaria', 'setor', 'endereco', 'telefone', 'email', 'site',
  'prefeito_nome', 'responsavel_nome', 'responsavel_cargo', 'convenio_numero', 'convenio_data', 'prazo_sinter', 'transmissores',
  'validade_certidao_dias', 'brasao', 'rodape_documentos'];

export async function getConfig(municipio = '') {
  const { rows } = await query('SELECT * FROM municipio_config WHERE municipio = $1', [municipio]);
  const c = rows[0] || {};
  return {
    municipio,
    nomeOficial: c.nome_oficial || (municipio ? `Prefeitura Municipal de ${municipio}` : 'Prefeitura Municipal'),
    uf: c.uf || 'PB', codigoIbge: c.codigo_ibge || '', cnpj: c.cnpj || '',
    secretaria: c.secretaria || 'Secretaria Municipal de Finanças', setor: c.setor || 'Setor de Cadastro Imobiliário',
    endereco: c.endereco || '', telefone: c.telefone || '', email: c.email || '', site: c.site || '',
    prefeitoNome: c.prefeito_nome || '', responsavelNome: c.responsavel_nome || '', responsavelCargo: c.responsavel_cargo || '',
    convenioNumero: c.convenio_numero || '', convenioData: isoData(c.convenio_data),
    prazoSinter: isoData(c.prazo_sinter) || PRAZO_PADRAO, transmissores: c.transmissores || '',
    validadeCertidaoDias: c.validade_certidao_dias || 90, brasao: c.brasao || '', rodapeDocumentos: c.rodape_documentos || '',
    configurado: Boolean(rows[0]),
  };
}

async function salvarConfig(municipio, body) {
  const map = {
    nome_oficial: body.nomeOficial, uf: body.uf, codigo_ibge: body.codigoIbge, cnpj: body.cnpj, secretaria: body.secretaria,
    setor: body.setor, endereco: body.endereco, telefone: body.telefone, email: body.email, site: body.site,
    prefeito_nome: body.prefeitoNome, responsavel_nome: body.responsavelNome, responsavel_cargo: body.responsavelCargo,
    convenio_numero: body.convenioNumero, convenio_data: body.convenioData || null, prazo_sinter: body.prazoSinter || null,
    transmissores: body.transmissores, validade_certidao_dias: Number(body.validadeCertidaoDias) || 90,
    brasao: body.brasao, rodape_documentos: body.rodapeDocumentos,
  };
  if (map.brasao && String(map.brasao).length > 400000) throw erro(400, 'Brasão muito grande (máx. ~300 KB).');
  const cols = CONFIG_CAMPOS.filter((c) => map[c] !== undefined);
  const vals = cols.map((c) => (typeof map[c] === 'string' ? map[c].slice(0, c === 'brasao' ? 400000 : 1000) : map[c]));
  await query(
    `INSERT INTO municipio_config (municipio, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => '$' + (i + 2)).join(', ')})
     ON CONFLICT (municipio) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = NOW()`,
    [municipio, ...vals]
  );
  return getConfig(municipio);
}

// ---- revalidacao + status Sinter -------------------------------------------
/**
 * Revalida imoveis (pendencias + valor venal) e recalcula o status Sinter.
 * `alvo` = { ids: [...] } ou { municipio }.
 */
export async function processarImoveis(db, alvo) {
  db = db || { query };
  const where = alvo.ids ? 'i.id = ANY($1::bigint[])' : 'i.municipio = $1';
  const param = alvo.ids ? alvo.ids : alvo.municipio;
  if (alvo.ids && !alvo.ids.length) return 0;
  const { rows } = await db.query(
    `SELECT i.*, l.area_m2 AS lote_area_m2 FROM imoveis i LEFT JOIN lotes l ON l.id = i.lote_id WHERE ${where}`, [param]
  );
  if (!rows.length) return 0;
  const pgvPorMuni = new Map();
  const ids = [], pends = [], erros = [], vt = [], vc = [], vtot = [], anos = [];
  for (const im of rows) {
    if (!pgvPorMuni.has(im.municipio)) pgvPorMuni.set(im.municipio, await carregarPgvVigente(db, im.municipio));
    const pgv = pgvPorMuni.get(im.municipio);
    const v = calcularValorVenal(im, pgv);
    // O valor venal entra na UI do Sinter (campo opcional): valida com ele.
    const p = im.situacao === 'baixado' ? [] : validarImovel({ ...im, valor_venal_total: v.total, valor_venal_ano: pgv.ano });
    ids.push(im.id); pends.push(JSON.stringify(p)); erros.push(temErro(p)); vt.push(v.t); vc.push(v.c); vtot.push(v.total); anos.push(pgv.ano);
  }
  await db.query(
    `UPDATE imoveis i SET pendencias = u.p::jsonb, tem_erro = u.e, valor_venal_terreno = u.vt, valor_venal_construcao = u.vc,
       valor_venal_total = u.vtot, valor_venal_ano = u.ano
     FROM unnest($1::bigint[], $2::text[], $3::boolean[], $4::numeric[], $5::numeric[], $6::numeric[], $7::int[]) AS u(id, p, e, vt, vc, vtot, ano)
     WHERE i.id = u.id`,
    [ids, pends, erros, vt, vc, vtot, anos]
  );
  await recalcularStatus(db, { ids });
  return rows.length;
}

export async function recalcularStatus(db, alvo) {
  db = db || { query };
  const where = alvo.ids ? 'i.id = ANY($1::bigint[])' : 'i.municipio = $1';
  await db.query(
    `UPDATE imoveis i SET sinter_status = CASE
        WHEN EXISTS (SELECT 1 FROM cib_divergencias d WHERE d.imovel_id = i.id AND d.status = 'aberta') THEN 'divergente'
        WHEN i.situacao = 'ativo' AND i.tem_erro THEN 'pendente_correcao'
        WHEN EXISTS (SELECT 1 FROM cib_movimentacoes m WHERE m.imovel_id = i.id AND m.status = 'transmitida') THEN 'enviado'
        WHEN EXISTS (SELECT 1 FROM cib_movimentacoes m WHERE m.imovel_id = i.id AND m.status = 'rejeitada') THEN 'rejeitado'
        WHEN EXISTS (SELECT 1 FROM cib_movimentacoes m WHERE m.imovel_id = i.id AND m.status IN ('capturada','validada')) THEN 'aguardando_envio'
        WHEN i.cib <> '' THEN 'conciliado'
        WHEN i.situacao = 'baixado' THEN 'baixado'
        ELSE 'pronto' END
     WHERE ${where}`,
    [alvo.ids || alvo.municipio]
  );
}

// ---- vinculo com o CTM -----------------------------------------------------
async function resolverLote(db, codigo, municipio) {
  const c = String(codigo || '').trim();
  if (!c) return null;
  const { rows } = await db.query(
    `SELECT id FROM lotes WHERE codigo = $1 AND (municipio IS NOT DISTINCT FROM $2 OR municipio IS NULL OR $2 = '')
     ORDER BY (municipio IS NOT DISTINCT FROM $2) DESC LIMIT 1`,
    [c, municipio || null]
  );
  return rows[0]?.id || null;
}

// ---- mapeamento ------------------------------------------------------------
function mapImovel(r, { completo = false, incluirDoc = false } = {}) {
  const o = {
    id: r.id, municipio: r.municipio, inscricao: r.inscricao, loteId: r.lote_id, loteCodigo: r.lote_codigo,
    cib: r.cib, cibAtribuidoEm: r.cib_atribuido_em, situacao: r.situacao, tipo: r.tipo, uso: r.uso,
    logradouro: r.logradouro, numero: r.numero, complemento: r.complemento, bairro: r.bairro, cep: r.cep,
    setor: r.setor, quadra: r.quadra, loteNum: r.lote_num,
    contribuinteNome: r.contribuinte_nome, contribuinteDocMascarado: mascararDoc(r.contribuinte_doc),
    areaTerreno: r.area_terreno_m2, areaConstruida: r.area_construida_m2,
    valorVenal: r.valor_venal_total != null ? Number(r.valor_venal_total) : null,
    pendencias: r.pendencias || [], temErro: r.tem_erro, sinterStatus: r.sinter_status, transmitido: r.transmitido,
    cibSimulado: Boolean(r.cib_simulado), atualizadoEm: r.updated_at,
  };
  if (completo) {
    // CPF/CNPJ completo NÃO sai aqui (LGPD): só por POST /api/cib/imoveis/:id/revelar, que registra o acesso.
    Object.assign(o, {
      contribuinteEmail: r.contribuinte_email, contribuinteTelefone: r.contribuinte_telefone,
      tipoLogradouro: r.tipo_logradouro, tpArquitetonico: r.tp_arquitetonico, destinacao: r.destinacao, bice: r.bice, temBairro: r.tem_bairro,
      titularTipo: r.titular_tipo, titularDocTipo: r.titular_doc_tipo, titularDtAquisicao: isoData(r.titular_dt_aquisicao),
      titularPerc: r.titular_perc != null ? Number(r.titular_perc) : null, cnmRi: r.cnm_ri, cnsRi: r.cns_ri, valorVenalAno: r.valor_venal_ano,
      ...(incluirDoc ? { contribuinteDoc: r.contribuinte_doc } : {}),
      matriculaCartorio: r.matricula_cartorio, cartorio: r.cartorio, testada: r.testada_m, nPavimentos: r.n_pavimentos,
      padraoConstrutivo: r.padrao_construtivo, anoConstrucao: r.ano_construcao, observacoes: r.observacoes,
      valorVenalTerreno: r.valor_venal_terreno != null ? Number(r.valor_venal_terreno) : null,
      valorVenalConstrucao: r.valor_venal_construcao != null ? Number(r.valor_venal_construcao) : null,
      dataBaixa: isoData(r.data_baixa), motivoBaixa: r.motivo_baixa, criadoEm: r.created_at,
      loteArea: r.lote_area_m2 ?? null, centroide: r.lat != null ? { lat: r.lat, lng: r.lng } : null,
    });
  }
  return o;
}
function mapMov(m) {
  return {
    id: m.id, municipio: m.municipio, imovelId: m.imovel_id, inscricao: m.inscricao, tipo: m.tipo, origem: m.origem,
    documentoRef: m.documento_ref, descricao: m.descricao, dadosAntes: mascararCampos(m.dados_antes, mascararDoc), dadosDepois: mascararCampos(m.dados_depois, mascararDoc),
    status: m.status, erros: m.erros || [], retornoMsg: m.retorno_msg, remessaId: m.remessa_id, remessaNumero: m.remessa_numero ?? null,
    desativacaoTipo: m.desativacao_tipo, desativacaoMotivo: m.desativacao_motivo, falhasSinter: m.falhas_sinter || [], tentativas: m.tentativas || 0,
    competencia: m.competencia, criadoPorNome: m.criado_por_nome, validadoEm: m.validado_em, transmitidoEm: m.transmitido_em,
    conciliadoEm: m.conciliado_em, criadoEm: m.created_at,
  };
}

/** Imovel completo (com centroide do lote) — usado pela ficha e pelos documentos. */
/** `incluirDoc` só para uso interno (emissão de documento oficial). Nunca devolva isso direto numa rota. */
export async function getImovelCompleto(id, { incluirDoc = false } = {}) {
  const { rows } = await query(
    `SELECT i.*, l.area_m2 AS lote_area_m2, ST_Y(ST_PointOnSurface(l.geom)) AS lat, ST_X(ST_PointOnSurface(l.geom)) AS lng
     FROM imoveis i LEFT JOIN lotes l ON l.id = i.lote_id WHERE i.id = $1`, [id]
  );
  return rows[0] ? mapImovel(rows[0], { completo: true, incluirDoc }) : null;
}

export async function buscarImovelPorInscricao(municipio, inscricao, opts = {}) {
  const { rows } = await query('SELECT id FROM imoveis WHERE municipio = $1 AND inscricao = $2', [municipio, String(inscricao || '').trim()]);
  return rows[0] ? getImovelCompleto(rows[0].id, opts) : null;
}

// ---- movimentacoes ---------------------------------------------------------
async function integracaoIniciada(db, municipio) {
  const { rows } = await db.query('SELECT 1 FROM cib_remessas WHERE municipio = $1 LIMIT 1', [municipio]);
  return rows.length > 0;
}

/** Registra um evento (Capturar). Nao altera o cadastro ate ser validado. */
export async function capturarMovimentacao(db, m) {
  db = db || { query };
  if (!TIPOS_MOV.includes(m.tipo)) throw erro(400, 'Tipo de movimentação inválido.');
  const origem = ORIGENS.includes(m.origem) ? m.origem : 'manual';
  let imovelId = m.imovelId || null;
  let antes = {};
  if (!imovelId && m.inscricao) {
    const r = await db.query('SELECT id FROM imoveis WHERE municipio = $1 AND inscricao = $2', [m.municipio, String(m.inscricao).trim()]);
    imovelId = r.rows[0]?.id || null;
  }
  if (m.tipo !== 'inclusao' && !imovelId) throw erro(404, `Inscrição ${m.inscricao || ''} não encontrada no cadastro.`);
  if (m.tipo === 'inclusao' && imovelId) throw erro(409, `A inscrição ${m.inscricao} já existe no cadastro — use uma alteração.`);
  const depois = normalizarCampos(m.dadosDepois || {});
  let desTipo = null, desMotivo = null;
  if (m.tipo === 'baixa') {
    desMotivo = Number(m.desativacaoMotivo) || null;
    const mot = MOTIVO_DESATIVACAO[String(desMotivo)];
    if (!mot) throw erro(400, 'Informe o motivo da baixa conforme a tabela do Sinter (desmembramento, remembramento, duplicidade, inscrição indevida…).');
    desTipo = Number(m.desativacaoTipo) || mot.tipos[0];
    if (!mot.tipos.includes(desTipo)) throw erro(400, `O motivo "${mot.descricao}" não aceita esse tipo de desativação.`);
  }
  if (imovelId) {
    const r = await db.query('SELECT * FROM imoveis WHERE id = $1', [imovelId]);
    const atual = r.rows[0];
    for (const k of Object.keys(depois)) antes[k] = atual[k];
    if (m.dadosAntes) antes = { ...antes, ...m.dadosAntes };
  }
  if (m.tipo === 'inclusao') { depois.inscricao = depois.inscricao || String(m.inscricao || '').trim(); completarDerivados(depois); }
  const { rows } = await db.query(
    `INSERT INTO cib_movimentacoes (municipio, imovel_id, inscricao, tipo, origem, documento_ref, descricao, dados_antes, dados_depois,
       status, competencia, criado_por_nome, desativacao_tipo, desativacao_motivo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14) RETURNING *`,
    [m.municipio, imovelId, String(m.inscricao || depois.inscricao || '').trim(), m.tipo, origem, String(m.documentoRef || '').slice(0, 80),
      String(m.descricao || '').slice(0, 1000), JSON.stringify(antes), JSON.stringify(depois), m.status || 'capturada',
      m.competencia || competenciaDe(), m.usuario || '', desTipo, desMotivo]
  );
  if (imovelId) await recalcularStatus(db, { ids: [imovelId] });
  await auditar(db, { municipio: m.municipio, entidade: 'movimentacao', entidadeId: rows[0].id, acao: 'capturar',
    detalhe: `${m.tipo} · ${origem} · ${rows[0].inscricao}${m.documentoRef ? ' · ' + m.documentoRef : ''}`, usuario: m.usuario });
  return rows[0];
}

/**
 * Valida uma movimentacao capturada e, se estiver ok, aplica no cadastro
 * municipal (a prefeitura e a fonte do dado). Devolve { ok, mov, erros }.
 */
export async function validarMovimentacao(db, id, usuario = '') {
  const m = (await db.query('SELECT * FROM cib_movimentacoes WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!m) throw erro(404, 'Movimentação não encontrada.');
  if (!['capturada', 'rejeitada'].includes(m.status)) throw erro(409, `Movimentação já está ${m.status}.`);
  const depois = m.dados_depois || {};
  let atual = null;
  if (m.imovel_id) atual = (await db.query('SELECT i.*, l.area_m2 AS lote_area_m2 FROM imoveis i LEFT JOIN lotes l ON l.id = i.lote_id WHERE i.id = $1', [m.imovel_id])).rows[0];
  if (m.tipo !== 'inclusao' && !atual) throw erro(404, 'Imóvel da movimentação não existe mais.');

  // Já aplicada no cadastro antes (voltou da remessa por falha de leiaute ou foi
  // rejeitada pelo Sinter): não reaplica — só confere o estado atual e devolve à fila.
  if (m.validado_em && m.imovel_id) {
    const pend = ['inclusao', 'alteracao'].includes(m.tipo) && atual ? validarImovel(atual).filter((p) => p.nivel === 'erro') : [];
    if (pend.length) {
      const r = await db.query(`UPDATE cib_movimentacoes SET erros = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING *`, [JSON.stringify(pend), id]);
      return { ok: false, mov: r.rows[0], erros: pend };
    }
    const r = await db.query(`UPDATE cib_movimentacoes SET status = $2, erros = '[]'::jsonb, remessa_id = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, m.tipo === 'reativacao' ? 'nao_transmissivel' : 'validada']);
    await processarImoveis(db, { ids: [m.imovel_id] });
    await auditar(db, { municipio: m.municipio, entidade: 'movimentacao', entidadeId: id, acao: 'revalidar', detalhe: `${m.tipo} ${m.inscricao} de volta à fila de transmissão`, usuario });
    return { ok: true, mov: r.rows[0], erros: [] };
  }

  let errosVal = [];
  if (m.tipo === 'inclusao' || m.tipo === 'alteracao') {
    const candidato = { ...(atual || { tipo: 'predial' }), ...depois };
    if (candidato.lote_codigo && (!atual || candidato.lote_codigo !== atual.lote_codigo)) {
      candidato.lote_id = await resolverLote(db, candidato.lote_codigo, m.municipio);
      if (candidato.lote_id) candidato.lote_area_m2 = (await db.query('SELECT area_m2 FROM lotes WHERE id = $1', [candidato.lote_id])).rows[0]?.area_m2;
    }
    errosVal = validarImovel(candidato).filter((p) => p.nivel === 'erro');
  }
  if (m.tipo === 'baixa' && atual.situacao === 'baixado') errosVal = [{ codigo: 'JA_BAIXADO', mensagem: 'Imóvel já está baixado.', nivel: 'erro' }];
  if (m.tipo === 'reativacao' && atual.situacao === 'ativo') errosVal = [{ codigo: 'JA_ATIVO', mensagem: 'Imóvel já está ativo.', nivel: 'erro' }];

  if (errosVal.length) {
    const r = await db.query(`UPDATE cib_movimentacoes SET erros = $1::jsonb, updated_at = NOW() WHERE id = $2 RETURNING *`, [JSON.stringify(errosVal), id]);
    return { ok: false, mov: r.rows[0], erros: errosVal };
  }

  // Aplica no cadastro.
  let imovelId = m.imovel_id;
  if (m.tipo === 'inclusao') {
    const campos = { ...depois };
    const loteId = campos.lote_codigo ? await resolverLote(db, campos.lote_codigo, m.municipio) : (campos.inscricao ? await resolverLote(db, campos.inscricao, m.municipio) : null);
    const cols = Object.keys(campos);
    const r = await db.query(
      `INSERT INTO imoveis (municipio, lote_id, ${cols.join(', ')}) VALUES ($1, $2, ${cols.map((_, i) => '$' + (i + 3)).join(', ')}) RETURNING id`,
      [m.municipio, loteId, ...cols.map((c) => campos[c])]
    );
    imovelId = r.rows[0].id;
  } else if (m.tipo === 'alteracao') {
    const cols = Object.keys(depois);
    if (cols.length) {
      const sets = cols.map((c, i) => `${c} = $${i + 2}`);
      if (depois.lote_codigo !== undefined) sets.push(`lote_id = ${depois.lote_codigo ? `(SELECT id FROM lotes WHERE codigo = $${cols.indexOf('lote_codigo') + 2} LIMIT 1)` : 'lote_id'}`);
      await db.query(`UPDATE imoveis SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, [imovelId, ...cols.map((c) => depois[c])]);
    }
  } else if (m.tipo === 'baixa') {
    await db.query(`UPDATE imoveis SET situacao = 'baixado', data_baixa = CURRENT_DATE, motivo_baixa = $2, updated_at = NOW() WHERE id = $1`,
      [imovelId, m.descricao || m.origem]);
  } else if (m.tipo === 'reativacao') {
    await db.query(`UPDATE imoveis SET situacao = 'ativo', data_baixa = NULL, motivo_baixa = '', updated_at = NOW() WHERE id = $1`, [imovelId]);
  }
  // A API do Sinter (manual 1.17) só tem Inclusão, Alteração e Desativação: a
  // reativação vale no cadastro municipal, mas não tem como ser transmitida.
  // Se o imóvel já tinha CIB, abre uma divergência para tratar com o suporte do Sinter.
  const naoTransmissivel = m.tipo === 'reativacao';
  const r = await db.query(
    `UPDATE cib_movimentacoes SET status = $3, erros = '[]'::jsonb, imovel_id = $2, remessa_id = NULL, validado_em = NOW(), updated_at = NOW(),
       retorno_msg = CASE WHEN $3 = 'nao_transmissivel' THEN 'Sem operação de reativação na API do Sinter (manual 1.17).' ELSE retorno_msg END
     WHERE id = $1 RETURNING *`, [id, imovelId, naoTransmissivel ? 'nao_transmissivel' : 'validada']
  );
  if (naoTransmissivel && atual?.cib) {
    await db.query(
      `INSERT INTO cib_divergencias (municipio, imovel_id, movimentacao_id, fonte, campo, valor_municipio, valor_externo, mensagem)
       VALUES ($1,$2,$3,'sinter','situacao','ativo','desativada',$4) ON CONFLICT DO NOTHING`,
      [m.municipio, imovelId, id, 'Inscrição reativada no município; a API do Sinter não tem operação de reativação. Solicite ao suporte do Sinter ou registre nova inclusão.']
    );
  }
  await processarImoveis(db, { ids: [imovelId] });
  await auditar(db, { municipio: m.municipio, entidade: 'movimentacao', entidadeId: id, acao: 'validar', detalhe: `${m.tipo} ${m.inscricao} aplicada no cadastro`, usuario });
  return { ok: true, mov: r.rows[0], erros: [] };
}

// ---- diagnostico (Fase 1, etapa 1) ----------------------------------------
// Lotes do CTM que pertencem ao municipio (pelo campo municipio ou por vinculo com um imovel dele).
const LOTES_DO_MUNI = `(COALESCE(l.municipio,'') = $1 OR EXISTS (SELECT 1 FROM imoveis x WHERE x.lote_id = l.id AND x.municipio = $1))`;
export async function diagnostico(municipio) {
  const base = (await query(
    `SELECT COUNT(*) FILTER (WHERE situacao = 'ativo')::int AS ativos,
            COUNT(*) FILTER (WHERE situacao = 'baixado')::int AS baixados,
            COUNT(*) FILTER (WHERE situacao = 'ativo' AND NOT tem_erro)::int AS prontos,
            COUNT(*) FILTER (WHERE situacao = 'ativo' AND tem_erro)::int AS com_erro,
            COUNT(*) FILTER (WHERE situacao = 'ativo' AND lote_id IS NULL)::int AS sem_lote,
            COUNT(*) FILTER (WHERE situacao = 'ativo' AND cib <> '')::int AS com_cib,
            COUNT(*) FILTER (WHERE situacao = 'ativo' AND tipo = 'predial')::int AS prediais,
            COUNT(*) FILTER (WHERE situacao = 'ativo' AND tipo = 'territorial')::int AS territoriais,
            COALESCE(SUM(valor_venal_total) FILTER (WHERE situacao = 'ativo'), 0)::float AS valor_venal
     FROM imoveis WHERE municipio = $1`, [municipio]
  )).rows[0];
  const porRegra = (await query(
    `SELECT p->>'codigo' AS codigo, p->>'mensagem' AS mensagem, p->>'nivel' AS nivel, COUNT(*)::int AS n
     FROM imoveis i, jsonb_array_elements(i.pendencias) p WHERE i.municipio = $1 AND i.situacao = 'ativo'
     GROUP BY 1,2,3 ORDER BY (p->>'nivel') = 'erro' DESC, n DESC`, [municipio]
  )).rows;
  const lotesSemImovel = (await query(
    `SELECT COUNT(*)::int AS n FROM lotes l WHERE ${LOTES_DO_MUNI}
       AND NOT EXISTS (SELECT 1 FROM imoveis i WHERE i.lote_id = l.id AND i.situacao = 'ativo')`, [municipio]
  )).rows[0].n;
  const totalLotes = (await query(`SELECT COUNT(*)::int AS n FROM lotes l WHERE ${LOTES_DO_MUNI}`, [municipio])).rows[0].n;
  const duplicidades = (await query(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT contribuinte_doc, logradouro, numero FROM imoveis
       WHERE municipio = $1 AND situacao = 'ativo' AND contribuinte_doc <> '' AND logradouro <> '' AND numero NOT IN ('', 'S/N')
       GROUP BY 1,2,3 HAVING COUNT(*) > 1) d`, [municipio]
  )).rows[0].n;
  const logradourosSemNome = (await query(
    `SELECT COUNT(*)::int AS n FROM ruas WHERE COALESCE(municipio,'') = $1 AND COALESCE(TRIM(nome),'') = ''`, [municipio]
  )).rows[0].n;
  const porBairro = (await query(
    `SELECT COALESCE(NULLIF(bairro,''),'(sem bairro)') AS bairro, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE NOT tem_erro)::int AS prontos
     FROM imoveis WHERE municipio = $1 AND situacao = 'ativo' GROUP BY 1 ORDER BY total DESC LIMIT 30`, [municipio]
  )).rows;
  const ativos = base.ativos || 0;
  const pct = (n) => (ativos ? Math.round((n / ativos) * 1000) / 10 : 0);
  const semanasSaneamento = Math.ceil((base.com_erro || 0) / CAPACIDADE_SEMANAL);
  const semanasIntegracao = ativos ? Math.max(2, Math.ceil(ativos / 5000)) : 0;
  return {
    municipio, geradoEm: new Date().toISOString(),
    imoveis: { ...base, pctProntos: pct(base.prontos), pctComErro: pct(base.com_erro), pctComCib: pct(base.com_cib) },
    lotes: { total: totalLotes, semImovel: lotesSemImovel },
    duplicidades, logradourosSemNome, porRegra, porBairro,
    estimativa: { semanasSaneamento, semanasIntegracao, semanasTotal: semanasSaneamento + semanasIntegracao, capacidadeSemanal: CAPACIDADE_SEMANAL },
  };
}

// ---- relatorio mensal (Prestar contas) -------------------------------------
export async function relatorioMensal(municipio, competencia) {
  competencia = /^\d{4}-\d{2}$/.test(String(competencia || '')) ? competencia : competenciaDe();
  const movs = (await query(
    `SELECT tipo, status, origem, COUNT(*)::int AS n FROM cib_movimentacoes WHERE municipio = $1 AND competencia = $2 GROUP BY 1,2,3`,
    [municipio, competencia]
  )).rows;
  const somar = (f) => movs.filter(f).reduce((s, r) => s + r.n, 0);
  const porTipo = Object.fromEntries(TIPOS_MOV.map((t) => [t, somar((r) => r.tipo === t)]));
  const porStatus = Object.fromEntries(STATUS_MOV.map((s) => [s, somar((r) => r.status === s)]));
  const porOrigem = {};
  for (const r of movs) porOrigem[r.origem] = (porOrigem[r.origem] || 0) + r.n;
  const remessas = (await query(
    `SELECT numero, status, modo, protocolo, qtd_itens, qtd_ok, qtd_divergente, qtd_erro, enviada_em, processada_em
     FROM cib_remessas WHERE municipio = $1 AND competencia = $2 ORDER BY numero`, [municipio, competencia]
  )).rows;
  const [ano, mes] = competencia.split('-').map(Number);
  const ini = `${competencia}-01`;
  const fim = `${mes === 12 ? ano + 1 : ano}-${String(mes === 12 ? 1 : mes + 1).padStart(2, '0')}-01`;
  const cibs = (await query(`SELECT COUNT(*)::int AS n FROM imoveis WHERE municipio = $1 AND cib_atribuido_em >= $2::date AND cib_atribuido_em < $3::date`, [municipio, ini, fim])).rows[0].n;
  const div = (await query(
    `SELECT COUNT(*) FILTER (WHERE created_at >= $2::date AND created_at < $3::date)::int AS abertas_mes,
            COUNT(*) FILTER (WHERE resolvido_em >= $2::date AND resolvido_em < $3::date)::int AS resolvidas_mes,
            COUNT(*) FILTER (WHERE status = 'aberta')::int AS em_aberto
     FROM cib_divergencias WHERE municipio = $1`, [municipio, ini, fim]
  )).rows[0];
  const vist = (await query(
    `SELECT COUNT(*) FILTER (WHERE created_at >= $2::date AND created_at < $3::date)::int AS detectadas,
            COUNT(*) FILTER (WHERE status = 'confirmada' AND resolvido_em >= $2::date AND resolvido_em < $3::date)::int AS confirmadas,
            COUNT(*) FILTER (WHERE status IN ('pendente','agendada'))::int AS pendentes
     FROM cib_vistorias WHERE municipio = $1`, [municipio, ini, fim]
  )).rows[0];
  const base = (await query(
    `SELECT COUNT(*) FILTER (WHERE situacao = 'ativo')::int AS ativos, COUNT(*) FILTER (WHERE situacao = 'ativo' AND cib <> '')::int AS com_cib,
            COUNT(*) FILTER (WHERE situacao = 'ativo' AND tem_erro)::int AS pendentes
     FROM imoveis WHERE municipio = $1`, [municipio]
  )).rows[0];
  let req = { protocolados: 0, concluidos: 0, emAberto: 0 }, docs = { emitidos: 0, porTipo: {} };
  try {
    req = (await query(
      `SELECT COUNT(*) FILTER (WHERE created_at >= $2::date AND created_at < $3::date)::int AS "protocolados",
              COUNT(*) FILTER (WHERE status IN ('deferido','indeferido','concluido') AND updated_at >= $2::date AND updated_at < $3::date)::int AS "concluidos",
              COUNT(*) FILTER (WHERE status IN ('protocolado','em_analise','pendente_documentacao'))::int AS "emAberto"
       FROM requerimentos WHERE municipio = $1`, [municipio, ini, fim])).rows[0];
    const d = (await query(`SELECT tipo, COUNT(*)::int AS n FROM documentos WHERE municipio = $1 AND emitido_em >= $2::date AND emitido_em < $3::date AND status = 'valido' GROUP BY 1`, [municipio, ini, fim])).rows;
    docs = { emitidos: d.reduce((s, r) => s + r.n, 0), porTipo: Object.fromEntries(d.map((r) => [r.tipo, r.n])) };
  } catch { /* modulo de documentos ainda sem tabelas */ }
  return {
    municipio, competencia, geradoEm: new Date().toISOString(),
    movimentacoes: { total: movs.reduce((s, r) => s + r.n, 0), porTipo, porStatus, porOrigem },
    remessas, cibsAtribuidos: cibs, divergencias: div, vistorias: vist, base,
    requerimentos: req, documentos: docs,
  };
}

// ---- implantacao -----------------------------------------------------------
async function implantacao(municipio) {
  let row = (await query('SELECT * FROM cib_implantacao WHERE municipio = $1', [municipio])).rows[0];
  if (!row) row = { municipio, etapa_atual: 1, etapas: {}, checklist: {} };
  const d = await diagnostico(municipio);
  const rem = (await query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status <> 'preparada')::int AS enviadas,
      COALESCE(MAX(numero),0)::int AS ultima FROM cib_remessas WHERE municipio = $1`, [municipio])).rows[0];
  const transmitidos = (await query(`SELECT COUNT(*)::int AS n FROM imoveis WHERE municipio = $1 AND transmitido`, [municipio])).rows[0].n;
  const divAbertas = (await query(`SELECT COUNT(*)::int AS n FROM cib_divergencias WHERE municipio = $1 AND status = 'aberta'`, [municipio])).rows[0].n;
  let docsComCib = 0;
  try { docsComCib = (await query(`SELECT COUNT(*)::int AS n FROM documentos WHERE municipio = $1 AND COALESCE(conteudo->'imovel'->>'cib','') <> ''`, [municipio])).rows[0].n; } catch { /* ok */ }
  const ativos = d.imoveis.ativos || 0;
  const metricas = {
    diagnostico: { texto: `${ativos} imóveis analisados · ${String(d.imoveis.pctProntos).replace('.', ',')}% prontos para o Sinter`, progresso: ativos ? 100 : 0 },
    saneamento: { texto: `${d.imoveis.com_erro} imóveis com pendência bloqueante`, progresso: ativos ? Math.round((d.imoveis.prontos / ativos) * 100) : 0 },
    integracao: { texto: `${rem.enviadas} remessa(s) enviada(s) · ${transmitidos} imóveis transmitidos`, progresso: ativos ? Math.round((transmitidos / ativos) * 100) : 0, remessa: rem.ultima },
    conciliacao: { texto: `${divAbertas} divergência(s) em aberto`, progresso: transmitidos ? Math.round(((transmitidos - divAbertas) / transmitidos) * 100) : 0 },
    internalizacao: { texto: `${d.imoveis.com_cib} imóveis com CIB (${String(d.imoveis.pctComCib).replace('.', ',')}%) · ${docsComCib} documento(s) emitidos com CIB`, progresso: Math.round(d.imoveis.pctComCib) },
  };
  return {
    municipio, etapaAtual: row.etapa_atual,
    etapas: ETAPAS.map((e) => ({ ...e, ...(row.etapas?.[e.id] || {}), status: e.n < row.etapa_atual ? 'concluida' : (e.n === row.etapa_atual ? 'em_andamento' : 'a_fazer'), metrica: metricas[e.id] })),
    checklist: CHECKLIST_ADESAO.map((c) => ({ ...c, feito: Boolean(row.checklist?.[c.id]) })),
    atualizadoEm: row.updated_at || null,
  };
}

// ---- painel ---------------------------------------------------------------
async function painel(municipio) {
  const comp = competenciaDe();
  const base = (await query(
    `SELECT COUNT(*) FILTER (WHERE situacao = 'ativo')::int AS ativos,
            COUNT(*) FILTER (WHERE situacao = 'ativo' AND cib <> '')::int AS com_cib,
            COUNT(*) FILTER (WHERE situacao = 'ativo' AND tem_erro)::int AS com_erro,
            COUNT(*) FILTER (WHERE sinter_status = 'aguardando_envio')::int AS aguardando,
            COUNT(*) FILTER (WHERE sinter_status = 'enviado')::int AS enviados
     FROM imoveis WHERE municipio = $1`, [municipio]
  )).rows[0];
  const porStatus = (await query(`SELECT sinter_status AS s, COUNT(*)::int AS n FROM imoveis WHERE municipio = $1 GROUP BY 1`, [municipio])).rows;
  const ciclo = (await query(`SELECT status, COUNT(*)::int AS n FROM cib_movimentacoes WHERE municipio = $1 AND competencia = $2 GROUP BY 1`, [municipio, comp])).rows;
  const filaValidar = (await query(`SELECT COUNT(*)::int AS n FROM cib_movimentacoes WHERE municipio = $1 AND status = 'capturada'`, [municipio])).rows[0].n;
  const filaTransmitir = (await query(`SELECT COUNT(*)::int AS n FROM cib_movimentacoes WHERE municipio = $1 AND status = 'validada' AND remessa_id IS NULL`, [municipio])).rows[0].n;
  const ultimas = (await query(
    `SELECT id, tipo, origem, inscricao, status, created_at FROM cib_movimentacoes WHERE municipio = $1 ORDER BY created_at DESC, id DESC LIMIT 8`, [municipio]
  )).rows;
  const div = (await query(`SELECT COUNT(*)::int AS n FROM cib_divergencias WHERE municipio = $1 AND status = 'aberta'`, [municipio])).rows[0].n;
  const vist = (await query(`SELECT COUNT(*)::int AS n FROM cib_vistorias WHERE municipio = $1 AND status IN ('pendente','agendada')`, [municipio])).rows[0].n;
  const ultimaRemessa = (await query(`SELECT numero, status, qtd_itens, enviada_em, created_at FROM cib_remessas WHERE municipio = $1 ORDER BY numero DESC LIMIT 1`, [municipio])).rows[0] || null;
  let reqAbertos = 0, reqAtrasados = 0, docsMes = 0;
  try {
    const r = (await query(`SELECT COUNT(*)::int AS a, COUNT(*) FILTER (WHERE prazo < CURRENT_DATE)::int AS t FROM requerimentos
      WHERE municipio = $1 AND status IN ('protocolado','em_analise','pendente_documentacao')`, [municipio])).rows[0];
    reqAbertos = r.a; reqAtrasados = r.t;
    docsMes = (await query(`SELECT COUNT(*)::int AS n FROM documentos WHERE municipio = $1 AND to_char(emitido_em AT TIME ZONE '${TZ}','YYYY-MM') = $2`, [municipio, comp])).rows[0].n;
  } catch { /* ok */ }
  const cfg = await getConfig(municipio);
  const prazo = new Date(cfg.prazoSinter + 'T23:59:59-03:00');
  const diasPrazo = Math.ceil((prazo - Date.now()) / 86400000);
  const imp = (await query('SELECT etapa_atual FROM cib_implantacao WHERE municipio = $1', [municipio])).rows[0];
  return {
    municipio, competencia: comp, prazoSinter: cfg.prazoSinter, diasPrazo,
    etapaImplantacao: imp?.etapa_atual || 1,
    imoveis: base, porStatus,
    pendencias: (base.com_erro || 0) + div + vist,
    alteracoesMes: ciclo.reduce((s, r) => s + r.n, 0),
    ciclo: Object.fromEntries(ciclo.map((r) => [r.status, r.n])),
    filas: { validar: filaValidar, transmitir: filaTransmitir, divergencias: div, vistorias: vist, requerimentos: reqAbertos, requerimentosAtrasados: reqAtrasados },
    documentosMes: docsMes, ultimaRemessa,
    ultimas: ultimas.map((u) => ({ id: u.id, tipo: u.tipo, origem: u.origem, inscricao: u.inscricao, status: u.status, criadoEm: u.created_at })),
  };
}

// ---- deteccao (IA / cruzamento) -------------------------------------------
/**
 * Cruza as edificacoes extraidas (camada `edificacoes`, ex.: vetorizada por
 * visao computacional sobre a ortofoto) com o cadastro: o que existe no chao e
 * nao existe no cadastro vira item da lista de vistoria.
 */
export async function detectarDiferencas(municipio, { minArea = 20, tolerancia = 0.15 } = {}) {
  const { rows } = await query(
    `WITH lt AS (
       SELECT l.id, l.codigo, l.bairro, l.geom FROM lotes l WHERE ${LOTES_DO_MUNI}
     ), ed AS (
       SELECT lt.id AS lote_id, SUM(ST_Area(ST_Intersection(e.geom, lt.geom)::geography)) AS area_edif
       FROM lt JOIN edificacoes e ON ST_Intersects(e.geom, lt.geom)
       GROUP BY lt.id
     ), cad AS (
       SELECT lote_id, SUM(COALESCE(area_construida_m2,0)) AS area_cad, MIN(id) AS imovel_id, MIN(inscricao) AS inscricao,
              COUNT(*) AS n
       FROM imoveis WHERE situacao = 'ativo' AND lote_id IS NOT NULL GROUP BY lote_id
     )
     SELECT lt.id AS lote_id, lt.codigo, lt.bairro, COALESCE(ed.area_edif,0) AS area_edif, COALESCE(cad.area_cad,0) AS area_cad,
            cad.imovel_id, cad.inscricao, cad.n AS n_imoveis,
            ST_Y(ST_PointOnSurface(lt.geom)) AS lat, ST_X(ST_PointOnSurface(lt.geom)) AS lng
     FROM lt LEFT JOIN ed ON ed.lote_id = lt.id LEFT JOIN cad ON cad.lote_id = lt.id
     WHERE COALESCE(ed.area_edif,0) >= $2 OR COALESCE(cad.area_cad,0) > 0`,
    [municipio, minArea]
  );
  const achados = [];
  for (const r of rows) {
    let tipo = null;
    if (r.area_edif >= minArea && r.area_cad <= 0) tipo = 'edificacao_nova';
    else if (r.area_edif >= minArea && r.area_edif > r.area_cad * (1 + tolerancia) + 10) tipo = 'ampliacao';
    else if (r.area_cad > 0 && r.area_edif < minArea) tipo = 'demolicao';
    if (tipo) achados.push({ ...r, tipo });
  }
  let novas = 0;
  for (const a of achados) {
    const ja = await query(`SELECT 1 FROM cib_vistorias WHERE lote_id = $1 AND tipo = $2 AND status IN ('pendente','agendada')`, [a.lote_id, a.tipo]);
    if (ja.rows.length) continue;
    await query(
      `INSERT INTO cib_vistorias (municipio, lote_id, lote_codigo, imovel_id, inscricao, bairro, tipo, area_detectada_m2, area_cadastrada_m2, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [municipio, a.lote_id, a.codigo || '', a.imovel_id || null, a.inscricao || '', a.bairro || '', a.tipo,
        Math.round(a.area_edif * 10) / 10, Math.round(a.area_cad * 10) / 10, a.lat, a.lng]
    );
    novas += 1;
  }
  return { analisados: rows.length, diferencas: achados.length, novas };
}

/**
 * Aplica mudanças em um imóvel existente (edição na tela ou importação do
 * sistema tributário). Se o imóvel já é conhecido do Sinter, a mudança vira (ou
 * se junta a) uma movimentação de alteração na fila de transmissão.
 * Devolve { mudou, antes, movId } — mudou vazio = nada a fazer (idempotente).
 */
export async function aplicarAlteracao(db, atual, campos, { origem = 'manual', descricao = 'Atualização cadastral', usuario = '', documentoRef = '' } = {}) {
  const mudou = {};
  for (const [k, v] of Object.entries(campos)) {
    if (k === 'cib') continue;
    if (!igualCampo(atual[k], v, CAMPOS_IMOVEL[k])) mudou[k] = v;
  }
  if (!Object.keys(mudou).length) return { mudou, antes: {}, movId: null };
  const antes = Object.fromEntries(Object.keys(mudou).map((k) => [k, atual[k] instanceof Date ? isoData(atual[k]) : atual[k]]));
  const cols = Object.keys(mudou);
  await db.query(`UPDATE imoveis SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`, [atual.id, ...cols.map((c) => mudou[c])]);
  if ('lote_codigo' in mudou) {
    const loteId = await resolverLote(db, mudou.lote_codigo, atual.municipio);
    await db.query('UPDATE imoveis SET lote_id = $2 WHERE id = $1', [atual.id, loteId]);
  }
  let movId = null;
  if (atual.transmitido || atual.cib) {
    const aberta = (await db.query(
      `SELECT * FROM cib_movimentacoes WHERE imovel_id = $1 AND tipo = 'alteracao' AND status IN ('capturada','validada') AND remessa_id IS NULL ORDER BY id DESC LIMIT 1`, [atual.id]
    )).rows[0];
    if (aberta) {
      await db.query(`UPDATE cib_movimentacoes SET dados_depois = dados_depois || $2::jsonb, dados_antes = $3::jsonb || dados_antes, updated_at = NOW() WHERE id = $1`,
        [aberta.id, JSON.stringify(mudou), JSON.stringify(antes)]);
      movId = aberta.id;
    } else {
      const r = await db.query(
        `INSERT INTO cib_movimentacoes (municipio, imovel_id, inscricao, tipo, origem, documento_ref, descricao, dados_antes, dados_depois, status, validado_em, competencia, criado_por_nome)
         VALUES ($1,$2,$3,'alteracao',$4,$5,$6,$7::jsonb,$8::jsonb,'validada',NOW(),$9,$10) RETURNING id`,
        [atual.municipio, atual.id, mudou.inscricao || atual.inscricao, ORIGENS.includes(origem) ? origem : 'manual', String(documentoRef || '').slice(0, 80),
          String(descricao).slice(0, 500), JSON.stringify(antes), JSON.stringify(mudou), competenciaDe(), usuario]
      );
      movId = r.rows[0].id;
    }
  }
  await processarImoveis(db, { ids: [atual.id] });
  const im = (await db.query('SELECT tem_erro FROM imoveis WHERE id = $1', [atual.id])).rows[0];
  if (movId && im.tem_erro) {
    await db.query(`UPDATE cib_movimentacoes SET status = 'capturada', validado_em = NULL WHERE id = $1 AND status = 'validada'`, [movId]);
    await recalcularStatus(db, { ids: [atual.id] });
  }
  const mascarar = (k, v) => (k === 'contribuinte_doc' ? mascararDoc(v) : v);
  await auditar(db, { municipio: atual.municipio, entidade: 'imovel', entidadeId: atual.id, acao: origem === 'sistema_tributario' ? 'importar' : 'editar',
    detalhe: Object.keys(mudou).map((k) => `${ROTULOS[k] || k}: "${mascarar(k, antes[k]) ?? ''}" → "${mascarar(k, mudou[k]) ?? ''}"`).join('; '), usuario });
  return { mudou, antes, movId };
}

/** Compara valor do banco com valor normalizado (números com tolerância, vazio = nulo, datas ISO). */
export function igualCampo(a, v, tipo) {
  const vazioA = a == null || a === '', vazioV = v == null || v === '';
  if (vazioA || vazioV) return vazioA && vazioV;
  if (tipo === 'num' || tipo === 'int') return Math.abs(Number(a) - Number(v)) < 0.0001;
  if (tipo === 'bool') return Boolean(a) === Boolean(v);
  if (tipo === 'data') return isoData(a) === isoData(v);
  return String(a).trim() === String(v).trim();
}

// ===========================================================================
// Rotas
// ===========================================================================
export const cibRouter = Router();
const gestor = requireRole('admin', 'coordenador');
cibRouter.use('/api/cib', requireAuth);

// -- municipios e configuracao
cibRouter.get('/api/cib/municipios', asyncRoute(async (req, res) => {
  if (MUNICIPIO_FIXO) return res.json([MUNICIPIO_FIXO]); // um deploy por prefeitura
  const { rows } = await query(
    `SELECT m AS municipio FROM (
       SELECT municipio AS m FROM municipio_config UNION SELECT DISTINCT municipio FROM imoveis
       UNION SELECT DISTINCT COALESCE(municipio,'') FROM lotes) x ORDER BY 1`
  );
  res.json(rows.map((r) => r.municipio));
}));
cibRouter.get('/api/cib/config', asyncRoute(async (req, res) => res.json({ ...(await getConfig(muniDe(req))), simulacao: SIMULACAO_SINTER, municipioFixo: Boolean(MUNICIPIO_FIXO) })));
cibRouter.put('/api/cib/config', gestor, asyncRoute(async (req, res) => {
  const m = muniDe(req);
  const cfg = await salvarConfig(m, req.body || {});
  await auditar(null, { municipio: m, entidade: 'config', acao: 'salvar', detalhe: 'Configuração do município atualizada', usuario: nomeUsuario(req) });
  res.json(cfg);
}));

// -- painel, diagnostico, relatorio, implantacao
cibRouter.get('/api/cib/painel', asyncRoute(async (req, res) => res.json(await painel(muniDe(req)))));
cibRouter.get('/api/cib/diagnostico', asyncRoute(async (req, res) => res.json(await diagnostico(muniDe(req)))));
cibRouter.get('/api/cib/relatorio-mensal', asyncRoute(async (req, res) => res.json(await relatorioMensal(muniDe(req), req.query.competencia))));
cibRouter.get('/api/cib/implantacao', asyncRoute(async (req, res) => res.json(await implantacao(muniDe(req)))));
cibRouter.put('/api/cib/implantacao', gestor, asyncRoute(async (req, res) => {
  const m = muniDe(req);
  const b = req.body || {};
  const etapa = Math.min(5, Math.max(1, Number(b.etapaAtual) || 1));
  const checklist = {};
  for (const c of CHECKLIST_ADESAO) checklist[c.id] = Boolean(b.checklist?.[c.id]);
  const etapas = {};
  for (const e of ETAPAS) if (b.etapas?.[e.id]) etapas[e.id] = { obs: String(b.etapas[e.id].obs || '').slice(0, 1000), prazo: b.etapas[e.id].prazo || null };
  const ant = (await query('SELECT etapa_atual FROM cib_implantacao WHERE municipio = $1', [m])).rows[0];
  await query(
    `INSERT INTO cib_implantacao (municipio, etapa_atual, etapas, checklist) VALUES ($1,$2,$3::jsonb,$4::jsonb)
     ON CONFLICT (municipio) DO UPDATE SET etapa_atual = EXCLUDED.etapa_atual, etapas = EXCLUDED.etapas, checklist = EXCLUDED.checklist, updated_at = NOW()`,
    [m, etapa, JSON.stringify(etapas), JSON.stringify(checklist)]
  );
  if (!ant || ant.etapa_atual !== etapa) {
    await auditar(null, { municipio: m, entidade: 'implantacao', acao: 'etapa', detalhe: `Implantação avançou para a etapa ${etapa} (${ETAPAS[etapa - 1].titulo})`, usuario: nomeUsuario(req) });
  }
  res.json(await implantacao(m));
}));

// -- imoveis
cibRouter.get('/api/cib/imoveis', asyncRoute(async (req, res) => {
  const m = muniDe(req);
  const where = ['i.municipio = $1'], params = [m];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('$?', '$' + params.length)); };
  if (req.query.status) add('i.sinter_status = $?', String(req.query.status));
  if (req.query.situacao) add('i.situacao = $?', String(req.query.situacao));
  if (req.query.bairro) add('i.bairro = $?', String(req.query.bairro));
  if (req.query.regra) add(`i.pendencias @> $?::jsonb`, JSON.stringify([{ codigo: String(req.query.regra) }]));
  if (req.query.semCib === '1') where.push(`i.cib = '' AND i.situacao = 'ativo'`);
  if (req.query.q) {
    const q = '%' + String(req.query.q).replace(/[%_]/g, '') + '%';
    const qd = normalizarNi(req.query.q);
    params.push(q);
    const p = '$' + params.length;
    let cond = `(i.inscricao ILIKE ${p} OR i.cib ILIKE ${p} OR i.logradouro ILIKE ${p} OR i.contribuinte_nome ILIKE ${p} OR i.lote_codigo ILIKE ${p}`;
    if (qd.length === 11 || qd.length === 14) { params.push(qd); cond += ` OR i.contribuinte_doc = $${params.length}`; }
    where.push(cond + ')');
  }
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const total = (await query(`SELECT COUNT(*)::int AS n FROM imoveis i WHERE ${where.join(' AND ')}`, params)).rows[0].n;
  const { rows } = await query(
    `SELECT i.* FROM imoveis i WHERE ${where.join(' AND ')} ORDER BY i.inscricao LIMIT ${limit} OFFSET ${offset}`, params
  );
  res.json({ total, limit, offset, itens: rows.map((r) => mapImovel(r)) });
}));

cibRouter.get('/api/cib/imoveis/:id', asyncRoute(async (req, res) => {
  const im = await getImovelCompleto(req.params.id);
  if (!im) throw erro(404, 'Imóvel não encontrado.');
  const movs = (await query(`SELECT m.*, r.numero AS remessa_numero FROM cib_movimentacoes m LEFT JOIN cib_remessas r ON r.id = m.remessa_id
     WHERE m.imovel_id = $1 ORDER BY m.created_at DESC LIMIT 50`, [im.id])).rows.map(mapMov);
  const divs = (await query(`SELECT * FROM cib_divergencias WHERE imovel_id = $1 ORDER BY created_at DESC`, [im.id])).rows;
  let docs = [], bcis = [];
  try { docs = (await query(`SELECT id, tipo, numero, titulo, emitido_em, status, codigo_validacao FROM documentos WHERE imovel_id = $1 ORDER BY emitido_em DESC`, [im.id])).rows; } catch { /* ok */ }
  try { bcis = (await query(`SELECT id, status, updated_at FROM bci WHERE inscricao = $1 ORDER BY updated_at DESC LIMIT 5`, [im.inscricao])).rows; } catch { /* ok */ }
  res.json({ ...im, movimentacoes: movs, divergencias: divs, documentos: docs, bcis });
}));

// LGPD: o CPF/CNPJ completo só sai por aqui, com finalidade, e o acesso fica registrado.
cibRouter.post('/api/cib/imoveis/:id/revelar', asyncRoute(async (req, res) => {
  if (req.user?.role && req.user.role !== 'anon' && !PERFIS_DADOS_PESSOAIS.includes(req.user.role)) throw erro(403, 'Seu perfil não acessa dados pessoais completos.');
  const finalidade = String(req.body?.finalidade || '').trim();
  if (finalidade.length < 3) throw erro(400, 'Informe a finalidade do acesso ao dado pessoal.');
  const r = (await query('SELECT id, municipio, contribuinte_doc FROM imoveis WHERE id = $1', [req.params.id])).rows[0];
  if (!r || r.municipio !== muniDe(req)) throw erro(404, 'Imóvel não encontrado.');
  await registrarAcesso(req, { municipio: r.municipio, entidade: 'imovel', entidadeId: r.id, dado: 'CPF/CNPJ do contribuinte', finalidade });
  res.json({ contribuinteDoc: r.contribuinte_doc });
}));

cibRouter.post('/api/cib/imoveis', asyncRoute(async (req, res) => {
  const m = muniDe(req);
  const campos = completarDerivados(normalizarCampos(req.body || {}));
  delete campos.cib;
  if (!campos.inscricao) throw erro(400, 'Informe a inscrição imobiliária.');
  const result = await withTransaction(async (db) => {
    const ja = await db.query('SELECT id FROM imoveis WHERE municipio = $1 AND inscricao = $2', [m, campos.inscricao]);
    if (ja.rows.length) throw erro(409, 'Inscrição já cadastrada neste município.');
    // Depois que a integracao comecou, toda inclusao precisa chegar ao Sinter:
    // registra como movimentacao e valida (aplica) na hora.
    if (await integracaoIniciada(db, m)) {
      const mov = await capturarMovimentacao(db, { municipio: m, tipo: 'inclusao', origem: 'manual', inscricao: campos.inscricao,
        dadosDepois: campos, descricao: req.body.descricao || 'Inclusão manual no cadastro', usuario: nomeUsuario(req) });
      const v = await validarMovimentacao(db, mov.id, nomeUsuario(req));
      if (!v.ok) throw erro(422, 'Dados incompletos para inclusão: ' + v.erros.map((e) => e.mensagem).join('; '));
      return v.mov.imovel_id;
    }
    const loteId = await resolverLote(db, campos.lote_codigo || campos.inscricao, m);
    const cols = Object.keys(campos);
    const r = await db.query(
      `INSERT INTO imoveis (municipio, lote_id, ${cols.join(', ')}) VALUES ($1,$2, ${cols.map((_, i) => '$' + (i + 3)).join(', ')}) RETURNING id`,
      [m, loteId, ...cols.map((c) => campos[c])]
    );
    await processarImoveis(db, { ids: [r.rows[0].id] });
    await auditar(db, { municipio: m, entidade: 'imovel', entidadeId: r.rows[0].id, acao: 'criar', detalhe: `Inscrição ${campos.inscricao}`, usuario: nomeUsuario(req) });
    return r.rows[0].id;
  });
  res.json(await getImovelCompleto(result));
}));

cibRouter.put('/api/cib/imoveis/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const campos = normalizarCampos(req.body || {});
  delete campos.cib; // CIB vem do Sinter (retorno) — ver PATCH /cib
  // CPF/CNPJ só é alterado se enviado explicitamente (a ficha mostra mascarado).
  if (!campos.contribuinte_doc) delete campos.contribuinte_doc;
  const out = await withTransaction(async (db) => {
    const atual = (await db.query('SELECT * FROM imoveis WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!atual || atual.municipio !== muniDe(req)) throw erro(404, 'Imóvel não encontrado.');
    if (campos.inscricao && campos.inscricao !== atual.inscricao) {
      const ja = await db.query('SELECT 1 FROM imoveis WHERE municipio = $1 AND inscricao = $2 AND id <> $3', [atual.municipio, campos.inscricao, id]);
      if (ja.rows.length) throw erro(409, 'Já existe outro imóvel com esta inscrição.');
    }
    const r = await aplicarAlteracao(db, atual, campos, { origem: 'manual', descricao: req.body.descricao || 'Atualização cadastral', usuario: nomeUsuario(req) });
    return { id, mov: r.movId };
  });
  res.json({ ...(await getImovelCompleto(out.id)), movimentacaoId: out.mov });
}));

// Baixa / reativacao (viram movimentacoes ja validadas).
for (const [rota, tipo] of [['baixa', 'baixa'], ['reativar', 'reativacao']]) {
  cibRouter.post(`/api/cib/imoveis/:id/${rota}`, asyncRoute(async (req, res) => {
    const out = await withTransaction(async (db) => {
      const im = (await db.query('SELECT * FROM imoveis WHERE id = $1', [req.params.id])).rows[0];
      if (!im) throw erro(404, 'Imóvel não encontrado.');
      if (im.municipio !== muniDe(req)) throw erro(404, 'Imóvel não encontrado.');
      const mov = await capturarMovimentacao(db, { municipio: im.municipio, imovelId: im.id, inscricao: im.inscricao, tipo,
        desativacaoMotivo: req.body?.desativacaoMotivo, desativacaoTipo: req.body?.desativacaoTipo,
        origem: ORIGENS.includes(req.body?.origem) ? req.body.origem : 'manual', documentoRef: req.body?.documentoRef,
        descricao: req.body?.motivo || (tipo === 'baixa' ? 'Baixa de inscrição' : 'Reativação de inscrição'), usuario: nomeUsuario(req) });
      const v = await validarMovimentacao(db, mov.id, nomeUsuario(req));
      if (!v.ok) throw erro(409, v.erros.map((e) => e.mensagem).join('; '));
      return im.id;
    });
    res.json(await getImovelCompleto(out));
  }));
}

cibRouter.post('/api/cib/revalidar', asyncRoute(async (req, res) => {
  const m = muniDe(req);
  // Revincula lotes por codigo antes de validar (caso a base cartografica tenha chegado depois).
  await query(
    `UPDATE imoveis i SET lote_id = l.id FROM lotes l
     WHERE i.municipio = $1 AND i.lote_id IS NULL AND l.codigo = COALESCE(NULLIF(i.lote_codigo,''), i.inscricao)`, [m]
  );
  const n = await processarImoveis(null, { municipio: m });
  await auditar(null, { municipio: m, entidade: 'imovel', acao: 'revalidar', detalhe: `${n} imóveis revalidados`, usuario: nomeUsuario(req) });
  res.json({ ok: true, revalidados: n, diagnostico: await diagnostico(m) });
}));

cibRouter.get('/api/cib/mapa', asyncRoute(async (req, res) => {
  const { rows } = await query(
    `SELECT i.id, i.inscricao, i.sinter_status, i.cib, ST_Y(ST_PointOnSurface(l.geom)) AS lat, ST_X(ST_PointOnSurface(l.geom)) AS lng
     FROM imoveis i JOIN lotes l ON l.id = i.lote_id WHERE i.municipio = $1 LIMIT 20000`, [muniDe(req)]
  );
  res.json(rows.map((r) => ({ id: r.id, inscricao: r.inscricao, status: r.sinter_status, cib: r.cib, lat: r.lat, lng: r.lng })));
}));

// -- movimentacoes (Capturar / Validar)
cibRouter.get('/api/cib/movimentacoes', asyncRoute(async (req, res) => {
  const m = muniDe(req);
  const where = ['m.municipio = $1'], params = [m];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('$?', '$' + params.length)); };
  if (req.query.competencia) add('m.competencia = $?', String(req.query.competencia));
  if (req.query.status) add('m.status = ANY($?::text[])', String(req.query.status).split(','));
  if (req.query.tipo) add('m.tipo = $?', String(req.query.tipo));
  if (req.query.origem) add('m.origem = $?', String(req.query.origem));
  if (req.query.remessa) add('m.remessa_id = $?', Number(req.query.remessa));
  if (req.query.q) add('m.inscricao ILIKE $?', '%' + String(req.query.q).replace(/[%_]/g, '') + '%');
  const limit = Math.min(500, Number(req.query.limit) || 200);
  const { rows } = await query(
    `SELECT m.*, r.numero AS remessa_numero FROM cib_movimentacoes m LEFT JOIN cib_remessas r ON r.id = m.remessa_id
     WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC, m.id DESC LIMIT ${limit}`, params
  );
  res.json(rows.map(mapMov));
}));

cibRouter.post('/api/cib/movimentacoes', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const mov = await withTransaction((db) => capturarMovimentacao(db, {
    municipio: muniDe(req), tipo: b.tipo, origem: b.origem, inscricao: b.inscricao, documentoRef: b.documentoRef,
    desativacaoMotivo: b.desativacaoMotivo, desativacaoTipo: b.desativacaoTipo,
    descricao: b.descricao, dadosDepois: b.dadosDepois, usuario: nomeUsuario(req),
  }));
  res.json(mapMov(mov));
}));

// Parcelamento do solo (desmembramento/remembramento/loteamento): baixa das
// inscricoes de origem + inclusao das novas, num unico ato.
cibRouter.post('/api/cib/movimentacoes/parcelamento', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const m = muniDe(req);
  const origens = (Array.isArray(b.origens) ? b.origens : String(b.origens || '').split(/[,;\s]+/)).map((s) => String(s).trim()).filter(Boolean);
  const novas = Array.isArray(b.novas) ? b.novas : [];
  if (!origens.length || !novas.length) throw erro(400, 'Informe a(s) inscrição(ões) de origem e as novas unidades.');
  const tipoParc = ['desmembramento', 'remembramento', 'loteamento', 'desdobro'].includes(b.modalidade) ? b.modalidade : 'desmembramento';
  const out = await withTransaction(async (db) => {
    const criadas = [];
    let modelo = null;
    for (const insc of origens) {
      const im = (await db.query('SELECT * FROM imoveis WHERE municipio = $1 AND inscricao = $2', [m, insc])).rows[0];
      if (!im) throw erro(404, `Inscrição de origem ${insc} não encontrada.`);
      modelo = modelo || im;
      criadas.push(await capturarMovimentacao(db, { municipio: m, imovelId: im.id, inscricao: insc, tipo: 'baixa', origem: 'parcelamento',
        desativacaoMotivo: { desmembramento: 1, desdobro: 1, remembramento: 2, loteamento: 4 }[tipoParc], desativacaoTipo: 1,
        documentoRef: b.documentoRef, descricao: `Baixa por ${tipoParc}`, usuario: nomeUsuario(req) }));
    }
    for (const n of novas) {
      const herdado = { logradouro: modelo.logradouro, bairro: modelo.bairro, cep: modelo.cep, contribuinte_nome: modelo.contribuinte_nome,
        contribuinte_doc: modelo.contribuinte_doc, tipo: 'territorial', uso: modelo.uso, setor: modelo.setor, quadra: modelo.quadra };
      criadas.push(await capturarMovimentacao(db, { municipio: m, tipo: 'inclusao', origem: 'parcelamento', inscricao: n.inscricao,
        documentoRef: b.documentoRef, descricao: `Inclusão por ${tipoParc} de ${origens.join(', ')}`,
        dadosDepois: { ...herdado, ...n }, usuario: nomeUsuario(req) }));
    }
    return criadas;
  });
  res.json(out.map(mapMov));
}));

// Carga inicial (Fase 1 / Integracao): todo imovel pronto que nunca foi ao Sinter.
cibRouter.post('/api/cib/movimentacoes/carga-inicial', gestor, asyncRoute(async (req, res) => {
  const m = muniDe(req);
  const n = await withTransaction(async (db) => {
    const { rows } = await db.query(
      `INSERT INTO cib_movimentacoes (municipio, imovel_id, inscricao, tipo, origem, descricao, dados_depois, status, validado_em, competencia, criado_por_nome)
       SELECT i.municipio, i.id, i.inscricao, 'inclusao', 'implantacao', 'Carga inicial do cadastro', '{}'::jsonb, 'validada', NOW(), $2, $3
       FROM imoveis i
       WHERE i.municipio = $1 AND i.situacao = 'ativo' AND NOT i.tem_erro AND NOT i.transmitido AND i.cib = ''
         AND NOT EXISTS (SELECT 1 FROM cib_movimentacoes x WHERE x.imovel_id = i.id AND x.status IN ('capturada','validada','transmitida'))
       RETURNING imovel_id`, [m, competenciaDe(), nomeUsuario(req)]
    );
    await recalcularStatus(db, { municipio: m });
    await auditar(db, { municipio: m, entidade: 'movimentacao', acao: 'carga_inicial', detalhe: `${rows.length} imóveis na fila de transmissão`, usuario: nomeUsuario(req) });
    return rows.length;
  });
  res.json({ ok: true, enfileirados: n });
}));

// Completa/corrige os dados de uma movimentacao antes de validar.
cibRouter.put('/api/cib/movimentacoes/:id', asyncRoute(async (req, res) => {
  const dados = normalizarCampos(req.body?.dadosDepois || {});
  const { rows } = await query(
    `UPDATE cib_movimentacoes SET dados_depois = dados_depois || $2::jsonb, documento_ref = COALESCE($3, documento_ref),
       descricao = COALESCE($4, descricao), remessa_id = CASE WHEN status = 'rejeitada' THEN NULL ELSE remessa_id END,
       status = CASE WHEN status = 'rejeitada' THEN 'capturada' ELSE status END, updated_at = NOW()
     WHERE id = $1 AND ((status = 'capturada' AND remessa_id IS NULL) OR status = 'rejeitada') RETURNING *`,
    [req.params.id, JSON.stringify(dados), req.body?.documentoRef ?? null, req.body?.descricao ?? null]
  );
  if (!rows[0]) throw erro(409, 'Só é possível editar movimentação capturada (ainda não transmitida).');
  await auditar(null, { municipio: rows[0].municipio, entidade: 'movimentacao', entidadeId: rows[0].id, acao: 'editar', detalhe: Object.keys(dados).join(', '), usuario: nomeUsuario(req) });
  res.json(mapMov(rows[0]));
}));

cibRouter.post('/api/cib/movimentacoes/:id/validar', asyncRoute(async (req, res) => {
  const out = await withTransaction((db) => validarMovimentacao(db, Number(req.params.id), nomeUsuario(req)));
  res.status(out.ok ? 200 : 422).json({ ok: out.ok, erros: out.erros, movimentacao: mapMov(out.mov) });
}));

cibRouter.post('/api/cib/movimentacoes/validar-lote', asyncRoute(async (req, res) => {
  const m = muniDe(req);
  const ids = (await query(`SELECT id FROM cib_movimentacoes WHERE municipio = $1 AND status = 'capturada' ORDER BY id`, [m])).rows.map((r) => r.id);
  let ok = 0, falhas = 0;
  for (const id of ids) {
    try {
      const r = await withTransaction((db) => validarMovimentacao(db, id, nomeUsuario(req)));
      if (r.ok) ok += 1; else falhas += 1;
    } catch { falhas += 1; }
  }
  res.json({ ok: true, validadas: ok, comErros: falhas });
}));

cibRouter.post('/api/cib/movimentacoes/:id/descartar', asyncRoute(async (req, res) => {
  const { rows } = await query(
    `UPDATE cib_movimentacoes SET status = 'descartada', retorno_msg = $2, updated_at = NOW()
     WHERE id = $1 AND status IN ('capturada','rejeitada') RETURNING *`, [req.params.id, String(req.body?.motivo || 'Descartada pela equipe').slice(0, 500)]
  );
  if (!rows[0]) throw erro(409, 'Só é possível descartar movimentação capturada ou rejeitada.');
  if (rows[0].imovel_id) await recalcularStatus(null, { ids: [rows[0].imovel_id] });
  await auditar(null, { municipio: rows[0].municipio, entidade: 'movimentacao', entidadeId: rows[0].id, acao: 'descartar', detalhe: rows[0].retorno_msg, usuario: nomeUsuario(req) });
  res.json(mapMov(rows[0]));
}));

// Atribuicao manual de CIB (ex.: consulta no portal do Sinter).
cibRouter.patch('/api/cib/imoveis/:id/cib', gestor, asyncRoute(async (req, res) => {
  const cib = String(req.body?.cib || '').trim().toUpperCase().slice(0, 20);
  const { rows } = await query(
    `UPDATE imoveis SET cib = $2, cib_simulado = FALSE, cib_atribuido_em = CASE WHEN $2 = '' THEN NULL ELSE COALESCE(cib_atribuido_em, NOW()) END, transmitido = (transmitido OR $2 <> ''), updated_at = NOW()
     WHERE id = $1 RETURNING municipio, inscricao`, [req.params.id, cib]
  );
  if (!rows[0]) throw erro(404, 'Imóvel não encontrado.');
  await recalcularStatus(null, { ids: [Number(req.params.id)] });
  await auditar(null, { municipio: rows[0].municipio, entidade: 'imovel', entidadeId: Number(req.params.id), acao: 'cib', detalhe: `CIB ${cib || '(removido)'} para ${rows[0].inscricao}`, usuario: nomeUsuario(req) });
  res.json(await getImovelCompleto(req.params.id));
}));

// -- vistorias (deteccao)
cibRouter.post('/api/cib/vistorias/detectar', asyncRoute(async (req, res) => {
  const m = muniDe(req);
  const r = await detectarDiferencas(m, { minArea: Number(req.body?.minArea) || 20, tolerancia: Number(req.body?.tolerancia) || 0.15 });
  await auditar(null, { municipio: m, entidade: 'vistoria', acao: 'detectar', detalhe: `${r.analisados} lotes analisados · ${r.novas} novas diferenças`, usuario: nomeUsuario(req) });
  res.json(r);
}));
cibRouter.get('/api/cib/vistorias', asyncRoute(async (req, res) => {
  const params = [muniDe(req)];
  let w = 'municipio = $1';
  if (req.query.status) { params.push(String(req.query.status).split(',')); w += ` AND status = ANY($${params.length}::text[])`; }
  const { rows } = await query(`SELECT * FROM cib_vistorias WHERE ${w} ORDER BY status IN ('pendente','agendada') DESC, created_at DESC LIMIT 1000`, params);
  res.json(rows);
}));
cibRouter.patch('/api/cib/vistorias/:id', asyncRoute(async (req, res) => {
  const acao = String(req.body?.acao || '');
  if (!['agendar', 'confirmar', 'descartar', 'reabrir'].includes(acao)) throw erro(400, 'Ação inválida.');
  const out = await withTransaction(async (db) => {
    const v = (await db.query('SELECT * FROM cib_vistorias WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!v) throw erro(404, 'Vistoria não encontrada.');
    const obs = String(req.body?.obs || '').slice(0, 1000);
    const rotulo = { edificacao_nova: 'edificação nova', ampliacao: 'ampliação', demolicao: 'possível demolição' }[v.tipo];
    if (acao === 'agendar') {
      let demandaId = v.demanda_id;
      try {
        const d = await db.query(
          `INSERT INTO demandas (titulo, descricao, municipio, lote_codigo, lote_bairro, equipe, prioridade, status, prazo, criado_por_nome)
           VALUES ($1,$2,$3,$4,$5,'CTM','media','pendente',$6,$7) RETURNING id`,
          [`Vistoria: ${rotulo} — lote ${v.lote_codigo}`, `Detectado no cruzamento ortofoto × cadastro: área edificada ${v.area_detectada_m2} m², cadastrada ${v.area_cadastrada_m2} m². Conferir em campo antes de qualquer lançamento.${obs ? '\n' + obs : ''}`,
            v.municipio, v.lote_codigo, v.bairro, req.body?.prazo || null, nomeUsuario(req)]
        );
        demandaId = d.rows[0].id;
      } catch (e) { console.error('[cib] demanda de vistoria:', e.message); }
      await db.query(`UPDATE cib_vistorias SET status = 'agendada', demanda_id = $2, obs = $3 WHERE id = $1`, [v.id, demandaId, obs || v.obs]);
    } else if (acao === 'confirmar') {
      let movId = null;
      const area = Number(req.body?.areaConstruida) || v.area_detectada_m2;
      if (v.tipo === 'demolicao' && v.imovel_id) {
        const mov = await capturarMovimentacao(db, { municipio: v.municipio, imovelId: v.imovel_id, tipo: 'alteracao', origem: 'ia_vistoria',
          descricao: `Vistoria confirmou demolição no lote ${v.lote_codigo}`, dadosDepois: { area_construida_m2: 0, tipo: 'territorial' }, usuario: nomeUsuario(req) });
        movId = mov.id;
      } else if (v.imovel_id) {
        const mov = await capturarMovimentacao(db, { municipio: v.municipio, imovelId: v.imovel_id, tipo: 'alteracao', origem: 'ia_vistoria',
          descricao: `Vistoria confirmou ${rotulo} no lote ${v.lote_codigo}`, dadosDepois: { area_construida_m2: area, tipo: 'predial' }, usuario: nomeUsuario(req) });
        movId = mov.id;
      } else {
        const insc = String(req.body?.inscricao || v.lote_codigo).trim();
        const mov = await capturarMovimentacao(db, { municipio: v.municipio, tipo: 'inclusao', origem: 'ia_vistoria', inscricao: insc,
          descricao: `Edificação nova confirmada em vistoria (lote ${v.lote_codigo})`,
          dadosDepois: { inscricao: insc, lote_codigo: v.lote_codigo, bairro: v.bairro, tipo: 'predial', area_construida_m2: area }, usuario: nomeUsuario(req) });
        movId = mov.id;
      }
      await db.query(`UPDATE cib_vistorias SET status = 'confirmada', movimentacao_id = $2, obs = $3, resolvido_por_nome = $4, resolvido_em = NOW() WHERE id = $1`,
        [v.id, movId, obs || v.obs, nomeUsuario(req)]);
    } else if (acao === 'descartar') {
      await db.query(`UPDATE cib_vistorias SET status = 'descartada', obs = $2, resolvido_por_nome = $3, resolvido_em = NOW() WHERE id = $1`, [v.id, obs || 'Falso positivo', nomeUsuario(req)]);
    } else {
      await db.query(`UPDATE cib_vistorias SET status = 'pendente', resolvido_em = NULL WHERE id = $1`, [v.id]);
    }
    await auditar(db, { municipio: v.municipio, entidade: 'vistoria', entidadeId: v.id, acao, detalhe: `${rotulo} · lote ${v.lote_codigo}`, usuario: nomeUsuario(req) });
    return (await db.query('SELECT * FROM cib_vistorias WHERE id = $1', [v.id])).rows[0];
  });
  res.json(out);
}));

// -- auditoria
cibRouter.get('/api/cib/auditoria', asyncRoute(async (req, res) => {
  const params = [muniDe(req)];
  let w = 'municipio = $1';
  if (req.query.entidade) { params.push(String(req.query.entidade)); w += ` AND entidade = $${params.length}`; }
  if (req.query.entidadeId) { params.push(Number(req.query.entidadeId)); w += ` AND entidade_id = $${params.length}`; }
  const { rows } = await query(`SELECT * FROM cib_auditoria WHERE ${w} ORDER BY created_at DESC, id DESC LIMIT ${Math.min(1000, Number(req.query.limit) || 200)}`, params);
  res.json(rows);
}));

// ---- integracao com o BCI ---------------------------------------------------
/**
 * Chamado quando um BCI e aprovado: a coleta de campo vira uma movimentacao
 * capturada (alteracao, se a inscricao existe; inclusao, se nao).
 */
export async function capturarDeBci(bci, usuario = '') {
  if (!isConfigured || !bci?.inscricao) return null;
  try {
    const municipio = bci.municipio || '';
    const d = bci.dados || {};
    const dados = normalizarCampos({
      area_terreno_m2: bci.area_terreno_m2, area_construida_m2: bci.area_construida_m2, uso: bci.uso || undefined,
      bairro: bci.bairro || undefined, logradouro: d.nome_logradouro || undefined, numero: d.numero || d.num_predial || undefined,
      tipo: /territorial/i.test(d.tipo_imovel || bci.uso || '') ? 'territorial' : (bci.area_construida_m2 > 0 ? 'predial' : undefined),
      n_pavimentos: d.num_pavimentos || undefined,
    });
    for (const k of Object.keys(dados)) if (dados[k] === '' || dados[k] == null) delete dados[k];
    const existe = (await query('SELECT id FROM imoveis WHERE municipio = $1 AND inscricao = $2', [municipio, bci.inscricao])).rows[0];
    return await withTransaction((db) => capturarMovimentacao(db, {
      municipio, imovelId: existe?.id, inscricao: bci.inscricao, tipo: existe ? 'alteracao' : 'inclusao', origem: 'bci',
      documentoRef: `BCI #${bci.id}`, descricao: 'Coleta de campo (BCI) aprovada', dadosDepois: dados, usuario,
    }));
  } catch (e) { console.error('[cib] captura do BCI:', e.message); return null; }
}
