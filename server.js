// Servidor Express da plataforma BzR: páginas estáticas + API dos módulos
// Território (WebGIS), CIB/Sinter, Documentos, BCI, Demandas e O.S./Waze.
//
// Produção (NODE_ENV=production): o boot FALHA se o ambiente não for seguro
// (login desligado, segredo fraco, modo demonstração, sem MUNICIPIO/PUBLIC_BASE_URL)
// — ver src/env.js. O schema é mantido por migrations versionadas (src/migrate.js).
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { PRODUCAO, conferirAmbiente, modulosAtivos, MUNICIPIO_FIXO, demoPermitido } from './src/env.js';
import { isConfigured, healthcheck, query } from './src/db.js';
import { runMigrations } from './src/migrate.js';
import {
  isValidLayer, getLayerGeoJSON, getDashboard, getHeatmap,
  getExtent, getCounts, getBairros, getMunicipios,
} from './src/queries.js';
import { osRouter } from './src/os.js';
import { IMPORT_LAYERS, insertFeatures, backfillMeasures } from './src/import.js';
import { authRouter, requireAuth, requireRole, semearUsuarios, bloquearEscritaGestor, AUTH_ENABLED } from './src/auth.js';
import { demandasRouter } from './src/demandas.js';
import { bciRouter, semearFormularioBci } from './src/bci.js';
import { cibRouter } from './src/cib.js';
import { remessasRouter } from './src/cib-remessas.js';
import { pgvRouter } from './src/pgv.js';
import { importacaoRouter } from './src/importacao.js';
import { lgpdRouter } from './src/lgpd.js';
import { documentosRouter } from './src/documentos.js';
import { limitar } from './src/ratelimit.js';

