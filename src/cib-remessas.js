// Transmitir e Conciliar — remessas ao Sinter no LEIAUTE OFICIAL (src/sinter/leiaute.js).
//
//  Preparar  → agrupa a fila (movimentações validadas) por imóvel, monta UM
//              registro NDJSON por imóvel ({"ui":…, "operacao":"I|A|D"}) e o
//              valida contra o leiaute. Registro com erro NÃO entra: as
//              movimentações voltam para "capturada" com a falha apontada.
//              Numeração transacional (tabela numeradores). O arquivo é
//              CONGELADO (cib_remessa_arquivos, somente-inserção) com SHA-256.
//  Enviar    → via API (POST /api/v1/arquivos/{codigoIbge}, .zip com NDJSON)
//              ou em lote (arquivo enviado no portal/Swagger e o idArquivo
//              informado aqui).
//  Retorno   → consulta oficial (efetivados/rejeitados + falhas), por API ou
//              arquivo. IDEMPOTENTE: o mesmo conteúdo importado duas vezes é
//              reconhecido (cib_retornos, UNIQUE remessa+sha256) e nada muda;
//              só movimentações ainda "transmitidas" recebem resposta.
//  Rejeitados → fila de reprocessamento: corrigir, revalidar e reenviar.
import { Router } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from './db.js';
import { requireRole } from './auth.js';
import { PRODUCAO, SIMULACAO_SINTER } from './env.js';
import { muniDe, nomeUsuario, erro, competenciaDe, rotaAsync } from './util.js';
import { LEIAUTE, montarRegistro, gerarNdjson, campoLocal } from './sinter/leiaute.js';
import { parseRetorno } from './sinter/retorno.js';
import { ClienteSinter, configSinter } from './sinter/cliente.js';
import { criarZip } from './sinter/zip.js';
import * as DOM from './sinter/dominios.js';
const { CODIGOS_FALHA } = DOM;
import { proximoNumero } from './numeradores.js';
import { jcs, mascararDoc } from './cib-validacao.js';
import { registrarAcesso, PERFIS_EXPORTACAO } from './lgpd.js';
import { getConfig, recalcularStatus, auditar, capturarMovimentacao, validarMovimentacao, CAMPOS_IMOVEL, ROTULOS } from './cib.js';
import { csvEscapar } from './csv.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ROTULO_LEIAUTE = `${LEIAUTE.id}@${LEIAUTE.versaoManual}`;
let cliente = null;
const clienteSinter = () => (cliente ||= new ClienteSinter(configSinter()));

// ----------------------------------------------------------------- preparar
/**
 * Agrupa a fila de transmissão numa remessa. Devolve { remessa|null, excluidos[] }.
 * Por imóvel vai um único registro: D (baixa) prevalece; senão I (inclusão);
 * senão A (alteração). As demais movimentações do mesmo imóvel são absorvidas
 * (o registro leva o estado atual completo da UI).
 */
