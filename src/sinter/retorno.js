// Leitura do retorno do Sinter, normalizada para o processamento da remessa.
//
// Formatos aceitos:
//  1) OFICIAL — resposta de "Consultar processamento e falhas"
//     (GET /api/v1/{codigoIbge}/arquivo/{idArquivo}/consulta) ou de
//     "Consultar requisição" — objeto com `registros[]` ou lista de páginas:
//       { inscricaoImobiliaria, cib, operacao: "Inclusão", efetivado: bool,
//         falhas: [{ codigoFalha, camposFalha, complemento }] }
//  2) Respostas síncronas por UI: { uiIncluida|uiAlterada|uiDesativada: {inscricaoImobiliaria, cib:{valor}}, camposInvalidos[] }
//  3) Planilha (CSV) de conferência: inscricao;situacao(ok|erro|divergente);cib;campo;valor_externo;mensagem
//
// Saída: [{ inscricao, operacao (I|A|D|''), efetivado, cib, falhas[], situacao, campo, valorExterno, valorMunicipio, fonte, mensagem }]
import { parseCsv, normalizarColuna } from '../csv.js';
import { CODIGOS_FALHA } from './dominios.js';

const OPERACAO = { 'inclusao': 'I', 'inclusão': 'I', 'i': 'I', 'alteracao': 'A', 'alteração': 'A', 'a': 'A', 'desativacao': 'D', 'desativação': 'D', 'd': 'D' };
const limpar = (s) => String(s ?? '').replace(/[\s_]+/g, '').trim();
const opDe = (s) => OPERACAO[String(s || '').trim().toLowerCase()] || '';

function falhasOficiais(lista) {
  return (lista || []).map((f) => {
    const codigo = limpar(f.codigoFalha ?? f.idFalha ?? f.codigo);
    return {
      codigo,
      campos: String(f.camposFalha ?? f.campo ?? '').split(',').map((x) => x.replace(/\s+/g, '')).filter(Boolean),
      mensagem: f.erro || CODIGOS_FALHA[codigo] || '',
      complemento: f.complemento || '',
    };
  });
}

function deRegistroOficial(r) {
  const efetivado = r.efetivado === true || r.efetivado === 'true';
  const falhas = falhasOficiais(r.falhas);
  return {
    inscricao: limpar(r.inscricaoImobiliaria), operacao: opDe(r.operacao), efetivado,
    cib: limpar(r.cib?.valor ?? r.cib).toUpperCase(), falhas,
    situacao: efetivado ? (falhas.length ? 'ok_com_falhas' : 'ok') : 'erro',
    fonte: 'sinter', mensagem: falhas.map((f) => `${f.codigo} ${f.mensagem}${f.campos.length ? ' (' + f.campos.join(', ') + ')' : ''}`).join('; '),
  };
}

function deRespostaSincrona(r) {
  const ui = r.uiIncluida || r.uiAlterada || r.uiDesativada;
  const operacao = r.uiIncluida ? 'I' : r.uiAlterada ? 'A' : r.uiDesativada ? 'D' : '';
  const falhas = falhasOficiais(r.camposInvalidos);
  const efetivado = Boolean(ui?.cib?.valor);
  return {
    inscricao: limpar(ui?.inscricaoImobiliaria), operacao, efetivado, cib: limpar(ui?.cib?.valor).toUpperCase(), falhas,
    situacao: efetivado ? (falhas.length ? 'ok_com_falhas' : 'ok') : 'erro', fonte: 'sinter', mensagem: r.mensagem || '',
  };
}

const SITUACAO_CSV = { ok: 'ok', aceito: 'ok', processado: 'ok', efetivado: 'ok', erro: 'erro', rejeitado: 'erro', rejeitada: 'erro', divergente: 'divergente', divergencia: 'divergente' };
function deLinhaManual(o) {
  const sit = SITUACAO_CSV[String(o.situacao || o.status || 'ok').trim().toLowerCase()] || 'erro';
  return {
    inscricao: String(o.inscricao || o.inscricao_municipal || o.inscricaoImobiliaria || '').trim(), operacao: opDe(o.operacao),
    efetivado: sit !== 'erro', cib: String(o.cib || '').trim().toUpperCase(), falhas: o.codigo_falha ? [{ codigo: String(o.codigo_falha), campos: [o.campo].filter(Boolean), mensagem: CODIGOS_FALHA[o.codigo_falha] || '' }] : [],
    situacao: sit, campo: String(o.campo || ''), valorExterno: String(o.valor_externo ?? o.valorExterno ?? o.valor_sinter ?? ''),
    valorMunicipio: String(o.valor_municipio ?? o.valorMunicipio ?? ''), fonte: String(o.fonte || 'sinter'), mensagem: String(o.mensagem || ''),
  };
}

/** Converte o conteúdo recebido (texto ou objeto) para a lista normalizada. */
export function parseRetorno(entrada) {
  let dado = entrada;
  if (typeof entrada === 'string') {
    const t = entrada.replace(/^﻿/, '').trim();
    if (t.startsWith('{') || t.startsWith('[')) dado = JSON.parse(t);
    else {
      const { cabecalho, linhas } = parseCsv(t);
      const ks = cabecalho.map(normalizarColuna);
      return linhas.map((l) => deLinhaManual(Object.fromEntries(ks.map((k, i) => [k, l[i]])))).filter((x) => x.inscricao);
    }
  }
  const paginas = Array.isArray(dado) ? dado : [dado];
  const out = [];
  for (const p of paginas) {
    if (p && Array.isArray(p.registros)) out.push(...p.registros.map(deRegistroOficial));
    else if (p && (p.uiIncluida || p.uiAlterada || p.uiDesativada || p.camposInvalidos)) out.push(deRespostaSincrona(p));
    else if (p && Array.isArray(p.itens)) out.push(...p.itens.map(deLinhaManual));
    else if (p && typeof p === 'object') out.push(deLinhaManual(p));
  }
  return out;
}
