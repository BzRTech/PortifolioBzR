// Importa Ordens de Servico de OUTRO banco Postgres (ex.: um Neon existente)
// para o banco do app. Flexivel: se a tabela de origem for a mesma do
// SistemaOS (colunas iguais), copia fielmente (numero, status, historico,
// fotos, datas); caso contrario, mapeia pelas colunas mais comuns.
//
// Uso (as URLs NUNCA ficam no codigo — passe por variavel de ambiente):
//   SOURCE_DATABASE_URL="postgres://...neon..." \
//   DATABASE_URL="postgres://...banco-do-app..." \
//   npm run import-os-neon -- --table ordens_servico
//
// Flags:
//   --table <nome>   tabela de origem (padrao: ordens_servico)
//   --truncate       limpa as O.S. do destino antes de importar
//   --limit <n>      importa no maximo n linhas (teste)
//   --dry-run        so mostra o de-para e as contagens, sem gravar
import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'crypto';
import { isConfigured, withTransaction, query, closePool } from '../src/db.js';
import { ensureOsSchema } from '../src/os.js';

const arg = (name, def = null) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : def;
};
const SOURCE_URL = process.env.SOURCE_DATABASE_URL || '';
const SOURCE_TABLE = String(arg('table', 'ordens_servico'));
const TRUNCATE = !!arg('truncate', false);
const DRY = !!arg('dry-run', false);
const LIMIT = arg('limit') ? parseInt(arg('limit'), 10) : null;

const ANO = new Date().getFullYear();
const fmtNumero = (seq) => `OS-${ANO}-${String(seq).padStart(4, '0')}`;

// ---- de-para de colunas (aliases comuns, PT-BR/EN) -----------------------
const ALIASES = {
  numero: ['numero', 'num_os', 'os', 'protocolo', 'codigo'],
  tipo: ['tipo', 'tipo_servico', 'servico', 'categoria', 'assunto'],
  descricao: ['descricao', 'descrição', 'description', 'detalhe', 'detalhes', 'obs', 'observacao', 'observação'],
  endereco: ['endereco', 'endereço', 'logradouro', 'local', 'rua', 'address'],
  bairro: ['bairro', 'neighborhood', 'distrito'],
  referencia: ['referencia', 'referência', 'ponto_referencia', 'complemento'],
  solicitante: ['solicitante', 'requerente', 'cidadao', 'cidadão', 'nome', 'requester'],
  responsavel: ['responsavel', 'responsável', 'tecnico', 'técnico', 'fiscal', 'engenheiro'],
  equipe: ['equipe', 'empreiteira', 'empresa', 'team'],
  prioridade: ['prioridade', 'priority', 'urgencia', 'urgência'],
  prazo: ['prazo', 'data_prazo', 'previsao', 'previsão', 'deadline'],
  status: ['status', 'situacao', 'situação', 'estado'],
  ocorrencias: ['ocorrencias', 'ocorrências', 'reincidencias', 'qtd', 'quantidade'],
  tag: ['tag', 'origem', 'fonte', 'source', 'canal'],
  foto_abertura: ['foto_abertura', 'fotos_abertura', 'foto_inicio', 'foto'],
  foto_conclusao: ['foto_conclusao', 'fotos_conclusao', 'foto_fim'],
  historico: ['historico', 'histórico', 'timeline', 'history'],
  criado_em: ['criado_em', 'created_at', 'data_abertura', 'data', 'abertura', 'data_criacao', 'dt_abertura'],
  concluido_em: ['concluido_em', 'concluído_em', 'data_conclusao', 'fechamento', 'dt_conclusao'],
  lat: ['lat', 'latitude', 'y'],
  lng: ['lng', 'lon', 'long', 'longitude', 'x'],
  coordenadas: ['coordenadas', 'coordenada', 'coord', 'geo', 'latlng'],
};

