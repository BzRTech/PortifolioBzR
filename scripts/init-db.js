// Prepara o banco: aplica as migrations versionadas (migrations/*.sql).
// Uso: npm run init-db   (equivale a npm run migrate)
import { runMigrations } from '../src/migrate.js';
import { healthcheck, closePool, isConfigured } from '../src/db.js';

(async () => {
  if (!isConfigured) {
    console.error('DATABASE_URL nao configurada. Crie um .env a partir de .env.example.');
    process.exit(1);
  }
  const hc = await healthcheck();
  if (!hc.ok) {
    console.error('Falha ao conectar no banco:', hc.reason);
    process.exit(1);
  }
  console.log(`Conectado em "${hc.db}".`);
  const feitas = await runMigrations();
  console.log(feitas.length ? `Migrations aplicadas: ${feitas.join(', ')}` : 'Banco já estava em dia.');
  const after = await healthcheck();
  console.log(`PostGIS: ${after.postgis || 'nao detectado'}`);
  console.log('Schema criado/atualizado com sucesso.');
  await closePool();
})().catch((e) => {
  console.error('Erro:', e.message);
  process.exit(1);
});
