// Conferência de um banco restaurado (usado por scripts/restore-test.sh).
// Sai com código 1 se algo não conferir.
import pg from 'pg';
import crypto from 'crypto';
import { jcs } from '../src/cib-validacao.js';

const TABELAS = ['imoveis', 'cib_movimentacoes', 'cib_remessas', 'cib_remessa_arquivos', 'cib_retornos', 'cib_divergencias', 'documentos', 'requerimentos',
  'cib_auditoria', 'lgpd_acessos', 'pgv_valores', 'pgv_exercicios', 'numeradores', 'usuarios', 'lotes', 'bci', 'demandas', 'ordens_servico', 'schema_migrations'];
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const conectar = (url) => { const c = new pg.Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } }); return c.connect().then(() => c); };

let falhas = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) falhas += 1; };
const r = await conectar(process.env.RESTORE_URL);
const o = process.env.ORIGEM_URL ? await conectar(process.env.ORIGEM_URL) : null;
for (const t of TABELAS) {
  const n = (await r.query(`SELECT COUNT(*)::int AS n FROM ${t}`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
  if (o) {
    const m = (await o.query(`SELECT COUNT(*)::int AS n FROM ${t}`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    ok(n === m, `${t}: ${n} linha(s) (origem ${m})`);
  } else ok(n >= 0, `${t}: ${n} linha(s)`);
}
const docs = (await r.query('SELECT id, conteudo, hash_conteudo FROM documentos')).rows;
const ruins = docs.filter((d) => sha(jcs(d.conteudo)) !== d.hash_conteudo);
ok(ruins.length === 0, `documentos: ${docs.length - ruins.length}/${docs.length} com SHA-256/JCS íntegro`);
const arqs = (await r.query('SELECT remessa_id, conteudo, sha256 FROM cib_remessa_arquivos')).rows;
ok(arqs.every((a) => sha(a.conteudo) === a.sha256), `arquivos de remessa: ${arqs.length} com SHA-256 íntegro`);
const trig = (await r.query(`SELECT COUNT(*)::int AS n FROM pg_trigger WHERE tgname IN ('trg_documentos_imutavel','trg_auditoria_append','trg_lgpd_append','trg_remessa_arquivo_append')`)).rows[0].n;
ok(trig === 4, `travas de imutabilidade presentes (${trig}/4)`);
await r.end(); if (o) await o.end();
console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nRestauração verificada com sucesso.');
process.exit(falhas ? 1 : 0);
