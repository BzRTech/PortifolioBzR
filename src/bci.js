// Modulo BCI — Boletim de Cadastro Imobiliario.
// Coleta de campo vinculada a um lote do Territorio. Formulario dinamico e
// versionavel por municipio. Fluxo: Rascunho -> Enviado -> Aprovado | Rejeitado
// -> Arquivado. Guarda snapshot dos campos (dados), fotos, GPS e um sinal de
// "ajuste de geometria" (o desenho do lote precisa fundir/desmembrar/redesenhar).
import { Router } from 'express';
import { query, withTransaction, isConfigured } from './db.js';
import { requireAuth } from './auth.js';
import { BCI_PADRAO } from './bci-catalog.js';

export const STATUS = ['rascunho', 'enviado', 'aprovado', 'rejeitado', 'arquivado'];
export const AJUSTE_TIPOS = ['merge', 'desmembrar', 'redesenhar', 'reposicionar', 'outro'];
const ABERTOS = ['rascunho', 'enviado'];

const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export async function ensureBciSchema() {
  if (!isConfigured) return false;
  await query(`
    CREATE TABLE IF NOT EXISTS bci_formulario (
      id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      municipio  TEXT,
      nome       TEXT NOT NULL,
      versao     INTEGER NOT NULL DEFAULT 1,
      ativo      BOOLEAN NOT NULL DEFAULT TRUE,
      definicao  JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS bci (
      id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      lote_id          BIGINT REFERENCES lotes(id) ON DELETE SET NULL,
      inscricao        TEXT NOT NULL DEFAULT '',
      municipio        TEXT DEFAULT '',
      bairro           TEXT DEFAULT '',
      tecnico_nome     TEXT DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'rascunho',
      dados            JSONB NOT NULL DEFAULT '{}'::jsonb,
      area_terreno_m2      DOUBLE PRECISION,
      area_construida_m2   DOUBLE PRECISION,
      uso              TEXT DEFAULT '',
      observacoes      TEXT DEFAULT '',
      ponto_lat        DOUBLE PRECISION,
      ponto_lng        DOUBLE PRECISION,
      precisao_gps_m   DOUBLE PRECISION,
      enviado_em       TIMESTAMPTZ,
      aprovado_em      TIMESTAMPTZ,
      aprovado_por_nome TEXT DEFAULT '',
      motivo_rejeicao  TEXT DEFAULT '',
      ajuste_geom      BOOLEAN NOT NULL DEFAULT FALSE,
      ajuste_tipo      TEXT DEFAULT '',
      ajuste_obs       TEXT DEFAULT '',
      ajuste_inscricoes TEXT DEFAULT '',
      ajuste_resolvido BOOLEAN NOT NULL DEFAULT FALSE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`
    CREATE TABLE IF NOT EXISTS bci_foto (
      id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      bci_id     BIGINT NOT NULL REFERENCES bci(id) ON DELETE CASCADE,
      imagem     TEXT NOT NULL,
      tipo       TEXT NOT NULL DEFAULT 'geral',
      legenda    TEXT DEFAULT '',
      lat        DOUBLE PRECISION,
      lng        DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bci_status ON bci (status)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bci_municipio ON bci (municipio)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_bci_ajuste ON bci (ajuste_geom) WHERE ajuste_geom = TRUE`);
  // No maximo um BCI "aberto" (rascunho/enviado) por lote.
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_bci_aberto_lote
               ON bci (lote_id) WHERE lote_id IS NOT NULL AND status IN ('rascunho','enviado')`);

  // Seed do formulario PADRAO (municipio NULL) se ainda nao existir.
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM bci_formulario WHERE municipio IS NULL AND ativo = TRUE`);
  if (rows[0].n === 0) {
    await query(
      `INSERT INTO bci_formulario (municipio, nome, versao, ativo, definicao) VALUES (NULL, $1, $2, TRUE, $3)`,
      [BCI_PADRAO.nome, BCI_PADRAO.versao, JSON.stringify(BCI_PADRAO)]
    );
    console.log('[bci] formulário padrão carregado.');
  }
  return true;
}

/** Formulario ativo do municipio, com fallback no padrao. */
async function resolverFormulario(municipio) {
  if (municipio) {
    const r = await query(`SELECT * FROM bci_formulario WHERE municipio = $1 AND ativo = TRUE ORDER BY versao DESC LIMIT 1`, [municipio]);
    if (r.rows[0]) return r.rows[0];
  }
  const p = await query(`SELECT * FROM bci_formulario WHERE municipio IS NULL AND ativo = TRUE ORDER BY versao DESC LIMIT 1`);
  return p.rows[0] || { id: null, nome: BCI_PADRAO.nome, versao: BCI_PADRAO.versao, definicao: BCI_PADRAO };
}

function mapBci(b, fotos) {
  return {
    id: b.id, loteId: b.lote_id, inscricao: b.inscricao, municipio: b.municipio || '', bairro: b.bairro || '',
    tecnicoNome: b.tecnico_nome || '', status: b.status, dados: b.dados || {},
    areaTerreno: b.area_terreno_m2, areaConstruida: b.area_construida_m2, uso: b.uso || '', observacoes: b.observacoes || '',
    ponto: (b.ponto_lat != null && b.ponto_lng != null) ? { lat: b.ponto_lat, lng: b.ponto_lng } : null,
    precisaoGps: b.precisao_gps_m,
    enviadoEm: b.enviado_em, aprovadoEm: b.aprovado_em, aprovadoPorNome: b.aprovado_por_nome || '', motivoRejeicao: b.motivo_rejeicao || '',
    ajuste: { geom: b.ajuste_geom, tipo: b.ajuste_tipo || '', obs: b.ajuste_obs || '', inscricoes: b.ajuste_inscricoes || '', resolvido: b.ajuste_resolvido },
    criadoEm: b.created_at, atualizadoEm: b.updated_at,
    fotos: fotos || undefined,
  };
}

export const bciRouter = Router();
bciRouter.use(requireAuth); // aberto quando AUTH_ENABLED=false

// Formulario dinamico (definicao das secoes/campos).
bciRouter.get('/api/bci/formulario', async (req, res) => {
  if (!isConfigured) return res.status(503).json({ error: 'Banco não configurado.' });
  try {
    const f = await resolverFormulario(req.query.municipio ? String(req.query.municipio) : null);
    res.json({ id: f.id, nome: f.nome, versao: f.versao, definicao: f.definicao });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resumo para o painel (contagens por status + pendencias).
bciRouter.get('/api/bci/resumo', async (req, res) => {
  try {
    const porStatus = (await query(`SELECT status, COUNT(*)::int AS n FROM bci GROUP BY status`)).rows;
    const ajustes = (await query(`SELECT COUNT(*)::int AS n FROM bci WHERE ajuste_geom = TRUE AND ajuste_resolvido = FALSE`)).rows[0].n;
    res.json({ porStatus, ajustesAbertos: ajustes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pontos coletados para o mapa (colorir por status de cadastro).
bciRouter.get('/api/bci/mapa', async (req, res) => {
  const params = [];
  let w = 'WHERE ponto_lat IS NOT NULL AND ponto_lng IS NOT NULL';
  if (req.query.municipio) { params.push(String(req.query.municipio)); w += ` AND municipio = $${params.length}`; }
  try {
    const { rows } = await query(`SELECT id, inscricao, status, ponto_lat, ponto_lng, ajuste_geom, ajuste_resolvido FROM bci ${w}`, params);
    res.json(rows.map((r) => ({ id: r.id, inscricao: r.inscricao, status: r.status, lat: r.ponto_lat, lng: r.ponto_lng, ajuste: r.ajuste_geom && !r.ajuste_resolvido })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista com filtros.
bciRouter.get('/api/bci', async (req, res) => {
  const where = [], params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('$?', '$' + params.length)); };
  if (req.query.status && STATUS.includes(String(req.query.status))) add('status = $?', String(req.query.status));
  if (req.query.municipio) add('municipio = $?', String(req.query.municipio));
  if (req.query.bairro) add('bairro = $?', String(req.query.bairro));
  if (req.query.ajuste === '1') where.push('ajuste_geom = TRUE AND ajuste_resolvido = FALSE');
  if (req.query.q) add('inscricao ILIKE $?', '%' + String(req.query.q).replace(/[%_]/g, '') + '%');
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  try {
    const { rows } = await query(
      `SELECT b.*, (SELECT COUNT(*)::int FROM bci_foto f WHERE f.bci_id = b.id) AS n_fotos
       FROM bci b ${whereSql} ORDER BY b.updated_at DESC`, params
    );
    res.json(rows.map((r) => ({ ...mapBci(r), nFotos: r.n_fotos })));
  } catch (e) { console.error('GET /api/bci', e.message); res.status(500).json({ error: e.message }); }
});

bciRouter.get('/api/bci/:id', async (req, res) => {
  try {
    const b = (await query('SELECT * FROM bci WHERE id = $1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'BCI não encontrado.' });
    const fotos = (await query('SELECT id, imagem, tipo, legenda, lat, lng FROM bci_foto WHERE bci_id = $1 ORDER BY created_at', [b.id])).rows;
    res.json(mapBci(b, fotos));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Resolve o lote (por codigo = inscricao, no municipio) para vincular o BCI —
// assim a trava de "um BCI aberto por lote" funciona e o mapa colore certo.
async function resolverLoteId(inscricao, municipio) {
  const insc = String(inscricao || '').trim();
  if (!insc) return null;
  const params = [insc];
  let sql = 'SELECT id FROM lotes WHERE codigo = $1';
  if (municipio) { params.push(String(municipio)); sql += ' AND municipio = $2'; }
  sql += ' LIMIT 1';
  try { const { rows } = await query(sql, params); return rows[0]?.id || null; } catch { return null; }
}

function corpoBci(b, req) {
  return [
    b.loteId || null, String(b.inscricao || '').slice(0, 40), String(b.municipio || ''), String(b.bairro || ''),
    String(b.tecnicoNome || req.user?.nome || ''), JSON.stringify(b.dados || {}),
    num(b.areaTerreno), num(b.areaConstruida), String(b.uso || ''), String(b.observacoes || ''),
    b.ponto ? num(b.ponto.lat) : null, b.ponto ? num(b.ponto.lng) : null, num(b.precisaoGps),
    !!(b.ajuste && b.ajuste.geom), AJUSTE_TIPOS.includes(b.ajuste?.tipo) ? b.ajuste.tipo : '',
    String(b.ajuste?.obs || ''), String(b.ajuste?.inscricoes || ''),
  ];
}

bciRouter.post('/api/bci', async (req, res) => {
  const b = req.body || {};
  if (!b.inscricao || !String(b.inscricao).trim()) return res.status(400).json({ error: 'Informe a inscrição / código do lote.' });
  const status = b.status === 'enviado' ? 'enviado' : 'rascunho';
  try {
    if (!b.loteId) b.loteId = await resolverLoteId(b.inscricao, b.municipio);
    const vals = corpoBci(b, req);
    const { rows } = await query(
      `INSERT INTO bci (lote_id, inscricao, municipio, bairro, tecnico_nome, dados,
         area_terreno_m2, area_construida_m2, uso, observacoes, ponto_lat, ponto_lng, precisao_gps_m,
         ajuste_geom, ajuste_tipo, ajuste_obs, ajuste_inscricoes, status, enviado_em)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [...vals, status, status === 'enviado' ? new Date() : null]
    );
    res.json(mapBci(rows[0], []));
  } catch (e) {
    if (String(e.message).includes('uq_bci_aberto_lote')) return res.status(409).json({ error: 'Já existe um BCI em aberto para este lote.' });
    console.error('POST /api/bci', e.message); res.status(500).json({ error: e.message });
  }
});

