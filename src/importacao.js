// Importação INCREMENTAL da base do sistema tributário (recorrente).
//
// - Chave: inscrição imobiliária (municipio + inscricao).
// - Idempotente: cada linha é comparada campo a campo com o cadastro; o que
//   não mudou é "inalterado" e não gera nada. Importar o mesmo arquivo de novo
//   não cria movimentação, não altera imóvel e é reconhecido pelo SHA-256.
// - Só os campos presentes no arquivo são considerados (coluna ausente = não mexe).
// - Imóvel já conhecido do Sinter: a mudança vira (ou se junta a) uma
//   alteração na fila de transmissão. Inscrição nova depois de iniciada a
//   integração: vira inclusão no ciclo mensal (uma só, mesmo reimportando).
// - Carga "completa": inscrições ativas que não vieram no arquivo aparecem como
//   "ausente" no relatório (nunca são baixadas automaticamente).
// - Relatório por importação: novos, alterados (campo: antes → depois),
//   inalterados, erros e ausentes; exportável em CSV (CPF/CNPJ mascarado).
import { Router } from 'express';
import { query, withTransaction } from './db.js';
import { requireRole } from './auth.js';
import { muniDe, nomeUsuario, erro, rotaAsync } from './util.js';
import { mapearColunas, csvEscapar, parseCsv } from './csv.js';
import { mascararDoc } from './cib-validacao.js';
import { normalizarCampos, completarDerivados, aplicarAlteracao, capturarMovimentacao, validarMovimentacao, processarImoveis, auditar, ROTULOS } from './cib.js';

export const ALIASES = {
  inscricao: ['inscricao', 'inscricao_imobiliaria', 'insc', 'inscricao_municipal', 'cod_imovel', 'codigo_imovel', 'inscricaoimobiliaria'],
  lote_codigo: ['lote_codigo', 'codigo_lote', 'cod_lote', 'id_lote'],
  tipo: ['tipo', 'tipo_imovel'], uso: ['uso', 'uso_imovel', 'utilizacao'],
  logradouro: ['logradouro', 'endereco', 'rua', 'nome_logradouro'], numero: ['numero', 'num', 'n', 'numero_predial'],
  complemento: ['complemento', 'compl'], bairro: ['bairro'], cep: ['cep'], setor: ['setor'], quadra: ['quadra'], lote_num: ['lote', 'lote_num'],
  contribuinte_nome: ['contribuinte', 'contribuinte_nome', 'proprietario', 'nome_contribuinte', 'nome'],
  contribuinte_doc: ['cpf', 'cnpj', 'cpf_cnpj', 'documento', 'contribuinte_doc', 'cpf_cnpj_contribuinte', 'ni'],
  contribuinte_email: ['email', 'e_mail', 'contribuinte_email'], contribuinte_telefone: ['telefone', 'fone', 'contribuinte_telefone'],
  matricula_cartorio: ['matricula', 'matricula_cartorio'], cartorio: ['cartorio'], cnm_ri: ['cnm', 'cnm_ri', 'codigo_nacional_matricula'],
  area_terreno_m2: ['area_terreno', 'area_terreno_m2', 'at', 'area_lote'], area_construida_m2: ['area_construida', 'area_construida_m2', 'ac', 'area_edificada'],
  testada_m: ['testada', 'testada_m'], n_pavimentos: ['pavimentos', 'n_pavimentos'], padrao_construtivo: ['padrao', 'padrao_construtivo'],
  ano_construcao: ['ano_construcao', 'ano'], tipo_logradouro: ['tipo_logradouro', 'cod_tipo_logradouro'], tp_arquitetonico: ['tp_arquitetonico', 'tipo_arquitetonico'],
  destinacao: ['destinacao', 'destinacao_imovel'], titular_tipo: ['tipo_titularidade', 'titular_tipo'], titular_doc_tipo: ['doc_titularidade', 'titular_doc_tipo'],
  titular_dt_aquisicao: ['data_aquisicao', 'dt_aquisicao', 'titular_dt_aquisicao'],
};

const mascararValor = (k, v) => (k === 'contribuinte_doc' && v ? mascararDoc(v) : v);

