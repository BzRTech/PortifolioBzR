// Modulo Documentos e Atendimento — protocolo de requerimentos do cidadao,
// emissao de certidoes/declaracoes/notificacoes/oficios/relatorios com
// numeracao oficial, codigo de validacao (QR) e hash de integridade, e as
// paginas publicas de validacao e de consulta de protocolo.
import { Router } from 'express';
import crypto from 'crypto';
import { query, withTransaction, isConfigured } from './db.js';
import { requireAuth, requireRole } from './auth.js';
import { TIPOS_DOC, catalogoPublico, renderDocumento, renderComprovante } from './doc-templates.js';
import { getConfig, getImovelCompleto, buscarImovelPorInscricao, relatorioMensal, diagnostico, capturarMovimentacao, auditar } from './cib.js';
import { soDigitos, mascararDoc, isoData, jsonCanonico } from './cib-validacao.js';

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

const muniDe = (req) => String(req.query?.municipio ?? req.body?.municipio ?? '').trim();
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
export async function emitirDocumento({ municipio, tipo, imovelId, inscricao, campos = {}, interessado = '', requerimentoId = null, usuario = '' }) {
  const t = TIPOS_DOC[tipo];
  if (!t) throw erro(400, 'Tipo de documento inválido.');
  const cfg = await getConfig(municipio);
  let imovel = null;
  if (imovelId) imovel = await getImovelCompleto(imovelId);
  else if (inscricao) imovel = await buscarImovelPorInscricao(municipio, inscricao);
  if ((imovelId || inscricao) && !imovel) throw erro(404, 'Imóvel não encontrado no cadastro deste município.');
  if (imovel && imovel.municipio !== municipio) throw erro(400, 'O imóvel pertence a outro município.');
  const base = await t.preparar({ municipio, cfg, imovel, campos, relatorioMensal, diagnostico });
  const { brasao, ...cfgSnap } = cfg;
  const conteudo = { ...base, cfg: cfgSnap, interessado: interessado || imovel?.contribuinteNome || '', emissor: { nome: usuario, responsavelNome: cfg.responsavelNome } };
  const conteudoDb = JSON.parse(JSON.stringify(conteudo)); // o que o JSONB vai guardar
  const hash = crypto.createHash('sha256').update(jsonCanonico(conteudoDb)).digest('hex');
  const ano = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric' }).format(new Date()));
  const validade = t.validade ? new Date(Date.now() + (cfg.validadeCertidaoDias || 90) * 86400000).toISOString().slice(0, 10) : null;
  const titulo = base.tituloLivre || t.titulo;
  return withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`doc:${municipio}:${tipo}:${ano}`]);
    const seq = (await db.query('SELECT COALESCE(MAX(seq),0)::int + 1 AS n FROM documentos WHERE municipio = $1 AND tipo = $2 AND ano = $3', [municipio, tipo, ano])).rows[0].n;
    const numero = `${String(seq).padStart(4, '0')}/${ano}`;
    let codigo = gerarCodigo();
    for (let i = 0; i < 3; i++) {
      const ja = await db.query('SELECT 1 FROM documentos WHERE codigo_validacao = $1', [codigo]);
      if (!ja.rows.length) break;
      codigo = gerarCodigo();
    }
    const { rows } = await db.query(
      `INSERT INTO documentos (municipio, tipo, numero, seq, ano, titulo, imovel_id, inscricao, requerimento_id, interessado, conteudo, hash_conteudo,
         codigo_validacao, emitido_por_nome, validade)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15) RETURNING *`,
      [municipio, tipo, numero, seq, ano, titulo, imovel?.id || null, imovel?.inscricao || '', requerimentoId, conteudo.interessado,
        JSON.stringify(conteudo), hash, codigo, usuario, validade]
    );
    await auditar(db, { municipio, entidade: 'documento', entidadeId: rows[0].id, acao: 'emitir', detalhe: `${titulo} nº ${numero}${imovel ? ' · ' + imovel.inscricao : ''} · ${codigo}`, usuario });
    return rows[0];
  });
}

