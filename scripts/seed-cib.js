// Carrega o cadastro fiscal de DEMONSTRACAO do modulo CIB/Sinter + Documentos
// sobre a cidade ficticia do Territorio ("Municipio Exemplo"). Dados ficticios.
//
// Percorre o fluxo real do sistema: importa a base, valida, faz a carga
// inicial, prepara/envia remessas, processa retornos (simulados), abre
// divergencias, detecta diferencas para vistoria, protocola requerimentos e
// emite documentos — para o painel ficar parecido com o da revista.
//
// Uso: npm run seed-cib            (recusa se ja houver imoveis)
//      npm run seed-cib -- --truncate
import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { isConfigured, query, withTransaction, closePool } from '../src/db.js';
import { ensureSchema } from '../src/schema.js';
import { ensureAuthSchema } from '../src/auth.js';
import { ensureDemandasSchema } from '../src/demandas.js';
import { ensureBciSchema } from '../src/bci.js';
import {
  ensureCibSchema, processarImoveis, capturarMovimentacao, validarMovimentacao, prepararRemessa, enviarRemessa,
  simularRetorno, recalcularStatus, detectarDiferencas,
} from '../src/cib.js';
import { ensureDocumentosSchema, emitirDocumento } from '../src/documentos.js';
import { seedDemo } from './seed-demo.js';

export const MUNI = 'Município Exemplo';

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

