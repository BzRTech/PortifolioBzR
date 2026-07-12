// Modulo de Gestao de Demandas (tarefas internas da equipe — PD/CTM).
// Fluxo: Pendente -> Em andamento -> Concluida | Cancelada.
// Uma demanda pode ter varios responsaveis (usuarios) e, opcionalmente,
// vincular-se a um municipio e a um lote do Territorio.
import { Router } from 'express';
import { query, withTransaction, isConfigured } from './db.js';
import { requireAuth } from './auth.js';

export const PRIORIDADES = ['baixa', 'media', 'alta', 'urgente'];
export const STATUS = ['pendente', 'em_andamento', 'concluida', 'cancelada'];
const ABERTAS = ['pendente', 'em_andamento'];

export async function ensureDemandasSchema() {
  if (!isConfigured) return false;
  await query(`
    CREATE TABLE IF NOT EXISTS demandas (
      id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      titulo       TEXT NOT NULL DEFAULT '',
      descricao    TEXT NOT NULL DEFAULT '',
      municipio    TEXT DEFAULT '',
      lote_codigo  TEXT DEFAULT '',
      lote_bairro  TEXT DEFAULT '',
      equipe       TEXT DEFAULT '',
      prioridade   TEXT NOT NULL DEFAULT 'media',
      status       TEXT NOT NULL DEFAULT 'pendente',
      prazo        DATE,
      iniciada_em  TIMESTAMPTZ,
      concluida_em TIMESTAMPTZ,
      criado_por   BIGINT,
      criado_por_nome TEXT DEFAULT '',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS demanda_responsaveis (
      demanda_id  BIGINT NOT NULL REFERENCES demandas(id) ON DELETE CASCADE,
      usuario_id  BIGINT NOT NULL,
      usuario_nome TEXT DEFAULT '',
      PRIMARY KEY (demanda_id, usuario_id)
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_demandas_status ON demandas (status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_demandas_prazo ON demandas (prazo)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_demresp_usuario ON demanda_responsaveis (usuario_id)`);
  return true;
}

// Normaliza a lista de responsaveis do corpo: [{id, nome}] ou [id].
function normalizarResponsaveis(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const r of v) {
    if (r == null) continue;
    if (typeof r === 'object') { if (r.id != null) out.push({ id: Number(r.id), nome: String(r.nome || '') }); }
    else out.push({ id: Number(r), nome: '' });
  }
  return out.filter((r) => Number.isFinite(r.id));
}

async function carregarResponsaveis(ids) {
  if (!ids.length) return new Map();
  const { rows } = await query('SELECT id, nome FROM usuarios WHERE id = ANY($1)', [ids]);
  return new Map(rows.map((r) => [r.id, r.nome]));
}

function mapDemanda(d, responsaveis) {
  return {
    id: d.id, titulo: d.titulo, descricao: d.descricao,
    municipio: d.municipio || '', loteCodigo: d.lote_codigo || '', loteBairro: d.lote_bairro || '',
    equipe: d.equipe || '', prioridade: d.prioridade, status: d.status,
    prazo: d.prazo, iniciadaEm: d.iniciada_em, concluidaEm: d.concluida_em,
    criadoPor: d.criado_por, criadoPorNome: d.criado_por_nome || '',
    criadoEm: d.created_at, atualizadoEm: d.updated_at,
    responsaveis: responsaveis || [],
  };
}

async function comResponsaveis(demandas) {
  const ids = demandas.map((d) => d.id);
  const byId = new Map(demandas.map((d) => [d.id, []]));
  if (ids.length) {
    const { rows } = await query(
      'SELECT demanda_id, usuario_id, usuario_nome FROM demanda_responsaveis WHERE demanda_id = ANY($1)',
      [ids]
    );
    for (const r of rows) byId.get(r.demanda_id)?.push({ id: r.usuario_id, nome: r.usuario_nome || '' });
  }
  return demandas.map((d) => mapDemanda(d, byId.get(d.id)));
}

export const demandasRouter = Router();
demandasRouter.use(requireAuth);