// ---- Travas de ambiente (antes de qualquer coisa) -------------------------
const amb = conferirAmbiente();
for (const a of amb.avisos) console.warn('[env] aviso:', a);
if (amb.erros.length) {
  console.error('[env] Configuração insegura para produção — o servidor NÃO vai subir:');
  for (const e of amb.erros) console.error('  ✗', e);
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const MODULOS = modulosAtivos();
const ativo = (m) => MODULOS.includes(m);

// Token opcional para proteger as rotas de escrita de importacao (/api/import).
const IMPORT_TOKEN = process.env.IMPORT_TOKEN || '';

const app = express();
app.set('trust proxy', 1); // Render/Neon: IP real do cliente para o rate limit e a auditoria LGPD
app.disable('x-powered-by');
app.use(cors(PRODUCAO ? { origin: process.env.PUBLIC_BASE_URL } : undefined));
// Limite generoso: importação de GeoJSON em lote e fotos das O.S. (base64).
app.use(express.json({ limit: '25mb' }));

// ---- Liga/desliga de módulos por cliente (MODULOS=…) -----------------------
// Páginas e APIs de módulo desligado respondem 404.
const ROTAS_MODULO = {
  territorio: { paginas: ['/territorio', '/territorio.html', '/importar', '/importar.html', '/mapa'], api: ['/api/layers', '/api/dashboard', '/api/heatmap', '/api/counts', '/api/bairros', '/api/extent', '/api/municipios', '/api/import'] },
  cib: { paginas: ['/cib'], api: ['/api/cib'] },
  documentos: { paginas: ['/documentos', '/validar', '/validar.html'], api: ['/api/documentos', '/api/requerimentos', '/api/publico'] },
  bci: { paginas: ['/bci'], api: ['/api/bci'] },
  demandas: { paginas: ['/demandas'], api: ['/api/demandas'] },
  os: { paginas: ['/os'], api: ['/api/ordens', '/api/proximo-numero', '/api/ping', '/api/diagnostico'] },
  waze: { paginas: ['/os/dashboard-waze'], api: ['/api/waze'] },
};
const comeca = (p, prefixos) => prefixos.some((x) => p === x || p.startsWith(x + '/') || p.startsWith(x + '.') || p.startsWith(x + '?'));
app.use((req, res, next) => {
  for (const [m, r] of Object.entries(ROTAS_MODULO)) {
    if (ativo(m)) continue;
    if (comeca(req.path, r.api)) return res.status(404).json({ error: `Módulo "${m}" não está habilitado nesta instalação.` });
    if (comeca(req.path, r.paginas)) return res.status(404).send('Módulo não habilitado nesta instalação.');
  }
  next();
});
// Público: quais módulos estão ativos (a navegação esconde os demais).
app.get('/api/modulos', (req, res) => res.json({ modulos: MODULOS, municipio: MUNICIPIO_FIXO || null, producao: PRODUCAO }));

// ---- Tiles locais da ortofoto (opcional) ---------------------------------
const localTilesDir = path.join(__dirname, 'tiles');
const hasLocalOrtho = fs.existsSync(path.join(localTilesDir, 'ortho'));
const serveLocalTiles = String(process.env.SERVE_LOCAL_TILES || 'true') === 'true';
if (serveLocalTiles && fs.existsSync(localTilesDir)) {
  app.use('/tiles', express.static(localTilesDir, { maxAge: '7d', fallthrough: true }));
}

// ---- Front-end estático ---------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get(['/home', '/landing'], (req, res) => res.redirect(301, '/'));
app.get('/mapa', (req, res) => res.redirect(301, '/territorio'));
app.get(['/cadastro', '/sinter'], (req, res) => res.redirect(302, '/cib/'));

// ---- Segurança da API -----------------------------------------------------
// Força bruta no login: 10 tentativas / 15 min por IP+e-mail.
app.post('/api/auth/login', limitar({ nome: 'login', janelaMs: 15 * 60000, max: 10, chave: (req) => `${req.ip}|${String(req.body?.email || '').toLowerCase()}` }));
// Perfil gestor é somente leitura em toda a API.
app.use('/api', bloquearEscritaGestor);
// Login nas APIs do Território e das O.S. (antes ficavam abertas). Rotas públicas:
// /api/health, /api/config, /api/modulos, /api/auth/config, /api/auth/login, /api/publico/*.
app.use(['/api/layers', '/api/dashboard', '/api/heatmap', '/api/counts', '/api/bairros', '/api/extent', '/api/municipios', '/api/import/:layer',
  '/api/ordens', '/api/proximo-numero', '/api/ping', '/api/diagnostico', '/api/waze'], requireAuth);
// Escrita nas O.S. e importação de camadas: técnico ou acima.
app.use(['/api/import/:layer'], requireRole('admin', 'coordenador', 'tecnico'));

// ---- Módulos ---------------------------------------------------------------
app.use(documentosRouter); // /api/publico/* (validação), /api/documentos, /api/requerimentos
app.use(authRouter);       // /api/auth/*, /api/usuarios
app.use(demandasRouter);   // /api/demandas/*
app.use(bciRouter);        // /api/bci/*
app.use(cibRouter);        // /api/cib/* (imóveis, ciclo mensal, implantação, vistoria, auditoria)
app.use(remessasRouter);   // /api/cib/remessas, retorno, reprocessamento, divergências
app.use(pgvRouter);        // /api/cib/pgv (exercícios)
app.use(importacaoRouter); // /api/cib/importacoes
app.use(lgpdRouter);       // /api/lgpd/acessos
app.use(osRouter);         // /api/ordens, /api/waze/*

// ---- Configuração pública para o front ------------------------------------
function buildPublicConfig() {
  let orthoUrl = process.env.ORTHO_TILE_URL || '';
  if (!orthoUrl && hasLocalOrtho) orthoUrl = '/tiles/ortho/{z}/{x}/{y}.png';
  return {
    appName: 'BzR Território',
    map: {
      center: [Number(process.env.MAP_CENTER_LAT) || -22.0178, Number(process.env.MAP_CENTER_LNG) || -47.8908],
      zoom: Number(process.env.MAP_ZOOM) || 14,
      minZoom: 3,
      maxZoom: 22,
    },
    ortho: {
      url: orthoUrl || null,
      attribution: process.env.ORTHO_TILE_ATTRIBUTION || 'Ortofoto municipal',
      minZoom: Number(process.env.ORTHO_TILE_MINZOOM) || 0,
      maxZoom: Number(process.env.ORTHO_TILE_MAXZOOM) || 22,
    },
    layers: [
      { id: 'bairros', label: 'Bairros', kind: 'polygon' },
      { id: 'quadras', label: 'Quadras', kind: 'polygon' },
      { id: 'lotes', label: 'Lotes', kind: 'polygon', porBbox: true },
      { id: 'edificacoes', label: 'Edificacoes', kind: 'polygon', porBbox: true },
      { id: 'ruas', label: 'Ruas', kind: 'line' },
    ],
    // Camadas pesadas são carregadas só na área visível a partir deste zoom.
    bbox: { zoomMinimo: Number(process.env.MAPA_ZOOM_DETALHE) || 14, limite: Number(process.env.MAPA_LIMITE_FEICOES) || 5000 },
    municipioFixo: MUNICIPIO_FIXO || null,
    authEnabled: AUTH_ENABLED,
    dbConfigured: isConfigured,
  };
}

// ---- Helpers --------------------------------------------------------------
function requireDb(res) {
  if (!isConfigured) {
    res.status(503).json({ error: 'Banco de dados nao configurado. Defina DATABASE_URL.' });
    return false;
  }
  return true;
}

const asyncRoute = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[api]', req.path, err.message);
    res.status(500).json({ error: PRODUCAO ? 'Erro interno.' : err.message });
  });
};