// CPF/CNPJ ficticios com digitos verificadores validos.
function cpfFicticio() {
  const n = Array.from({ length: 9 }, () => Math.floor(rnd() * 10));
  const dv = (b) => { const s = b.reduce((a, d, i) => a + d * (b.length + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  n.push(dv(n)); n.push(dv(n));
  return n.join('');
}
function cnpjFicticio() {
  const n = [...Array.from({ length: 8 }, () => Math.floor(rnd() * 10)), 0, 0, 0, 1];
  const calc = (b) => { const p = b.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const r = b.reduce((a, d, i) => a + d * p[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  n.push(calc(n)); n.push(calc(n));
  return n.join('');
}

const NOMES = ['Maria', 'José', 'Ana', 'João', 'Francisca', 'Antônio', 'Adriana', 'Carlos', 'Juliana', 'Paulo', 'Márcia', 'Pedro', 'Aline', 'Lucas', 'Patrícia', 'Rafael', 'Sandra', 'Severino', 'Luciana', 'Fernando'];
const SOBRENOMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Ferreira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento', 'Araújo', 'Medeiros', 'Cavalcanti', 'Barbosa', 'Gomes', 'Dantas', 'Brito'];
const EMPRESAS = ['Comercial Alvorada Ltda', 'Mercadinho Bom Preço ME', 'Construtora Horizonte Ltda', 'Indústria Nordeste Têxtil S/A', 'Padaria Pão Nosso ME', 'Oficina Dois Irmãos Ltda'];
const RUAS = ['Rua das Acácias', 'Rua Projetada 12', 'Av. Presidente Epitácio', 'Rua São José', 'Rua Manoel Deodato', 'Rua das Flores', 'Travessa do Comércio', 'Rua Joaquim Nabuco', 'Av. Getúlio Vargas', 'Rua Coronel Antônio Pessoa', 'Rua Santo Antônio', 'Rua Padre Ibiapina'];
const SETOR = { 'CENTRO': '01', 'JARDIM DAS FLORES': '02', 'VILA INDUSTRIAL': '03', 'PARQUE NORTE': '04' };
const CEP = { 'CENTRO': '58700000', 'JARDIM DAS FLORES': '58700100', 'VILA INDUSTRIAL': '58700200', 'PARQUE NORTE': '58700300' };
const USO = { residencial: 'Residencial', comercial: 'Comercial', misto: 'Misto', industrial: 'Industrial', institucional: 'Institucional', vazio: 'Terreno vazio' };

const EQUIPE = 'Coordenação do Cadastro (demo)';

async function datar(sql, params) { await query(sql, params); }

export async function seedCibDemo({ truncate = false, log = () => {} } = {}) {
  await ensureSchema(); await ensureAuthSchema(); await ensureDemandasSchema(); await ensureBciSchema();
  await ensureCibSchema(); await ensureDocumentosSchema();

  const nLotes = (await query('SELECT COUNT(*)::int AS n FROM lotes')).rows[0].n;
  if (!nLotes) { log('  sem lotes no Território — carregando a cidade de demonstração primeiro...'); await seedDemo({ truncate: true, log }); }

  if (truncate) {
    for (const t of ['documentos', 'requerimentos', 'cib_vistorias', 'cib_divergencias', 'cib_movimentacoes', 'cib_remessas', 'cib_auditoria', 'cib_implantacao', 'pgv_valores']) {
      await query(`DELETE FROM ${t} WHERE municipio = $1`, [MUNI]);
    }
    await query('DELETE FROM imoveis WHERE municipio = $1', [MUNI]);
  } else {
    const ja = (await query('SELECT COUNT(*)::int AS n FROM imoveis WHERE municipio = $1', [MUNI])).rows[0].n;
    if (ja) throw new Error(`Já existem ${ja} imóveis em "${MUNI}". Use --truncate para recriar.`);
  }

  // A cidade de demonstracao do Territorio vem sem municipio: marca como "Municipio Exemplo".
  for (const t of ['bairros', 'quadras', 'lotes', 'ruas', 'edificacoes']) {
    await query(`UPDATE ${t} SET municipio = $1 WHERE municipio IS NULL OR municipio = ''`, [MUNI]);
  }

  // Configuracao do municipio (cabecalho dos documentos).
  await query(
    `INSERT INTO municipio_config (municipio, nome_oficial, uf, codigo_ibge, cnpj, secretaria, setor, endereco, telefone, email,
       prefeito_nome, responsavel_nome, responsavel_cargo, convenio_numero, convenio_data, prazo_sinter, transmissores, rodape_documentos)
     VALUES ($1,$2,'PB','2599999',$3,'Secretaria Municipal de Finanças','Setor de Cadastro Imobiliário','Rua Principal, 100 — Centro',
       '(83) 3300-0000','cadastro@exemplo.pb.gov.br','Prefeito(a) Exemplo',$4,'Coordenador(a) do Cadastro Imobiliário','SINTER-PB-0000/2026',
       '2026-08-15','2026-12-31','BzR Technology (transmissora PJ)','Dados fictícios — ambiente de demonstração BzR.')
     ON CONFLICT (municipio) DO UPDATE SET nome_oficial = EXCLUDED.nome_oficial`,
    [MUNI, `Prefeitura Municipal de ${MUNI}`, cnpjFicticio(), EQUIPE]
  );

  // PGV.
  const pgv = [['terreno', 'CENTRO', 420], ['terreno', 'JARDIM DAS FLORES', 260], ['terreno', 'VILA INDUSTRIAL', 180], ['terreno', 'PARQUE NORTE', 110], ['terreno', '*', 150],
    ['construcao', 'baixo', 950], ['construcao', 'medio', 1550], ['construcao', 'alto', 2350], ['construcao', 'luxo', 3300]];
  for (const [t, k, v] of pgv) await query('INSERT INTO pgv_valores (municipio, tipo, chave, valor_m2, ano) VALUES ($1,$2,$3,$4,2026) ON CONFLICT DO NOTHING', [MUNI, t, k, v]);

  // Base cadastral (como se tivesse vindo do sistema tributario).
  const lotes = (await query(
    `SELECT l.id, l.codigo, l.quadra, l.bairro, l.uso, l.area_m2,
            COALESCE((SELECT SUM(ST_Area(ST_Intersection(e.geom, l.geom)::geography) * GREATEST(COALESCE(e.n_pavimentos,1),1))
                      FROM edificacoes e WHERE ST_Intersects(e.geom, l.geom)), 0) AS area_edif
     FROM lotes l WHERE l.municipio = $1 ORDER BY l.codigo`, [MUNI]
  )).rows;
  let seqPorQuadra = {};
  let nNova = 0, nAmpl = 0;
  const itens = [];
  for (const l of lotes) {
    if (rnd() < 0.04) continue; // lacunas: lote sem inscricao
    const bairro = String(l.bairro || '').toUpperCase();
    const setor = SETOR[bairro] || '05';
    const q = String(l.quadra || 'Q0000').replace(/\D/g, '').slice(-2).padStart(2, '0');
    seqPorQuadra[q + setor] = (seqPorQuadra[q + setor] || 0) + 1;
    const inscricao = `${setor}.${q}.${String(seqPorQuadra[q + setor]).padStart(4, '0')}`;
    const pj = ['comercial', 'industrial'].includes(l.uso) && rnd() < 0.6;
    let doc = pj ? cnpjFicticio() : cpfFicticio();
    const r = rnd();
    if (r < 0.03) doc = '';
    else if (r < 0.06) doc = doc.slice(0, -1) + ((Number(doc.slice(-1)) + 1) % 10); // DV errado
    let areaConstr = Math.round(l.area_edif * (0.95 + rnd() * 0.15));
    let tipo = l.uso === 'vazio' || areaConstr <= 0 ? 'territorial' : 'predial';
    // Diferencas propositais para a deteccao por imagem:
    if (tipo === 'predial' && nNova < 9 && rnd() < 0.05) { tipo = 'territorial'; areaConstr = 0; nNova += 1; }
    else if (tipo === 'predial' && nAmpl < 6 && rnd() < 0.05) { areaConstr = Math.round(areaConstr * 0.45); nAmpl += 1; }
    const areaTerreno = rnd() < 0.04 ? Math.round(l.area_m2 * 1.25) : Math.round(l.area_m2 * (0.98 + rnd() * 0.04));
    itens.push({
      inscricao, lote_codigo: l.codigo, setor, quadra: q, lote_num: String(seqPorQuadra[q + setor]).padStart(4, '0'),
      tipo, uso: USO[l.uso] || 'Residencial', logradouro: rnd() < 0.025 ? '' : pick(RUAS), numero: rnd() < 0.08 ? 'S/N' : String(10 + Math.floor(rnd() * 1800)),
      bairro: l.bairro || '', cep: CEP[bairro] || '58700000',
      contribuinte_nome: pj ? pick(EMPRESAS) : `${pick(NOMES)} ${pick(SOBRENOMES)} ${pick(SOBRENOMES)}`, contribuinte_doc: doc,
      matricula_cartorio: rnd() < 0.85 ? String(1000 + Math.floor(rnd() * 30000)) : '', cartorio: 'Cartório do 1º Ofício',
      area_terreno_m2: areaTerreno, area_construida_m2: tipo === 'predial' ? areaConstr : 0,
      padrao_construtivo: bairro === 'CENTRO' ? pick(['medio', 'alto']) : pick(['baixo', 'medio', 'medio']),
      ano_construcao: tipo === 'predial' ? 1975 + Math.floor(rnd() * 50) : null, testada_m: 12 + Math.round(rnd() * 10),
    });
  }
  await withTransaction(async (db) => {
    for (const c of itens) {
      const cols = Object.keys(c);
      await db.query(
        `INSERT INTO imoveis (municipio, lote_id, ${cols.join(', ')}) VALUES ($1, (SELECT id FROM lotes WHERE codigo = $2 AND municipio = $1 LIMIT 1), ${cols.map((_, i) => '$' + (i + 3)).join(', ')})`,
        [MUNI, c.lote_codigo, ...cols.map((k) => c[k])]
      );
    }
  });
  await processarImoveis(null, { municipio: MUNI });
  log(`  ${itens.length} imóveis importados (${lotes.length - itens.length} lotes sem inscrição).`);

  // Saneamento parcial: corrige a maior parte dos documentos ausentes/inválidos.
  const comErro = (await query(`SELECT id, pendencias FROM imoveis WHERE municipio = $1 AND tem_erro ORDER BY id`, [MUNI])).rows;
  let corrigidos = 0;
  for (const im of comErro.slice(0, Math.floor(comErro.length * 0.55))) {
    const cods = im.pendencias.map((p) => p.codigo);
    const sets = [];
    if (cods.includes('DOC_INVALIDO') || cods.includes('DOC_AUSENTE')) sets.push(`contribuinte_doc = '${cpfFicticio()}'`);
    if (cods.includes('LOGRADOURO_VAZIO')) sets.push(`logradouro = '${pick(RUAS)}'`);
    if (sets.length) { await query(`UPDATE imoveis SET ${sets.join(', ')} WHERE id = $1`, [im.id]); corrigidos += 1; }
  }
  await processarImoveis(null, { municipio: MUNI });
  log(`  saneamento: ${corrigidos} imóveis corrigidos.`);

  // Remessa 01 (setembro): carga inicial de metade da base pronta.
  const prontos = (await query(`SELECT id, inscricao FROM imoveis WHERE municipio = $1 AND NOT tem_erro AND situacao = 'ativo' ORDER BY id`, [MUNI])).rows;
  const enfileirar = async (lista, comp) => {
    for (const p of lista) {
      await query(
        `INSERT INTO cib_movimentacoes (municipio, imovel_id, inscricao, tipo, origem, descricao, status, validado_em, competencia, criado_por_nome, created_at)
         VALUES ($1,$2,$3,'inclusao','implantacao','Carga inicial do cadastro','validada',NOW(),$4,$5,$6)`,
        [MUNI, p.id, p.inscricao, comp, EQUIPE, `${comp}-10T12:00:00-03:00`]
      );
    }
  };
  const ciclo = async (comp, dia, protocolo) => {
    const r = await prepararRemessa(MUNI, { usuario: EQUIPE });
    await enviarRemessa(r.id, { protocolo, usuario: EQUIPE });
    const ret = await simularRetorno(r.id, 'Retorno Sinter (simulado)');
    await datar(`UPDATE cib_remessas SET competencia = $2, created_at = $3, enviada_em = $3, processada_em = $4 WHERE id = $1`,
      [r.id, comp, `${comp}-${dia}T10:00:00-03:00`, `${comp}-${dia}T16:00:00-03:00`]);
    await datar(`UPDATE cib_movimentacoes SET competencia = $2, transmitido_em = $3, conciliado_em = CASE WHEN conciliado_em IS NULL THEN NULL ELSE $4::timestamptz END WHERE remessa_id = $1`,
      [r.id, comp, `${comp}-${dia}T10:00:00-03:00`, `${comp}-${dia}T16:00:00-03:00`]);
    await datar(`UPDATE imoveis SET cib_atribuido_em = $2 WHERE municipio = $1 AND cib_atribuido_em > NOW() - interval '1 minute'`, [MUNI, `${comp}-${dia}T16:00:00-03:00`]);
    await datar(`UPDATE cib_divergencias SET created_at = $2 WHERE remessa_id = $1`, [r.id, `${comp}-${dia}T16:00:00-03:00`]);
    log(`  remessa ${r.numero} (${comp}): ${r.qtd_itens} itens · ${ret.ok} ok · ${ret.divergentes} divergentes · ${ret.rejeitadas} rejeitadas`);
    return r;
  };
  const metade = Math.floor(prontos.length / 2);
  await enfileirar(prontos.slice(0, metade), '2026-09');
  await ciclo('2026-09', '22', 'SINTER-2026-0915-0001');
  await enfileirar(prontos.slice(metade, Math.floor(prontos.length * 0.85)), '2026-10');
  await ciclo('2026-10', '08', 'SINTER-2026-1008-0002');

  // Outubro: eventos do ciclo mensal (ITBI, habite-se, alvara) + remessa 03.
  const algunsComCib = (await query(`SELECT id, inscricao, area_construida_m2 FROM imoveis WHERE municipio = $1 AND cib <> '' ORDER BY id LIMIT 40`, [MUNI])).rows;
  const evento = async (im, tipo, origem, ref, dados, desc, comp, dia) => {
    const mov = await withTransaction((db) => capturarMovimentacao(db, { municipio: MUNI, imovelId: im.id, inscricao: im.inscricao, tipo, origem, documentoRef: ref, dadosDepois: dados, descricao: desc, usuario: EQUIPE }));
    await withTransaction((db) => validarMovimentacao(db, mov.id, EQUIPE));
    await datar(`UPDATE cib_movimentacoes SET competencia = $2, created_at = $3 WHERE id = $1`, [mov.id, comp, `${comp}-${dia}T09:00:00-03:00`]);
    return mov;
  };
  for (let i = 0; i < 14; i++) {
    const im = algunsComCib[i];
    if (i % 3 === 0) await evento(im, 'alteracao', 'itbi', `ITBI ${2026}/${300 + i}`, { contribuinte_nome: `${pick(NOMES)} ${pick(SOBRENOMES)}`, contribuinte_doc: cpfFicticio() }, 'Transferência de titularidade (ITBI quitado)', '2026-10', String(10 + i).padStart(2, '0'));
    else if (i % 3 === 1) await evento(im, 'alteracao', 'habite_se', `Habite-se ${2026}/${80 + i}`, { area_construida_m2: Math.round((im.area_construida_m2 || 60) * 1.3) }, 'Ampliação com habite-se', '2026-10', String(10 + i).padStart(2, '0'));
    else await evento(im, 'alteracao', 'alvara', `Alvará ${2026}/${150 + i}`, { uso: 'Comercial' }, 'Mudança de uso (alvará de funcionamento)', '2026-10', String(10 + i).padStart(2, '0'));
  }
  await ciclo('2026-10', '28', 'SINTER-2026-1028-0003');

  // Novembro (competencia atual): restante da base + eventos -> remessa 04 enviada, aguardando retorno.
  await enfileirar(prontos.slice(Math.floor(prontos.length * 0.85)), '2026-11');
  for (let i = 14; i < 22; i++) {
    const im = algunsComCib[i];
    await evento(im, 'alteracao', i % 2 ? 'itbi' : 'habite_se', `${i % 2 ? 'ITBI' : 'Habite-se'} 2026/${400 + i}`,
      i % 2 ? { contribuinte_nome: `${pick(NOMES)} ${pick(SOBRENOMES)}` } : { area_construida_m2: Math.round((im.area_construida_m2 || 80) * 1.2) },
      i % 2 ? 'Transferência de titularidade' : 'Ampliação com habite-se', '2026-11', '05');
  }
  const r4 = await prepararRemessa(MUNI, { usuario: EQUIPE });
  await enviarRemessa(r4.id, { protocolo: 'SINTER-2026-1110-0004', usuario: EQUIPE });
  await datar(`UPDATE cib_remessas SET created_at = '2026-11-10T10:00:00-03:00', enviada_em = '2026-11-10T10:00:00-03:00' WHERE id = $1`, [r4.id]);
  log(`  remessa ${r4.numero} (2026-11): ${r4.qtd_itens} itens enviados, aguardando retorno.`);

  // Novembro: eventos capturados ainda nao validados (fila do mes).
  const im1 = algunsComCib[23], im2 = algunsComCib[24];
  await withTransaction((db) => capturarMovimentacao(db, { municipio: MUNI, imovelId: im1.id, inscricao: im1.inscricao, tipo: 'alteracao', origem: 'itbi', documentoRef: 'ITBI 2026/512', dadosDepois: { contribuinte_nome: 'Juliana Medeiros Dantas', contribuinte_doc: cpfFicticio() }, descricao: 'Imóvel vendido em cartório', usuario: EQUIPE }));
  await withTransaction((db) => capturarMovimentacao(db, { municipio: MUNI, imovelId: im2.id, inscricao: im2.inscricao, tipo: 'alteracao', origem: 'alvara', documentoRef: 'Alvará de construção 2026/233', dadosDepois: { area_construida_m2: Math.round((im2.area_construida_m2 || 100) * 1.5) }, descricao: 'Galpão ampliado na saída da cidade', usuario: EQUIPE }));
  // Parcelamento: lote desmembrado no Centro.
  const mae = (await query(`SELECT * FROM imoveis WHERE municipio = $1 AND bairro ILIKE 'centro' AND cib <> '' AND tipo = 'territorial' LIMIT 1`, [MUNI])).rows[0]
    || (await query(`SELECT * FROM imoveis WHERE municipio = $1 AND cib <> '' ORDER BY id DESC LIMIT 1`, [MUNI])).rows[0];
  if (mae) {
    await withTransaction(async (db) => {
      await capturarMovimentacao(db, { municipio: MUNI, imovelId: mae.id, inscricao: mae.inscricao, tipo: 'baixa', origem: 'parcelamento', documentoRef: 'Decreto de desmembramento 2026/014', descricao: 'Baixa por desmembramento', usuario: EQUIPE });
      for (const suf of ['A', 'B']) {
        await capturarMovimentacao(db, { municipio: MUNI, tipo: 'inclusao', origem: 'parcelamento', inscricao: `${mae.inscricao}-${suf}`, documentoRef: 'Decreto de desmembramento 2026/014',
          descricao: `Inclusão por desmembramento de ${mae.inscricao}`, usuario: EQUIPE,
          dadosDepois: { logradouro: mae.logradouro, numero: String(Number(mae.numero) || 100) + suf, bairro: mae.bairro, cep: mae.cep, tipo: 'territorial', uso: 'Terreno vazio',
            contribuinte_nome: mae.contribuinte_nome, contribuinte_doc: mae.contribuinte_doc, area_terreno_m2: Math.round((mae.area_terreno_m2 || 300) / 2), setor: mae.setor, quadra: mae.quadra } });
      }
    });
  }
  // Casa nova num loteamento (inclusao com dado incompleto — fica na fila com erro de validacao).
  await withTransaction((db) => capturarMovimentacao(db, { municipio: MUNI, tipo: 'inclusao', origem: 'habite_se', inscricao: '04.99.0001', documentoRef: 'Habite-se 2026/301',
    descricao: 'Casa nova num loteamento', dadosDepois: { logradouro: 'Rua Projetada 12', numero: '45', bairro: 'Parque Norte', tipo: 'predial', area_terreno_m2: 200, area_construida_m2: 96, contribuinte_nome: 'Lucas Araújo Brito' }, usuario: EQUIPE }));

  // Resolve parte das divergencias.
  const divs = (await query(`SELECT id FROM cib_divergencias WHERE municipio = $1 AND status = 'aberta' ORDER BY id`, [MUNI])).rows;
  for (const d of divs.slice(0, Math.floor(divs.length / 2))) {
    await query(`UPDATE cib_divergencias SET status = 'resolvida', resolucao = 'Área conferida com a matrícula; cadastro ajustado.', resolvido_por_nome = $2, resolvido_em = '2026-10-20T15:00:00-03:00' WHERE id = $1`, [d.id, EQUIPE]);
  }
  await query(`UPDATE cib_movimentacoes m SET status = 'conciliada', conciliado_em = NOW() WHERE municipio = $1 AND status = 'divergente'
    AND NOT EXISTS (SELECT 1 FROM cib_divergencias d WHERE d.movimentacao_id = m.id AND d.status = 'aberta')`, [MUNI]);
  await recalcularStatus(null, { municipio: MUNI });

  // Implantacao: etapa 3 (Integracao), checklist de adesao.
  await query(`INSERT INTO cib_implantacao (municipio, etapa_atual, checklist, etapas) VALUES ($1, 3, $2::jsonb, $3::jsonb)
    ON CONFLICT (municipio) DO UPDATE SET etapa_atual = 3, checklist = EXCLUDED.checklist`,
    [MUNI, JSON.stringify({ convenio: true, perfis: true, transmissor: true, base: true, ctm: true, equipe: false }),
      JSON.stringify({ integracao: { obs: 'Remessa 04 enviada; aguardando retorno.' } })]);

  // Deteccao por imagem (cruzamento edificacoes x cadastro).
  const det = await detectarDiferencas(MUNI);
  log(`  vistoria: ${det.novas} diferenças detectadas.`);
  const vs = (await query(`SELECT id FROM cib_vistorias WHERE municipio = $1 ORDER BY id LIMIT 2`, [MUNI])).rows;
  for (const v of vs) await query(`UPDATE cib_vistorias SET status = 'agendada' WHERE id = $1`, [v.id]);

  // Atendimento: requerimentos + documentos.
  const amostra = (await query(`SELECT * FROM imoveis WHERE municipio = $1 AND cib <> '' AND NOT tem_erro AND numero <> 'S/N' ORDER BY id LIMIT 6`, [MUNI])).rows;
  const reqs = [
    ['certidao', 'certidao_cadastral', amostra[0], 'deferido'],
    ['certidao', 'declaracao_cib', amostra[1], 'deferido'],
    ['numeracao_predial', '', amostra[2], 'deferido'],
    ['revisao_cadastral', '', amostra[3], 'em_analise'],
    ['certidao', 'certidao_valor_venal', amostra[4], 'protocolado'],
    ['vistoria', '', amostra[5], 'pendente_documentacao'],
  ];
  let nReq = 0;
  for (const [tipo, docTipo, im, status] of reqs) {
    if (!im) continue;
    nReq += 1;
    const numero = `2026/${String(nReq).padStart(5, '0')}`;
    const criado = `2026-11-${String(3 + nReq).padStart(2, '0')}T09:30:00-03:00`;
    const prazo = status === 'pendente_documentacao' ? '2026-11-12' : `2026-11-${String(20 + nReq).padStart(2, '0')}`;
    const hist = [{ em: criado, status: 'protocolado', por: 'Atendimento (demo)', obs: 'Requerimento protocolado' }];
    if (status !== 'protocolado') hist.push({ em: criado, status: status === 'deferido' ? 'em_analise' : status, por: EQUIPE, obs: '' });
    const r = (await query(
      `INSERT INTO requerimentos (municipio, numero, tipo, documento_tipo, requerente_nome, requerente_doc, imovel_id, inscricao, descricao, status, prazo, responsavel_nome, historico, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$14) RETURNING *`,
      [MUNI, numero, tipo, docTipo || (tipo === 'numeracao_predial' ? 'certidao_numeracao' : ''), im.contribuinte_nome, im.contribuinte_doc, im.id, im.inscricao,
        { certidao: 'Solicita certidão para fins de financiamento.', numeracao_predial: 'Solicita certidão de numeração para ligação de energia.', revisao_cadastral: 'Informa ampliação da área construída.', vistoria: 'Solicita vistoria para conferência de área.' }[tipo] || '',
        status === 'deferido' ? 'em_analise' : status, prazo, EQUIPE, JSON.stringify(hist), criado]
    )).rows[0];
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

  const fim = (await query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE cib <> '')::int AS cib FROM imoveis WHERE municipio = $1`, [MUNI])).rows[0];
  log(`  pronto: ${fim.n} imóveis, ${fim.cib} com CIB.`);
  return fim;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  (async () => {
    if (!isConfigured) { console.error('Defina DATABASE_URL.'); process.exit(1); }
    try {
      console.log(`Carregando o cadastro de demonstração (CIB/Sinter) em "${MUNI}"...`);
      await seedCibDemo({ truncate: process.argv.includes('--truncate'), log: console.log });
      console.log('Concluído. Abra /cib/ e /documentos/.');
    } catch (e) { console.error('Erro:', e.message); process.exitCode = 1; }
    finally { await closePool(); }
  })();
}