bciRouter.put('/api/bci/:id', async (req, res) => {
  const b = req.body || {};
  try {
    const atual = (await query('SELECT status FROM bci WHERE id = $1', [req.params.id])).rows[0];
    if (!atual) return res.status(404).json({ error: 'BCI não encontrado.' });
    if (['aprovado', 'arquivado'].includes(atual.status)) return res.status(409).json({ error: 'BCI aprovado/arquivado não pode ser editado.' });
    if (!b.loteId) b.loteId = await resolverLoteId(b.inscricao, b.municipio);
    const vals = corpoBci(b, req);
    const { rows } = await query(
      `UPDATE bci SET lote_id=$1, inscricao=$2, municipio=$3, bairro=$4, tecnico_nome=$5, dados=$6::jsonb,
         area_terreno_m2=$7, area_construida_m2=$8, uso=$9, observacoes=$10, ponto_lat=$11, ponto_lng=$12, precisao_gps_m=$13,
         ajuste_geom=$14, ajuste_tipo=$15, ajuste_obs=$16, ajuste_inscricoes=$17, updated_at=NOW()
       WHERE id=$18 RETURNING *`,
      [...vals, req.params.id]
    );
    res.json(mapBci(rows[0], []));
  } catch (e) { console.error('PUT /api/bci/:id', e.message); res.status(500).json({ error: e.message }); }
});