export async function prepararRemessa(municipio, { modo = 'lote', obs = '', usuario = '' } = {}) {
  return withTransaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['remessa:' + municipio]);
    const fila = (await db.query(
      `SELECT m.*, row_to_json(i.*) AS im FROM cib_movimentacoes m LEFT JOIN imoveis i ON i.id = m.imovel_id
       WHERE m.municipio = $1 AND m.status = 'validada' AND m.remessa_id IS NULL ORDER BY m.id LIMIT 5000`, [municipio]
    )).rows;
    if (!fila.length) throw erro(409, 'Não há movimentações validadas na fila de transmissão.');
    const grupos = new Map();
    for (const m of fila) {
      const k = m.imovel_id ? `i${m.imovel_id}` : `m${m.id}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(m);
    }
    const prioridade = { baixa: 0, inclusao: 1, alteracao: 2, reativacao: 3 };
    const registros = [], incluidas = [], excluidos = [];
    for (const movs of grupos.values()) {
      const principal = [...movs].sort((a, b) => prioridade[a.tipo] - prioridade[b.tipo])[0];
      const { registro, falhas, ok } = montarRegistro(principal, principal.im);
      const errosLeiaute = falhas.filter((f) => f.nivel === 'erro');
      if (ok && registro) {
        registros.push(registro);
        incluidas.push(...movs.map((m) => m.id));
      } else {
        for (const m of movs) {
          await db.query(
            `UPDATE cib_movimentacoes SET status = 'capturada', erros = $2::jsonb, validado_em = validado_em,
               historico = historico || jsonb_build_array(jsonb_build_object('em', NOW(), 'evento', 'excluida_da_remessa', 'motivo', 'leiaute')),
               updated_at = NOW() WHERE id = $1`,
            [m.id, JSON.stringify(errosLeiaute.map((f) => ({ codigo: f.codigo, campo: f.campo, nivel: 'erro', mensagem: `Leiaute Sinter ${f.codigo}: ${f.mensagem}` })))]
          );
        }
        excluidos.push({ inscricao: principal.inscricao, tipo: principal.tipo, falhas: errosLeiaute });
      }
    }
    const tocados = fila.map((m) => m.imovel_id).filter(Boolean);
    if (!registros.length) {
      await recalcularStatus(db, { ids: tocados });
      await auditar(db, { municipio, entidade: 'remessa', acao: 'preparar', detalhe: `Nenhum registro válido no leiaute ${ROTULO_LEIAUTE}; ${excluidos.length} devolvido(s) à fila com falha`, usuario });
      return { remessa: null, excluidos };
    }
    const numero = await proximoNumero(db, 'remessa', municipio, 0);
    const ndjson = gerarNdjson(registros);
    const hash = sha256(ndjson);
    const r = (await db.query(
      `INSERT INTO cib_remessas (municipio, numero, competencia, qtd_itens, qtd_excluidos, modo, criado_por_nome, obs, leiaute, hash_arquivo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [municipio, numero, competenciaDe(), registros.length, excluidos.length, modo === 'api' ? 'api' : 'lote', usuario, String(obs || '').slice(0, 500), ROTULO_LEIAUTE, hash]
    )).rows[0];
    await db.query(`UPDATE cib_movimentacoes SET remessa_id = $1, updated_at = NOW() WHERE id = ANY($2::bigint[])`, [r.id, incluidas]);
    await db.query(`INSERT INTO cib_remessa_arquivos (remessa_id, leiaute, formato, conteudo, sha256, qtd) VALUES ($1,$2,'ndjson',$3,$4,$5)`,
      [r.id, ROTULO_LEIAUTE, ndjson, hash, registros.length]);
    await recalcularStatus(db, { ids: tocados });
    await auditar(db, { municipio, entidade: 'remessa', entidadeId: r.id, acao: 'preparar',
      detalhe: `Remessa ${numero}: ${registros.length} registro(s) no leiaute ${ROTULO_LEIAUTE} · sha256 ${hash.slice(0, 16)}…${excluidos.length ? ` · ${excluidos.length} excluído(s) por falha de leiaute` : ''}`, usuario });
    return { remessa: r, excluidos };
  });
}

async function carregarRemessa(id, municipio) {
  const rem = (await query('SELECT * FROM cib_remessas WHERE id = $1', [id])).rows[0];
  if (!rem || (municipio !== undefined && rem.municipio !== municipio)) throw erro(404, 'Remessa não encontrada.');
  return rem;
}
async function arquivoDa(remessaId) {
  const a = (await query('SELECT * FROM cib_remessa_arquivos WHERE remessa_id = $1', [remessaId])).rows[0];
  if (!a) throw erro(409, 'Esta remessa é anterior ao leiaute oficial e não tem arquivo congelado. Prepare uma nova remessa.');
  if (sha256(a.conteudo) !== a.sha256) throw erro(500, 'Integridade do arquivo da remessa não confere (SHA-256).');
  return a;
}
const nomeArquivo = (rem, cfg, ext) => `${cfg.codigoIbge || 'municipio'}_remessa_${String(rem.numero).padStart(3, '0')}.${ext}`;

// -------------------------------------------------------------------- enviar
export async function enviarRemessa(remessaId, { modo = null, idArquivo = '', usuario = '' } = {}) {
  const rem = await carregarRemessa(remessaId);
  if (rem.status !== 'preparada') throw erro(409, 'Remessa já enviada.');
  const arq = await arquivoDa(rem.id);
  const cfg = await getConfig(rem.municipio);
  modo = modo === 'api' ? 'api' : 'lote';
  let id = String(idArquivo || '').trim().slice(0, 80);
  if (modo === 'api') {
    if (!/^\d{7}$/.test(String(cfg.codigoIbge))) throw erro(400, 'Informe o código IBGE (7 dígitos) do município na configuração: ele vai na URL da API do Sinter.');
    const resp = await clienteSinter().enviarArquivo(cfg.codigoIbge, criarZip([{ nome: nomeArquivo(rem, cfg, 'ndjson'), conteudo: arq.conteudo }]), nomeArquivo(rem, cfg, 'zip'));
    id = String(resp.idArquivo || resp.idRequisicao || '').slice(0, 80);
    if (!id) throw erro(502, 'O Sinter não devolveu o idArquivo da remessa.');
  } else if (!id) {
    throw erro(400, 'Informe o idArquivo devolvido pelo Sinter ao receber o arquivo (envio em lote).');
  }
  await withTransaction(async (db) => {
    await db.query(`UPDATE cib_remessas SET status = 'enviada', modo = $2, protocolo = $3, id_arquivo_sinter = $3, enviada_em = NOW() WHERE id = $1`, [rem.id, modo, id]);
    await db.query(`UPDATE cib_movimentacoes SET status = 'transmitida', transmitido_em = NOW(), updated_at = NOW() WHERE remessa_id = $1 AND status = 'validada'`, [rem.id]);
    await db.query(`UPDATE imoveis SET transmitido = TRUE WHERE id IN (SELECT imovel_id FROM cib_movimentacoes WHERE remessa_id = $1)`, [rem.id]);
    await recalcularStatus(db, { municipio: rem.municipio });
    await auditar(db, { municipio: rem.municipio, entidade: 'remessa', entidadeId: rem.id, acao: 'enviar',
      detalhe: `Remessa ${rem.numero} enviada (${modo}) · idArquivo ${id} · sha256 ${arq.sha256.slice(0, 16)}…`, usuario });
  });
  return carregarRemessa(rem.id);
}

