// Modulo Documentos e Atendimento — protocolo de requerimentos do cidadao,
// emissao de certidoes/declaracoes/notificacoes/oficios/relatorios com
// numeracao oficial, codigo de validacao (QR) e hash de integridade, e as
// paginas publicas de validacao e de consulta de protocolo.
import { Router } from 'express';
import crypto from 'crypto';
import { query, withTransaction, isConfigured } from './db.js';
import { requireAuth, requireRole, AUTH_ENABLED } from './auth.js';
import { validarAnexos, salvarAnexos, listarAnexos, enviarAnexo } from './anexos.js';
import { TIPOS_DOC, catalogoPublico, renderDocumento, renderComprovante } from './doc-templates.js';
import { getConfig, getImovelCompleto, buscarImovelPorInscricao, relatorioMensal, diagnostico, capturarMovimentacao, auditar } from './cib.js';
import { mascararDoc, isoData, jcs, normalizarNi, niValido } from './cib-validacao.js';
import { proximoNumero } from './numeradores.js';
import { registrarAcesso, PERFIS_DADOS_PESSOAIS } from './lgpd.js';
import { muniDe as muniDaInstancia } from './util.js';
import { limitar, excedeu, contarFalha } from './ratelimit.js';
import { PRODUCAO } from './env.js';

// Tipos de requerimento e o que o deferimento dispara.
export const TIPOS_REQ = {
  certidao: { label: 'Emissão de certidão/declaração', prazoDias: 10 },
  revisao_cadastral: { label: 'Revisão / atualização cadastral', prazoDias: 30, movimentacao: 'alteracao' },
  inclusao_imovel: { label: 'Inclusão de imóvel no cadastro', prazoDias: 30, movimentacao: 'inclusao' },
  transferencia: { label: 'Transferência de titularidade (ITBI)', prazoDias: 15, movimentacao: 'alteracao', origem: 'itbi' },
  parcelamento: { label: 'Desmembramento / remembramento', prazoDias: 45 },
  baixa: { label: 'Baixa de inscrição (demolição/unificação)', prazoDias: 30, movimentacao: 'baixa' },
  reativacao: { label: 'Reativação de inscrição', prazoDias: 30, movimentacao: 'reativacao' },
  numeracao_predial: { label: 'Numeração predial', prazoDias: 15, documento: 'certidao_numeracao' },
  vistoria: { label: 'Solicitação de vistoria', prazoDias: 20, demanda: true },
  outro: { label: 'Outro assunto', prazoDias: 30 },
};
export const STATUS_REQ = ['protocolado', 'em_analise', 'pendente_documentacao', 'deferido', 'indeferido', 'concluido', 'arquivado'];
const ABERTOS = ['protocolado', 'em_analise', 'pendente_documentacao'];

const muniDe = muniDaInstancia; // travado por instância quando MUNICIPIO está definido
const nomeUsuario = (req) => String(req.user?.nome || req.body?.usuarioNome || 'Equipe').slice(0, 80);
const erro = (status, msg) => Object.assign(new Error(msg), { status });
const asyncRoute = (fn) => (req, res) => {
  if (!isConfigured) return res.status(503).json({ error: 'Banco não configurado. Defina DATABASE_URL.' });
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[docs]', req.method, req.path, err.message);
    res.status(err.status || 500).json({ error: err.message });
  });
};
const origemDe = (req) => process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

