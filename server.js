// Servidor Express: serve o front-end estatico e a API dos dois modulos do
// sistema BzR — Território (WebGIS: GeoJSON, dashboard, mapa de calor,
// ortofoto) e Ordens de Serviço (O.S. da infraestrutura + buracos do Waze).
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { isConfigured, healthcheck } from './src/db.js';
import { ensureSchema } from './src/schema.js';
import {
  isValidLayer, getLayerGeoJSON, getDashboard, getHeatmap,
  getExtent, getCounts, getBairros, getMunicipios,
} from './src/queries.js';
import { seedDemo } from './scripts/seed-demo.js';
import { osRouter, ensureOsSchema } from './src/os.js';
import { IMPORT_LAYERS, insertFeatures, backfillMeasures } from './src/import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Token opcional para proteger as rotas de escrita de importacao (/api/import).
// Se definido, a pagina de importacao precisa envia-lo no cabecalho
// `x-import-token`. Sem ele, as rotas ficam abertas (util em desenvolvimento).
const IMPORT_TOKEN = process.env.IMPORT_TOKEN || '';

const app = express();
app.use(cors());
// Limite generoso: importacao de GeoJSON em lote e fotos das O.S. (base64).
app.use(express.json({ limit: '25mb' }));

// ---- Tiles locais da ortofoto (opcional) ---------------------------------
const localTilesDir = path.join(__dirname, 'tiles');
const hasLocalOrtho = fs.existsSync(path.join(localTilesDir, 'ortho'));
const serveLocalTiles = String(process.env.SERVE_LOCAL_TILES || 'true') === 'true';
if (serveLocalTiles && fs.existsSync(localTilesDir)) {
  app.use('/tiles', express.static(localTilesDir, { maxAge: '7d', fallthrough: true }));
}

// ---- Front-end estatico ---------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---- Modulo de Ordens de Servico (rotas /api/ordens, /api/waze/*) --------
app.use(osRouter);

// ---- Configuracao publica para o front ------------------------------------
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
      { id: 'lotes', label: 'Lotes', kind: 'polygon' },
      { id: 'edificacoes', label: 'Edificacoes', kind: 'polygon' },
      { id: 'ruas', label: 'Ruas', kind: 'line' },
    ],
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
    res.status(500).json({ error: err.message });
  });
};

function parseBbox(value) {
  if (!value) return undefined;
  const parts = String(value).split(',').map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : undefined;
}

const muni = (req) => (req.query.municipio ? String(req.query.municipio) : undefined);

// ---- Rotas da API ---------------------------------------------------------
app.get('/api/health', asyncRoute(async (req, res) => {
  // Sempre 200 enquanto o processo HTTP estiver vivo (liveness probe).
  // O status do banco vai no corpo — assim um banco ainda nao configurado
  // ou "dormindo" no Neon nao derruba o health check do Render.
  const hc = await healthcheck();
  res.status(200).json(hc);
}));

app.get('/api/config', (req, res) => res.json(buildPublicConfig()));

app.get('/api/municipios', asyncRoute(async (req, res) => {
  if (!requireDb(res)) return;
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
// Fluxo (feito pela pagina, em lotes): POST /api/import/:layer com um pedaco
// das feicoes (truncate=true so no primeiro pedaco de cada camada) e, ao final,
// POST /api/import/:layer/finalize para recalcular areas/extensoes.
function requireImportToken(req, res, next) {
  if (!IMPORT_TOKEN) return next();
  const sent = req.get('x-import-token') || '';
  if (sent === IMPORT_TOKEN) return next();
  return res.status(401).json({ error: 'Token de importacao invalido ou ausente.' });
}

app.get('/api/import/config', (req, res) => {
  res.json({ layers: IMPORT_LAYERS, tokenRequired: Boolean(IMPORT_TOKEN), dbConfigured: isConfigured });
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
  const municipio = body.municipio ? String(body.municipio) : null;
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
  const municipio = req.body && req.body.municipio ? String(req.body.municipio) : null;
  await backfillMeasures(layer, municipio);
  const counts = await getCounts(municipio);
  res.json({ ok: true, counts });
}));

// ---- Boot -----------------------------------------------------------------
async function start() {
  if (isConfigured) {
    try {
      await ensureSchema();
      await ensureOsSchema();
      console.log('[db] schema verificado (território + ordens de serviço).');
      // Auto-seed opcional: util para um deploy de demonstracao sem shell.
      if (String(process.env.SEED_DEMO || '') === 'true') {
        const counts = await getCounts();
        const total = Object.values(counts).reduce((s, n) => s + Number(n || 0), 0);
        if (total === 0) {
          console.log('[db] SEED_DEMO=true e banco vazio — carregando cidade de demonstracao...');
          await seedDemo({ truncate: true, log: console.log });
          console.log('[db] seed de demonstracao concluido.');
        }
      }
    } catch (e) {
      console.error('[db] nao foi possivel preparar o schema:', e.message);
    }
  } else {
    console.warn('[db] DATABASE_URL nao definida — a API de dados respondera 503 ate configurar.');
  }
  app.listen(PORT, () => {
    console.log(`BzR rodando em http://localhost:${PORT} (Território) e /os (Ordens de Serviço)`);
  });
}

start();