export async function iniciarImportacao({ municipio, arquivoNome = '', arquivoSha256 = '', completa = false, colunas = [], usuario = '', origem = 'tela', forcar = false }) {
  if (arquivoSha256 && !forcar) {
    const ant = (await query(`SELECT id, created_at, totais FROM cib_importacoes WHERE municipio = $1 AND arquivo_sha256 = $2 AND status = 'concluida' ORDER BY id DESC LIMIT 1`,
      [municipio, arquivoSha256])).rows[0];
    if (ant) return { repetida: true, anterior: ant };
  }
  const { rows } = await query(
    `INSERT INTO cib_importacoes (municipio, arquivo_nome, arquivo_sha256, completa, colunas, usuario_nome, origem) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING *`,
    [municipio, String(arquivoNome).slice(0, 200), String(arquivoSha256).slice(0, 64), Boolean(completa), JSON.stringify(colunas), usuario, origem]
  );
  return { repetida: false, importacao: rows[0] };
}

/** Processa um lote de linhas. Aceita { cabecalho, linhas } (CSV já lido) ou { itens: [objetos com nomes de campo] }. */
export async function processarLote(importacaoId, { cabecalho, linhas, itens }, usuario = '') {
  const imp = (await query('SELECT * FROM cib_importacoes WHERE id = $1', [importacaoId])).rows[0];
  if (!imp) throw erro(404, 'Importação não encontrada.');
  if (imp.status !== 'em_andamento') throw erro(409, 'Importação já finalizada.');
  let objs = itens || [];
  if (cabecalho && linhas) {
    const mapa = mapearColunas(cabecalho, ALIASES);
    if (!mapa.includes('inscricao')) throw erro(400, 'Nenhuma coluna de inscrição reconhecida no arquivo.');
    objs = linhas.map((l) => Object.fromEntries(mapa.map((k, i) => [k, l[i]]).filter(([k]) => k)));
  }
  if (objs.length > 2000) throw erro(400, 'Máximo de 2000 linhas por lote.');
  const cont = { novo: 0, alterado: 0, inalterado: 0, erro: 0 };
  await withTransaction(async (db) => {
    const iniciou = (await db.query('SELECT 1 FROM cib_remessas WHERE municipio = $1 LIMIT 1', [imp.municipio])).rows.length > 0;
    for (const raw of objs) {
      const c = normalizarCampos(raw);
      delete c.cib;
      const insc = c.inscricao;
      if (!insc) { cont.erro += 1; continue; }
      completarDerivados(c);
      let acao, campos = {}, mensagem = '', imovelId = null, movId = null;
      await db.query('SAVEPOINT linha');
      try {
        const atual = (await db.query('SELECT * FROM imoveis WHERE municipio = $1 AND inscricao = $2 FOR UPDATE', [imp.municipio, insc])).rows[0];
        if (atual) {
          imovelId = atual.id;
          const r = await aplicarAlteracao(db, atual, c, { origem: 'sistema_tributario', descricao: `Importação do sistema tributário (${imp.arquivo_nome || '#' + imp.id})`,
            documentoRef: `Importação #${imp.id}`, usuario });
          movId = r.movId;
          acao = Object.keys(r.mudou).length ? 'alterado' : 'inalterado';
          campos = Object.fromEntries(Object.keys(r.mudou).map((k) => [k, { antes: mascararValor(k, r.antes[k]), depois: mascararValor(k, r.mudou[k]) }]));
          if (atual.situacao === 'baixado') mensagem = 'Inscrição baixada no cadastro, mas presente na base tributária.';
        } else if (iniciou) {
          // Depois de iniciada a integração, inclusão vai pelo ciclo mensal — uma só por inscrição.
          const pend = (await db.query(`SELECT id FROM cib_movimentacoes WHERE municipio = $1 AND inscricao = $2 AND tipo = 'inclusao' AND status IN ('capturada','rejeitada')
            ORDER BY id DESC LIMIT 1`, [imp.municipio, insc])).rows[0];
          let jaPendente = false;
          if (pend) {
            jaPendente = (await db.query(`SELECT dados_depois @> $2::jsonb AS igual FROM cib_movimentacoes WHERE id = $1`, [pend.id, JSON.stringify(c)])).rows[0].igual;
            if (!jaPendente) await db.query(`UPDATE cib_movimentacoes SET dados_depois = dados_depois || $2::jsonb, updated_at = NOW() WHERE id = $1`, [pend.id, JSON.stringify(c)]);
            movId = pend.id;
          } else {
            movId = (await capturarMovimentacao(db, { municipio: imp.municipio, tipo: 'inclusao', origem: 'sistema_tributario', inscricao: insc,
              documentoRef: `Importação #${imp.id}`, descricao: 'Inscrição nova na base tributária', dadosDepois: c, usuario })).id;
          }
          const v = await validarMovimentacao(db, movId, usuario);
          imovelId = v.mov.imovel_id;
          acao = jaPendente ? 'inalterado' : 'novo';
          mensagem = v.ok ? 'Incluído e na fila do Sinter.' : `Inclusão ${jaPendente ? 'continua pendente' : 'capturada com pendências'}: ` + v.erros.map((e) => e.mensagem).join('; ');
        } else {
          const loteId = (await db.query(`SELECT id FROM lotes WHERE codigo = $1 LIMIT 1`, [c.lote_codigo || insc])).rows[0]?.id || null;
          const cols = Object.keys(c);
          imovelId = (await db.query(`INSERT INTO imoveis (municipio, lote_id, ${cols.join(', ')}) VALUES ($1,$2, ${cols.map((_, i) => '$' + (i + 3)).join(', ')}) RETURNING id`,
            [imp.municipio, loteId, ...cols.map((k) => c[k])])).rows[0].id;
          await processarImoveis(db, { ids: [imovelId] });
          acao = 'novo';
          mensagem = 'Incluído no cadastro.';
        }
        await db.query('RELEASE SAVEPOINT linha');
      } catch (e) {
        await db.query('ROLLBACK TO SAVEPOINT linha');
        acao = 'erro'; mensagem = e.message.slice(0, 500);
      }
      cont[acao] += 1;
      await db.query(
        `INSERT INTO cib_importacao_itens (importacao_id, inscricao, acao, campos, mensagem, imovel_id, movimentacao_id) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
         ON CONFLICT (importacao_id, inscricao) DO UPDATE SET acao = CASE WHEN EXCLUDED.acao = 'inalterado' THEN cib_importacao_itens.acao ELSE EXCLUDED.acao END,
           campos = cib_importacao_itens.campos || EXCLUDED.campos, mensagem = EXCLUDED.mensagem`,
        [imp.id, insc, acao, JSON.stringify(campos), mensagem, imovelId, movId]);
    }
  });
  return cont;
}

