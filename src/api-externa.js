// Acesso externo — API somente leitura com chave, para parceiros baixarem os
// dados de cada lote (cartórios, secretarias de obras/planejamento, Receita
// Estadual, consórcio, sistemas da própria prefeitura).
//
// - Chave por parceiro, criada pelo admin: "bzr_<prefixo>_<segredo>". Só o
//   SHA-256 fica no banco; a chave aparece uma única vez.
// - Escopos: lotes (geometria + imóveis do lote, sem dados pessoais),
//   cadastro (ficha técnica do imóvel), valores (valor venal) e pessoais
//   (nome e CPF/CNPJ do contribuinte — exige finalidade/base legal e validade,
//   e cada chamada entra no registro LGPD).
// - Limite de requisições por minuto, lista opcional de IPs, validade e
//   revogação. Cada chamada fica em api_acessos (somente inserção).
// - Formatos: JSON, GeoJSON e CSV (; com BOM, abre direto no Excel).
// Documentação para o parceiro: /api-externa
import { Router } from 'express';
import crypto from 'crypto';
import cors from 'cors';
import { query } from './db.js';
import { requireRole } from './auth.js';
import { MUNICIPIO_FIXO } from './env.js';
import { muniDe, nomeUsuario, erro, rotaAsync, TZ } from './util.js';
import { excedeu, contarFalha } from './ratelimit.js';
import { formatarDoc, normalizarNi } from './ni.js';
import { csvEscapar } from './csv.js';
import { registrarAcesso } from './lgpd.js';
import { auditar } from './cib.js';

export const ESCOPOS = {
  lotes: 'Lotes: código, quadra, bairro, uso, área, geometria e os imóveis do lote (inscrição, CIB, endereço, áreas).',
  cadastro: 'Cadastro técnico do imóvel: padrão, ano, pavimentos, testada, matrícula/CNM, situação e status no Sinter.',
  valores: 'Valor venal do terreno, da construção e total, com o exercício.',
  pessoais: 'Dados pessoais: nome e CPF/CNPJ do contribuinte (LGPD — exige finalidade e validade; todo acesso é registrado).',
};
const asyncRoute = rotaAsync('api-externa');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

// ---- Chave ------------------------------------------------------------------
export function gerarChave() {
  const prefixo = crypto.randomBytes(5).toString('hex');           // 10 hex, público
  const segredo = crypto.randomBytes(32).toString('base64url');    // 43 chars
  const chave = `bzr_${prefixo}_${segredo}`;
  return { chave, prefixo, hash: sha256(chave) };
}
export function lerChave(texto) {
  const c = String(texto || '').trim();
  const m = /^bzr_([0-9a-f]{10})_([A-Za-z0-9_-]{43})$/.exec(c);
  return m ? { chave: c, prefixo: m[1] } : null;
}
const chaveDaRequisicao = (req) => {
  const h = req.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : (req.get('x-api-key') || '');
};

