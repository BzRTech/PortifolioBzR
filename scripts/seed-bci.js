// Carrega BCIs de DEMONSTRACAO (cadastro imobiliario — Joao Pessoa).
// Uso: npm run seed-bci   |   npm run seed-bci -- --truncate
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { isConfigured, query, withTransaction, closePool } from '../src/db.js';
import { ensureBciSchema } from '../src/bci.js';

const MUNI = 'João Pessoa';
// [inscricao, bairro, uso, status, [lat,lng], areaTerreno, areaConstruida, ajuste?]
const DEMO = [
  ['381790124', 'João Paulo II', 'Residencial', 'aprovado', [-7.1502, -34.8412], 250, 120, null],
  ['381790125', 'João Paulo II', 'Residencial', 'enviado', [-7.1508, -34.8419], 300, 0, null],
  ['210450088', 'Bancários', 'Comercial', 'enviado', [-7.1401, -34.8381], 420, 260, null],
  ['118220041', 'Centro', 'Misto', 'rascunho', [-7.1179, -34.8815], 180, 300, null],
  ['076330012', 'Cabo Branco', 'Residencial', 'aprovado', [-7.1452, -34.7963], 500, 340, null],
  ['076330013', 'Cabo Branco', 'Territorial', 'rejeitado', [-7.1459, -34.7971], 360, 0, null],
  ['145880203', 'Tambaú', 'Residencial', 'rascunho', [-7.1096, -34.8301], 280, 210, { tipo: 'merge', obs: 'Lote dividido em campo; fundir com o vizinho.', inscricoes: '145880204' }],
  ['201770335', 'Manaíra', 'Comercial', 'enviado', [-7.0975, -34.8361], 640, 520, { tipo: 'redesenhar', obs: 'Divisa dos fundos diverge da base cartográfica.', inscricoes: '' }],
];

const dadosExemplo = (uso, bairro) => ({
  setor_responsavel: 'Tributos', data_preenchimento: new Date().toISOString().slice(0, 10),
  nome_logradouro: 'Rua Principal', prop_bairro: bairro, tipo_imovel: uso === 'Territorial' ? 'Territorial' : 'Predial',
  uso_do_solo: uso === 'Misto' ? 'Misto' : (uso === 'Comercial' ? 'Comercial/Serviços' : (uso === 'Territorial' ? 'Terreno vazio' : 'Residencial')),
  abastecimento_agua: 'Rede Pública', eletricidade: 'Rede', topografia: 'Plano',
  especie_edificacao: uso === 'Comercial' ? 'Loja/Sala' : 'Casa Isolada', ocupacao: 'Construída - Ocupada',
});

export async function seedBciDemo({ truncate = false, log = () => {} } = {}) {
  await ensureBciSchema();
  return withTransaction(async (client) => {
    if (truncate) { await client.query('DELETE FROM bci_foto'); await client.query('TRUNCATE bci RESTART IDENTITY CASCADE'); }
    let n = 0;
    for (const [insc, bairro, uso, status, [lat, lng], at, ac, ajuste] of DEMO) {
      const enviado = ['enviado', 'aprovado', 'rejeitado'].includes(status);
      await client.query(
        `INSERT INTO bci (inscricao, municipio, bairro, tecnico_nome, status, dados, area_terreno_m2, area_construida_m2,
           uso, ponto_lat, ponto_lng, precisao_gps_m, enviado_em, aprovado_em, aprovado_por_nome, motivo_rejeicao,
           ajuste_geom, ajuste_tipo, ajuste_obs, ajuste_inscricoes)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          insc, MUNI, bairro, 'Técnico de Campo (demo)', status, JSON.stringify(dadosExemplo(uso, bairro)),
          at, ac, uso, lat, lng, 6 + Math.random() * 6,
          enviado ? new Date() : null,
          status === 'aprovado' ? new Date() : null, status === 'aprovado' ? 'Coordenação (demo)' : '',
          status === 'rejeitado' ? 'Divergência na área do terreno; revisar em campo.' : '',
          ajuste ? true : false, ajuste?.tipo || '', ajuste?.obs || '', ajuste?.inscricoes || '',
        ]
      );
      n += 1;
      log(`  ${insc}  ${status.padEnd(10)} ${bairro}${ajuste ? ' · ⚠ ajuste' : ''}`);
    }
    return n;
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  (async () => {
    if (!isConfigured) { console.error('DATABASE_URL não configurada.'); process.exit(1); }
    const truncate = process.argv.includes('--truncate');
    await ensureBciSchema();
    if (!truncate) {
      const { rows } = await query('SELECT COUNT(*)::int AS n FROM bci');
      if (rows[0].n > 0) { console.error(`Já existem ${rows[0].n} BCIs. Use --truncate para substituir.`); await closePool(); process.exit(1); }
    }
    console.log('Carregando BCIs de demonstração...');
    const n = await seedBciDemo({ truncate, log: console.log });
    console.log(`Seed concluído: ${n} BCIs. Abra /bci.`);
    await closePool();
  })().catch((e) => { console.error('Erro no seed de BCI:', e.message); process.exit(1); });
}