// ------------------------------------------------------------------- retorno
/**
 * Processa o retorno (lista normalizada por parseRetorno). Idempotente.
 * Devolve { repetido, efetivados, comFalhas, rejeitados, ignorados, semIdentificacao, status }.
 */
export async function processarRetorno(remessaId, registros, { origem = 'arquivo', usuario = '' } = {}) {
  const assinatura = sha256(jcs(registros));
  return withTransaction(async (db) => {
    const rem = (await db.query('SELECT * FROM cib_remessas WHERE id = $1 FOR UPDATE', [remessaId])).rows[0];
    if (!rem) throw erro(404, 'Remessa não encontrada.');
    if (!['enviada', 'parcial', 'processada_com_erros'].includes(rem.status)) throw erro(409, 'Só é possível processar retorno de remessa enviada.');
    const ins = await db.query(`INSERT INTO cib_retornos (remessa_id, sha256, origem, usuario_nome) VALUES ($1,$2,$3,$4) ON CONFLICT (remessa_id, sha256) DO NOTHING RETURNING id`,
      [rem.id, assinatura, origem, usuario]);
    if (!ins.rows.length) return { repetido: true, mensagem: 'Este retorno já foi processado para esta remessa; nada foi alterado.', status: rem.status };
    const pendentes = (await db.query(`SELECT * FROM cib_movimentacoes WHERE remessa_id = $1 AND status = 'transmitida'`, [rem.id])).rows;
    const porInsc = new Map();
    for (const m of pendentes) { if (!porInsc.has(m.inscricao)) porInsc.set(m.inscricao, []); porInsc.get(m.inscricao).push(m); }
    let efetivados = 0, comFalhas = 0, rejeitados = 0, ignorados = 0, semIdentificacao = 0;
    const tocados = new Set();
    for (const reg of registros) {
      if (!reg.inscricao) { semIdentificacao += 1; continue; }
      const movs = porInsc.get(reg.inscricao);
      if (!movs) { ignorados += 1; continue; } // já respondido ou não pertence à remessa
      porInsc.delete(reg.inscricao);
      const imovelId = movs.find((m) => m.imovel_id)?.imovel_id || null;
      if (imovelId) tocados.add(imovelId);
      const falhas = reg.falhas || [];
      const hist = JSON.stringify({ em: new Date().toISOString(), evento: 'retorno', remessa: rem.numero, efetivado: reg.efetivado, falhas: falhas.map((f) => f.codigo) });
      if (reg.efetivado) {
        const divergentes = falhas.length > 0 || reg.situacao === 'divergente';
        for (const m of movs) {
          await db.query(`UPDATE cib_movimentacoes SET status = $2, conciliado_em = NOW(), retorno_msg = $3, falhas_sinter = $4::jsonb,
              historico = historico || $5::jsonb, updated_at = NOW() WHERE id = $1`,
            [m.id, divergentes ? 'divergente' : 'conciliada', String(reg.mensagem || (divergentes ? 'Efetivado com falhas' : 'Efetivado pelo Sinter')).slice(0, 500), JSON.stringify(falhas), `[${hist}]`]);
        }
        if (imovelId) {
          await db.query(
            `UPDATE imoveis SET transmitido = TRUE, cib = CASE WHEN $2 <> '' THEN $2 ELSE cib END,
               cib_atribuido_em = CASE WHEN $2 <> '' AND cib = '' THEN NOW() ELSE cib_atribuido_em END,
               cib_simulado = CASE WHEN $2 <> '' THEN $3 ELSE cib_simulado END, updated_at = NOW() WHERE id = $1`,
            [imovelId, reg.cib || '', origem === 'simulado']);
          for (const f of falhas) {
            const campo = campoLocal(f.campos[0]) || f.campos[0] || f.codigo;
            await db.query(
              `INSERT INTO cib_divergencias (municipio, imovel_id, movimentacao_id, remessa_id, fonte, campo, mensagem)
               VALUES ($1,$2,$3,$4,'sinter',$5,$6) ON CONFLICT DO NOTHING`,
              [rem.municipio, imovelId, movs[0].id, rem.id, campo,
                `Falha ${f.codigo}: ${f.mensagem || CODIGOS_FALHA[f.codigo] || ''}${f.campos.length ? ' — ' + f.campos.join(', ') : ''}${f.complemento ? ' (' + f.complemento + ')' : ''}`.slice(0, 500)]);
          }
          if (reg.situacao === 'divergente' && reg.campo) {
            await db.query(
              `INSERT INTO cib_divergencias (municipio, imovel_id, movimentacao_id, remessa_id, fonte, campo, valor_municipio, valor_externo, mensagem)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
              [rem.municipio, imovelId, movs[0].id, rem.id, String(reg.fonte || 'sinter').slice(0, 20), String(reg.campo).slice(0, 60),
                String(reg.valorMunicipio || '').slice(0, 300), String(reg.valorExterno || '').slice(0, 300), String(reg.mensagem || '').slice(0, 500)]);
          }
        }
        efetivados += 1; if (divergentes) comFalhas += 1;
      } else {
        for (const m of movs) {
          await db.query(`UPDATE cib_movimentacoes SET status = 'rejeitada', retorno_msg = $2, falhas_sinter = $3::jsonb, tentativas = tentativas + 1,
              historico = historico || $4::jsonb, updated_at = NOW() WHERE id = $1`,
            [m.id, String(reg.mensagem || 'Rejeitado pelo Sinter').slice(0, 500), JSON.stringify(falhas), `[${hist}]`]);
        }
        rejeitados += 1;
      }
    }
    // Contadores recalculados a partir do estado (nunca incrementados): reimportar não infla.
    const c = (await db.query(
      `SELECT COUNT(DISTINCT COALESCE(imovel_id, -id)) FILTER (WHERE status IN ('conciliada','divergente'))::int AS ok,
              COUNT(DISTINCT COALESCE(imovel_id, -id)) FILTER (WHERE status = 'divergente')::int AS div,
              COUNT(DISTINCT COALESCE(imovel_id, -id)) FILTER (WHERE status = 'rejeitada')::int AS rej,
              COUNT(*) FILTER (WHERE status = 'transmitida')::int AS pend
       FROM cib_movimentacoes WHERE remessa_id = $1`, [rem.id])).rows[0];
    const status = c.pend > 0 ? 'parcial' : (c.rej > 0 ? 'processada_com_erros' : 'processada');
    await db.query(`UPDATE cib_remessas SET status = $2, qtd_ok = $3, qtd_divergente = $4, qtd_erro = $5, processada_em = NOW() WHERE id = $1`,
      [rem.id, status, c.ok, c.div, c.rej]);
    const resumo = { efetivados, comFalhas, rejeitados, ignorados, semIdentificacao, status };
    await db.query('UPDATE cib_retornos SET resumo = $2::jsonb WHERE id = $1', [ins.rows[0].id, JSON.stringify(resumo)]);
    if (tocados.size) await recalcularStatus(db, { ids: [...tocados] });
    await auditar(db, { municipio: rem.municipio, entidade: 'remessa', entidadeId: rem.id, acao: 'retorno',
      detalhe: `Remessa ${rem.numero} (${origem}): ${efetivados} efetivado(s) (${comFalhas} com falhas), ${rejeitados} rejeitado(s), ${ignorados} já respondido(s)/fora da remessa, ${semIdentificacao} sem inscrição · sha256 ${assinatura.slice(0, 12)}…`, usuario });
    return { repetido: false, ...resumo };
  });
}

/** Retorno simulado no formato OFICIAL da consulta (somente demonstração). */
export async function gerarRetornoSimulado(remessaId) {
  if (PRODUCAO) throw erro(403, 'Simulação de retorno não existe em produção.');
  const arq = await arquivoDa(remessaId);
  const linhas = arq.conteudo.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const alfa = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  const registros = linhas.map((reg) => {
    const insc = reg.ui.DadosGeraisImovel?.inscricaoImobiliaria || reg.ui.inscricaoImobiliaria;
    const h = crypto.createHash('sha1').update(insc + ':' + remessaId).digest();
    const cib = reg.ui.cib || Array.from({ length: 8 }, (_, i) => alfa[h[i] % alfa.length]).join('');
    const sorte = h[10] % 100;
    const operacao = { I: 'Inclusão', A: 'Alteração', D: 'Desativação' }[reg.operacao];
    if (sorte < 3) return { inscricaoImobiliaria: insc, operacao, efetivado: false, falhas: [{ codigoFalha: '0004', camposFalha: 'enderecoImovel.tipoLogradouro' }] };
    if (sorte < 9 && reg.ui.Titular) return { inscricaoImobiliaria: insc, cib, operacao, efetivado: true, falhas: [{ codigoFalha: '0106', camposFalha: 'titular.niTitular' }] };
    return { inscricaoImobiliaria: insc, cib, operacao, efetivado: true, falhas: [] };
  });
  return [{ codigoIbgeMunicipio: 0, pagina: 1, qtdeRegistrosTotal: registros.length, ultimaPagina: true, registros }];
}

// -------------------------------------------------------------- reprocessar
/** Rejeitados → revalida o estado atual do imóvel e devolve à fila (ou aponta o que corrigir). */
export async function reprocessar(municipio, ids, usuario = '') {
  const alvo = (await query(
    `SELECT id FROM cib_movimentacoes WHERE municipio = $1 AND status = 'rejeitada' ${ids?.length ? 'AND id = ANY($2::bigint[])' : ''} ORDER BY id`,
    ids?.length ? [municipio, ids] : [municipio])).rows.map((r) => r.id);
  let reenfileirados = 0, comErros = 0;
  for (const id of alvo) {
    const r = await withTransaction(async (db) => {
      await db.query(`UPDATE cib_movimentacoes SET status = 'capturada', remessa_id = NULL,
          historico = historico || jsonb_build_array(jsonb_build_object('em', NOW(), 'evento', 'reprocessar', 'por', $2::text)), updated_at = NOW()
        WHERE id = $1`, [id, usuario]);
      return validarMovimentacao(db, id, usuario);
    });
    if (r.ok) reenfileirados += 1; else comErros += 1;
  }
  return { analisados: alvo.length, reenfileirados, comErros };
}

// ===================================================================== rotas
export const remessasRouter = Router();
const asyncRoute = rotaAsync('remessas');
const gestor = requireRole('admin', 'coordenador');
const leitura = requireRole('admin', 'coordenador', 'tecnico', 'gestor');

remessasRouter.get('/api/cib/sinter/status', leitura, asyncRoute(async (req, res) => {
  const c = configSinter();
  const cfg = await getConfig(muniDe(req));
  res.json({ leiaute: LEIAUTE, api: { configurado: c.configurado, ambiente: c.ambiente, base: c.base }, codigoIbgeOk: /^\d{7}$/.test(String(cfg.codigoIbge)), simulacao: SIMULACAO_SINTER });
}));

remessasRouter.get('/api/cib/sinter/dominios', leitura, (req, res) => res.json({
  versao: DOM.VERSAO_DOMINIOS, tipoLogradouro: DOM.TIPO_LOGRADOURO, tipoArquitetonico: DOM.TIPO_ARQUITETONICO, destinacao: DOM.DESTINACAO,
  bice: DOM.BICE, padraoConstrutivo: DOM.PADRAO_CONSTRUTIVO, tipoTitularidade: DOM.TIPO_TITULARIDADE, docTitularidade: DOM.DOC_TITULARIDADE,
  tipoDesativacao: DOM.TIPO_DESATIVACAO, motivoDesativacao: DOM.MOTIVO_DESATIVACAO, codigosFalha: DOM.CODIGOS_FALHA,
}));

remessasRouter.get('/api/cib/remessas', leitura, asyncRoute(async (req, res) => {
  const { rows } = await query(`SELECT r.*, (SELECT COUNT(*)::int FROM cib_retornos x WHERE x.remessa_id = r.id) AS n_retornos
    FROM cib_remessas r WHERE municipio = $1 ORDER BY numero DESC`, [muniDe(req)]);
  res.json(rows);
}));

remessasRouter.post('/api/cib/remessas', gestor, asyncRoute(async (req, res) => {
  const r = await prepararRemessa(muniDe(req), { modo: req.body?.modo, obs: req.body?.obs, usuario: nomeUsuario(req) });
  res.status(r.remessa ? 200 : 422).json(r);
}));

// Arquivo da remessa (contém CPF/CNPJ): só perfis de exportação, com registro LGPD.
remessasRouter.get('/api/cib/remessas/:id/arquivo', requireRole(...PERFIS_EXPORTACAO), asyncRoute(async (req, res) => {
  const rem = await carregarRemessa(req.params.id, muniDe(req));
  const arq = await arquivoDa(rem.id);
  const cfg = await getConfig(rem.municipio);
  const formato = ['zip', 'ndjson', 'csv'].includes(req.query.formato) ? req.query.formato : 'zip';
  await registrarAcesso(req, { municipio: rem.municipio, entidade: 'remessa', entidadeId: rem.id, dado: `arquivo da remessa (${formato})`, finalidade: String(req.query.finalidade || 'transmissão/conferência Sinter') });
  if (formato === 'ndjson') {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo(rem, cfg, 'ndjson')}"`);
    return res.send(arq.conteudo);
  }
  if (formato === 'csv') {
    // Planilha de conferência (CPF/CNPJ mascarado). Não é o arquivo de envio.
    const cols = ['operacao', 'inscricaoImobiliaria', 'cib', 'tipoImovel', 'tpArquitetonico', 'destinacaoImovel', 'areaTerreno', 'areaConstruida',
      'tipoLogradouro', 'nomeLogradouro', 'numeroImovel', 'bairro', 'cep', 'nomeTitular', 'niTitular', 'tipoDesativacao', 'motivoDesativacao'];
    const linhas = arq.conteudo.split('\n').filter(Boolean).map((l) => {
      const { ui, operacao } = JSON.parse(l);
      const d = ui.DadosGeraisImovel || {}, e = ui.EnderecoImovel || {}, t = (ui.Titular || [])[0] || {};
      return [operacao, d.inscricaoImobiliaria || ui.inscricaoImobiliaria, ui.cib, d.tipoImovel, d.tpArquitetonico, d.destinacaoImovel, d.areaTerreno, d.areaConstruida,
        e.tipoLogradouro, e.nomeLogradouro, e.numeroImovel, e.bairro, e.cep, t.nomeTitular, t.niTitular ? mascararDoc(t.niTitular) : '', ui.tipoDesativacao, ui.motivoDesativacao]
        .map((v) => csvEscapar(v)).join(';');
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo(rem, cfg, 'conferencia.csv')}"`);
    return res.send('﻿' + [cols.join(';'), ...linhas].join('\r\n'));
  }
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo(rem, cfg, 'zip')}"`);
  res.send(criarZip([{ nome: nomeArquivo(rem, cfg, 'ndjson'), conteudo: arq.conteudo }]));
}));

remessasRouter.post('/api/cib/remessas/:id/enviar', gestor, asyncRoute(async (req, res) => {
  await carregarRemessa(req.params.id, muniDe(req));
  res.json(await enviarRemessa(Number(req.params.id), { modo: req.body?.modo, idArquivo: req.body?.idArquivo ?? req.body?.protocolo, usuario: nomeUsuario(req) }));
}));

// Retorno por arquivo: corpo { conteudo: "<JSON oficial da consulta ou CSV>" } (ou { itens: [...] }).
remessasRouter.post('/api/cib/remessas/:id/retorno', gestor, asyncRoute(async (req, res) => {
  await carregarRemessa(req.params.id, muniDe(req));
  let registros;
  try { registros = parseRetorno(req.body?.conteudo ?? req.body?.itens ?? []); } catch (e) { throw erro(400, 'Retorno ilegível: ' + e.message); }
  if (!registros.length) throw erro(400, 'Nenhum registro reconhecido no retorno.');
  res.json(await processarRetorno(Number(req.params.id), registros, { origem: 'arquivo', usuario: nomeUsuario(req) }));
}));

// Retorno pela API do Sinter (consulta de processamento do idArquivo).
remessasRouter.post('/api/cib/remessas/:id/consultar', gestor, asyncRoute(async (req, res) => {
  const rem = await carregarRemessa(req.params.id, muniDe(req));
  if (!rem.id_arquivo_sinter) throw erro(409, 'Remessa sem idArquivo do Sinter.');
  const cfg = await getConfig(rem.municipio);
  const paginas = await clienteSinter().consultarArquivo(cfg.codigoIbge, rem.id_arquivo_sinter);
  res.json(await processarRetorno(rem.id, parseRetorno(paginas), { origem: 'api', usuario: nomeUsuario(req) }));
}));

// Somente demonstração (CIB_SIMULAR_RETORNO=true e fora de produção).
remessasRouter.post('/api/cib/remessas/:id/simular-retorno', gestor, asyncRoute(async (req, res) => {
  if (!SIMULACAO_SINTER) throw erro(403, 'Simulação desligada (só existe fora de produção, com CIB_SIMULAR_RETORNO=true).');
  await carregarRemessa(req.params.id, muniDe(req));
  res.json(await processarRetorno(Number(req.params.id), parseRetorno(await gerarRetornoSimulado(Number(req.params.id))), { origem: 'simulado', usuario: nomeUsuario(req) }));
}));

remessasRouter.get('/api/cib/remessas/:id/retornos', leitura, asyncRoute(async (req, res) => {
  await carregarRemessa(req.params.id, muniDe(req));
  res.json((await query('SELECT id, sha256, origem, resumo, usuario_nome, created_at FROM cib_retornos WHERE remessa_id = $1 ORDER BY id', [req.params.id])).rows);
}));

// Fila de reprocessamento dos rejeitados.
remessasRouter.get('/api/cib/reprocessamento', leitura, asyncRoute(async (req, res) => {
  const { rows } = await query(
    `SELECT m.id, m.inscricao, m.tipo, m.origem, m.retorno_msg, m.falhas_sinter, m.tentativas, m.updated_at, m.imovel_id, r.numero AS remessa_numero
     FROM cib_movimentacoes m LEFT JOIN cib_remessas r ON r.id = m.remessa_id
     WHERE m.municipio = $1 AND m.status = 'rejeitada' ORDER BY m.updated_at DESC LIMIT 1000`, [muniDe(req)]);
  res.json(rows.map((x) => ({ ...x, falhas: (x.falhas_sinter || []).map((f) => ({ ...f, descricao: CODIGOS_FALHA[f.codigo] || f.mensagem || '' })) })));
}));
remessasRouter.post('/api/cib/reprocessamento', gestor, asyncRoute(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : null;
  const r = await reprocessar(muniDe(req), ids, nomeUsuario(req));
  await auditar(null, { municipio: muniDe(req), entidade: 'movimentacao', acao: 'reprocessar', detalhe: `${r.analisados} rejeitada(s): ${r.reenfileirados} de volta à fila, ${r.comErros} ainda com erro`, usuario: nomeUsuario(req) });
  res.json(r);
}));

// ------------------------------------------------------------- divergências
remessasRouter.get('/api/cib/divergencias', leitura, asyncRoute(async (req, res) => {
  const params = [muniDe(req)];
  let w = 'd.municipio = $1';
  if (req.query.status) { params.push(String(req.query.status)); w += ` AND d.status = $${params.length}`; }
  const { rows } = await query(
    `SELECT d.*, i.inscricao, i.cib, i.logradouro, i.numero, i.bairro, r.numero AS remessa_numero
     FROM cib_divergencias d LEFT JOIN imoveis i ON i.id = d.imovel_id LEFT JOIN cib_remessas r ON r.id = d.remessa_id
     WHERE ${w} ORDER BY d.status = 'aberta' DESC, d.created_at DESC LIMIT 500`, params);
  res.json(rows.map((d) => ({ ...d, campo_rotulo: ROTULOS[d.campo] || d.campo,
    valor_municipio: d.campo === 'contribuinte_doc' ? mascararDoc(d.valor_municipio) : d.valor_municipio,
    valor_externo: d.campo === 'contribuinte_doc' ? mascararDoc(d.valor_externo) : d.valor_externo })));
}));

/**
 * Resolver: adotar_externo (ajusta o cadastro ao valor externo e retransmite),
 * retransmitir (cadastro corrigido ou dado municipal mantido: reenvia o estado
 * atual) ou ignorar (desconsiderar, com justificativa).
 */
remessasRouter.post('/api/cib/divergencias/:id/resolver', asyncRoute(async (req, res) => {
  const acao = { manter_municipio: 'retransmitir' }[req.body?.acao] || String(req.body?.acao || '');
  if (!['adotar_externo', 'retransmitir', 'ignorar'].includes(acao)) throw erro(400, 'Ação inválida.');
  const usuario = nomeUsuario(req);
  const out = await withTransaction(async (db) => {
    const d = (await db.query('SELECT * FROM cib_divergencias WHERE id = $1 FOR UPDATE', [req.params.id])).rows[0];
    if (!d || d.municipio !== muniDe(req)) throw erro(404, 'Divergência não encontrada.');
    if (d.status !== 'aberta') throw erro(409, 'Divergência já resolvida.');
    const im = (await db.query('SELECT * FROM imoveis WHERE id = $1', [d.imovel_id])).rows[0];
    let resolucao = String(req.body?.resolucao || '').slice(0, 1000);
    if (acao === 'adotar_externo') {
      if (!CAMPOS_IMOVEL[d.campo] || !d.valor_externo) throw erro(400, 'Esta divergência não traz um valor externo aplicável: corrija o cadastro e use "retransmitir".');
      const mov = await capturarMovimentacao(db, { municipio: d.municipio, imovelId: d.imovel_id, inscricao: im.inscricao, tipo: 'alteracao',
        origem: 'conciliacao', descricao: `Conciliação: ${ROTULOS[d.campo] || d.campo} ajustado conforme ${d.fonte}`, dadosDepois: { [d.campo]: d.valor_externo }, usuario });
      await validarMovimentacao(db, mov.id, usuario);
      resolucao = resolucao || `Cadastro ajustado para o valor do ${d.fonte}.`;
    } else if (acao === 'retransmitir') {
      if (im.cib) {
        const ja = (await db.query(`SELECT id FROM cib_movimentacoes WHERE imovel_id = $1 AND status IN ('capturada','validada') AND remessa_id IS NULL LIMIT 1`, [im.id])).rows[0];
        if (!ja) {
          const mov = await capturarMovimentacao(db, { municipio: d.municipio, imovelId: im.id, inscricao: im.inscricao, tipo: 'alteracao', origem: 'conciliacao',
            descricao: `Conciliação: retransmissão do cadastro (${ROTULOS[d.campo] || d.campo})`, dadosDepois: {}, usuario });
          await validarMovimentacao(db, mov.id, usuario);
        }
      }
      resolucao = resolucao || 'Cadastro conferido/corrigido e retransmitido ao Sinter.';
    } else resolucao = resolucao || 'Divergência desconsiderada pela equipe.';
    await db.query(`UPDATE cib_divergencias SET status = $2, resolucao = $3, resolvido_por_nome = $4, resolvido_em = NOW() WHERE id = $1`,
      [d.id, acao === 'ignorar' ? 'ignorada' : 'resolvida', resolucao, usuario]);
    if (d.movimentacao_id) {
      const abertas = (await db.query(`SELECT COUNT(*)::int AS n FROM cib_divergencias WHERE movimentacao_id = $1 AND status = 'aberta'`, [d.movimentacao_id])).rows[0].n;
      if (!abertas) await db.query(`UPDATE cib_movimentacoes SET status = 'conciliada', conciliado_em = NOW() WHERE id = $1 AND status = 'divergente'`, [d.movimentacao_id]);
    }
    await recalcularStatus(db, { ids: [d.imovel_id] });
    await auditar(db, { municipio: d.municipio, entidade: 'divergencia', entidadeId: d.id, acao, detalhe: `${im.inscricao}: ${resolucao}`, usuario });
    return d.id;
  });
  res.json({ ok: true, id: out });
}));

// Conferência da UI no Sinter (consulta por CIB) → divergências por campo.
remessasRouter.post('/api/cib/imoveis/:id/conferir-sinter', gestor, asyncRoute(async (req, res) => {
  const im = (await query('SELECT * FROM imoveis WHERE id = $1', [req.params.id])).rows[0];
  if (!im || im.municipio !== muniDe(req)) throw erro(404, 'Imóvel não encontrado.');
  if (!im.cib) throw erro(409, 'Imóvel sem CIB.');
  const ui = await clienteSinter().consultarUI(im.cib);
  const d = ui.DadosGeraisImovel || {}, e = ui.EnderecoImovel || {};
  const comparar = [
    ['area_terreno_m2', im.area_terreno_m2, d.areaTerreno, (a, b) => Math.abs(Number(a) - Number(b)) < 0.01],
    ['area_construida_m2', im.area_construida_m2 || null, d.areaConstruida ?? null, (a, b) => (a == null && b == null) || Math.abs(Number(a) - Number(b)) < 0.01],
    ['cep', im.cep, e.cep, (a, b) => String(a || '') === String(b || '')],
    ['bairro', im.bairro, e.bairro, (a, b) => String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase()],
  ];
  let n = 0;
  for (const [campo, local, ext, igual] of comparar) {
    if (igual(local, ext)) continue;
    const r = await query(`INSERT INTO cib_divergencias (municipio, imovel_id, fonte, campo, valor_municipio, valor_externo, mensagem)
      SELECT $1,$2,'sinter',$3,$4,$5,'Diferença na conferência da UI no Sinter'
      WHERE NOT EXISTS (SELECT 1 FROM cib_divergencias WHERE imovel_id = $2 AND campo = $3 AND status = 'aberta') RETURNING id`,
      [im.municipio, im.id, campo, String(local ?? ''), String(ext ?? '')]);
    n += r.rowCount;
  }
  await recalcularStatus(null, { ids: [im.id] });
  await auditar(null, { municipio: im.municipio, entidade: 'imovel', entidadeId: im.id, acao: 'conferir_sinter', detalhe: `${im.inscricao} · CIB ${im.cib}: ${n} divergência(s)`, usuario: nomeUsuario(req) });
  res.json({ ok: true, divergencias: n, situacaoCib: ui.Cib?.situacao || '' });
}));
