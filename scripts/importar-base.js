// Importação recorrente da base do sistema tributário (para rotina agendada,
// ex.: Render Cron Job ou cron do servidor da prefeitura).
// Uso:
//   npm run importar-base -- --arquivo base.csv [--completa] [--forcar] [--municipio "Nome"]
// Idempotente: o mesmo arquivo (mesmo SHA-256) não é reprocessado; um arquivo
// diferente só altera o que mudou. Sai com código 0 e imprime o resumo.
import 'dotenv/config';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { closePool, isConfigured } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { importarCsv } from '../src/importacao.js';
import { MUNICIPIO_FIXO } from '../src/env.js';

const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (n) => process.argv.includes('--' + n);

(async () => {
  try {
    if (!isConfigured) throw new Error('Defina DATABASE_URL.');
    const arquivo = arg('arquivo');
    if (!arquivo) throw new Error('Informe --arquivo caminho/base.csv');
    const municipio = MUNICIPIO_FIXO || arg('municipio') || '';
    const buf = fs.readFileSync(arquivo);
    let texto = buf.toString('utf8');
    if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf); // exportações antigas em ANSI
    await runMigrations({ log: () => {} });
    const r = await importarCsv({ municipio, texto, arquivoNome: path.basename(arquivo), arquivoSha256: crypto.createHash('sha256').update(buf).digest('hex'),
      completa: flag('completa'), forcar: flag('forcar'), usuario: 'rotina de importação', log: console.log });
    if (r.repetida) console.log(`Arquivo idêntico ao da importação #${r.anterior.id} (${new Date(r.anterior.created_at).toISOString()}): nada a fazer.`);
    else console.log(`Importação #${r.id} concluída:`, JSON.stringify(r.totais));
  } catch (e) { console.error('Erro:', e.message); process.exitCode = 1; }
  finally { await closePool(); }
})();
