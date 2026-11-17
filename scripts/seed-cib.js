// Cadastro fiscal de DEMONSTRAÇÃO do módulo CIB/Sinter + Documentos sobre a
// cidade fictícia do Território ("Município Exemplo"). Dados fictícios.
// BLOQUEADO em produção (NODE_ENV=production).
//
// Percorre o fluxo real: base importada → saneamento → carga inicial →
// remessas no leiaute oficial (validadas antes de gerar) → retorno no formato
// oficial da consulta do Sinter (SIMULADO, CIBs fictícios marcados como tal) →
// divergências → vistoria → protocolos → documentos.
//
// Uso: npm run seed-cib            (recusa se já houver imóveis)
//      npm run seed-cib -- --truncate
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { isConfigured, query, withTransaction, closePool } from '../src/db.js';
import { PRODUCAO } from '../src/env.js';
import { runMigrations } from '../src/migrate.js';
import { semearUsuarios } from '../src/auth.js';
import { semearFormularioBci } from '../src/bci.js';
import { processarImoveis, capturarMovimentacao, validarMovimentacao, recalcularStatus, detectarDiferencas } from '../src/cib.js';
import { prepararRemessa, enviarRemessa, processarRetorno, gerarRetornoSimulado } from '../src/cib-remessas.js';
import { parseRetorno } from '../src/sinter/retorno.js';
import { publicarExercicio } from '../src/pgv.js';
import { emitirDocumento, protocolarRequerimento } from '../src/documentos.js';
import { dvCnpj, dvCnm } from '../src/ni.js';
import { seedDemo } from './seed-demo.js';

export const MUNI = 'Município Exemplo';
const IBGE = '2599999'; // fictício

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261116);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const dig = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');

