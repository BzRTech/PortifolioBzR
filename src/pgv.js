// Planta Genérica de Valores — versionada por EXERCÍCIO.
//
// Cada exercício (ano) tem seus próprios valores e um status:
//   rascunho  → editável; não afeta nenhum imóvel
//   vigente   → é o usado no valor venal (só um por município); valores travados
//   encerrado → histórico (o anterior ao vigente atual)
// Publicar um exercício é um JOB TRANSACIONAL: troca o vigente e recalcula o
// valor venal de toda a base numa única transação (tudo ou nada), registrando
// totais antes/depois em pgv_recalculos.
// Certidões já emitidas NÃO mudam: o conteúdo é congelado na emissão e o banco
// impede alteração (trigger em `documentos`); a certidão registra o exercício.
import { Router } from 'express';
import { query, withTransaction } from './db.js';
import { requireRole } from './auth.js';
import { muniDe, nomeUsuario, erro, num, rotaAsync } from './util.js';
import { processarImoveis, auditar } from './cib.js';

export const PADROES_PGV = ['popular', 'baixo', 'normal', 'alto', 'luxo'];

/** Valores do exercício vigente: { ano, terreno: Map, construcao: Map, vazio }. */
export async function carregarPgvVigente(db, municipio) {
  const ex = (await (db || { query }).query(`SELECT ano FROM pgv_exercicios WHERE municipio = $1 AND status = 'vigente'`, [municipio])).rows[0];
  if (!ex) return { ano: null, terreno: new Map(), construcao: new Map(), vazio: true };
  return carregarValores(db, municipio, ex.ano);
}
async function carregarValores(db, municipio, ano) {
  const { rows } = await (db || { query }).query('SELECT tipo, chave, valor_m2::float AS v FROM pgv_valores WHERE municipio = $1 AND ano = $2', [municipio, ano]);
  const terreno = new Map(), construcao = new Map();
  for (const r of rows) (r.tipo === 'terreno' ? terreno : construcao).set(r.chave.toUpperCase(), r.v);
  return { ano, terreno, construcao, vazio: rows.length === 0 };
}

export function calcularValorVenal(im, pgv) {
  if (!pgv || pgv.vazio) return { t: null, c: null, total: null };
  const vt = pgv.terreno.get(String(im.bairro || '').toUpperCase()) ?? pgv.terreno.get('*') ?? 0;
  const padrao = String(im.padrao_construtivo || 'normal').toUpperCase() === 'MEDIO' ? 'NORMAL' : String(im.padrao_construtivo || 'normal').toUpperCase();
  const vc = pgv.construcao.get(padrao) ?? pgv.construcao.get('NORMAL') ?? 0;
  const t = Math.round((Number(im.area_terreno_m2) || 0) * vt * 100) / 100;
  const c = im.tipo === 'territorial' ? 0 : Math.round((Number(im.area_construida_m2) || 0) * vc * 100) / 100;
  return { t, c, total: Math.round((t + c) * 100) / 100 };
}

/** Publica o exercício e recalcula a base inteira numa transação. */
export async function publicarExercicio(municipio, ano, { atoLegal = '', usuario = '' } = {}) {
  return withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['pgv:' + municipio]);
    const ex = (await db.query('SELECT * FROM pgv_exercicios WHERE municipio = $1 AND ano = $2 FOR UPDATE', [municipio, ano])).rows[0];
    if (!ex) throw erro(404, `Exercício ${ano} não existe.`);
    if (ex.status !== 'rascunho') throw erro(409, `Exercício ${ano} já está ${ex.status}.`);
    const nVal = (await db.query('SELECT COUNT(*)::int AS n FROM pgv_valores WHERE municipio = $1 AND ano = $2', [municipio, ano])).rows[0].n;
    if (!nVal) throw erro(422, 'Cadastre os valores do exercício antes de publicar.');
    const antes = (await db.query(`SELECT COALESCE(SUM(valor_venal_total),0) AS t FROM imoveis WHERE municipio = $1 AND situacao = 'ativo'`, [municipio])).rows[0].t;
    await db.query(`UPDATE pgv_exercicios SET status = 'encerrado' WHERE municipio = $1 AND status = 'vigente'`, [municipio]);
    await db.query(`UPDATE pgv_exercicios SET status = 'vigente', publicado_em = NOW(), publicado_por = $3, ato_legal = COALESCE(NULLIF($4,''), ato_legal)
      WHERE municipio = $1 AND ano = $2`, [municipio, ano, usuario, String(atoLegal || '').slice(0, 200)]);
    const qtd = await processarImoveis(db, { municipio });
    const depois = (await db.query(`SELECT COALESCE(SUM(valor_venal_total),0) AS t FROM imoveis WHERE municipio = $1 AND situacao = 'ativo'`, [municipio])).rows[0].t;
    await db.query(`INSERT INTO pgv_recalculos (municipio, ano, qtd_imoveis, total_antes, total_depois, usuario_nome) VALUES ($1,$2,$3,$4,$5,$6)`,
      [municipio, ano, qtd, antes, depois, usuario]);
    await auditar(db, { municipio, entidade: 'pgv', acao: 'publicar', detalhe: `Exercício ${ano} vigente; ${qtd} imóveis recalculados (total ${Number(antes).toFixed(2)} → ${Number(depois).toFixed(2)})`, usuario });
    return { ano, qtd, totalAntes: Number(antes), totalDepois: Number(depois) };
  });
}

// ------------------------------------------------------------------ rotas
export const pgvRouter = Router();
const asyncRoute = rotaAsync('pgv');
const gestor = requireRole('admin', 'coordenador');
const leitura = requireRole('admin', 'coordenador', 'tecnico', 'gestor');

