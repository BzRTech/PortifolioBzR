// Carrega ordens de servico de DEMONSTRACAO (dados ficticios de Joao Pessoa)
// para apresentar o modulo de O.S. ao cliente antes dos dados reais.
// Uso: npm run seed-os            (mantem o que existe? nao — ver abaixo)
//      npm run seed-os -- --truncate   (limpa a tabela antes)
//
// As coordenadas ficam embutidas no campo `referencia` como
// "Coordenadas: lat, lng" — e assim que o app e o dashboard plotam os pontos
// no mapa. Os historicos sao coerentes com o status de cada O.S.
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { isConfigured, withTransaction, query, closePool } from '../src/db.js';
import { ensureOsSchema } from '../src/os.js';

const ANO = new Date().getFullYear();
const fmtNumero = (seq) => `OS-${ANO}-${String(seq).padStart(4, '0')}`;

// Data a partir de "N dias atras" (com hora fixa para reprodutibilidade).
function diasAtras(n, hora = 9) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hora, 15, 0, 0);
  return d;
}
const iso = (d) => d.toISOString();

// Conjunto de O.S. de demonstracao. `abertaHa` = dias desde a abertura;
// `coord` = [lat, lng] em Joao Pessoa; `dias*` controlam a linha do tempo.
const DEMO = [
  {
    tipo: 'Pavimentação / Asfalto', prioridade: 'alta', tag: 'Waze',
    descricao: 'Buraco profundo na faixa da direita, ~80 cm, risco a motos.',
    endereco: 'Av. Epitácio Pessoa, 1200', bairro: 'Tambaú', ref: 'Em frente ao banco',
    coord: [-7.1096, -34.8301], solicitante: 'Ouvidoria', responsavel: 'Eng. Sandoval',
    equipe: 'Fênix Construções', status: 'andamento', abertaHa: 12,
  },
  {
    tipo: 'Drenagem / Esgoto', prioridade: 'alta', tag: 'Defesa Civil',
    descricao: 'Boca de lobo entupida causando alagamento em dia de chuva.',
    endereco: 'Rua das Trincheiras, 45', bairro: 'Centro', ref: 'Esquina com a Rua da República',
    coord: [-7.1179, -34.8815], solicitante: 'Defesa Civil', responsavel: 'Eng. Larissa',
    equipe: 'Equipe Drenagem 2', status: 'concluida', abertaHa: 20,
  },
  {
    tipo: 'Iluminação Pública', prioridade: 'baixa', tag: '156',
    descricao: 'Três postes apagados há mais de uma semana na orla.',
    endereco: 'Av. João Maurício, 800', bairro: 'Manaíra', ref: 'Trecho da praça',
    coord: [-7.0975, -34.8361], solicitante: 'Central 156', status: 'validada', abertaHa: 5,
  },
  {
    tipo: 'Calçadas / Passeios', prioridade: 'alta', tag: 'Ouvidoria',
    descricao: 'Calçada destruída por raízes, pedestres andam na pista.',
    endereco: 'Av. Rui Barbosa, 80', bairro: 'Torre', ref: 'Próximo à escola',
    coord: [-7.1181, -34.8652], solicitante: 'Ouvidoria', responsavel: 'Eng. Sandoval',
    equipe: 'Fênix Construções', status: 'aberta', abertaHa: 3,
    ocorrencias: 4, primeiraHa: 180,
  },
  {
    tipo: 'Limpeza Urbana', prioridade: 'media', tag: 'Vistoria de campo',
    descricao: 'Entulho e lixo acumulados no canteiro central.',
    endereco: 'Av. Cabo Branco, 500', bairro: 'Cabo Branco', ref: 'Ao lado do quiosque',
    coord: [-7.1452, -34.7963], solicitante: 'Alyne (fiscal)', status: 'aberta', abertaHa: 2,
  },
  {
    tipo: 'Bueiros / Bocas de Lobo', prioridade: 'media', tag: 'Waze',
    descricao: 'Bueiro sem tampa na via, sinalizado provisoriamente.',
    endereco: 'Av. Governador Flávio Ribeiro, 210', bairro: 'Bessa', ref: '',
    coord: [-7.0783, -34.8385], solicitante: 'Ouvidoria', responsavel: 'Eng. Larissa',
    equipe: 'Equipe Drenagem 1', status: 'andamento', abertaHa: 8,
  },
  {
    tipo: 'Pavimentação / Asfalto', prioridade: 'media', tag: '156',
    descricao: 'Recapeamento solicitado após obra de saneamento.',
    endereco: 'Rua Amazonas, 130', bairro: 'Bancários', ref: 'Quadra 12',
    coord: [-7.1401, -34.8381], solicitante: 'Central 156', responsavel: 'Eng. Sandoval',
    equipe: 'Fênix Construções', status: 'concluida', abertaHa: 30,
  },
  {
    tipo: 'Sinalização Viária', prioridade: 'baixa', tag: 'Ouvidoria',
    descricao: 'Faixa de pedestres apagada em frente ao hospital.',
    endereco: 'Av. Dom Pedro II, 1500', bairro: 'Jaguaribe', ref: '',
    coord: [-7.1283, -34.8724], solicitante: 'Ouvidoria', status: 'aberta', abertaHa: 1,
  },
  {
    tipo: 'Manutenção de Praças', prioridade: 'baixa', tag: 'Vistoria de campo',
    descricao: 'Bancos e brinquedos danificados na praça.',
    endereco: 'Praça da Independência', bairro: 'Cristo Redentor', ref: '',
    coord: [-7.1652, -34.8503], solicitante: 'Alyne (fiscal)', status: 'cancelada', abertaHa: 15,
    obsCancel: 'Duplicada da OS-2026-0003.',
  },
  {
    tipo: 'Drenagem / Esgoto', prioridade: 'alta', tag: 'Waze',
    descricao: 'Afundamento de pista após período de chuvas.',
    endereco: 'Av. Josefa Taveira, 2100', bairro: 'Mangabeira', ref: 'Sentido bairro',
    coord: [-7.1902, -34.8302], solicitante: 'Ouvidoria', responsavel: 'Eng. Larissa',
    equipe: 'Equipe Drenagem 2', status: 'andamento', abertaHa: 6,
    ocorrencias: 2, primeiraHa: 45,
  },
];