// Lista com filtros: status, equipe, prioridade, responsavel (=me para "minhas").
demandasRouter.get('/api/demandas', async (req, res) => {
  const where = [];
  const params = [];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('$?', '$' + params.length)); };

  if (req.query.status && STATUS.includes(String(req.query.status))) add('d.status = $?', String(req.query.status));
  if (req.query.prioridade && PRIORIDADES.includes(String(req.query.prioridade))) add('d.prioridade = $?', String(req.query.prioridade));
  if (req.query.equipe) add('d.equipe = $?', String(req.query.equipe));
  if (req.query.municipio) add('d.municipio = $?', String(req.query.municipio));

  // Filtro por responsavel via EXISTS (evita JOIN+DISTINCT, que conflita com
  // o ORDER BY por expressao de prioridade).
  const responsavel = req.query.responsavel === 'me' ? req.user.uid
    : (req.query.responsavel ? Number(req.query.responsavel) : null);
  if (Number.isFinite(responsavel)) {
    params.push(responsavel);
    where.push(`EXISTS (SELECT 1 FROM demanda_responsaveis dr WHERE dr.demanda_id = d.id AND dr.usuario_id = $${params.length})`);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const { rows } = await query(
      `SELECT d.* FROM demandas d ${whereSql} ORDER BY
         CASE d.prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
         d.prazo NULLS LAST, d.created_at DESC`,
      params
    );
    res.json(await comResponsaveis(rows));
  } catch (e) { console.error('GET /api/demandas', e.message); res.status(500).json({ error: e.message }); }
});

// Resumo para o mini-dashboard (contagens por status/prioridade/equipe).
demandasRouter.get('/api/demandas/resumo', async (req, res) => {
  try {
    const porStatus = (await query(`SELECT status, COUNT(*)::int AS n FROM demandas GROUP BY status`)).rows;
    const porEquipe = (await query(`SELECT COALESCE(NULLIF(equipe,''),'(sem equipe)') AS equipe, COUNT(*)::int AS n FROM demandas GROUP BY 1 ORDER BY n DESC`)).rows;
    const atrasadas = (await query(
      `SELECT COUNT(*)::int AS n FROM demandas WHERE prazo IS NOT NULL AND prazo < CURRENT_DATE AND status IN ('pendente','em_andamento')`
    )).rows[0].n;
    const minhas = (await query(
      `SELECT COUNT(DISTINCT d.id)::int AS n FROM demandas d JOIN demanda_responsaveis dr ON dr.demanda_id=d.id
       WHERE dr.usuario_id=$1 AND d.status IN ('pendente','em_andamento')`, [req.user.uid]
    )).rows[0].n;
    res.json({ porStatus, porEquipe, atrasadas, minhasAbertas: minhas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

demandasRouter.get('/api/demandas/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM demandas WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Demanda não encontrada.' });
    res.json((await comResponsaveis(rows))[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

demandasRouter.post('/api/demandas', async (req, res) => {
  const b = req.body || {};
  const prioridade = PRIORIDADES.includes(b.prioridade) ? b.prioridade : 'media';
  const status = STATUS.includes(b.status) ? b.status : 'pendente';
  const resp = normalizarResponsaveis(b.responsaveis);
  try {
    const nomes = await carregarResponsaveis(resp.map((r) => r.id));
    const nova = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO demandas (titulo, descricao, municipio, lote_codigo, lote_bairro, equipe,
           prioridade, status, prazo, iniciada_em, criado_por, criado_por_nome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          String(b.titulo || '').slice(0, 160), String(b.descricao || ''),
          String(b.municipio || ''), String(b.loteCodigo || ''), String(b.loteBairro || ''),
          String(b.equipe || '').slice(0, 40), prioridade, status, b.prazo || null,
          status === 'em_andamento' ? new Date() : null,
          req.user.uid, req.user.nome || '',
        ]
      );
      const d = rows[0];
      for (const r of resp) {
        await client.query(
          `INSERT INTO demanda_responsaveis (demanda_id, usuario_id, usuario_nome) VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`,
          [d.id, r.id, nomes.get(r.id) || r.nome || '']
        );
      }
      return d;
    });
    res.json((await comResponsaveis([nova]))[0]);
  } catch (e) { console.error('POST /api/demandas', e.message); res.status(500).json({ error: e.message }); }
});

demandasRouter.put('/api/demandas/:id', async (req, res) => {
  const b = req.body || {};
  try {
    const atual = (await query('SELECT * FROM demandas WHERE id = $1', [req.params.id])).rows[0];
    if (!atual) return res.status(404).json({ error: 'Demanda não encontrada.' });
    const manter = (nv, at) => (nv !== undefined ? nv : at);
    const status = STATUS.includes(b.status) ? b.status : atual.status;
    const prioridade = PRIORIDADES.includes(b.prioridade) ? b.prioridade : atual.prioridade;
    // Carimba as datas de transicao.
    const iniciada = status === 'em_andamento' && !atual.iniciada_em ? new Date() : atual.iniciada_em;
    const concluida = status === 'concluida' ? (atual.concluida_em || new Date())
      : (status === 'cancelada' ? (atual.concluida_em || new Date()) : (['pendente', 'em_andamento'].includes(status) ? null : atual.concluida_em));

    const atualizado = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE demandas SET titulo=$1, descricao=$2, municipio=$3, lote_codigo=$4, lote_bairro=$5,
           equipe=$6, prioridade=$7, status=$8, prazo=$9, iniciada_em=$10, concluida_em=$11, updated_at=NOW()
         WHERE id=$12 RETURNING *`,
        [
          manter(b.titulo, atual.titulo), manter(b.descricao, atual.descricao),
          manter(b.municipio, atual.municipio), manter(b.loteCodigo, atual.lote_codigo),
          manter(b.loteBairro, atual.lote_bairro), manter(b.equipe, atual.equipe),
          prioridade, status, b.prazo !== undefined ? (b.prazo || null) : atual.prazo,
          iniciada, concluida, req.params.id,
        ]
      );
      if (b.responsaveis !== undefined) {
        const resp = normalizarResponsaveis(b.responsaveis);
        const nomes = await carregarResponsaveis(resp.map((r) => r.id));
        await client.query('DELETE FROM demanda_responsaveis WHERE demanda_id = $1', [req.params.id]);
        for (const r of resp) {
          await client.query(
            `INSERT INTO demanda_responsaveis (demanda_id, usuario_id, usuario_nome) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [req.params.id, r.id, nomes.get(r.id) || r.nome || '']
          );
        }
      }
      return rows[0];
    });
    res.json((await comResponsaveis([atualizado]))[0]);
  } catch (e) { console.error('PUT /api/demandas/:id', e.message); res.status(500).json({ error: e.message }); }
});