export async function finalizarImportacao(importacaoId, usuario = '') {
  return withTransaction(async (db) => {
    const imp = (await db.query('SELECT * FROM cib_importacoes WHERE id = $1 FOR UPDATE', [importacaoId])).rows[0];
    if (!imp) throw erro(404, 'Importação não encontrada.');
    if (imp.status === 'concluida') return imp;
    if (imp.completa) {
      await db.query(`INSERT INTO cib_importacao_itens (importacao_id, inscricao, acao, mensagem, imovel_id)
        SELECT $1, i.inscricao, 'ausente', 'Inscrição ativa no cadastro que não veio na carga completa (avaliar baixa).', i.id
        FROM imoveis i WHERE i.municipio = $2 AND i.situacao = 'ativo'
          AND NOT EXISTS (SELECT 1 FROM cib_importacao_itens x WHERE x.importacao_id = $1 AND x.inscricao = i.inscricao)
        ON CONFLICT DO NOTHING`, [imp.id, imp.municipio]);
    }
    const tot = Object.fromEntries((await db.query(`SELECT acao, COUNT(*)::int AS n FROM cib_importacao_itens WHERE importacao_id = $1 GROUP BY 1`, [imp.id])).rows.map((r) => [r.acao, r.n]));
    const totais = { novo: tot.novo || 0, alterado: tot.alterado || 0, inalterado: tot.inalterado || 0, erro: tot.erro || 0, ausente: tot.ausente || 0 };
    const r = (await db.query(`UPDATE cib_importacoes SET status = 'concluida', totais = $2::jsonb, finalizada_em = NOW() WHERE id = $1 RETURNING *`, [imp.id, JSON.stringify(totais)])).rows[0];
    await auditar(db, { municipio: imp.municipio, entidade: 'importacao', entidadeId: imp.id, acao: 'concluir',
      detalhe: `${imp.arquivo_nome || 'arquivo'}: ${totais.novo} novo(s), ${totais.alterado} alterado(s), ${totais.inalterado} inalterado(s), ${totais.erro} erro(s)${imp.completa ? `, ${totais.ausente} ausente(s)` : ''}`, usuario });
    return r;
  });
}

/** Importa um CSV inteiro (usado pela linha de comando / rotina agendada). */
export async function importarCsv({ municipio, texto, arquivoNome, arquivoSha256, completa = false, usuario = 'rotina', forcar = false, log = () => {} }) {
  const { cabecalho, linhas } = parseCsv(texto);
  const ini = await iniciarImportacao({ municipio, arquivoNome, arquivoSha256, completa, colunas: cabecalho, usuario, origem: 'cli', forcar });
  if (ini.repetida) return { repetida: true, anterior: ini.anterior };
  for (let i = 0; i < linhas.length; i += 1000) {
    const c = await processarLote(ini.importacao.id, { cabecalho, linhas: linhas.slice(i, i + 1000) }, usuario);
    log(`  linhas ${i + 1}–${Math.min(i + 1000, linhas.length)}: ${JSON.stringify(c)}`);
  }
  return finalizarImportacao(ini.importacao.id, usuario);
}