// Transicoes do fluxo de aprovacao.
const TRANSICOES = {
  enviar:   { de: ['rascunho', 'rejeitado'], para: 'enviado' },
  aprovar:  { de: ['enviado'], para: 'aprovado' },
  rejeitar: { de: ['enviado'], para: 'rejeitado' },
  arquivar: { de: ['rascunho', 'enviado', 'aprovado', 'rejeitado'], para: 'arquivado' },
  reabrir:  { de: ['rejeitado', 'arquivado'], para: 'rascunho' },
};
bciRouter.patch('/api/bci/:id/status', async (req, res) => {
  const acao = String(req.body?.acao || '');
  const t = TRANSICOES[acao];
  if (!t) return res.status(400).json({ error: 'Ação inválida.' });
  try {
    const atual = (await query('SELECT * FROM bci WHERE id = $1', [req.params.id])).rows[0];
    if (!atual) return res.status(404).json({ error: 'BCI não encontrado.' });
    if (!t.de.includes(atual.status)) return res.status(409).json({ error: `Não é possível ${acao} um BCI ${atual.status}.` });
    const sets = ['status = $1', 'updated_at = NOW()'];
    const params = [t.para];
    const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (acao === 'enviar') push('enviado_em', new Date());
    if (acao === 'aprovar') { push('aprovado_em', new Date()); push('aprovado_por_nome', String(req.body?.aprovadoPorNome || req.user?.nome || '')); }
    if (acao === 'rejeitar') push('motivo_rejeicao', String(req.body?.motivo || ''));
    if (acao === 'reabrir') { push('motivo_rejeicao', ''); }
    params.push(req.params.id);
    const { rows } = await query(`UPDATE bci SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    res.json(mapBci(rows[0], []));
  } catch (e) {
    if (String(e.message).includes('uq_bci_aberto_lote')) return res.status(409).json({ error: 'Já existe um BCI em aberto para este lote.' });
    res.status(500).json({ error: e.message });
  }
});

// Marca o ajuste de geometria como resolvido (papel do coordenador).
bciRouter.patch('/api/bci/:id/ajuste', async (req, res) => {
  const resolvido = req.body?.resolvido !== false;
  try {
    const { rows } = await query('UPDATE bci SET ajuste_resolvido = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [resolvido, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'BCI não encontrado.' });
    res.json(mapBci(rows[0], []));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fotos (data URI base64, como no modulo de O.S.).
bciRouter.post('/api/bci/:id/fotos', async (req, res) => {
  const fotos = Array.isArray(req.body?.fotos) ? req.body.fotos : [];
  if (!fotos.length) return res.status(400).json({ error: 'Envie ao menos uma foto.' });
  try {
    const bci = (await query('SELECT id FROM bci WHERE id = $1', [req.params.id])).rows[0];
    if (!bci) return res.status(404).json({ error: 'BCI não encontrado.' });
    const salvas = await withTransaction(async (client) => {
      const out = [];
      for (const f of fotos.slice(0, 20)) {
        if (!f?.imagem) continue;
        const { rows } = await client.query(
          `INSERT INTO bci_foto (bci_id, imagem, tipo, legenda, lat, lng) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, tipo, legenda, lat, lng`,
          [req.params.id, String(f.imagem), f.tipo === 'croqui' ? 'croqui' : 'geral', String(f.legenda || '').slice(0, 160), num(f.lat), num(f.lng)]
        );
        out.push(rows[0]);
      }
      return out;
    });
    res.json({ ok: true, fotos: salvas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bciRouter.delete('/api/bci/:id/fotos/:fid', async (req, res) => {
  try {
    await query('DELETE FROM bci_foto WHERE id = $1 AND bci_id = $2', [req.params.fid, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

bciRouter.delete('/api/bci/:id', async (req, res) => {
  try {
    const b = (await query('SELECT status FROM bci WHERE id = $1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'BCI não encontrado.' });
    if (!['rascunho', 'rejeitado', 'arquivado'].includes(b.status)) {
      return res.status(409).json({ error: 'Só é possível excluir BCI em rascunho, rejeitado ou arquivado.' });
    }
    await query('DELETE FROM bci WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