/** Valida a chave, a validade, o IP e o limite por minuto. */
async function autenticarChave(req, res, next) {
  const parsed = lerChave(chaveDaRequisicao(req));
  const negar = (status, msg) => res.status(status).json({ error: msg });
  if (!parsed) return negar(401, 'Informe a chave no cabeçalho Authorization: Bearer bzr_… (ou X-API-Key).');
  // Força bruta: 30 chaves erradas por IP a cada 15 min.
  const kFalha = `api-falha:${req.ip}`;
  if (excedeu(kFalha, { janelaMs: 15 * 60000, max: 30 })) return negar(429, 'Muitas chaves inválidas a partir deste IP. Aguarde.');
  let row;
  try { row = (await query('SELECT * FROM api_chaves WHERE prefixo = $1', [parsed.prefixo])).rows[0]; } catch (e) { return negar(500, e.message); }
  const ok = row && crypto.timingSafeEqual(Buffer.from(row.hash, 'hex'), Buffer.from(sha256(parsed.chave), 'hex'));
  if (!ok) { contarFalha(kFalha, 15 * 60000); return negar(401, 'Chave inválida.'); }
  if (row.revogada_em) return negar(401, 'Chave revogada.');
  if (row.expira_em && new Date(row.expira_em) < new Date()) return negar(401, 'Chave expirada.');
  if (MUNICIPIO_FIXO && row.municipio !== MUNICIPIO_FIXO) return negar(401, 'Chave de outro município.');
  if (row.ips_permitidos?.length && !row.ips_permitidos.includes(String(req.ip))) return negar(403, `IP ${req.ip} não autorizado para esta chave.`);
  const kLimite = `api-chave:${row.id}`;
  const espera = excedeu(kLimite, { janelaMs: 60000, max: row.limite_min });
  if (espera) { res.set('Retry-After', String(espera)); return negar(429, `Limite de ${row.limite_min} requisições por minuto.`); }
  contarFalha(kLimite, 60000); // conta a requisição
  res.set('X-RateLimit-Limit', String(row.limite_min));
  req.chave = row;
  const rota = req.originalUrl.split('?')[0];
  req.user = { uid: null, role: 'api', nome: `API: ${row.nome}` };
  res.on('finish', () => {
    query(`INSERT INTO api_acessos (chave_id, municipio, rota, parametros, formato, status, registros, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.id, row.municipio, rota, JSON.stringify(req.query || {}), res.locals.formato || 'json', res.statusCode, res.locals.registros || 0, String(req.ip || '')])
      .catch((e) => console.error('[api-externa] log:', e.message));
    query('UPDATE api_chaves SET usos = usos + 1, ultimo_uso_em = now() WHERE id = $1', [row.id]).catch(() => {});
  });
  next();
}
const tem = (req, escopo) => req.chave.escopos.includes(escopo);
const exigir = (escopo) => (req, res, next) => (tem(req, escopo) ? next() : res.status(403).json({ error: `Esta chave não tem o escopo "${escopo}".` }));

// ---- Montagem dos registros (somente o que o escopo permite) ----------------
const n = (v) => (v == null ? null : Number(v));
const d = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
function imovelPublico(r, req) {
  const o = {
    inscricao: r.inscricao,
    cib: r.cib_simulado ? null : (r.cib || null),
    lote: r.lote_codigo || null,
    tipo: r.tipo, uso: r.uso || null, situacao: r.situacao,
    endereco: { logradouro: r.logradouro, numero: r.numero, complemento: r.complemento, bairro: r.bairro, cep: r.cep },
    areaTerrenoM2: n(r.area_terreno_m2), areaConstruidaM2: n(r.area_construida_m2),
  };
  if (tem(req, 'cadastro')) Object.assign(o, {
    setor: r.setor, quadra: r.quadra, loteNumero: r.lote_num,
    testadaM: n(r.testada_m), pavimentos: n(r.n_pavimentos), padraoConstrutivo: r.padrao_construtivo, anoConstrucao: n(r.ano_construcao),
    tipoLogradouro: n(r.tipo_logradouro), tipoArquitetonico: n(r.tp_arquitetonico), destinacao: n(r.destinacao),
    registro: { matricula: r.matricula_cartorio, cartorio: r.cartorio, cnm: r.cnm_ri || null, cns: n(r.cns_ri) },
    sinter: { status: r.sinter_status, cibAtribuidoEm: r.cib_simulado ? null : d(r.cib_atribuido_em) },
    baixa: r.situacao === 'baixado' ? { data: d(r.data_baixa), motivo: r.motivo_baixa } : null,
    atualizadoEm: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  });
  if (tem(req, 'valores')) o.valorVenal = { exercicio: n(r.valor_venal_ano), terreno: n(r.valor_venal_terreno), construcao: n(r.valor_venal_construcao), total: n(r.valor_venal_total) };
  if (tem(req, 'pessoais')) o.contribuinte = {
    nome: r.contribuinte_nome || null, documento: r.contribuinte_doc ? formatarDoc(normalizarNi(r.contribuinte_doc)) : null,
    titularidade: { tipo: n(r.titular_tipo), percentual: n(r.titular_perc), aquisicao: d(r.titular_dt_aquisicao) },
  };
  return o;
}
function lotePublico(r) {
  return {
    codigo: r.codigo, quadra: r.quadra, bairro: r.bairro, uso: r.uso,
    areaM2: r.area_m2 == null ? null : Math.round(Number(r.area_m2) * 100) / 100,
    centroide: r.cx == null ? null : { lon: Number(r.cx), lat: Number(r.cy) },
  };
}

async function registrarPessoais(req, qtd, rota) {
  if (!tem(req, 'pessoais') || !qtd) return;
  await registrarAcesso(req, { municipio: req.chave.municipio, entidade: 'api_chave', entidadeId: req.chave.id,
    dado: `nome e CPF/CNPJ via API (${qtd} imóve${qtd > 1 ? 'is' : 'l'}) — ${rota}`, finalidade: req.chave.finalidade });
}

function paginacao(req, max) {
  const pagina = Math.max(1, Math.floor(Number(req.query.pagina) || 1));
  const porPagina = Math.min(max, Math.max(1, Math.floor(Number(req.query.por_pagina) || 100)));
  return { pagina, porPagina, offset: (pagina - 1) * porPagina };
}
function formatoDe(req, aceitos) {
  const f = String(req.query.formato || 'json').toLowerCase();
  if (!aceitos.includes(f)) throw erro(400, `formato deve ser ${aceitos.join(', ')}.`);
  return f;
}
function lerBbox(v) {
  if (!v) return null;
  const b = String(v).split(',').map(Number);
  if (b.length !== 4 || !b.every(Number.isFinite) || b[0] >= b[2] || b[1] >= b[3]) throw erro(400, 'bbox = oeste,sul,leste,norte (graus, WGS84).');
  if ((b[2] - b[0]) * (b[3] - b[1]) > 1) throw erro(400, 'bbox grande demais (máx. 1 grau²); pagine por bairro ou quadra.');
  return b;
}

// CSV achatado (; e BOM para o Excel brasileiro).
function achatar(o, prefixo = '', out = {}) {
  for (const [k, v] of Object.entries(o)) {
    const chave = prefixo ? `${prefixo}_${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) achatar(v, chave, out);
    else out[chave] = Array.isArray(v) ? v.join('|') : v;
  }
  return out;
}
function enviarCsv(res, nome, linhas) {
  const planas = linhas.map((l) => achatar(l));
  const cols = [...new Set(planas.flatMap((l) => Object.keys(l)))];
  const corpo = [cols.join(';'), ...planas.map((l) => cols.map((c) => csvEscapar(l[c] ?? '', ';')).join(';'))].join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${nome}.csv"`);
  res.send('﻿' + corpo + '\r\n');
}
const stamp = () => new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date());

const COLS_LOTE = `l.id, l.codigo, l.quadra, l.bairro, l.uso, l.area_m2,
  ST_X(ST_PointOnSurface(l.geom)) AS cx, ST_Y(ST_PointOnSurface(l.geom)) AS cy`;

async function imoveisDosLotes(ids, municipio) {
  if (!ids.length) return new Map();
  const { rows } = await query(`SELECT * FROM imoveis WHERE municipio = $1 AND lote_id = ANY($2::bigint[]) ORDER BY inscricao`, [municipio, ids]);
  const m = new Map();
  for (const r of rows) { if (!m.has(String(r.lote_id))) m.set(String(r.lote_id), []); m.get(String(r.lote_id)).push(r); }
  return m;
}

// ---- Rotas públicas da API (com chave) -------------------------------------
export const apiExternaRouter = Router();
const v1 = Router();
// Sem cookies: qualquer origem pode chamar com a chave (servidor a servidor ou navegador).
v1.use(cors({ origin: '*', allowedHeaders: ['Authorization', 'X-API-Key'], methods: ['GET'] }));
v1.use(autenticarChave);

v1.get('/', (req, res) => res.json({
  municipio: req.chave.municipio,
  chave: { nome: req.chave.nome, prefixo: req.chave.prefixo, escopos: req.chave.escopos, limitePorMinuto: req.chave.limite_min, expiraEm: req.chave.expira_em },
  endpoints: {
    'GET /lotes': 'lista paginada — filtros: codigo, quadra, bairro, bbox; formato=json|geojson|csv',
    'GET /lotes/{codigo}': 'um lote com os seus imóveis — formato=json|geojson|csv',
    ...(req.chave.escopos.includes('cadastro') ? { 'GET /imoveis': 'lista paginada — filtros: inscricao, cib, bairro, situacao, alterados_desde; formato=json|csv', 'GET /imoveis/{inscricao}': 'um imóvel' } : {}),
  },
  documentacao: '/api-externa',
}));

v1.get('/lotes', exigir('lotes'), asyncRoute(async (req, res) => {
  const formato = res.locals.formato = formatoDe(req, ['json', 'geojson', 'csv']);
  const { pagina, porPagina, offset } = paginacao(req, formato === 'csv' ? 5000 : 1000);
  const M = req.chave.municipio;
  const params = [M], w = ['COALESCE(l.municipio, \'\') = $1'];
  const add = (sql, v) => { params.push(v); w.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.codigo) add('l.codigo = ?', String(req.query.codigo));
  if (req.query.quadra) add('l.quadra = ?', String(req.query.quadra));
  if (req.query.bairro) add('l.bairro ILIKE ?', String(req.query.bairro));
  const bbox = lerBbox(req.query.bbox);
  if (bbox) { params.push(...bbox); const k = params.length; w.push(`l.geom && ST_MakeEnvelope($${k - 3},$${k - 2},$${k - 1},$${k},4326)`); }
  const where = w.join(' AND ');
  const total = (await query(`SELECT count(*)::int AS n FROM lotes l WHERE ${where}`, params)).rows[0].n;
  const geo = formato === 'geojson' ? ', ST_AsGeoJSON(l.geom, 7) AS gj' : '';
  const { rows } = await query(`SELECT ${COLS_LOTE}${geo} FROM lotes l WHERE ${where} ORDER BY l.codigo, l.id LIMIT ${porPagina} OFFSET ${offset}`, params);
  const porLote = await imoveisDosLotes(rows.map((r) => r.id), M);
  const lotes = rows.map((r) => ({ ...lotePublico(r), imoveis: (porLote.get(String(r.id)) || []).map((i) => imovelPublico(i, req)) }));
  const qtdImoveis = lotes.reduce((s, l) => s + l.imoveis.length, 0);
  res.locals.registros = lotes.length;
  await registrarPessoais(req, qtdImoveis, 'GET /lotes');
  const meta = { municipio: M, pagina, porPagina, total, paginas: Math.ceil(total / porPagina), geradoEm: new Date().toISOString() };
  if (formato === 'csv') {
    return enviarCsv(res, `lotes-${stamp()}-p${pagina}`, lotes.map(({ imoveis, ...l }) => ({ ...l, qtdImoveis: imoveis.length, inscricoes: imoveis.map((i) => i.inscricao), cibs: imoveis.map((i) => i.cib).filter(Boolean) })));
  }
  if (formato === 'geojson') {
    return res.type('application/geo+json').json({ type: 'FeatureCollection', meta,
      features: rows.map((r, i) => ({ type: 'Feature', id: r.codigo, geometry: r.gj ? JSON.parse(r.gj) : null, properties: lotes[i] })) });
  }
  res.json({ ...meta, lotes });
}));

v1.get('/lotes/:codigo', exigir('lotes'), asyncRoute(async (req, res) => {
  const formato = res.locals.formato = formatoDe(req, ['json', 'geojson', 'csv']);
  const M = req.chave.municipio;
  const { rows } = await query(`SELECT ${COLS_LOTE}, ST_AsGeoJSON(l.geom, 7) AS gj FROM lotes l WHERE COALESCE(l.municipio,'') = $1 AND l.codigo = $2 ORDER BY l.id LIMIT 1`, [M, req.params.codigo]);
  if (!rows[0]) return res.status(404).json({ error: 'Lote não encontrado.' });
  const r = rows[0];
  const imoveis = ((await imoveisDosLotes([r.id], M)).get(String(r.id)) || []).map((i) => imovelPublico(i, req));
  const lote = { ...lotePublico(r), imoveis };
  res.locals.registros = 1;
  await registrarPessoais(req, imoveis.length, `GET /lotes/${r.codigo}`);
  if (formato === 'csv') {
    // Uma linha por imóvel, com os dados do lote repetidos (lote vago: uma linha só com o lote).
    const base = { ...lotePublico(r) };
    return enviarCsv(res, `lote-${r.codigo}`, imoveis.length ? imoveis.map((i) => ({ lote: base, imovel: i })) : [{ lote: base }]);
  }
  if (formato === 'geojson') return res.type('application/geo+json').json({ type: 'Feature', id: r.codigo, geometry: r.gj ? JSON.parse(r.gj) : null, properties: lote });
  res.json({ municipio: M, lote, geometria: r.gj ? JSON.parse(r.gj) : null });
}));

v1.get('/imoveis', exigir('cadastro'), asyncRoute(async (req, res) => {
  const formato = res.locals.formato = formatoDe(req, ['json', 'csv']);
  const { pagina, porPagina, offset } = paginacao(req, formato === 'csv' ? 5000 : 1000);
  const M = req.chave.municipio;
  const params = [M], w = ['municipio = $1'];
  const add = (sql, v) => { params.push(v); w.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.inscricao) add('inscricao = ?', String(req.query.inscricao));
  if (req.query.cib) add('cib = ? AND NOT cib_simulado', String(req.query.cib));
  if (req.query.bairro) add('bairro ILIKE ?', String(req.query.bairro));
  if (req.query.situacao) add('situacao = ?', String(req.query.situacao));
  if (req.query.alterados_desde) {
    const t = new Date(String(req.query.alterados_desde));
    if (Number.isNaN(t.getTime())) throw erro(400, 'alterados_desde deve ser uma data ISO (ex.: 2026-11-01 ou 2026-11-01T08:00:00Z).');
    add('updated_at >= ?', t.toISOString());
  }
  const where = w.join(' AND ');
  const total = (await query(`SELECT count(*)::int AS n FROM imoveis WHERE ${where}`, params)).rows[0].n;
  const { rows } = await query(`SELECT * FROM imoveis WHERE ${where} ORDER BY inscricao LIMIT ${porPagina} OFFSET ${offset}`, params);
  const imoveis = rows.map((r) => imovelPublico(r, req));
  res.locals.registros = imoveis.length;
  await registrarPessoais(req, imoveis.length, 'GET /imoveis');
  if (formato === 'csv') return enviarCsv(res, `imoveis-${stamp()}-p${pagina}`, imoveis);
  res.json({ municipio: M, pagina, porPagina, total, paginas: Math.ceil(total / porPagina), geradoEm: new Date().toISOString(), imoveis });
}));

v1.get('/imoveis/:inscricao', exigir('cadastro'), asyncRoute(async (req, res) => {
  const formato = res.locals.formato = formatoDe(req, ['json', 'csv']);
  const { rows } = await query('SELECT * FROM imoveis WHERE municipio = $1 AND inscricao = $2', [req.chave.municipio, req.params.inscricao]);
  if (!rows[0]) return res.status(404).json({ error: 'Imóvel não encontrado.' });
  const im = imovelPublico(rows[0], req);
  res.locals.registros = 1;
  await registrarPessoais(req, 1, `GET /imoveis/${rows[0].inscricao}`);
  if (formato === 'csv') return enviarCsv(res, `imovel-${rows[0].inscricao}`, [im]);
  res.json({ municipio: req.chave.municipio, imovel: im });
}));

apiExternaRouter.use('/api/externa/v1', v1);

// ---- Gestão das chaves (admin) ----------------------------------------------
const admin = requireRole('admin');
const chavePublica = (r) => ({
  id: r.id, nome: r.nome, prefixo: r.prefixo, escopos: r.escopos, finalidade: r.finalidade, limiteMin: r.limite_min, ipsPermitidos: r.ips_permitidos,
  criadoPor: r.criado_por_nome, criadaEm: r.created_at, expiraEm: r.expira_em, revogadaEm: r.revogada_em, revogadaPor: r.revogada_por_nome,
  motivoRevogacao: r.motivo_revogacao, ultimoUsoEm: r.ultimo_uso_em, usos: Number(r.usos),
  situacao: r.revogada_em ? 'revogada' : (r.expira_em && new Date(r.expira_em) < new Date() ? 'expirada' : 'ativa'),
});

apiExternaRouter.get('/api/externa/escopos', admin, (req, res) => res.json(ESCOPOS));

apiExternaRouter.get('/api/externa/chaves', admin, asyncRoute(async (req, res) => {
  const { rows } = await query('SELECT * FROM api_chaves WHERE municipio = $1 ORDER BY revogada_em NULLS FIRST, created_at DESC', [muniDe(req)]);
  res.json(rows.map(chavePublica));
}));

apiExternaRouter.post('/api/externa/chaves', admin, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const M = muniDe(req);
  const nome = String(b.nome || '').trim().slice(0, 120);
  const escopos = [...new Set((Array.isArray(b.escopos) ? b.escopos : []).map(String))].filter((e) => e in ESCOPOS);
  const finalidade = String(b.finalidade || '').trim().slice(0, 500);
  const limite = Math.min(6000, Math.max(1, Math.floor(Number(b.limiteMin) || 60)));
  const ips = String(b.ipsPermitidos || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).slice(0, 50);
  let expira = b.expiraEm ? new Date(b.expiraEm) : null;
  if (!nome) throw erro(400, 'Informe para quem é a chave (ex.: Cartório do 1º Ofício).');
  if (!escopos.length) throw erro(400, 'Escolha ao menos um escopo.');
  if (expira && (Number.isNaN(expira.getTime()) || expira < new Date())) throw erro(400, 'Validade inválida ou no passado.');
  if (escopos.includes('pessoais')) {
    if (finalidade.length < 20) throw erro(400, 'Dados pessoais exigem a finalidade e a base legal (convênio, lei, ofício) — mín. 20 caracteres.');
    const umAno = new Date(Date.now() + 366 * 86400000);
    if (!expira) throw erro(400, 'Dados pessoais exigem data de validade (máx. 1 ano).');
    if (expira > umAno) throw erro(400, 'Chave com dados pessoais vale no máximo 1 ano.');
  }
  if (expira) expira = expira.toISOString();
  const g = gerarChave();
  const { rows } = await query(
    `INSERT INTO api_chaves (municipio, nome, prefixo, hash, escopos, finalidade, limite_min, ips_permitidos, criado_por, criado_por_nome, expira_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [M, nome, g.prefixo, g.hash, escopos, finalidade, limite, ips, req.user?.uid ?? null, nomeUsuario(req), expira]);
  await auditar(null, { municipio: M, entidade: 'api_chave', entidadeId: rows[0].id, acao: 'chave de API criada', detalhe: `${nome} — escopos: ${escopos.join(', ')}${expira ? ` — válida até ${expira.slice(0, 10)}` : ''}`, usuario: nomeUsuario(req) });
  res.status(201).json({ ...chavePublica(rows[0]), chave: g.chave, aviso: 'Copie a chave agora: ela não será mostrada de novo.' });
}));

apiExternaRouter.post('/api/externa/chaves/:id/revogar', admin, asyncRoute(async (req, res) => {
  const motivo = String(req.body?.motivo || '').trim().slice(0, 300);
  const { rows } = await query(
    `UPDATE api_chaves SET revogada_em = now(), revogada_por_nome = $3, motivo_revogacao = $4 WHERE id = $1 AND municipio = $2 AND revogada_em IS NULL RETURNING *`,
    [req.params.id, muniDe(req), nomeUsuario(req), motivo]);
  if (!rows[0]) throw erro(404, 'Chave não encontrada ou já revogada.');
  await auditar(null, { municipio: rows[0].municipio, entidade: 'api_chave', entidadeId: rows[0].id, acao: 'chave de API revogada', detalhe: `${rows[0].nome}${motivo ? ' — ' + motivo : ''}`, usuario: nomeUsuario(req) });
  res.json(chavePublica(rows[0]));
}));

apiExternaRouter.get('/api/externa/acessos', admin, asyncRoute(async (req, res) => {
  const params = [muniDe(req)];
  let w = 'a.municipio = $1';
  if (req.query.chave) { params.push(Number(req.query.chave)); w += ` AND a.chave_id = $${params.length}`; }
  const { rows } = await query(`SELECT a.*, c.nome AS chave_nome, c.prefixo FROM api_acessos a JOIN api_chaves c ON c.id = a.chave_id
    WHERE ${w} ORDER BY a.created_at DESC, a.id DESC LIMIT ${Math.min(2000, Number(req.query.limit) || 300)}`, params);
  res.json(rows);
}));
