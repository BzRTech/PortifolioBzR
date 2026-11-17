// Migrations versionadas (substituem as antigas funções ensure*Schema no boot).
//
// - Arquivos em migrations/NNN_nome.sql, aplicados em ordem, cada um numa
//   transação. A tabela schema_migrations guarda versão, nome, checksum
//   SHA-256 e data. Uma migration já aplicada NÃO pode mudar: se o checksum
//   divergir, o boot falha (crie uma nova migration).
// - Advisory lock: duas instâncias subindo ao mesmo tempo não aplicam a mesma
//   migration duas vezes.
// - Adoção de bancos antigos: se o banco já tem as tabelas mas não tem
//   schema_migrations (criado antes desta versão), as funções legadas
//   (idempotentes) trazem o banco ao estado da 001_baseline, que é então
//   marcada como aplicada sem executar.
// Uso: npm run migrate | npm run migrate:status | npm run migrate:nova -- nome
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getPool, isConfigured, clienteDireto } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DIR_MIGRATIONS = path.join(__dirname, '..', 'migrations');
const LOCK_ID = 7_260_311; // chave do advisory lock das migrations

export function listarArquivos() {
  if (!fs.existsSync(DIR_MIGRATIONS)) return [];
  return fs.readdirSync(DIR_MIGRATIONS)
    .filter((f) => /^\d{3,}_[\w-]+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const sql = fs.readFileSync(path.join(DIR_MIGRATIONS, f), 'utf8');
      return { versao: f.split('_')[0], nome: f.replace(/\.sql$/, ''), arquivo: f, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
    });
}

async function adotarBancoLegado(client, log) {
  log('[migrate] banco existente sem schema_migrations — adotando (funções legadas → estado da 001_baseline)…');
  const mods = await Promise.all([
    import('./schema.js'), import('./os.js'), import('./auth.js'), import('./demandas.js'),
    import('./bci.js'), import('./cib.js'), import('./documentos.js'),
  ]);
  const fns = [mods[0].ensureSchema, mods[1].ensureOsSchema, mods[2].ensureAuthSchemaLegado, mods[3].ensureDemandasSchema,
    mods[4].ensureBciSchema, mods[5].ensureCibSchema, mods[6].ensureDocumentosSchema];
  for (const f of fns) if (typeof f === 'function') await f();
}

/** Aplica as migrations pendentes. Devolve a lista das aplicadas nesta chamada. */
export async function runMigrations({ log = console.log } = {}) {
  if (!isConfigured) return [];
  // Conexão direta (não o pool): o advisory lock é de sessão — ver urlDireta() em db.js.
  const client = await clienteDireto();
  const aplicadas = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    const existia = (await client.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok`)).rows[0].ok;
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      versao TEXT PRIMARY KEY, nome TEXT NOT NULL, checksum TEXT NOT NULL, aplicada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), adotada BOOLEAN NOT NULL DEFAULT FALSE)`);
    const arquivos = listarArquivos();
    if (!existia) {
      const legado = (await client.query(`SELECT to_regclass('public.lotes') IS NOT NULL AS ok`)).rows[0].ok;
      if (legado && arquivos[0]?.versao === '001') {
        await adotarBancoLegado(client, log);
        await client.query('INSERT INTO schema_migrations (versao, nome, checksum, adotada) VALUES ($1,$2,$3,TRUE)', ['001', arquivos[0].nome, arquivos[0].checksum]);
        log('[migrate] 001_baseline marcada como aplicada (banco adotado).');
      }
    }
    const feitas = new Map((await client.query('SELECT versao, checksum, nome FROM schema_migrations')).rows.map((r) => [r.versao, r]));
    for (const m of arquivos) {
      const ja = feitas.get(m.versao);
      if (ja) {
        if (ja.checksum !== m.checksum) {
          throw new Error(`Migration ${m.arquivo} foi alterada depois de aplicada (checksum diferente). Não edite migrations aplicadas: crie uma nova.`);
        }
        continue;
      }
      log(`[migrate] aplicando ${m.arquivo}…`);
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (versao, nome, checksum) VALUES ($1,$2,$3)', [m.versao, m.nome, m.checksum]);
        await client.query('COMMIT');
        aplicadas.push(m.arquivo);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Falha na migration ${m.arquivo}: ${e.message}`);
      }
    }
    // As migrations podem alterar search_path; garante o padrão no cliente devolvido ao pool.
    await client.query('RESET search_path');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    await client.end().catch(() => {});
  }
  return aplicadas;
}

export async function statusMigrations() {
  const pool = getPool();
  const temTabela = (await pool.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok`)).rows[0].ok;
  const feitas = temTabela ? new Map((await pool.query('SELECT * FROM schema_migrations')).rows.map((r) => [r.versao, r])) : new Map();
  return listarArquivos().map((m) => {
    const f = feitas.get(m.versao);
    return { arquivo: m.arquivo, aplicada: Boolean(f), em: f?.aplicada_em || null, adotada: Boolean(f?.adotada), checksumOk: !f || f.checksum === m.checksum };
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const { closePool } = await import('./db.js');
  const cmd = process.argv[2] || 'up';
  try {
    if (cmd === 'nova') {
      const nome = (process.argv[3] || '').replace(/[^\w-]+/g, '_');
      if (!nome) throw new Error('Informe o nome: npm run migrate:nova -- nome_da_mudanca');
      const ult = listarArquivos().at(-1);
      const prox = String(Number(ult?.versao || 0) + 1).padStart(3, '0');
      const arq = path.join(DIR_MIGRATIONS, `${prox}_${nome}.sql`);
      fs.writeFileSync(arq, `-- ${prox}_${nome}\n-- Descreva a mudança. Esta migration roda numa transação.\n\n`);
      console.log('Criada:', path.relative(process.cwd(), arq));
    } else if (!isConfigured) {
      throw new Error('Defina DATABASE_URL.');
    } else if (cmd === 'status') {
      for (const s of await statusMigrations()) {
        console.log(`${s.aplicada ? '✓' : '·'} ${s.arquivo}${s.adotada ? ' (adotada)' : ''}${s.em ? '  ' + new Date(s.em).toISOString() : ''}${s.checksumOk ? '' : '  ⚠ CHECKSUM DIFERENTE'}`);
      }
    } else {
      const feitas = await runMigrations();
      console.log(feitas.length ? `Aplicadas: ${feitas.join(', ')}` : 'Nada a aplicar: banco em dia.');
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await closePool(); }
}