// Transicao rapida de status (usada no arrastar do Kanban).
demandasRouter.patch('/api/demandas/:id/status', async (req, res) => {
  const status = String(req.body?.status || '');
  if (!STATUS.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  try {
    const atual = (await query('SELECT * FROM demandas WHERE id = $1', [req.params.id])).rows[0];
    if (!atual) return res.status(404).json({ error: 'Demanda não encontrada.' });
    const iniciada = status === 'em_andamento' && !atual.iniciada_em ? new Date() : atual.iniciada_em;
    const concluida = ['concluida', 'cancelada'].includes(status) ? (atual.concluida_em || new Date())
      : (['pendente', 'em_andamento'].includes(status) ? null : atual.concluida_em);
    const { rows } = await query(
      `UPDATE demandas SET status=$1, iniciada_em=$2, concluida_em=$3, updated_at=NOW() WHERE id=$4 RETURNING *`,
      [status, iniciada, concluida, req.params.id]
    );
    res.json((await comResponsaveis([rows[0]]))[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

demandasRouter.delete('/api/demandas/:id', async (req, res) => {
  // Apenas admin/coordenador ou o criador podem excluir.
  try {
    const d = (await query('SELECT criado_por FROM demandas WHERE id = $1', [req.params.id])).rows[0];
    if (!d) return res.status(404).json({ error: 'Demanda não encontrada.' });
    if (!['admin', 'coordenador'].includes(req.user.role) && d.criado_por !== req.user.uid) {
      return res.status(403).json({ error: 'Sem permissão para excluir esta demanda.' });
    }
    await query('DELETE FROM demandas WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