// Monta a linha do tempo (historico) coerente com o status.
function construirHistorico(o, aberturaISO) {
  const base = new Date(aberturaISO);
  const somaDias = (n, h = 10) => { const d = new Date(base); d.setDate(d.getDate() + n); d.setHours(h, 30, 0, 0); return iso(d); };
  const h = [{ status: 'aberta', data: aberturaISO, obs: 'Ordem de serviço aberta' }];
  const passa = (...st) => st.includes(o.status);
  if (passa('validada', 'andamento', 'concluida')) h.push({ status: 'validada', data: somaDias(1), obs: 'O.S. validada pela fiscalização' });
  if (passa('andamento', 'concluida')) h.push({ status: 'andamento', data: somaDias(2), obs: `Atendimento iniciado${o.equipe ? ' — equipe ' + o.equipe : ''}` });
  if (passa('concluida')) h.push({ status: 'concluida', data: somaDias(Math.max(3, Math.round(o.abertaHa * 0.7))), obs: 'Serviço concluído e vistoriado' });
  if (passa('cancelada')) h.push({ status: 'cancelada', data: somaDias(1), obs: o.obsCancel || 'O.S. cancelada' });
  return h;
}

const COLS = `id, numero, tipo, descricao, endereco, bairro, referencia,
  solicitante, responsavel, equipe, prioridade, prazo, status,
  ocorrencias, primeira_ocorrencia, tag, historico, criado_em, atualizado_em, concluido_em`;

/** Carrega as O.S. de demonstracao. Reutilizado pelo servidor no boot. */
export async function seedOsDemo({ truncate = false, log = () => {} } = {}) {
  await ensureOsSchema();

  const inseridas = await withTransaction(async (client) => {
    if (truncate) await client.query('TRUNCATE ordens_servico RESTART IDENTITY');

    let seq = 0;
    for (const o of DEMO) {
      seq += 1;
      const numero = fmtNumero(seq);
      const abertura = diasAtras(o.abertaHa);
      const aberturaISO = iso(abertura);
      const historico = construirHistorico(o, aberturaISO);
      const ultimo = historico[historico.length - 1];
      const referencia = [o.ref, `Coordenadas: ${o.coord[0]}, ${o.coord[1]}`].filter(Boolean).join(' · ');
      const primeira = o.primeiraHa ? iso(diasAtras(o.primeiraHa)).slice(0, 10) : null;
      const concluido = o.status === 'concluida' ? ultimo.data : null;

      const vals = [
        randomUUID(), numero, o.tipo, o.descricao, o.endereco, o.bairro, referencia,
        o.solicitante, o.responsavel || '', o.equipe || '', o.prioridade, null, o.status,
        Math.max(1, o.ocorrencias || 1), primeira, o.tag || '',
        JSON.stringify(historico), aberturaISO, ultimo.data, concluido,
      ];
      await client.query(
        `INSERT INTO ordens_servico (${COLS})
         VALUES (${vals.map((_, i) => '$' + (i + 1)).join(',')})`,
        vals
      );
      log(`  ${numero}  ${o.status.padEnd(10)} ${o.bairro}`);
    }
    return seq;
  });

  return inseridas;
}

// Executa apenas quando chamado diretamente (npm run seed-os).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  (async () => {
    if (!isConfigured) {
      console.error('DATABASE_URL nao configurada. Crie um .env a partir de .env.example.');
      process.exit(1);
    }
    const truncate = process.argv.includes('--truncate');
    await ensureOsSchema(); // garante a tabela antes de checar/contar
    if (!truncate) {
      const { rows } = await query('SELECT COUNT(*)::int AS n FROM ordens_servico');
      if (rows[0].n > 0) {
        console.error(`Ja existem ${rows[0].n} O.S. no banco. Use --truncate para substituir por dados de demonstracao.`);
        await closePool();
        process.exit(1);
      }
    }
    console.log('Carregando ordens de servico de demonstracao (Joao Pessoa)...');
    const n = await seedOsDemo({ truncate, log: console.log });
    console.log(`Seed concluido: ${n} O.S. de demonstracao. Abra /os no navegador.`);
    await closePool();
  })().catch((e) => {
    console.error('Erro no seed de O.S.:', e.message);
    process.exit(1);
  });
}
