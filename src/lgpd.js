// LGPD — registro de acesso a dados pessoais (tabela append-only lgpd_acessos).
// Registra quem viu o CPF/CNPJ completo, abriu documento com dados pessoais ou
// exportou arquivo com CPF/CNPJ, com finalidade, IP e horário.
import { Router } from 'express';
import { query } from './db.js';
import { requireRole } from './auth.js';
import { muniDe, rotaAsync } from './util.js';

export async function registrarAcesso(req, { municipio, entidade, entidadeId = null, dado, finalidade = '' }) {
  try {
    await query(
      `INSERT INTO lgpd_acessos (municipio, usuario_id, usuario_nome, perfil, entidade, entidade_id, dado, finalidade, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [municipio ?? muniDe(req), req.user?.uid ?? null, String(req.user?.nome || 'acesso sem login'), String(req.user?.role || 'anon'),
        entidade, entidadeId, dado, String(finalidade || '').slice(0, 300), String(req.ip || '')]
    );
  } catch (e) { console.error('[lgpd] registro de acesso:', e.message); }
}

/** Perfis que podem ver/exportar dados pessoais completos. */
export const PERFIS_DADOS_PESSOAIS = ['admin', 'coordenador', 'tecnico'];
export const PERFIS_EXPORTACAO = ['admin', 'coordenador'];

export const lgpdRouter = Router();
const asyncRoute = rotaAsync('lgpd');
lgpdRouter.get('/api/lgpd/acessos', requireRole('admin'), asyncRoute(async (req, res) => {
  const params = [muniDe(req)];
  let w = 'municipio = $1';
  if (req.query.entidade) { params.push(String(req.query.entidade)); w += ` AND entidade = $${params.length}`; }
  if (req.query.entidadeId) { params.push(Number(req.query.entidadeId)); w += ` AND entidade_id = $${params.length}`; }
  const { rows } = await query(`SELECT * FROM lgpd_acessos WHERE ${w} ORDER BY created_at DESC, id DESC LIMIT ${Math.min(2000, Number(req.query.limit) || 300)}`, params);
  res.json(rows);
}));