function parseBbox(value) {
  if (!value) return undefined;
  const parts = String(value).split(',').map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : undefined;
}

// Município: o da instância (MUNICIPIO) prevalece sobre o enviado pelo cliente.
const muni = (req) => MUNICIPIO_FIXO || (req.query.municipio ? String(req.query.municipio) : undefined);

// ---- Rotas da API ---------------------------------------------------------
app.get('/api/health', asyncRoute(async (req, res) => {
  // Sempre 200 enquanto o processo HTTP estiver vivo (liveness probe).
  const hc = await healthcheck();
  res.status(200).json(PRODUCAO ? { ok: hc.ok } : hc);
}));

app.get('/api/config', (req, res) => res.json(buildPublicConfig()));

app.get('/api/municipios', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  if (MUNICIPIO_FIXO) return res.json([MUNICIPIO_FIXO]);
  res.json(await getMunicipios());
}));

app.get('/api/counts', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  res.json(await getCounts(muni(req)));
}));

app.get('/api/bairros', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  res.json(await getBairros(muni(req)));
}));

app.get('/api/extent', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  res.json({ extent: await getExtent(muni(req)) });
}));

app.get('/api/dashboard', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  res.json(await getDashboard(muni(req)));
}));

app.get('/api/heatmap', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  const metric = String(req.query.metric || 'populacao');
  res.json({ metric, points: await getHeatmap(metric, muni(req)) });
}));

app.get('/api/layers/:layer', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  const { layer } = req.params;
  if (!isValidLayer(layer)) {
    return res.status(404).json({ error: 'Camada invalida: ' + layer });
  }
  const fc = await getLayerGeoJSON(layer, {
    municipio: muni(req),
    bbox: parseBbox(req.query.bbox),
    bairro: req.query.bairro ? String(req.query.bairro) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    simplify: req.query.simplify ? Number(req.query.simplify) : undefined,
    includeProps: req.query.props === '1' || req.query.props === 'true',
  });
  res.json(fc);
}));

// ---- Importacao de GeoJSON pela plataforma (/importar) --------------------
function requireImportToken(req, res, next) {
  if (!IMPORT_TOKEN) return next();
  const sent = req.get('x-import-token') || '';
  if (sent === IMPORT_TOKEN) return next();
  return res.status(401).json({ error: 'Token de importacao invalido ou ausente.' });
}

app.get('/api/import/config', (req, res) => {
  res.json({ layers: IMPORT_LAYERS, tokenRequired: Boolean(IMPORT_TOKEN), dbConfigured: isConfigured, municipioFixo: MUNICIPIO_FIXO || null });
});