const STATUS_MAP = [
  [/(cancel)/i, 'cancelada'],
  [/(conclu|final|fechad|resolv|atendid)/i, 'concluida'],
  [/(andamento|execu|progress|iniciad)/i, 'andamento'],
  [/(valid|aprovad)/i, 'validada'],
  [/(abert|nova|pendente|open|aguard)/i, 'aberta'],
];
function normStatus(v) {
  const s = String(v ?? '').trim();
  if (!s) return 'aberta';
  for (const [re, out] of STATUS_MAP) if (re.test(s)) return out;
  return 'aberta';
}
const PRIO_MAP = [[/(urgent|urgência|critica|crítica)/i, 'alta'], [/(alta|high)/i, 'alta'], [/(baix|low)/i, 'baixa']];
function normPrioridade(v) {
  const s = String(v ?? '').trim();
  if (!s) return 'media';
  for (const [re, out] of PRIO_MAP) if (re.test(s)) return out;
  return 'media';
}
function toStr(v) { return v == null ? '' : String(v); }
function validarData(v) { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); }
function parseHistorico(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') return v;
  const s = String(v).trim();
  if (!s) return null;
  try { const p = JSON.parse(s); return Array.isArray(p) ? p : (Array.isArray(p) ? p : null); } catch { return null; }
}