pgvRouter.get('/api/cib/pgv', leitura, asyncRoute(async (req, res) => {
  const m = muniDe(req);
  const exercicios = (await query(`SELECT ano, status, ato_legal, publicado_em, publicado_por,
      (SELECT COUNT(*)::int FROM pgv_valores v WHERE v.municipio = e.municipio AND v.ano = e.ano) AS n_valores
    FROM pgv_exercicios e WHERE municipio = $1 ORDER BY ano DESC`, [m])).rows;
  const vigente = exercicios.find((e) => e.status === 'vigente');
  const ano = Number(req.query.ano) || vigente?.ano || exercicios[0]?.ano || null;
  const valores = ano ? (await query(`SELECT tipo, chave, valor_m2::float AS valor FROM pgv_valores WHERE municipio = $1 AND ano = $2 ORDER BY tipo, chave`, [m, ano])).rows : [];
  const bairros = (await query(`SELECT DISTINCT bairro FROM imoveis WHERE municipio = $1 AND bairro <> '' ORDER BY 1`, [m])).rows.map((r) => r.bairro);
  const resumo = (await query(
    `SELECT COALESCE(NULLIF(bairro,''),'(sem bairro)') AS bairro, COUNT(*)::int AS n, COALESCE(SUM(valor_venal_total),0)::float AS total,
            COALESCE(AVG(valor_venal_total),0)::float AS medio
     FROM imoveis WHERE municipio = $1 AND situacao = 'ativo' GROUP BY 1 ORDER BY total DESC`, [m])).rows;
  const recalculos = (await query(`SELECT * FROM pgv_recalculos WHERE municipio = $1 ORDER BY created_at DESC LIMIT 10`, [m])).rows;
  res.json({ ano, exercicios, valores, bairros, padroes: PADROES_PGV, resumo, recalculos, editavel: exercicios.find((e) => e.ano === ano)?.status === 'rascunho' });
}));

// Novo exercício (rascunho), opcionalmente copiando os valores de outro.
pgvRouter.post('/api/cib/pgv/exercicios', gestor, asyncRoute(async (req, res) => {
  const m = muniDe(req);
  const ano = Number(req.body?.ano);
  if (!(ano >= 2000 && ano <= 2100)) throw erro(400, 'Ano do exercício inválido.');
  await withTransaction(async (db) => {
    const ja = await db.query('SELECT 1 FROM pgv_exercicios WHERE municipio = $1 AND ano = $2', [m, ano]);
    if (ja.rows.length) throw erro(409, `O exercício ${ano} já existe.`);
    await db.query(`INSERT INTO pgv_exercicios (municipio, ano, status, ato_legal) VALUES ($1,$2,'rascunho',$3)`, [m, ano, String(req.body?.atoLegal || '').slice(0, 200)]);
    if (req.body?.copiarDe) {
      await db.query(`INSERT INTO pgv_valores (municipio, ano, tipo, chave, valor_m2) SELECT municipio, $2, tipo, chave, valor_m2 FROM pgv_valores WHERE municipio = $1 AND ano = $3`,
        [m, ano, Number(req.body.copiarDe)]);
    }
    await auditar(db, { municipio: m, entidade: 'pgv', acao: 'criar', detalhe: `Exercício ${ano} (rascunho)${req.body?.copiarDe ? ' copiado de ' + req.body.copiarDe : ''}`, usuario: nomeUsuario(req) });
  });
  res.json({ ok: true, ano });
}));

// Edita valores — só exercício em rascunho.
pgvRouter.put('/api/cib/pgv', gestor, asyncRoute(async (req, res) => {
  const m = muniDe(req);
  const ano = Number(req.body?.ano);
  const linhas = [];
  for (const t of ['terreno', 'construcao']) for (const v of (req.body?.[t] || [])) {
    if (!v?.chave || num(v.valor) == null) continue;
    linhas.push([t, String(v.chave).trim().slice(0, 80), num(v.valor)]);
  }
  await withTransaction(async (db) => {
    const ex = (await db.query('SELECT status FROM pgv_exercicios WHERE municipio = $1 AND ano = $2 FOR UPDATE', [m, ano])).rows[0];
    if (!ex) throw erro(404, `Exercício ${ano} não existe. Crie o exercício primeiro.`);
    if (ex.status !== 'rascunho') throw erro(409, `O exercício ${ano} está ${ex.status}: valores travados. Crie um novo exercício.`);
    await db.query('DELETE FROM pgv_valores WHERE municipio = $1 AND ano = $2', [m, ano]);
    for (const [t, k, v] of linhas) await db.query('INSERT INTO pgv_valores (municipio, ano, tipo, chave, valor_m2) VALUES ($1,$2,$3,$4,$5)', [m, ano, t, k, v]);
    if (req.body?.atoLegal !== undefined) await db.query('UPDATE pgv_exercicios SET ato_legal = $3 WHERE municipio = $1 AND ano = $2', [m, ano, String(req.body.atoLegal).slice(0, 200)]);
    await auditar(db, { municipio: m, entidade: 'pgv', acao: 'salvar', detalhe: `Exercício ${ano}: ${linhas.length} valores (rascunho)`, usuario: nomeUsuario(req) });
  });
  res.json({ ok: true });
}));

pgvRouter.post('/api/cib/pgv/:ano/publicar', gestor, asyncRoute(async (req, res) => {
  res.json(await publicarExercicio(muniDe(req), Number(req.params.ano), { atoLegal: req.body?.atoLegal, usuario: nomeUsuario(req) }));
}));