export async function ensureDocumentosSchema() {
  if (!isConfigured) return false;
  await query(`
    CREATE TABLE IF NOT EXISTS requerimentos (
      id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      municipio           TEXT NOT NULL DEFAULT '',
      numero              TEXT NOT NULL,
      tipo                TEXT NOT NULL,
      documento_tipo      TEXT NOT NULL DEFAULT '',
      requerente_nome     TEXT NOT NULL,
      requerente_doc      TEXT NOT NULL DEFAULT '',
      requerente_email    TEXT NOT NULL DEFAULT '',
      requerente_telefone TEXT NOT NULL DEFAULT '',
      imovel_id           BIGINT REFERENCES imoveis(id) ON DELETE SET NULL,
      inscricao           TEXT NOT NULL DEFAULT '',
      descricao           TEXT NOT NULL DEFAULT '',
      dados               JSONB NOT NULL DEFAULT '{}'::jsonb,
      status              TEXT NOT NULL DEFAULT 'protocolado',
      prazo               DATE,
      responsavel_nome    TEXT NOT NULL DEFAULT '',
      parecer             TEXT NOT NULL DEFAULT '',
      documento_id        BIGINT,
      movimentacao_id     BIGINT,
      demanda_id          BIGINT,
      historico           JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_req_numero ON requerimentos (municipio, numero)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_req_status ON requerimentos (municipio, status)`);
  await query(`
    CREATE TABLE IF NOT EXISTS documentos (
      id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      municipio           TEXT NOT NULL DEFAULT '',
      tipo                TEXT NOT NULL,
      numero              TEXT NOT NULL,
      seq                 INTEGER NOT NULL,
      ano                 INTEGER NOT NULL,
      titulo              TEXT NOT NULL,
      imovel_id           BIGINT REFERENCES imoveis(id) ON DELETE SET NULL,
      inscricao           TEXT NOT NULL DEFAULT '',
      requerimento_id     BIGINT REFERENCES requerimentos(id) ON DELETE SET NULL,
      interessado         TEXT NOT NULL DEFAULT '',
      conteudo            JSONB NOT NULL DEFAULT '{}'::jsonb,
      hash_conteudo       TEXT NOT NULL DEFAULT '',
      codigo_validacao    TEXT NOT NULL UNIQUE,
      emitido_por_nome    TEXT NOT NULL DEFAULT '',
      emitido_em          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      validade            DATE,
      status              TEXT NOT NULL DEFAULT 'valido',
      motivo_cancelamento TEXT NOT NULL DEFAULT '',
      cancelado_em        TIMESTAMPTZ
    )`);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_numero ON documentos (municipio, tipo, ano, seq)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_doc_muni ON documentos (municipio, emitido_em DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_doc_imovel ON documentos (imovel_id)`);
  return true;
}

// ---- emissao ---------------------------------------------------------------
function gerarCodigo() {
  const alfa = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += alfa[b[i] % alfa.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/**
 * Emite um documento: valida pre-requisitos do modelo, congela o conteudo,
 * numera (sequencial por tipo/ano/municipio) e gera codigo + hash.
 */
export async function emitirDocumento({ municipio, tipo, imovelId, inscricao, campos = {}, interessado = '', requerimentoId = null, usuario = '', canal = 'interno', solicitanteDoc = '' }) {
  const t = TIPOS_DOC[tipo];
  if (!t) throw erro(400, 'Tipo de documento inválido.');
  const cfg = await getConfig(municipio);
  let imovel = null;
  if (imovelId) imovel = await getImovelCompleto(imovelId, { incluirDoc: true });
  else if (inscricao) imovel = await buscarImovelPorInscricao(municipio, inscricao, { incluirDoc: true });
  if ((imovelId || inscricao) && !imovel) throw erro(404, 'Imóvel não encontrado no cadastro deste município.');
  if (imovel && imovel.municipio !== municipio) throw erro(400, 'O imóvel pertence a outro município.');
  const base = await t.preparar({ municipio, cfg, imovel, campos, relatorioMensal, diagnostico });
  const { brasao, ...cfgSnap } = cfg;
  const conteudo = { ...base, cfg: cfgSnap, interessado: interessado || imovel?.contribuinteNome || '', emissor: { nome: usuario, responsavelNome: cfg.responsavelNome } };
  // Integridade: SHA-256 sobre o JCS (RFC 8785) do conteúdo exatamente como o JSONB guarda.
  const conteudoDb = JSON.parse(JSON.stringify(conteudo));
  const hash = crypto.createHash('sha256').update(jcs(conteudoDb), 'utf8').digest('hex');
  const ano = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric' }).format(new Date()));
  const validade = t.validade ? new Date(Date.now() + (cfg.validadeCertidaoDias || 90) * 86400000).toISOString().slice(0, 10) : null;
  const titulo = base.tituloLivre || t.titulo;
  return withTransaction(async (db) => {
    const seq = await proximoNumero(db, 'documento', `${municipio}|${tipo}`, ano);
    const numero = `${String(seq).padStart(4, '0')}/${ano}`;
    let codigo = gerarCodigo();
    for (let i = 0; i < 3; i++) {
      const ja = await db.query('SELECT 1 FROM documentos WHERE codigo_validacao = $1', [codigo]);
      if (!ja.rows.length) break;
      codigo = gerarCodigo();
    }
    const { rows } = await db.query(
      `INSERT INTO documentos (municipio, tipo, numero, seq, ano, titulo, imovel_id, inscricao, requerimento_id, interessado, conteudo, hash_conteudo,
         codigo_validacao, emitido_por_nome, validade, hash_alg, canal, solicitante_doc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,'sha256/jcs-rfc8785',$16,$17) RETURNING *`,
      [municipio, tipo, numero, seq, ano, titulo, imovel?.id || null, imovel?.inscricao || '', requerimentoId, conteudo.interessado,
        JSON.stringify(conteudo), hash, codigo, usuario, validade, canal, normalizarNi(solicitanteDoc)]
    );
    await auditar(db, { municipio, entidade: 'documento', entidadeId: rows[0].id, acao: 'emitir', detalhe: `${titulo} nº ${numero}${imovel ? ' · ' + imovel.inscricao : ''} · ${codigo}${canal === 'portal' ? ' · pelo Portal do Cidadão' : ''}`, usuario });
    return rows[0];
  });
}

function mapDoc(d) {
  return {
    id: d.id, municipio: d.municipio, tipo: d.tipo, numero: d.numero, titulo: d.titulo, imovelId: d.imovel_id, inscricao: d.inscricao,
    requerimentoId: d.requerimento_id, interessado: d.interessado, codigoValidacao: d.codigo_validacao, emitidoPorNome: d.emitido_por_nome,
    emitidoEm: d.emitido_em, validade: isoData(d.validade), status: d.status, motivoCancelamento: d.motivo_cancelamento, canceladoEm: d.cancelado_em,
    canal: d.canal || 'interno',
  };
}
function mapReq(r) {
  return {
    id: r.id, municipio: r.municipio, numero: r.numero, tipo: r.tipo, tipoLabel: TIPOS_REQ[r.tipo]?.label || r.tipo, documentoTipo: r.documento_tipo,
    requerenteNome: r.requerente_nome, requerenteDocMascarado: mascararDoc(r.requerente_doc),
    requerenteEmail: r.requerente_email, requerenteTelefone: r.requerente_telefone, imovelId: r.imovel_id, inscricao: r.inscricao,
    descricao: r.descricao, dados: r.dados, status: r.status, prazo: isoData(r.prazo), responsavelNome: r.responsavel_nome, parecer: r.parecer,
    documentoId: r.documento_id, movimentacaoId: r.movimentacao_id, demandaId: r.demanda_id, historico: r.historico || [],
    atrasado: Boolean(r.prazo && ABERTOS.includes(r.status) && isoData(r.prazo) < isoData(new Date())),
    criadoEm: r.created_at, atualizadoEm: r.updated_at, canal: r.canal || 'balcao', qtdAnexos: r.qtd_anexos ?? null,
  };
}
export { mapDoc, mapReq, ABERTOS };

/**
 * Protocola um requerimento (balcão ou Portal do Cidadão): numeração
 * transacional, prazo pelo assunto, anexos e auditoria na mesma transação.
 */
export async function protocolarRequerimento({ municipio, tipo, documentoTipo = '', requerenteNome, requerenteDoc, requerenteEmail = '', requerenteTelefone = '',
  inscricao = '', imovelId = null, descricao = '', dados = {}, prazo = null, responsavelNome = '', usuario = '', canal = 'balcao', anexos = [] }) {
  const t = TIPOS_REQ[tipo];
  if (!t) throw erro(400, 'Tipo de requerimento inválido.');
  if (!String(requerenteNome || '').trim()) throw erro(400, 'Informe o nome do requerente.');
  const doc = normalizarNi(requerenteDoc);
  if (!niValido(doc)) throw erro(400, 'Informe um CPF/CNPJ válido do requerente (CNPJ alfanumérico aceito).');
  if (tipo === 'certidao' && !TIPOS_DOC[documentoTipo]) throw erro(400, 'Escolha qual certidão/declaração está sendo requerida.');
  inscricao = String(inscricao || '').trim();
  if (!imovelId && inscricao) {
    const im = (await query('SELECT id FROM imoveis WHERE municipio = $1 AND inscricao = $2', [municipio, inscricao])).rows[0];
    imovelId = im?.id || null;
    if (!imovelId && !['inclusao_imovel', 'outro', 'vistoria'].includes(tipo)) throw erro(404, `Inscrição ${inscricao} não encontrada no cadastro.`);
  }
  const prazoFinal = prazo || new Date(Date.now() + t.prazoDias * 86400000).toISOString().slice(0, 10);
  return withTransaction(async (db) => {
    const ano = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric' }).format(new Date()));
    const n = await proximoNumero(db, 'protocolo', municipio, ano);
    const numero = `${ano}/${String(n).padStart(5, '0')}`;
    const { rows } = await db.query(
      `INSERT INTO requerimentos (municipio, numero, tipo, documento_tipo, requerente_nome, requerente_doc, requerente_email, requerente_telefone,
         imovel_id, inscricao, descricao, dados, prazo, responsavel_nome, historico, canal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb,$16) RETURNING *`,
      [municipio, numero, tipo, tipo === 'certidao' ? documentoTipo : (t.documento || ''), String(requerenteNome).trim().slice(0, 160), doc,
        String(requerenteEmail || '').slice(0, 160), String(requerenteTelefone || '').slice(0, 40), imovelId, inscricao,
        String(descricao || '').slice(0, 4000), JSON.stringify(dados || {}), prazoFinal, String(responsavelNome || '').slice(0, 80),
        JSON.stringify([{ em: new Date().toISOString(), status: 'protocolado', por: usuario, obs: canal === 'portal' ? 'Protocolado pelo Portal do Cidadão' : 'Requerimento protocolado' }]), canal]
    );
    const salvos = await salvarAnexos(db, rows[0].id, anexos, { por: canal === 'portal' ? `${rows[0].requerente_nome} (portal)` : usuario, canal });
    await auditar(db, { municipio, entidade: 'requerimento', entidadeId: rows[0].id, acao: 'protocolar',
      detalhe: `${numero} · ${t.label} · ${rows[0].requerente_nome}${canal === 'portal' ? ' · Portal do Cidadão' : ''}${salvos.length ? ` · ${salvos.length} anexo(s)` : ''}`, usuario });
    return { ...rows[0], qtd_anexos: salvos.length };
  });
}

async function carregarDoc(id) {
  const { rows } = await query(
    `SELECT d.*, r.numero AS requerimento_numero FROM documentos d LEFT JOIN requerimentos r ON r.id = d.requerimento_id WHERE d.id = $1`, [id]
  );
  return rows[0] || null;
}

// ===========================================================================
export const documentosRouter = Router();
const gestor = requireRole('admin', 'coordenador');

// ---- publico (sem login) ---------------------------------------------------
const limitePublico = limitar({ nome: 'publico', janelaMs: 60000, max: 30 });
documentosRouter.get('/api/publico/validar/:codigo', limitePublico, asyncRoute(async (req, res) => {
  const codigo = String(req.params.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const fmt = codigo.length === 12 ? `${codigo.slice(0, 4)}-${codigo.slice(4, 8)}-${codigo.slice(8)}` : codigo;
  const { rows } = await query('SELECT * FROM documentos WHERE codigo_validacao = $1', [fmt]);
  const d = rows[0];
  if (!d) return res.status(404).json({ valido: false, error: 'Nenhum documento encontrado com este código.' });
  const integro = crypto.createHash('sha256').update(jcs(d.conteudo), 'utf8').digest('hex') === d.hash_conteudo;
  const vencido = d.validade && new Date(isoData(d.validade) + 'T23:59:59-03:00') < new Date();
  const cfg = await getConfig(d.municipio);
  res.json({
    valido: d.status === 'valido' && integro && !vencido, status: d.status, integro, vencido: Boolean(vencido),
    titulo: d.titulo, numero: d.numero, emitidoEm: d.emitido_em, validade: isoData(d.validade), orgao: cfg.nomeOficial,
    inscricao: d.inscricao, interessado: d.interessado ? d.interessado.replace(/(\S)\S+(?=\s)/g, '$1.') : '',
    motivoCancelamento: d.status === 'cancelado' ? d.motivo_cancelamento : '', codigo: d.codigo_validacao,
  });
}));
// Versao publica do documento (CPF/CNPJ mascarado — LGPD).
documentosRouter.get('/api/publico/documento/:codigo', limitePublico, asyncRoute(async (req, res) => {
  const { rows } = await query(`SELECT d.*, r.numero AS requerimento_numero FROM documentos d LEFT JOIN requerimentos r ON r.id = d.requerimento_id
    WHERE d.codigo_validacao = $1`, [String(req.params.codigo || '').toUpperCase()]);
  if (!rows[0]) return res.status(404).send('Documento não encontrado.');
  const cfg = await getConfig(rows[0].municipio);
  res.type('html').send(renderDocumento(rows[0], { cfg, origem: origemDe(req), mascarar: true }));
}));
// Consulta de andamento de protocolo (numero + CPF/CNPJ do requerente).
// Anti-enumeração: 10 consultas/15 min por IP; 5 falhas/hora por IP; 5 falhas/hora por protocolo (qualquer IP).
const JANELA_FALHAS = 3600000;
documentosRouter.get('/api/publico/protocolo', limitar({ nome: 'protocolo', janelaMs: 15 * 60000, max: 10 }), asyncRoute(async (req, res) => {
  const numero = String(req.query.numero || '').trim().slice(0, 20);
  const doc = normalizarNi(req.query.doc);
  if (!/^\d{4}\/\d{1,6}$/.test(numero) || !niValido(doc)) throw erro(400, 'Informe o número do protocolo (AAAA/NNNNN) e um CPF/CNPJ válido.');
  const chaveIp = `protfalha-ip:${req.ip}`, chaveNum = `protfalha-num:${numero}`;
  const espera = Math.max(excedeu(chaveIp, { janelaMs: JANELA_FALHAS, max: 5 }), excedeu(chaveNum, { janelaMs: JANELA_FALHAS, max: 5 }));
  if (espera) { res.set('Retry-After', String(espera)); throw erro(429, 'Muitas tentativas sem sucesso. Aguarde e tente novamente.'); }
  const { rows } = await query('SELECT * FROM requerimentos WHERE numero = $1 AND requerente_doc = $2 AND municipio = $3', [numero, doc, muniDe(req)]);
  const r = rows[0];
  if (!r) {
    contarFalha(chaveIp, JANELA_FALHAS); contarFalha(chaveNum, JANELA_FALHAS);
    throw erro(404, 'Não encontramos protocolo com esses dados.');
  }
  let documento = null;
  if (r.documento_id) {
    const d = (await query('SELECT titulo, numero, codigo_validacao, status FROM documentos WHERE id = $1', [r.documento_id])).rows[0];
    if (d && d.status === 'valido') documento = { titulo: d.titulo, numero: d.numero, codigo: d.codigo_validacao };
  }
  res.json({
    numero: r.numero, assunto: TIPOS_REQ[r.tipo]?.label || r.tipo, status: r.status, prazo: isoData(r.prazo), criadoEm: r.created_at,
    atualizadoEm: r.updated_at, parecer: ['deferido', 'indeferido', 'concluido'].includes(r.status) ? r.parecer : '',
    historico: (r.historico || []).map((h) => ({ em: h.em, status: h.status })), documento,
  });
}));

// ---- interno ----------------------------------------------------------------
documentosRouter.use(['/api/documentos', '/api/requerimentos'], requireAuth);

documentosRouter.get('/api/documentos/catalogo', (req, res) => res.json({ documentos: catalogoPublico(), requerimentos: Object.entries(TIPOS_REQ).map(([id, t]) => ({ id, ...t })) }));

documentosRouter.get('/api/documentos', asyncRoute(async (req, res) => {
  const where = ['municipio = $1'], params = [muniDe(req)];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('$?', '$' + params.length)); };
  if (req.query.tipo) add('tipo = $?', String(req.query.tipo));
  if (req.query.status) add('status = $?', String(req.query.status));
  if (req.query.imovel) add('imovel_id = $?', Number(req.query.imovel));
  if (req.query.q) {
    params.push('%' + String(req.query.q).replace(/[%_]/g, '') + '%');
    const p = '$' + params.length;
    where.push(`(numero ILIKE ${p} OR inscricao ILIKE ${p} OR interessado ILIKE ${p} OR codigo_validacao ILIKE ${p})`);
  }
  const { rows } = await query(`SELECT * FROM documentos WHERE ${where.join(' AND ')} ORDER BY emitido_em DESC, id DESC LIMIT 300`, params);
  res.json(rows.map(mapDoc));
}));

documentosRouter.post('/api/documentos', gestor, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const d = await emitirDocumento({ municipio: muniDe(req), tipo: b.tipo, imovelId: b.imovelId, inscricao: b.inscricao, campos: b.campos || {},
    interessado: b.interessado, requerimentoId: b.requerimentoId || null, usuario: nomeUsuario(req) });
  res.json(mapDoc(d));
}));

documentosRouter.get('/api/documentos/:id/html', asyncRoute(async (req, res) => {
  const d = await carregarDoc(req.params.id);
  if (!d || d.municipio !== muniDe(req)) throw erro(404, 'Documento não encontrado.');
  const cfg = await getConfig(d.municipio);
  // Perfil sem acesso a dado pessoal (gestor) vê a versão mascarada; os demais acessos ficam registrados.
  const mascarar = Boolean(req.user?.role && req.user.role !== 'anon' && !PERFIS_DADOS_PESSOAIS.includes(req.user.role));
  if (!mascarar) await registrarAcesso(req, { municipio: d.municipio, entidade: 'documento', entidadeId: d.id, dado: 'documento com CPF/CNPJ', finalidade: 'visualização/impressão' });
  res.type('html').send(renderDocumento(d, { cfg, origem: origemDe(req), barra: req.query.barra !== '0', mascarar }));
}));

documentosRouter.post('/api/documentos/:id/cancelar', gestor, asyncRoute(async (req, res) => {
  const motivo = String(req.body?.motivo || '').trim();
  if (motivo.length < 5) throw erro(400, 'Informe o motivo do cancelamento.');
  const { rows } = await query(
    `UPDATE documentos SET status = 'cancelado', motivo_cancelamento = $2, cancelado_em = NOW() WHERE id = $1 AND status = 'valido' RETURNING *`,
    [req.params.id, motivo.slice(0, 500)]
  );
  if (!rows[0]) throw erro(409, 'Documento não encontrado ou já cancelado.');
  await auditar(null, { municipio: rows[0].municipio, entidade: 'documento', entidadeId: rows[0].id, acao: 'cancelar', detalhe: `${rows[0].titulo} nº ${rows[0].numero}: ${motivo}`, usuario: nomeUsuario(req) });
  res.json(mapDoc(rows[0]));
}));

// ---- requerimentos (protocolo) ---------------------------------------------
documentosRouter.get('/api/requerimentos', asyncRoute(async (req, res) => {
  const where = ['municipio = $1'], params = [muniDe(req)];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('$?', '$' + params.length)); };
  if (req.query.status === 'abertos') add('status = ANY($?::text[])', ABERTOS);
  else if (req.query.status) add('status = $?', String(req.query.status));
  if (req.query.tipo) add('tipo = $?', String(req.query.tipo));
  if (req.query.q) {
    params.push('%' + String(req.query.q).replace(/[%_]/g, '') + '%');
    const p = '$' + params.length;
    where.push(`(numero ILIKE ${p} OR requerente_nome ILIKE ${p} OR inscricao ILIKE ${p})`);
  }
  const { rows } = await query(`SELECT *, (SELECT count(*) FROM requerimento_anexos a WHERE a.requerimento_id = requerimentos.id)::int AS qtd_anexos
    FROM requerimentos WHERE ${where.join(' AND ')} ORDER BY (status = ANY('{protocolado,em_analise,pendente_documentacao}')) DESC, prazo NULLS LAST, id DESC LIMIT 500`, params);
  res.json(rows.map(mapReq));
}));

// LGPD: CPF/CNPJ completo do requerente só com finalidade, e o acesso fica registrado.
documentosRouter.post('/api/requerimentos/:id/revelar', asyncRoute(async (req, res) => {
  if (req.user?.role && req.user.role !== 'anon' && !PERFIS_DADOS_PESSOAIS.includes(req.user.role)) throw erro(403, 'Seu perfil não acessa dados pessoais completos.');
  const finalidade = String(req.body?.finalidade || '').trim();
  if (finalidade.length < 3) throw erro(400, 'Informe a finalidade do acesso ao dado pessoal.');
  const r = (await query('SELECT id, municipio, requerente_doc FROM requerimentos WHERE id = $1', [req.params.id])).rows[0];
  if (!r || r.municipio !== muniDe(req)) throw erro(404, 'Requerimento não encontrado.');
  await registrarAcesso(req, { municipio: r.municipio, entidade: 'requerimento', entidadeId: r.id, dado: 'CPF/CNPJ do requerente', finalidade });
  res.json({ requerenteDoc: r.requerente_doc });
}));

// Prévia do relatório mensal (sem número/validade) — para o gestor acompanhar sem emitir documento.
documentosRouter.get('/api/documentos/previa/relatorio-mensal', asyncRoute(async (req, res) => {
  const m = muniDe(req);
  const cfg = await getConfig(m);
  const t = TIPOS_DOC.relatorio_mensal;
  const base = await t.preparar({ municipio: m, cfg, imovel: null, campos: { competencia: req.query.competencia }, relatorioMensal, diagnostico });
  const { brasao, ...cfgSnap } = cfg;
  const doc = { tipo: 'relatorio_mensal', titulo: t.titulo, numero: 'PRÉVIA', status: 'previa', conteudo: { ...base, cfg: cfgSnap }, emitido_em: new Date(), emitido_por_nome: req.user?.nome || '', codigo_validacao: '' };
  res.type('html').send(renderDocumento(doc, { cfg, origem: origemDe(req), previa: true }));
}));

documentosRouter.get('/api/requerimentos/:id', asyncRoute(async (req, res) => {
  const r = (await query('SELECT * FROM requerimentos WHERE id = $1', [req.params.id])).rows[0];
  if (!r) throw erro(404, 'Requerimento não encontrado.');
  res.json(mapReq(r));
}));

documentosRouter.post('/api/requerimentos', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const r = await protocolarRequerimento({
    municipio: muniDe(req), tipo: b.tipo, documentoTipo: b.documentoTipo, requerenteNome: b.requerenteNome, requerenteDoc: b.requerenteDoc,
    requerenteEmail: b.requerenteEmail, requerenteTelefone: b.requerenteTelefone, inscricao: b.inscricao, descricao: b.descricao, dados: b.dados,
    prazo: b.prazo, responsavelNome: b.responsavelNome, usuario: nomeUsuario(req), canal: 'balcao', anexos: validarAnexos(b.anexos),
  });
  res.json(mapReq(r));
}));

// Anexos (documentos pessoais do requerente: o acesso fica no registro LGPD).
documentosRouter.get('/api/requerimentos/:id/anexos', asyncRoute(async (req, res) => {
  const r = (await query('SELECT id FROM requerimentos WHERE id = $1 AND municipio = $2', [req.params.id, muniDe(req)])).rows[0];
  if (!r) throw erro(404, 'Requerimento não encontrado.');
  res.json(await listarAnexos({ query }, r.id));
}));
documentosRouter.get('/api/requerimentos/:id/anexos/:aid', asyncRoute(async (req, res) => {
  if (AUTH_ENABLED && !PERFIS_DADOS_PESSOAIS.includes(req.user?.role)) throw erro(403, 'Anexos do requerente: perfil sem acesso a documentos pessoais.');
  const a = (await query(`SELECT a.*, r.municipio, r.numero FROM requerimento_anexos a JOIN requerimentos r ON r.id = a.requerimento_id
    WHERE a.id = $1 AND a.requerimento_id = $2 AND r.municipio = $3`, [req.params.aid, req.params.id, muniDe(req)])).rows[0];
  if (!a) throw erro(404, 'Anexo não encontrado.');
  await registrarAcesso(req, { municipio: a.municipio, entidade: 'requerimento', entidadeId: Number(req.params.id), dado: `anexo "${a.nome}" (protocolo ${a.numero})`, finalidade: 'análise do requerimento' });
  enviarAnexo(res, a);
}));
documentosRouter.post('/api/requerimentos/:id/anexos', asyncRoute(async (req, res) => {
  const r = (await query('SELECT id, municipio, numero FROM requerimentos WHERE id = $1 AND municipio = $2', [req.params.id, muniDe(req)])).rows[0];
  if (!r) throw erro(404, 'Requerimento não encontrado.');
  const arquivos = validarAnexos(req.body?.anexos);
  if (!arquivos.length) throw erro(400, 'Nenhum arquivo enviado.');
  const usuario = nomeUsuario(req);
  const salvos = await withTransaction(async (db) => {
    const s = await salvarAnexos(db, r.id, arquivos, { por: usuario, canal: 'balcao' });
    await auditar(db, { municipio: r.municipio, entidade: 'requerimento', entidadeId: r.id, acao: 'anexar', detalhe: `${r.numero}: ${s.map((x) => x.nome).join(', ')}`, usuario });
    return s;
  });
  res.json(salvos);
}));

// Tramitacao: analisar, pendenciar, deferir (dispara o efeito), indeferir, concluir, arquivar.
documentosRouter.post('/api/requerimentos/:id/tramitar', asyncRoute(async (req, res) => {
  const acao = String(req.body?.acao || '');
  const PARA = { analisar: 'em_analise', pendenciar: 'pendente_documentacao', deferir: 'deferido', indeferir: 'indeferido', concluir: 'concluido', arquivar: 'arquivado', reabrir: 'em_analise' };
  if (!PARA[acao]) throw erro(400, 'Ação inválida.');
  const usuario = nomeUsuario(req);
  const obs = String(req.body?.parecer || req.body?.obs || '').slice(0, 4000);
  const r = (await query('SELECT * FROM requerimentos WHERE id = $1', [req.params.id])).rows[0];
  if (!r) throw erro(404, 'Requerimento não encontrado.');
  if (['deferir', 'indeferir'].includes(acao) && !ABERTOS.includes(r.status)) throw erro(409, 'Requerimento já decidido.');
  if (acao === 'indeferir' && obs.length < 5) throw erro(400, 'Informe o parecer (motivo do indeferimento).');
  const t = TIPOS_REQ[r.tipo];
  let documentoId = r.documento_id, movimentacaoId = r.movimentacao_id, demandaId = r.demanda_id;
  let efeito = '';
  if (acao === 'deferir') {
    const docTipo = r.documento_tipo || t.documento;
    if (docTipo) {
      const d = await emitirDocumento({ municipio: r.municipio, tipo: docTipo, imovelId: r.imovel_id, campos: req.body?.campos || r.dados?.campos || {},
        interessado: r.requerente_nome, requerimentoId: r.id, usuario });
      documentoId = d.id; efeito = `Documento ${d.titulo} nº ${d.numero} emitido`;
    } else if (t.movimentacao) {
      const dados = req.body?.dadosDepois || r.dados?.dadosDepois || {};
      const mov = await withTransaction((db) => capturarMovimentacao(db, { municipio: r.municipio, imovelId: r.imovel_id, inscricao: r.inscricao, tipo: t.movimentacao,
        origem: t.origem || 'requerimento', documentoRef: `Protocolo ${r.numero}`, descricao: `${t.label} — ${obs || r.descricao}`.slice(0, 900), dadosDepois: dados, usuario }));
      movimentacaoId = mov.id; efeito = `Movimentação ${t.movimentacao} capturada para validação (ciclo mensal Sinter)`;
    } else if (t.demanda) {
      try {
        const d = await query(`INSERT INTO demandas (titulo, descricao, municipio, lote_codigo, equipe, prioridade, status, prazo, criado_por_nome)
          VALUES ($1,$2,$3,$4,'CTM','media','pendente',$5,$6) RETURNING id`,
          [`Vistoria — protocolo ${r.numero}`, `${r.descricao}\nRequerente: ${r.requerente_nome}`, r.municipio, r.inscricao, r.prazo, usuario]);
        demandaId = d.rows[0].id; efeito = 'Demanda de vistoria criada para a equipe de campo';
      } catch (e) { console.error('[docs] demanda:', e.message); }
    }
  }
  const hist = [...(r.historico || []), { em: new Date().toISOString(), status: PARA[acao], por: usuario, obs: [obs, efeito].filter(Boolean).join(' · ') }];
  const { rows } = await query(
    `UPDATE requerimentos SET status = $2, parecer = CASE WHEN $3 <> '' AND $4 THEN $3 ELSE parecer END, historico = $5::jsonb,
       documento_id = $6, movimentacao_id = $7, demanda_id = $8, responsavel_nome = COALESCE(NULLIF($9,''), responsavel_nome), updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [r.id, PARA[acao], obs, ['deferir', 'indeferir', 'pendenciar'].includes(acao), JSON.stringify(hist), documentoId, movimentacaoId, demandaId,
      String(req.body?.responsavelNome || '')]
  );
  await auditar(null, { municipio: r.municipio, entidade: 'requerimento', entidadeId: r.id, acao, detalhe: `${r.numero}: ${PARA[acao]}${efeito ? ' · ' + efeito : ''}`, usuario });
  res.json({ ...mapReq(rows[0]), efeito });
}));

documentosRouter.get('/api/requerimentos/:id/comprovante', asyncRoute(async (req, res) => {
  const r = (await query('SELECT * FROM requerimentos WHERE id = $1', [req.params.id])).rows[0];
  if (!r) throw erro(404, 'Requerimento não encontrado.');
  const cfg = await getConfig(r.municipio);
  res.type('html').send(renderComprovante({ ...r, tipo_label: TIPOS_REQ[r.tipo]?.label || r.tipo }, cfg, origemDe(req)));
}));