// ------------------------------------------------------------------- rotas
export const importacaoRouter = Router();
const asyncRoute = rotaAsync('importacao');
const gestor = requireRole('admin', 'coordenador');
const leitura = requireRole('admin', 'coordenador', 'tecnico', 'gestor');

importacaoRouter.post('/api/cib/importacoes', gestor, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const r = await iniciarImportacao({ municipio: muniDe(req), arquivoNome: b.arquivoNome, arquivoSha256: b.arquivoSha256, completa: b.completa,
    colunas: b.colunas || [], usuario: nomeUsuario(req), forcar: Boolean(b.forcar) });
  res.json(r);
}));
importacaoRouter.post('/api/cib/importacoes/:id/lote', gestor, asyncRoute(async (req, res) => {
  const imp = (await query('SELECT municipio FROM cib_importacoes WHERE id = $1', [req.params.id])).rows[0];
  if (!imp || imp.municipio !== muniDe(req)) throw erro(404, 'Importação não encontrada.');
  res.json(await processarLote(Number(req.params.id), req.body || {}, nomeUsuario(req)));
}));
importacaoRouter.post('/api/cib/importacoes/:id/finalizar', gestor, asyncRoute(async (req, res) => {
  const imp = (await query('SELECT municipio FROM cib_importacoes WHERE id = $1', [req.params.id])).rows[0];
  if (!imp || imp.municipio !== muniDe(req)) throw erro(404, 'Importação não encontrada.');
  res.json(await finalizarImportacao(Number(req.params.id), nomeUsuario(req)));
}));
importacaoRouter.get('/api/cib/importacoes', leitura, asyncRoute(async (req, res) => {
  res.json((await query(`SELECT id, arquivo_nome, arquivo_sha256, completa, status, totais, usuario_nome, origem, created_at, finalizada_em
    FROM cib_importacoes WHERE municipio = $1 ORDER BY id DESC LIMIT 100`, [muniDe(req)])).rows);
}));
importacaoRouter.get('/api/cib/importacoes/:id', leitura, asyncRoute(async (req, res) => {
  const imp = (await query('SELECT * FROM cib_importacoes WHERE id = $1', [req.params.id])).rows[0];
  if (!imp || imp.municipio !== muniDe(req)) throw erro(404, 'Importação não encontrada.');
  const params = [imp.id];
  let w = 'importacao_id = $1';
  if (req.query.acao) { params.push(String(req.query.acao)); w += ` AND acao = $2`; }
  const itens = (await query(`SELECT inscricao, acao, campos, mensagem, imovel_id, movimentacao_id FROM cib_importacao_itens WHERE ${w} ORDER BY acao, inscricao LIMIT ${Math.min(2000, Number(req.query.limit) || 500)}`, params)).rows;
  res.json({ ...imp, itens, rotulos: ROTULOS });
}));
importacaoRouter.get('/api/cib/importacoes/:id/relatorio.csv', leitura, asyncRoute(async (req, res) => {
  const imp = (await query('SELECT * FROM cib_importacoes WHERE id = $1', [req.params.id])).rows[0];
  if (!imp || imp.municipio !== muniDe(req)) throw erro(404, 'Importação não encontrada.');
  const itens = (await query(`SELECT inscricao, acao, campos, mensagem FROM cib_importacao_itens WHERE importacao_id = $1 AND acao <> 'inalterado' ORDER BY acao, inscricao`, [imp.id])).rows;
  const linhas = [];
  for (const it of itens) {
    const cs = Object.entries(it.campos || {});
    if (!cs.length) linhas.push([it.inscricao, it.acao, '', '', '', it.mensagem]);
    for (const [k, v] of cs) linhas.push([it.inscricao, it.acao, ROTULOS[k] || k, v.antes ?? '', v.depois ?? '', it.mensagem]);
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="importacao-${imp.id}-relatorio.csv"`);
  res.send('﻿' + [['inscricao', 'acao', 'campo', 'antes', 'depois', 'mensagem'].join(';'), ...linhas.map((l) => l.map((x) => csvEscapar(x)).join(';'))].join('\r\n'));
}));