function cpfFicticio() {
  const n = dig(9).split('').map(Number);
  const dv = (b) => { const s = b.reduce((a, d, i) => a + d * (b.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  n.push(dv(n)); n.push(dv(n));
  return n.join('');
}
function cnpjFicticio({ alfanumerico = false } = {}) {
  const alfa = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const raiz = alfanumerico ? Array.from({ length: 8 }, () => alfa[Math.floor(rnd() * alfa.length)]).join('') : dig(8);
  const base = raiz + '0001';
  return base + dvCnpj(base);
}
const cnmFicticio = () => { const b = '1' + dig(5) + '2' + dig(7); return b + dvCnm(b); };

const NOMES = ['Maria', 'José', 'Ana', 'João', 'Francisca', 'Antônio', 'Adriana', 'Carlos', 'Juliana', 'Paulo', 'Márcia', 'Pedro', 'Aline', 'Lucas', 'Patrícia', 'Rafael', 'Sandra', 'Severino', 'Luciana', 'Fernando'];
const SOBRENOMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Ferreira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento', 'Araújo', 'Medeiros', 'Cavalcanti', 'Barbosa', 'Gomes', 'Dantas', 'Brito'];
const EMPRESAS = ['Comercial Alvorada Ltda', 'Mercadinho Bom Preço ME', 'Construtora Horizonte Ltda', 'Indústria Nordeste Têxtil S/A', 'Padaria Pão Nosso ME', 'Oficina Dois Irmãos Ltda'];
// [nome completo, código do tipo de logradouro no domínio do Sinter]
const RUAS = [['Rua das Acácias', 250], ['Rua Projetada 12', 250], ['Avenida Presidente Epitácio', 26], ['Rua São José', 250], ['Rua Manoel Deodato', 250],
  ['Rua das Flores', 250], ['Travessa do Comércio', 273], ['Rua Joaquim Nabuco', 250], ['Avenida Getúlio Vargas', 26], ['Rua Coronel Antônio Pessoa', 250],
  ['Rua Santo Antônio', 250], ['Travessa Padre Ibiapina', 273]];
const SETOR = { 'CENTRO': '01', 'JARDIM DAS FLORES': '02', 'VILA INDUSTRIAL': '03', 'PARQUE NORTE': '04' };
const CEP = { 'CENTRO': '58700000', 'JARDIM DAS FLORES': '58700100', 'VILA INDUSTRIAL': '58700200', 'PARQUE NORTE': '58700300' };
const USO = { residencial: ['Residencial', 1, 1], comercial: ['Comercial', 2, 7], misto: ['Misto', 14, 7], industrial: ['Industrial', 4, 11], institucional: ['Institucional', 9, 6], vazio: ['Terreno vazio', null, null] };
const EQUIPE = 'Coordenação do Cadastro (demo)';

async function datar(sql, params) { await query(sql, params); }

async function limpar() {
  await withTransaction(async (db) => {
    await db.query(`SET LOCAL bzr.manutencao = 'on'`); // libera as tabelas imutáveis (só scripts de manutenção)
    await db.query('DELETE FROM documentos WHERE municipio = $1', [MUNI]);
    await db.query('DELETE FROM requerimentos WHERE municipio = $1', [MUNI]);
    await db.query('DELETE FROM cib_remessa_arquivos WHERE remessa_id IN (SELECT id FROM cib_remessas WHERE municipio = $1)', [MUNI]);
    for (const t of ['cib_vistorias', 'cib_divergencias', 'cib_movimentacoes', 'cib_remessas', 'cib_auditoria', 'cib_implantacao', 'pgv_valores', 'pgv_exercicios', 'pgv_recalculos', 'cib_importacoes', 'lgpd_acessos']) {
      await db.query(`DELETE FROM ${t} WHERE municipio = $1`, [MUNI]);
    }
    await db.query('DELETE FROM imoveis WHERE municipio = $1', [MUNI]);
    await db.query(`DELETE FROM numeradores WHERE chave = $1 OR chave LIKE $2`, [MUNI, MUNI + '|%']);
    await db.query(`DELETE FROM demandas WHERE municipio = $1 AND titulo LIKE 'Vistoria%'`, [MUNI]);
  });
}

export async function seedCibDemo({ truncate = false, log = () => {} } = {}) {
  if (PRODUCAO) throw new Error('Seed de demonstração não roda em produção.');
  await runMigrations({ log: () => {} });
  await semearUsuarios(); await semearFormularioBci();

  // A demonstração usa a SUA cidade fictícia ("Município Exemplo"). Se o banco já tem
  // camadas de outro município (ex.: dados reais do Território), elas ficam intactas e a
  // cidade fictícia é criada ao lado — nunca se gera cadastro fictício sobre município real.
  const c = (await query(`SELECT count(*) FILTER (WHERE municipio = $1)::int AS meus,
      count(*) FILTER (WHERE municipio IS NULL OR municipio = '')::int AS sem,
      count(*) FILTER (WHERE municipio <> $1 AND municipio <> '')::int AS outros FROM lotes`, [MUNI])).rows[0];
  const soDemo = c.outros === 0;
  if (!c.meus && !(soDemo && c.sem)) {
    log(soDemo ? '  sem lotes no Território — carregando a cidade de demonstração primeiro...'
      : `  o banco já tem ${c.outros + c.sem} lotes de outro(s) município(s) (mantidos) — criando a cidade fictícia "${MUNI}" ao lado...`);
    await seedDemo({ truncate: soDemo, municipio: MUNI, log });
  }

  if (truncate) await limpar();
  else {
    const ja = (await query('SELECT COUNT(*)::int AS n FROM imoveis WHERE municipio = $1', [MUNI])).rows[0].n;
    if (ja) throw new Error(`Já existem ${ja} imóveis em "${MUNI}". Use --truncate para recriar.`);
  }

  // Base antiga só de demonstração (camadas sem município): passam a ser do Município Exemplo.
  if (soDemo) for (const t of ['bairros', 'quadras', 'lotes', 'ruas', 'edificacoes']) await query(`UPDATE ${t} SET municipio = $1 WHERE municipio IS NULL OR municipio = ''`, [MUNI]);

  await query(
    `INSERT INTO municipio_config (municipio, nome_oficial, uf, codigo_ibge, cnpj, secretaria, setor, endereco, telefone, email,
       prefeito_nome, responsavel_nome, responsavel_cargo, convenio_numero, convenio_data, prazo_sinter, transmissores, rodape_documentos)
     VALUES ($1,$2,'PB',$3,$4,'Secretaria Municipal de Finanças','Setor de Cadastro Imobiliário','Rua Principal, 100 — Centro',
       '(83) 3300-0000','cadastro@exemplo.pb.gov.br','Prefeito(a) Exemplo',$5,'Coordenador(a) do Cadastro Imobiliário','SINTER-PB-0000/2026',
       '2026-08-15','2026-12-31','BzR Technology (transmissora PJ)','Dados fictícios — ambiente de demonstração BzR.')
     ON CONFLICT (municipio) DO UPDATE SET nome_oficial = EXCLUDED.nome_oficial, codigo_ibge = EXCLUDED.codigo_ibge`,
    [MUNI, `Prefeitura Municipal de ${MUNI}`, IBGE, cnpjFicticio(), EQUIPE]
  );
  await semearPaginaDemo();

  // PGV: exercício 2026 (rascunho → publicado depois da carga).
  await query(`INSERT INTO pgv_exercicios (municipio, ano, status, ato_legal) VALUES ($1, 2026, 'rascunho', 'Lei Complementar Municipal nº 00/2025 (fictícia)') ON CONFLICT DO NOTHING`, [MUNI]);
  const pgv = [['terreno', 'CENTRO', 420], ['terreno', 'JARDIM DAS FLORES', 260], ['terreno', 'VILA INDUSTRIAL', 180], ['terreno', 'PARQUE NORTE', 110], ['terreno', '*', 150],
    ['construcao', 'popular', 780], ['construcao', 'baixo', 950], ['construcao', 'normal', 1550], ['construcao', 'alto', 2350], ['construcao', 'luxo', 3300]];
  for (const [t, k, v] of pgv) await query('INSERT INTO pgv_valores (municipio, ano, tipo, chave, valor_m2) VALUES ($1,2026,$2,$3,$4) ON CONFLICT DO NOTHING', [MUNI, t, k, v]);

  // Base cadastral.
  const lotes = (await query(
    `SELECT l.id, l.codigo, l.quadra, l.bairro, l.uso, l.area_m2,
            COALESCE((SELECT SUM(ST_Area(ST_Intersection(e.geom, l.geom)::geography) * GREATEST(COALESCE(e.n_pavimentos,1),1))
                      FROM edificacoes e WHERE ST_Intersects(e.geom, l.geom)), 0) AS area_edif
     FROM lotes l WHERE l.municipio = $1 ORDER BY l.codigo`, [MUNI]
  )).rows;
  const seq = {};
  let nNova = 0, nAmpl = 0;
  const itens = [];
  for (const l of lotes) {
    if (rnd() < 0.04) continue; // lacunas: lote sem inscrição
    const bairro = String(l.bairro || '').toUpperCase();
    const setor = SETOR[bairro] || '05';
    const q = String(l.quadra || 'Q0000').replace(/\D/g, '').slice(-2).padStart(2, '0');
    seq[q + setor] = (seq[q + setor] || 0) + 1;
    const inscricao = `${setor}.${q}.${String(seq[q + setor]).padStart(4, '0')}`;
    const pj = ['comercial', 'industrial'].includes(l.uso) && rnd() < 0.6;
    let doc = pj ? cnpjFicticio({ alfanumerico: rnd() < 0.35 }) : cpfFicticio();
    const r = rnd();
    if (r < 0.03) doc = '';
    else if (r < 0.06) doc = doc.slice(0, -1) + ((Number(doc.slice(-1)) + 1) % 10);
    let areaConstr = Math.round(l.area_edif * (0.95 + rnd() * 0.15));
    let tipo = l.uso === 'vazio' || areaConstr <= 0 ? 'territorial' : 'predial';
    if (tipo === 'predial' && nNova < 9 && rnd() < 0.05) { tipo = 'territorial'; areaConstr = 0; nNova += 1; }
    else if (tipo === 'predial' && nAmpl < 6 && rnd() < 0.05) { areaConstr = Math.round(areaConstr * 0.45); nAmpl += 1; }
    const [usoTxt, dest, tpArq] = USO[l.uso] || USO.residencial;
    const [rua, tipoLogr] = pick(RUAS);
    const semTp = tipo === 'predial' && rnd() < 0.03; // saneamento: falta tipo arquitetônico
    const titular = rnd() < 0.7;
    itens.push({
      inscricao, lote_codigo: l.codigo, setor, quadra: q, lote_num: String(seq[q + setor]).padStart(4, '0'),
      tipo, uso: usoTxt, destinacao: tipo === 'predial' ? dest : null, tp_arquitetonico: tipo === 'predial' && !semTp ? tpArq : null,
      logradouro: rnd() < 0.02 ? '' : rua, tipo_logradouro: tipoLogr, numero: rnd() < 0.08 ? 'S/N' : String(10 + Math.floor(rnd() * 1800)),
      bairro: l.bairro || '', tem_bairro: true, cep: rnd() < 0.02 ? '' : (CEP[bairro] || '58700000'),
      contribuinte_nome: pj ? pick(EMPRESAS) : `${pick(NOMES)} ${pick(SOBRENOMES)} ${pick(SOBRENOMES)}`, contribuinte_doc: doc,
      titular_tipo: titular ? 1 : null, titular_doc_tipo: titular ? 1 : null, titular_perc: titular ? 1 : null,
      titular_dt_aquisicao: titular ? `${2000 + Math.floor(rnd() * 26)}-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 9)}` : null,
      matricula_cartorio: rnd() < 0.85 ? String(1000 + Math.floor(rnd() * 30000)) : '', cartorio: 'Cartório do 1º Ofício', cnm_ri: rnd() < 0.3 ? cnmFicticio() : '',
      area_terreno_m2: rnd() < 0.04 ? Math.round(l.area_m2 * 1.25) : Math.round(l.area_m2 * (0.98 + rnd() * 0.04)), area_construida_m2: tipo === 'predial' ? areaConstr : 0,
      padrao_construtivo: bairro === 'CENTRO' ? pick(['normal', 'alto']) : pick(['popular', 'baixo', 'normal']),
      ano_construcao: tipo === 'predial' ? 1975 + Math.floor(rnd() * 50) : null, testada_m: 12 + Math.round(rnd() * 10),
    });
  }
  await withTransaction(async (db) => {
    for (const c of itens) {
      const cols = Object.keys(c);
      await db.query(`INSERT INTO imoveis (municipio, lote_id, ${cols.join(', ')}) VALUES ($1, (SELECT id FROM lotes WHERE codigo = $2 AND municipio = $1 LIMIT 1), ${cols.map((_, i) => '$' + (i + 3)).join(', ')})`,
        [MUNI, c.lote_codigo, ...cols.map((k) => c[k])]);
    }
  });
  await publicarExercicio(MUNI, 2026, { usuario: EQUIPE });
  log(`  ${itens.length} imóveis importados (${lotes.length - itens.length} lotes sem inscrição); PGV 2026 publicada.`);

  // Saneamento parcial.
  const comErro = (await query(`SELECT id, pendencias FROM imoveis WHERE municipio = $1 AND tem_erro ORDER BY id`, [MUNI])).rows;
  let corrigidos = 0;
  for (const im of comErro.slice(0, Math.floor(comErro.length * 0.55))) {
    const cods = im.pendencias.map((p) => p.codigo).join(' ');
    const sets = [];
    if (/nomeLogradouro/.test(cods)) sets.push(`logradouro = '${pick(RUAS)[0]}'`);
    if (/_cep/.test(cods)) sets.push(`cep = '58700000'`);
    if (/tpArquitetonico/.test(cods)) sets.push('tp_arquitetonico = 1');
    if (sets.length) { await query(`UPDATE imoveis SET ${sets.join(', ')} WHERE id = $1`, [im.id]); corrigidos += 1; }
  }
  await processarImoveis(null, { municipio: MUNI });
  log(`  saneamento: ${corrigidos} imóveis corrigidos.`);

  const prontos = (await query(`SELECT id, inscricao FROM imoveis WHERE municipio = $1 AND NOT tem_erro AND situacao = 'ativo' ORDER BY id`, [MUNI])).rows;
  const enfileirar = async (lista, comp) => {
    for (const p of lista) {
      await query(`INSERT INTO cib_movimentacoes (municipio, imovel_id, inscricao, tipo, origem, descricao, status, validado_em, competencia, criado_por_nome, created_at)
         VALUES ($1,$2,$3,'inclusao','implantacao','Carga inicial do cadastro','validada',NOW(),$4,$5,$6)`, [MUNI, p.id, p.inscricao, comp, EQUIPE, `${comp}-10T12:00:00-03:00`]);
    }
  };
  let idSeq = 1763401799000;
  const ciclo = async (comp, dia) => {
    const { remessa: r, excluidos } = await prepararRemessa(MUNI, { usuario: EQUIPE });
    await enviarRemessa(r.id, { modo: 'lote', idArquivo: `${IBGE}_${idSeq++}`, usuario: EQUIPE });
    const ret = await processarRetorno(r.id, parseRetorno(await gerarRetornoSimulado(r.id)), { origem: 'simulado', usuario: 'Retorno Sinter (simulado)' });
    const quando = `${comp}-${dia}T10:00:00-03:00`, fim = `${comp}-${dia}T16:00:00-03:00`;
    await datar(`UPDATE cib_remessas SET competencia = $2, created_at = $3, enviada_em = $3, processada_em = $4 WHERE id = $1`, [r.id, comp, quando, fim]);
    await datar(`UPDATE cib_movimentacoes SET competencia = $2, transmitido_em = $3, conciliado_em = CASE WHEN conciliado_em IS NULL THEN NULL ELSE $4::timestamptz END WHERE remessa_id = $1`, [r.id, comp, quando, fim]);
    await datar(`UPDATE imoveis SET cib_atribuido_em = $2 WHERE municipio = $1 AND cib_atribuido_em > NOW() - interval '1 minute'`, [MUNI, fim]);
    await datar(`UPDATE cib_divergencias SET created_at = $2 WHERE remessa_id = $1`, [r.id, fim]);
    log(`  remessa ${r.numero} (${comp}): ${r.qtd_itens} registros · ${ret.efetivados} efetivados (${ret.comFalhas} c/ falhas) · ${ret.rejeitados} rejeitados${excluidos.length ? ` · ${excluidos.length} fora por leiaute` : ''}`);
    return r;
  };
  const metade = Math.floor(prontos.length / 2);
  await enfileirar(prontos.slice(0, metade), '2026-09');
  await ciclo('2026-09', '22');
  await enfileirar(prontos.slice(metade, Math.floor(prontos.length * 0.85)), '2026-10');
  await ciclo('2026-10', '08');

  const comCib = (await query(`SELECT id, inscricao, area_construida_m2 FROM imoveis WHERE municipio = $1 AND cib <> '' AND tipo = 'predial' AND NOT tem_erro ORDER BY id LIMIT 40`, [MUNI])).rows;
  const evento = async (im, origem, ref, dados, desc, comp, dia) => {
    const mov = await withTransaction((db) => capturarMovimentacao(db, { municipio: MUNI, imovelId: im.id, inscricao: im.inscricao, tipo: 'alteracao', origem, documentoRef: ref, dadosDepois: dados, descricao: desc, usuario: EQUIPE }));
    await withTransaction((db) => validarMovimentacao(db, mov.id, EQUIPE));
    await datar(`UPDATE cib_movimentacoes SET competencia = $2, created_at = $3 WHERE id = $1`, [mov.id, comp, `${comp}-${dia}T09:00:00-03:00`]);
  };
  for (let i = 0; i < 14; i++) {
    const im = comCib[i];
    if (i % 3 === 0) await evento(im, 'itbi', `ITBI 2026/${300 + i}`, { contribuinte_nome: `${pick(NOMES)} ${pick(SOBRENOMES)}`, contribuinte_doc: cpfFicticio(), titular_tipo: 1, titular_doc_tipo: 1, titular_dt_aquisicao: '2026-10-05', titular_perc: 1 }, 'Transferência de titularidade (ITBI quitado)', '2026-10', String(10 + i).padStart(2, '0'));
    else if (i % 3 === 1) await evento(im, 'habite_se', `Habite-se 2026/${80 + i}`, { area_construida_m2: Math.round((im.area_construida_m2 || 60) * 1.3) }, 'Ampliação com habite-se', '2026-10', String(10 + i).padStart(2, '0'));
    else await evento(im, 'alvara', `Alvará 2026/${150 + i}`, { uso: 'Comercial', destinacao: 2 }, 'Mudança de uso (alvará de funcionamento)', '2026-10', String(10 + i).padStart(2, '0'));
  }
  await ciclo('2026-10', '28');

  await enfileirar(prontos.slice(Math.floor(prontos.length * 0.85)), '2026-11');
  for (let i = 14; i < 22; i++) {
    const im = comCib[i];
    await evento(im, i % 2 ? 'itbi' : 'habite_se', `${i % 2 ? 'ITBI' : 'Habite-se'} 2026/${400 + i}`,
      i % 2 ? { contribuinte_nome: `${pick(NOMES)} ${pick(SOBRENOMES)}` } : { area_construida_m2: Math.round((im.area_construida_m2 || 80) * 1.2) },
      i % 2 ? 'Transferência de titularidade' : 'Ampliação com habite-se', '2026-11', '05');
  }
  const { remessa: r4 } = await prepararRemessa(MUNI, { usuario: EQUIPE });
  await enviarRemessa(r4.id, { modo: 'lote', idArquivo: `${IBGE}_${idSeq++}`, usuario: EQUIPE });
  await datar(`UPDATE cib_remessas SET created_at = '2026-11-10T10:00:00-03:00', enviada_em = '2026-11-10T10:00:00-03:00' WHERE id = $1`, [r4.id]);
  log(`  remessa ${r4.numero} (2026-11): ${r4.qtd_itens} registros enviados, aguardando retorno.`);

  // Novembro: fila do mês ainda não validada.
  const [im1, im2] = [comCib[23], comCib[24]];
  await withTransaction((db) => capturarMovimentacao(db, { municipio: MUNI, imovelId: im1.id, inscricao: im1.inscricao, tipo: 'alteracao', origem: 'itbi', documentoRef: 'ITBI 2026/512', dadosDepois: { contribuinte_nome: 'Juliana Medeiros Dantas', contribuinte_doc: cpfFicticio() }, descricao: 'Imóvel vendido em cartório', usuario: EQUIPE }));
  await withTransaction((db) => capturarMovimentacao(db, { municipio: MUNI, imovelId: im2.id, inscricao: im2.inscricao, tipo: 'alteracao', origem: 'alvara', documentoRef: 'Alvará de construção 2026/233', dadosDepois: { area_construida_m2: Math.round((im2.area_construida_m2 || 100) * 1.5) }, descricao: 'Galpão ampliado na saída da cidade', usuario: EQUIPE }));
  const mae = (await query(`SELECT * FROM imoveis WHERE municipio = $1 AND cib <> '' AND tipo = 'territorial' ORDER BY id LIMIT 1`, [MUNI])).rows[0];
  if (mae) {
    await withTransaction(async (db) => {
      await capturarMovimentacao(db, { municipio: MUNI, imovelId: mae.id, inscricao: mae.inscricao, tipo: 'baixa', origem: 'parcelamento', desativacaoMotivo: 1, desativacaoTipo: 1,
        documentoRef: 'Decreto de desmembramento 2026/014', descricao: 'Baixa por desmembramento', usuario: EQUIPE });
      for (const suf of ['A', 'B']) {
        await capturarMovimentacao(db, { municipio: MUNI, tipo: 'inclusao', origem: 'parcelamento', inscricao: `${mae.inscricao}-${suf}`, documentoRef: 'Decreto de desmembramento 2026/014',
          descricao: `Inclusão por desmembramento de ${mae.inscricao}`, usuario: EQUIPE,
          dadosDepois: { logradouro: mae.logradouro, tipo_logradouro: mae.tipo_logradouro, numero: String(Number(mae.numero) || 100) + suf, bairro: mae.bairro, cep: mae.cep, tipo: 'territorial', uso: 'Terreno vazio',
            contribuinte_nome: mae.contribuinte_nome, contribuinte_doc: mae.contribuinte_doc, area_terreno_m2: Math.round((mae.area_terreno_m2 || 300) / 2), setor: mae.setor, quadra: mae.quadra } });
      }
    });
  }
  await withTransaction((db) => capturarMovimentacao(db, { municipio: MUNI, tipo: 'inclusao', origem: 'habite_se', inscricao: '04.99.0001', documentoRef: 'Habite-se 2026/301',
    descricao: 'Casa nova num loteamento', dadosDepois: { logradouro: 'Rua Projetada 12', numero: '45', bairro: 'Parque Norte', tipo: 'predial', area_terreno_m2: 200, area_construida_m2: 96, contribuinte_nome: 'Lucas Araújo Brito' }, usuario: EQUIPE }));

  const divs = (await query(`SELECT id FROM cib_divergencias WHERE municipio = $1 AND status = 'aberta' ORDER BY id`, [MUNI])).rows;
  for (const d of divs.slice(0, Math.floor(divs.length / 2))) {
    await query(`UPDATE cib_divergencias SET status = 'resolvida', resolucao = 'CPF/CNPJ conferido com o contribuinte; cadastro corrigido e retransmitido.', resolvido_por_nome = $2, resolvido_em = '2026-10-20T15:00:00-03:00' WHERE id = $1`, [d.id, EQUIPE]);
  }
  await query(`UPDATE cib_movimentacoes m SET status = 'conciliada', conciliado_em = NOW() WHERE municipio = $1 AND status = 'divergente'
    AND NOT EXISTS (SELECT 1 FROM cib_divergencias d WHERE d.movimentacao_id = m.id AND d.status = 'aberta')`, [MUNI]);
  await recalcularStatus(null, { municipio: MUNI });

  await query(`INSERT INTO cib_implantacao (municipio, etapa_atual, checklist, etapas) VALUES ($1, 3, $2::jsonb, $3::jsonb)
    ON CONFLICT (municipio) DO UPDATE SET etapa_atual = 3, checklist = EXCLUDED.checklist`,
    [MUNI, JSON.stringify({ convenio: true, perfis: true, transmissor: true, base: true, ctm: true, equipe: false }), JSON.stringify({ integracao: { obs: 'Remessa 04 enviada; aguardando retorno.' } })]);

  const det = await detectarDiferencas(MUNI);
  log(`  vistoria: ${det.novas} diferenças detectadas.`);
  for (const v of (await query(`SELECT id FROM cib_vistorias WHERE municipio = $1 ORDER BY id LIMIT 2`, [MUNI])).rows) await query(`UPDATE cib_vistorias SET status = 'agendada' WHERE id = $1`, [v.id]);

  // Atendimento.
  const amostra = (await query(`SELECT * FROM imoveis WHERE municipio = $1 AND cib <> '' AND NOT tem_erro AND numero <> 'S/N' AND contribuinte_doc <> '' ORDER BY id LIMIT 6`, [MUNI])).rows;
  const reqs = [['certidao', 'certidao_cadastral', 'deferido'], ['certidao', 'declaracao_cib', 'deferido'], ['numeracao_predial', 'certidao_numeracao', 'deferido'],
    ['revisao_cadastral', '', 'em_analise'], ['certidao', 'certidao_valor_venal', 'protocolado'], ['vistoria', '', 'pendente_documentacao']];
  let nReq = 0;
  for (const [i, [tipo, docTipo, status]] of reqs.entries()) {
    const im = amostra[i];
    if (!im) continue;
    nReq += 1;
    const numero = `2026/${String(nReq).padStart(5, '0')}`;
    await query(`INSERT INTO numeradores (escopo, chave, ano, ultimo) VALUES ('protocolo', $1, 2026, $2) ON CONFLICT (escopo, chave, ano) DO UPDATE SET ultimo = GREATEST(numeradores.ultimo, EXCLUDED.ultimo)`, [MUNI, nReq]);
    const criado = `2026-11-${String(3 + nReq).padStart(2, '0')}T09:30:00-03:00`;
    const prazo = status === 'pendente_documentacao' ? '2026-11-12' : `2026-11-${String(20 + nReq).padStart(2, '0')}`;
    const hist = [{ em: criado, status: 'protocolado', por: 'Atendimento (demo)', obs: 'Requerimento protocolado' }];
    if (status !== 'protocolado') hist.push({ em: criado, status: status === 'deferido' ? 'em_analise' : status, por: EQUIPE, obs: '' });
    const r = (await query(
      `INSERT INTO requerimentos (municipio, numero, tipo, documento_tipo, requerente_nome, requerente_doc, imovel_id, inscricao, descricao, status, prazo, responsavel_nome, historico, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$14) RETURNING *`,
      [MUNI, numero, tipo, docTipo, im.contribuinte_nome, im.contribuinte_doc, im.id, im.inscricao,
        { certidao: 'Solicita certidão para fins de financiamento.', numeracao_predial: 'Solicita certidão de numeração para ligação de energia.', revisao_cadastral: 'Informa ampliação da área construída.', vistoria: 'Solicita vistoria para conferência de área.' }[tipo] || '',
        status === 'deferido' ? 'em_analise' : status, prazo, EQUIPE, JSON.stringify(hist), criado])).rows[0];
    if (status === 'deferido') {
      const d = await emitirDocumento({ municipio: MUNI, tipo: r.documento_tipo, imovelId: im.id, interessado: im.contribuinte_nome, requerimentoId: r.id, usuario: EQUIPE });
      hist.push({ em: new Date().toISOString(), status: 'deferido', por: EQUIPE, obs: `Documento ${d.titulo} nº ${d.numero} emitido` });
      await query(`UPDATE requerimentos SET status = 'deferido', documento_id = $2, parecer = 'Deferido conforme dados cadastrais.', historico = $3::jsonb WHERE id = $1`, [r.id, d.id, JSON.stringify(hist)]);
    }
  }
  await emitirDocumento({ municipio: MUNI, tipo: 'relatorio_mensal', campos: { competencia: '2026-10' }, usuario: EQUIPE });
  await emitirDocumento({ municipio: MUNI, tipo: 'relatorio_diagnostico', usuario: EQUIPE });
  await emitirDocumento({ municipio: MUNI, tipo: 'oficio_adesao_sinter', campos: { destinatario: 'Ao(À) Senhor(a) Delegado(a) da Receita Federal do Brasil', unidadeRfb: 'Delegacia da Receita Federal do Brasil em João Pessoa/PB' }, usuario: EQUIPE });
  log(`  atendimento: ${nReq} requerimentos e documentos emitidos.`);

  await semearCidadaoDemo({ log });

  const fim = (await query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE cib <> '')::int AS cib FROM imoveis WHERE municipio = $1`, [MUNI])).rows[0];
  log(`  pronto: ${fim.n} imóveis, ${fim.cib} com CIB (SIMULADO — demonstração).`);
  return fim;
}

// Identidade FICTÍCIA da prefeitura de demonstração (página inicial e portal):
// um escudo genérico com as iniciais — não reproduz brasão de nenhum município.
export const BRASAO_DEMO = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 116">
<path d="M50 3 L95 15 V58 C95 86 74 104 50 113 C26 104 5 86 5 58 V15 Z" fill="#1d4e89" stroke="#f2c230" stroke-width="5"/>
<path d="M50 16 L83 25 V58 C83 79 68 93 50 100 C32 93 17 79 17 58 V25 Z" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="2"/>
<text x="50" y="68" text-anchor="middle" font-family="Georgia,serif" font-size="34" font-weight="700" fill="#ffffff">ME</text>
<rect x="30" y="76" width="40" height="3" fill="#f2c230"/></svg>`).toString('base64');
export async function semearPaginaDemo() {
  await query(`UPDATE municipio_config SET cor_primaria = '#1d4e89', brasao = CASE WHEN brasao = '' THEN $2 ELSE brasao END,
      horario_atendimento = 'Segunda a sexta, das 8h às 13h', whatsapp = '(83) 90000-0000', site = 'https://exemplo.invalid',
      aviso = 'Recadastramento imobiliário 2027: confira os seus imóveis no Portal do Cidadão e peça a correção até 31/12/2026, sem sair de casa.'
    WHERE municipio = $1`, [MUNI, BRASAO_DEMO]);
}

// Munícipe de DEMONSTRAÇÃO do Portal do Cidadão (dados fictícios): três imóveis
// (um com CIB, um terreno, um ainda sem CIB), e-mail para o código de acesso e
// duas solicitações feitas pelo portal.
export const CIDADAO_DEMO = { cpf: '52998224725', nome: 'Maria do Carmo Exemplo', email: 'maria.exemplo@exemplo.invalid' };
export async function semearCidadaoDemo({ log = () => {} } = {}) {
  const { cpf, nome, email } = CIDADAO_DEMO;
  if ((await query('SELECT 1 FROM imoveis WHERE municipio = $1 AND contribuinte_doc = $2', [MUNI, cpf])).rows.length) return log('  portal: cidadão de demonstração já existe.');
  const pega = async (sql) => (await query(`SELECT id, inscricao FROM imoveis WHERE municipio = $1 AND contribuinte_doc <> $2 AND ${sql} ORDER BY id LIMIT 1`, [MUNI, cpf])).rows[0];
  const casa = await pega(`tipo = 'predial' AND cib <> '' AND NOT tem_erro AND numero <> 'S/N' AND logradouro <> '' AND valor_venal_total IS NOT NULL AND situacao = 'ativo'`);
  const terreno = await pega(`tipo = 'territorial' AND situacao = 'ativo' AND id <> ${Number(casa?.id) || 0}`);
  const semCib = await pega(`cib = '' AND situacao = 'ativo' AND id NOT IN (${Number(casa?.id) || 0}, ${Number(terreno?.id) || 0})`);
  const meus = [casa, terreno, semCib].filter(Boolean);
  for (const im of meus) {
    await query(`UPDATE imoveis SET contribuinte_nome = $2, contribuinte_doc = $3, contribuinte_email = $4, contribuinte_telefone = '(83) 90000-0000', updated_at = now() WHERE id = $1`, [im.id, nome, cpf, email]);
  }
  if (casa) {
    await protocolarRequerimento({ municipio: MUNI, tipo: 'revisao_cadastral', requerenteNome: nome, requerenteDoc: cpf, requerenteEmail: email, imovelId: casa.id, inscricao: casa.inscricao,
      descricao: 'Construí uma varanda nos fundos (cerca de 18 m²). Peço a atualização da área construída.', usuario: `${nome} (Portal do Cidadão)`, canal: 'portal' });
  }
  if (semCib) {
    const r = await protocolarRequerimento({ municipio: MUNI, tipo: 'transferencia', requerenteNome: nome, requerenteDoc: cpf, requerenteEmail: email, imovelId: semCib.id, inscricao: semCib.inscricao,
      descricao: 'Comprei este imóvel em outubro. Peço a transferência para o meu nome.', usuario: `${nome} (Portal do Cidadão)`, canal: 'portal' });
    const hist = [...r.historico, { em: new Date().toISOString(), status: 'pendente_documentacao', por: 'Atendimento (demo)', obs: 'Envie a escritura registrada e a guia do ITBI quitada.' }];
    await query(`UPDATE requerimentos SET status = 'pendente_documentacao', parecer = 'Envie a escritura registrada e a guia do ITBI quitada.', historico = $2::jsonb WHERE id = $1`, [r.id, JSON.stringify(hist)]);
  }
  log(`  portal: cidadão de demonstração ${nome} (CPF 529.982.247-25) com ${meus.length} imóveis.`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  (async () => {
    if (!isConfigured) { console.error('Defina DATABASE_URL.'); process.exit(1); }
    if (PRODUCAO) { console.error('Seed de demonstração bloqueado em produção (NODE_ENV=production).'); process.exit(1); }
    try {
      console.log(`Carregando o cadastro de demonstração (CIB/Sinter) em "${MUNI}"...`);
      if (process.argv.includes('--cidadao')) { await semearPaginaDemo(); await semearCidadaoDemo({ log: console.log }); } // num banco já semeado
      else await seedCibDemo({ truncate: process.argv.includes('--truncate'), log: console.log });
      console.log('Concluído. Abra /cib/ e /documentos/.');
    } catch (e) { console.error('Erro:', e.message, e.stack); process.exitCode = 1; }
    finally { await closePool(); }
  })();
}