async function main() {
  if (!SOURCE_URL) { console.error('Defina SOURCE_DATABASE_URL (o banco de origem, ex.: seu Neon).'); process.exit(1); }
  if (!isConfigured) { console.error('Defina DATABASE_URL (o banco do app, destino).'); process.exit(1); }

  const src = new pg.Pool({ connectionString: SOURCE_URL, ssl: { rejectUnauthorized: false }, max: 3 });

  // 1) Introspecciona as colunas da origem.
  const { rows: cols } = await src.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
    [SOURCE_TABLE]
  );
  if (!cols.length) {
    console.error(`Tabela "${SOURCE_TABLE}" nao encontrada na origem. Use --table <nome>. Tabelas disponiveis:`);
    const { rows: tbls } = await src.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
    console.error('  ' + tbls.map((t) => t.table_name).join(', '));
    await src.end(); process.exit(1);
  }
  const present = new Set(cols.map((c) => c.column_name.toLowerCase()));
  const found = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    const hit = aliases.find((a) => present.has(a.toLowerCase()));
    if (hit) found[hit] = field; // coluna_origem -> campo
  }
  const mapa = Object.fromEntries(Object.entries(found).map(([col, f]) => [f, col])); // campo -> coluna
  console.log(`Origem "${SOURCE_TABLE}" (${cols.length} colunas). De-para detectado:`);
  for (const f of Object.keys(ALIASES)) if (mapa[f]) console.log(`  ${f.padEnd(14)} <- ${mapa[f]}`);
  const naoMapeadas = [...present].filter((c) => !Object.values(mapa).map((x) => x.toLowerCase()).includes(c));
  if (naoMapeadas.length) console.log('  (colunas ignoradas: ' + naoMapeadas.join(', ') + ')');

  // 2) Le as linhas.
  const sel = `SELECT * FROM "${SOURCE_TABLE}" ORDER BY 1 ${LIMIT ? 'LIMIT ' + LIMIT : ''}`;
  const { rows } = await src.query(sel);
  console.log(`\n${rows.length} linha(s) lida(s) da origem.`);
  await src.end();

  const get = (row, field) => (mapa[field] ? row[mapa[field]] : undefined);
  const registros = rows.map((row) => {
    // Coordenadas -> embutidas na referencia (padrao do app p/ o mapa).
    let referencia = toStr(get(row, 'referencia'));
    let lat = get(row, 'lat'), lng = get(row, 'lng');
    const coord = get(row, 'coordenadas');
    if ((lat == null || lng == null) && coord) {
      const m = String(coord).match(/(-?\d+(?:\.\d+)?)[,; ]+(-?\d+(?:\.\d+)?)/);
      if (m) { lat = m[1]; lng = m[2]; }
    }
    if (lat != null && lng != null && !/Coordenadas:/i.test(referencia)) {
      referencia = (referencia ? referencia + ' · ' : '') + `Coordenadas: ${lat}, ${lng}`;
    }
    return {
      numero: toStr(get(row, 'numero')).trim() || null,
      tipo: toStr(get(row, 'tipo')),
      descricao: toStr(get(row, 'descricao')),
      endereco: toStr(get(row, 'endereco')),
      bairro: toStr(get(row, 'bairro')),
      referencia,
      solicitante: toStr(get(row, 'solicitante')).trim() || 'Importado',
      responsavel: toStr(get(row, 'responsavel')),
      equipe: toStr(get(row, 'equipe')),
      prioridade: normPrioridade(get(row, 'prioridade')),
      prazo: validarData(get(row, 'prazo'))?.slice(0, 10) || null,
      status: normStatus(get(row, 'status')),
      ocorrencias: Math.max(1, parseInt(get(row, 'ocorrencias'), 10) || 1),
      tag: toStr(get(row, 'tag')).slice(0, 40),
      foto_abertura: get(row, 'foto_abertura') != null ? toStr(get(row, 'foto_abertura')) : null,
      foto_conclusao: get(row, 'foto_conclusao') != null ? toStr(get(row, 'foto_conclusao')) : null,
      historico: parseHistorico(get(row, 'historico')),
      criado_em: validarData(get(row, 'criado_em')) || new Date().toISOString(),
      concluido_em: validarData(get(row, 'concluido_em')),
    };
  });

  if (DRY) {
    console.log('\n--dry-run: nada foi gravado. Amostra (3 primeiras):');
    console.log(JSON.stringify(registros.slice(0, 3), null, 2));
    await closePool(); return;
  }

  // 3) Grava no destino.
  await ensureOsSchema();
  const COLS = `id, numero, tipo, descricao, endereco, bairro, referencia, solicitante, responsavel,
    equipe, prioridade, prazo, status, ocorrencias, tag, foto_abertura, foto_conclusao, historico, criado_em, concluido_em`;

  let inseridas = 0, puladas = 0;
  await withTransaction(async (client) => {
    if (TRUNCATE) await client.query('TRUNCATE ordens_servico RESTART IDENTITY');
    // proximo sequencial p/ quem nao tem numero
    let seq = (await client.query(
      `SELECT COALESCE(MAX(NULLIF(split_part(numero,'-',3),'')::int),0) AS s FROM ordens_servico WHERE numero LIKE $1`,
      [`OS-${ANO}-%`]
    )).rows[0].s;

    for (const r of registros) {
      const numero = r.numero || fmtNumero(++seq);
      const historico = r.historico || [{ status: 'aberta', data: r.criado_em, obs: 'Importada do Neon' }];
      const vals = [
        randomUUID(), numero, r.tipo, r.descricao, r.endereco, r.bairro, r.referencia, r.solicitante, r.responsavel,
        r.equipe, r.prioridade, r.prazo, r.status, r.ocorrencias, r.tag, r.foto_abertura, r.foto_conclusao,
        JSON.stringify(historico), r.criado_em, r.concluido_em,
      ];
      const res = await client.query(
        `INSERT INTO ordens_servico (${COLS}) VALUES (${vals.map((_, i) => '$' + (i + 1)).join(',')})
         ON CONFLICT (numero) DO NOTHING`,
        vals
      );
      if (res.rowCount) inseridas++; else puladas++;
    }
  });

  console.log(`\nConcluido: ${inseridas} importada(s)` + (puladas ? `, ${puladas} pulada(s) (numero ja existente)` : '') + '.');
  await closePool();
}

main().catch((e) => { console.error('Erro na importacao:', e.message); process.exit(1); });
