// Carrega demandas de DEMONSTRACAO (gestao de projeto — equipes PD/CTM).
// Uso: npm run seed-demandas   |   npm run seed-demandas -- --truncate
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { isConfigured, query, withTransaction, closePool } from '../src/db.js';
import { ensureAuthSchema } from '../src/auth.js';
import { ensureDemandasSchema } from '../src/demandas.js';

function diasAFrente(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

// Cada demanda: responsavel = email de um usuario semente (coordenador/tecnico).
const DEMO = [
  { titulo: 'Coleta de campo — Quadra 12 (Bancários)', descricao: 'Levantar BCIs dos lotes pendentes da quadra.', equipe: 'PD', prioridade: 'alta', status: 'em_andamento', prazoEmDias: 3, municipio: 'João Pessoa', loteBairro: 'Bancários', resp: ['tecnico@bzr.com'] },
  { titulo: 'Validar cadastros enviados', descricao: 'Revisar e aprovar/rejeitar BCIs enviados na semana.', equipe: 'CTM', prioridade: 'media', status: 'pendente', prazoEmDias: 5, municipio: 'João Pessoa', resp: ['coordenador@bzr.com'] },
  { titulo: 'Ajuste de divisas — Cabo Branco', descricao: 'Redesenhar lotes com sobreposição apontada em campo.', equipe: 'CTM', prioridade: 'alta', status: 'pendente', prazoEmDias: 7, municipio: 'João Pessoa', loteBairro: 'Cabo Branco', resp: ['coordenador@bzr.com', 'tecnico@bzr.com'] },
  { titulo: 'Importar ortofoto atualizada', descricao: 'Gerar tiles e publicar a ortofoto 2026 no mapa.', equipe: 'PD', prioridade: 'baixa', status: 'pendente', prazoEmDias: 14, municipio: 'João Pessoa', resp: [] },
  { titulo: 'Treinamento de coletores', descricao: 'Capacitar equipe nova no app de BCI.', equipe: 'PD', prioridade: 'media', status: 'concluida', prazoEmDias: -2, municipio: 'João Pessoa', resp: ['coordenador@bzr.com'] },
  { titulo: 'Conferir recadastro do Centro', descricao: 'Amostragem de 20 lotes já aprovados.', equipe: 'CTM', prioridade: 'media', status: 'em_andamento', prazoEmDias: 1, municipio: 'João Pessoa', loteBairro: 'Centro', resp: ['tecnico@bzr.com', 'coordenador@bzr.com'] },
  { titulo: 'Backup e fechamento do mês', descricao: 'Exportar relatórios e fazer backup do banco.', equipe: 'PD', prioridade: 'urgente', status: 'pendente', prazoEmDias: -1, resp: ['coordenador@bzr.com'] },
];

export async function seedDemandasDemo({ truncate = false, log = () => {} } = {}) {
  await ensureAuthSchema();
  await ensureDemandasSchema();
  const { rows: users } = await query('SELECT id, nome, email FROM usuarios');
  const porEmail = new Map(users.map((u) => [u.email, u]));

  return withTransaction(async (client) => {
    if (truncate) {
      await client.query('DELETE FROM demanda_responsaveis');
      await client.query('TRUNCATE demandas RESTART IDENTITY CASCADE');
    }
    let n = 0;
    for (const d of DEMO) {
      const iniciada = d.status === 'em_andamento' || d.status === 'concluida' ? new Date() : null;
      const concluida = d.status === 'concluida' || d.status === 'cancelada' ? new Date() : null;
      const { rows } = await client.query(
        `INSERT INTO demandas (titulo, descricao, municipio, lote_bairro, equipe, prioridade, status, prazo, iniciada_em, concluida_em, criado_por_nome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [d.titulo, d.descricao, d.municipio || '', d.loteBairro || '', d.equipe, d.prioridade, d.status,
         diasAFrente(d.prazoEmDias), iniciada, concluida, 'Coordenação (demo)']
      );
      const id = rows[0].id;
      for (const email of d.resp || []) {
        const u = porEmail.get(email);
        if (u) await client.query(
          `INSERT INTO demanda_responsaveis (demanda_id, usuario_id, usuario_nome) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [id, u.id, u.nome]
        );
      }
      n += 1;
      log(`  #${id} ${d.status.padEnd(12)} ${d.titulo}`);
    }
    return n;
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  (async () => {
    if (!isConfigured) { console.error('DATABASE_URL não configurada.'); process.exit(1); }
    const truncate = process.argv.includes('--truncate');
    await ensureDemandasSchema();
    if (!truncate) {
      const { rows } = await query('SELECT COUNT(*)::int AS n FROM demandas');
      if (rows[0].n > 0) { console.error(`Já existem ${rows[0].n} demandas. Use --truncate para substituir.`); await closePool(); process.exit(1); }
    }
    console.log('Carregando demandas de demonstração...');
    const n = await seedDemandasDemo({ truncate, log: console.log });
    console.log(`Seed concluído: ${n} demandas. Faça login em /login e abra /demandas.`);
    await closePool();
  })().catch((e) => { console.error('Erro no seed de demandas:', e.message); process.exit(1); });
}