app.post('/api/import/:layer', requireImportToken, asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  const { layer } = req.params;
  if (!IMPORT_LAYERS.includes(layer)) {
    return res.status(404).json({ error: 'Camada invalida: ' + layer });
  }
  const body = req.body || {};
  const features = body.features;
  if (!Array.isArray(features)) {
    return res.status(400).json({ error: 'Envie { features: [...] } com pelo menos 1 feicao.' });
  }
  if (features.length > 2000) {
    return res.status(400).json({ error: 'Maximo de 2000 feicoes por requisicao (envie em lotes).' });
  }
  const municipio = MUNICIPIO_FIXO || (body.municipio ? String(body.municipio) : null);
  const truncate = body.truncate === true || body.truncate === 'true';
  const { inserted, skipped } = await insertFeatures(layer, features, { municipio, truncate });
  res.json({ ok: true, inserted, skipped });
}));

app.post('/api/import/:layer/finalize', requireImportToken, asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
  const { layer } = req.params;
  if (!IMPORT_LAYERS.includes(layer)) {
    return res.status(404).json({ error: 'Camada invalida: ' + layer });
  }
  const municipio = MUNICIPIO_FIXO || (req.body && req.body.municipio ? String(req.body.municipio) : null);
  await backfillMeasures(layer, municipio);
  const counts = await getCounts(municipio);
  res.json({ ok: true, counts });
}));

// ---- Boot -----------------------------------------------------------------
async function seedsDemonstracao() {
  // Só fora de produção (src/env.js bloqueia em produção).
  const seeds = [
    ['SEED_DEMO', async () => Object.values(await getCounts()).reduce((s, n) => s + Number(n || 0), 0) === 0, async () => (await import('./scripts/seed-demo.js')).seedDemo({ truncate: true, log: console.log })],
    ['SEED_OS_DEMO', async () => (await query('SELECT COUNT(*)::int AS n FROM ordens_servico')).rows[0].n === 0, async () => (await import('./scripts/seed-os.js')).seedOsDemo({ truncate: false, log: console.log })],
    ['SEED_DEMANDAS_DEMO', async () => (await query('SELECT COUNT(*)::int AS n FROM demandas')).rows[0].n === 0, async () => (await import('./scripts/seed-demandas.js')).seedDemandasDemo({ log: console.log })],
    ['SEED_BCI_DEMO', async () => (await query('SELECT COUNT(*)::int AS n FROM bci')).rows[0].n === 0, async () => (await import('./scripts/seed-bci.js')).seedBciDemo({ log: console.log })],
    ['SEED_CIB_DEMO', async () => (await query('SELECT COUNT(*)::int AS n FROM imoveis')).rows[0].n === 0, async () => (await import('./scripts/seed-cib.js')).seedCibDemo({ log: console.log })],
  ];
  for (const [flag, vazio, rodar] of seeds) {
    if (demoPermitido(flag) && await vazio()) {
      console.log(`[demo] ${flag}=true e sem dados — carregando demonstração…`);
      await rodar();
    }
  }
}

async function start() {
  if (isConfigured) {
    try {
      const aplicadas = await runMigrations();
      console.log(`[db] migrations em dia${aplicadas.length ? ` (aplicadas: ${aplicadas.join(', ')})` : ''}.`);
      await semearUsuarios();
      await semearFormularioBci();
      if (!PRODUCAO) await seedsDemonstracao();
    } catch (e) {
      console.error('[db] falha ao preparar o banco:', e.message);
      if (PRODUCAO) process.exit(1); // em produção, não sobe com schema inconsistente
    }
  } else {
    console.warn('[db] DATABASE_URL nao definida — a API de dados respondera 503 ate configurar.');
  }
  app.listen(PORT, () => {
    console.log(`BzR rodando em http://localhost:${PORT}${MUNICIPIO_FIXO ? ` · município: ${MUNICIPIO_FIXO}` : ''} · módulos: ${MODULOS.join(', ')}${PRODUCAO ? ' · PRODUÇÃO' : ''}`);
  });
}

start();