function mapDoc(d) {
  return {
    id: d.id, municipio: d.municipio, tipo: d.tipo, numero: d.numero, titulo: d.titulo, imovelId: d.imovel_id, inscricao: d.inscricao,
    requerimentoId: d.requerimento_id, interessado: d.interessado, codigoValidacao: d.codigo_validacao, emitidoPorNome: d.emitido_por_nome,
    emitidoEm: d.emitido_em, validade: isoData(d.validade), status: d.status, motivoCancelamento: d.motivo_cancelamento, canceladoEm: d.cancelado_em,
  };
}
function mapReq(r) {
  return {
    id: r.id, municipio: r.municipio, numero: r.numero, tipo: r.tipo, tipoLabel: TIPOS_REQ[r.tipo]?.label || r.tipo, documentoTipo: r.documento_tipo,
    requerenteNome: r.requerente_nome, requerenteDoc: r.requerente_doc, requerenteDocMascarado: mascararDoc(r.requerente_doc),
    requerenteEmail: r.requerente_email, requerenteTelefone: r.requerente_telefone, imovelId: r.imovel_id, inscricao: r.inscricao,
    descricao: r.descricao, dados: r.dados, status: r.status, prazo: isoData(r.prazo), responsavelNome: r.responsavel_nome, parecer: r.parecer,
    documentoId: r.documento_id, movimentacaoId: r.movimentacao_id, demandaId: r.demanda_id, historico: r.historico || [],
    atrasado: Boolean(r.prazo && ABERTOS.includes(r.status) && isoData(r.prazo) < isoData(new Date())),
    criadoEm: r.created_at, atualizadoEm: r.updated_at,
  };
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
documentosRouter.get('/api/publico/validar/:codigo', asyncRoute(async (req, res) => {
  const codigo = String(req.params.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const fmt = codigo.length === 12 ? `${codigo.slice(0, 4)}-${codigo.slice(4, 8)}-${codigo.slice(8)}` : codigo;
  const { rows } = await query('SELECT * FROM documentos WHERE codigo_validacao = $1', [fmt]);
  const d = rows[0];
  if (!d) return res.status(404).json({ valido: false, error: 'Nenhum documento encontrado com este código.' });
  const integro = crypto.createHash('sha256').update(jsonCanonico(d.conteudo)).digest('hex') === d.hash_conteudo;
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
documentosRouter.get('/api/publico/documento/:codigo', asyncRoute(async (req, res) => {
  const { rows } = await query(`SELECT d.*, r.numero AS requerimento_numero FROM documentos d LEFT JOIN requerimentos r ON r.id = d.requerimento_id
    WHERE d.codigo_validacao = $1`, [String(req.params.codigo || '').toUpperCase()]);
  if (!rows[0]) return res.status(404).send('Documento não encontrado.');
  const cfg = await getConfig(rows[0].municipio);
  res.type('html').send(renderDocumento(rows[0], { cfg, origem: origemDe(req), mascarar: true }));
}));
// Consulta de andamento de protocolo (numero + CPF/CNPJ do requerente).
documentosRouter.get('/api/publico/protocolo', asyncRoute(async (req, res) => {
  const numero = String(req.query.numero || '').trim();
  const doc = soDigitos(req.query.doc);
  if (!numero || doc.length < 11) throw erro(400, 'Informe o número do protocolo e o CPF/CNPJ do requerente.');
  const { rows } = await query('SELECT * FROM requerimentos WHERE numero = $1 AND requerente_doc = $2', [numero, doc]);
  const r = rows[0];
  if (!r) throw erro(404, 'Protocolo não encontrado para este CPF/CNPJ.');
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
  if (!d) throw erro(404, 'Documento não encontrado.');
  const cfg = await getConfig(d.municipio);
  res.type('html').send(renderDocumento(d, { cfg, origem: origemDe(req), barra: req.query.barra !== '0' }));
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
  const { rows } = await query(`SELECT * FROM requerimentos WHERE ${where.join(' AND ')} ORDER BY (status = ANY('{protocolado,em_analise,pendente_documentacao}')) DESC, prazo NULLS LAST, id DESC LIMIT 500`, params);
  res.json(rows.map(mapReq));
}));

documentosRouter.get('/api/requerimentos/:id', asyncRoute(async (req, res) => {
  const r = (await query('SELECT * FROM requerimentos WHERE id = $1', [req.params.id])).rows[0];
  if (!r) throw erro(404, 'Requerimento não encontrado.');
  res.json(mapReq(r));
}));

documentosRouter.post('/api/requerimentos', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const m = muniDe(req);
  const t = TIPOS_REQ[b.tipo];
  if (!t) throw erro(400, 'Tipo de requerimento inválido.');
  if (!String(b.requerenteNome || '').trim()) throw erro(400, 'Informe o nome do requerente.');
  const doc = soDigitos(b.requerenteDoc);
  if (doc.length !== 11 && doc.length !== 14) throw erro(400, 'Informe o CPF/CNPJ do requerente.');
  if (b.tipo === 'certidao' && !TIPOS_DOC[b.documentoTipo]) throw erro(400, 'Escolha qual certidão/declaração está sendo requerida.');
  let imovelId = null, inscricao = String(b.inscricao || '').trim();
  if (inscricao) {
    const im = (await query('SELECT id FROM imoveis WHERE municipio = $1 AND inscricao = $2', [m, inscricao])).rows[0];
    imovelId = im?.id || null;
    if (!imovelId && !['inclusao_imovel', 'outro', 'vistoria'].includes(b.tipo)) throw erro(404, `Inscrição ${inscricao} não encontrada no cadastro.`);
  }
  const prazo = b.prazo || new Date(Date.now() + t.prazoDias * 86400000).toISOString().slice(0, 10);
  const usuario = nomeUsuario(req);
  const r = await withTransaction(async (db) => {
    const ano = new Date().getFullYear();
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`req:${m}:${ano}`]);
    const n = (await db.query(`SELECT COUNT(*)::int + 1 AS n FROM requerimentos WHERE municipio = $1 AND numero LIKE $2`, [m, `${ano}/%`])).rows[0].n;
    const numero = `${ano}/${String(n).padStart(5, '0')}`;
    const { rows } = await db.query(
      `INSERT INTO requerimentos (municipio, numero, tipo, documento_tipo, requerente_nome, requerente_doc, requerente_email, requerente_telefone,
         imovel_id, inscricao, descricao, dados, prazo, responsavel_nome, historico)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15::jsonb) RETURNING *`,
      [m, numero, b.tipo, b.tipo === 'certidao' ? b.documentoTipo : (t.documento || ''), String(b.requerenteNome).trim().slice(0, 160), doc,
        String(b.requerenteEmail || '').slice(0, 160), String(b.requerenteTelefone || '').slice(0, 40), imovelId, inscricao,
        String(b.descricao || '').slice(0, 4000), JSON.stringify(b.dados || {}), prazo, String(b.responsavelNome || '').slice(0, 80),
        JSON.stringify([{ em: new Date().toISOString(), status: 'protocolado', por: usuario, obs: 'Requerimento protocolado' }])]
    );
    await auditar(db, { municipio: m, entidade: 'requerimento', entidadeId: rows[0].id, acao: 'protocolar', detalhe: `${numero} · ${t.label} · ${rows[0].requerente_nome}`, usuario });
    return rows[0];
  });
  res.json(mapReq(r));
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
