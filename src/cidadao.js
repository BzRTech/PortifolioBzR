// Portal do Cidadão (/cidadao): o munícipe vê os imóveis cadastrados no seu
// CPF/CNPJ, emite documentos na hora e faz solicitações à prefeitura.
//
// SEGURANÇA — o CPF sozinho NÃO dá acesso. CPF não é segredo (está em nota
// fiscal, boleto, cadastro de loja); com ele apenas, qualquer um veria os
// imóveis de outra pessoa. A entrada exige uma segunda prova:
//   • gov.br  (Login Único, OIDC + PKCE) — o CPF vem verificado pelo gov.br;
//   • código por e-mail — 6 dígitos, 10 min, 5 tentativas, enviado ao e-mail
//     que já consta no cadastro do imóvel (nunca a um e-mail digitado agora);
//   • inscrição — CPF + a inscrição de um dos seus imóveis (está no carnê do
//     IPTU). É a mais fraca: a prefeitura decide se aceita (PORTAL_ENTRADA).
// A sessão do cidadão é assinada com uma chave derivada própria (não vale nas
// APIs internas), dura 30 min e fica só na aba (sessionStorage).
// Respostas não revelam se um CPF tem imóvel no município (anti-enumeração),
// e tudo tem limite de tentativas. Acessos entram no registro LGPD e na auditoria.
import { Router } from 'express';
import crypto from 'crypto';
import { query, withTransaction } from './db.js';
import { PRODUCAO, MUNICIPIO_FIXO, origemDe } from './env.js';
import { normalizarNi, niValido, mascararDoc, formatarDoc } from './ni.js';
import { isoData } from './cib-validacao.js';
import { limitar, excedeu, contarFalha } from './ratelimit.js';
import { rotaAsync, erro, muniDe } from './util.js';
import { getConfig, getImovelCompleto, relatorioMensal, diagnostico, auditar } from './cib.js';
import { TIPOS_DOC, renderDocumento, renderComprovante } from './doc-templates.js';
import { emitirDocumento, protocolarRequerimento, TIPOS_REQ, mapReq, mapDoc, ABERTOS } from './documentos.js';
import { validarAnexos, salvarAnexos, listarAnexos } from './anexos.js';
import { registrarAcesso } from './lgpd.js';
import { emailConfigurado, enviarEmail, mascararEmail } from './email.js';

const asyncRoute = rotaAsync('cidadao');
export const SESSAO_MIN = 30;
const PORTAL = 'Portal do Cidadão';

// ---- Configuração ---------------------------------------------------------------
export const DOCS_PADRAO = ['certidao_cadastral', 'declaracao_situacao', 'certidao_valor_venal', 'certidao_numeracao', 'declaracao_cib', 'certidao_baixa'];
const REQS_PORTAL = ['certidao', 'revisao_cadastral', 'transferencia', 'numeracao_predial', 'parcelamento', 'baixa', 'reativacao', 'vistoria', 'inclusao_imovel', 'outro'];
const lista = (v) => String(v || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

const GOVBR_BASES = { producao: 'https://sso.acesso.gov.br', homologacao: 'https://sso.staging.acesso.gov.br' };
export const govbr = () => ({
  clientId: process.env.GOVBR_CLIENT_ID || '',
  secret: process.env.GOVBR_CLIENT_SECRET || '',
  base: (process.env.GOVBR_BASE_URL || GOVBR_BASES[process.env.GOVBR_AMBIENTE === 'producao' ? 'producao' : 'homologacao']).replace(/\/$/, ''),
});

/** Formas de entrada habilitadas e disponíveis nesta instância. */
export function metodosAtivos(env = process.env) {
  const pedidos = lista(env.PORTAL_ENTRADA || 'govbr,email,inscricao');
  const prod = env.NODE_ENV === 'production';
  return pedidos.filter((m) => {
    if (m === 'govbr') return Boolean(env.GOVBR_CLIENT_ID && env.GOVBR_CLIENT_SECRET);
    if (m === 'email') return Boolean(env.SMTP_URL) || !prod; // sem SMTP: só demonstração (código na tela)
    return m === 'inscricao';
  });
}
/** Documentos que o cidadão emite sozinho (PORTAL_DOCUMENTOS); o resto vira solicitação. */
export const docsPortal = () => {
  const l = lista(process.env.PORTAL_DOCUMENTOS);
  return (l.length ? l : DOCS_PADRAO).filter((t) => TIPOS_DOC[t]?.imovel === true);
};

// ---- Sessão do cidadão ---------------------------------------------------------
const SEGREDO_BASE = process.env.AUTH_SECRET || (PRODUCAO ? '' : 'bzr-dev-secret-troque-em-producao');
const CHAVE = crypto.createHmac('sha256', SEGREDO_BASE || crypto.randomBytes(32)).update('bzr-cidadao/v1').digest();

export function emitirSessao({ doc, nome = '', metodo, municipio }, agora = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ typ: 'cidadao', doc: normalizarNi(doc), nome, metodo, muni: municipio, exp: Math.floor(agora / 1000) + SESSAO_MIN * 60 })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', CHAVE).update(payload).digest('base64url')}`;
}
export function lerSessao(token, agora = Date.now()) {
  const [p, s] = String(token || '').split('.');
  if (!p || !s) return null;
  const esp = crypto.createHmac('sha256', CHAVE).update(p).digest('base64url');
  if (s.length !== esp.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(esp))) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (d.typ !== 'cidadao' || !d.doc || d.exp < Math.floor(agora / 1000)) return null;
    return d;
  } catch { return null; }
}
function exigirCidadao(req, res, next) {
  const h = req.get('authorization') || '';
  const s = lerSessao(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!s || (MUNICIPIO_FIXO && s.muni !== MUNICIPIO_FIXO)) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  req.cidadao = s;
  req.user = { uid: null, role: 'cidadao', nome: `Cidadão: ${s.nome || mascararDoc(s.doc)}` };
  next();
}

// ---- Dados do cidadão --------------------------------------------------------
async function imoveisDo(municipio, doc) {
  const { rows } = await query(`SELECT id FROM imoveis WHERE municipio = $1 AND contribuinte_doc = $2 ORDER BY situacao, inscricao`, [municipio, doc]);
  return Promise.all(rows.map((r) => getImovelCompleto(r.id, { incluirDoc: true })));
}
async function nomeDo(municipio, doc) {
  const r = (await query(`SELECT contribuinte_nome FROM imoveis WHERE municipio = $1 AND contribuinte_doc = $2 AND contribuinte_nome <> '' ORDER BY updated_at DESC LIMIT 1`, [municipio, doc])).rows[0];
  return r?.contribuinte_nome || '';
}
/** Quais documentos o cidadão pode emitir agora, e por que não os outros. */
async function disponibilidade(municipio, im) {
  const cfg = await getConfig(municipio);
  const out = [];
  for (const id of docsPortal()) {
    const t = TIPOS_DOC[id];
    if (id === 'certidao_baixa' && im.situacao !== 'baixado') continue;
    if (id !== 'certidao_baixa' && id !== 'declaracao_situacao' && im.situacao === 'baixado') continue;
    try { await t.preparar({ municipio, cfg, imovel: im, campos: {}, relatorioMensal, diagnostico }); out.push({ id, titulo: t.titulo, disponivel: true }); }
    catch (e) { out.push({ id, titulo: t.titulo, disponivel: false, motivo: e.message }); }
  }
  return out;
}
const imovelDoCidadao = (im) => ({
  id: im.id, inscricao: im.inscricao, cib: im.cib || null, situacao: im.situacao, tipo: im.tipo, uso: im.uso,
  endereco: [im.logradouro, im.numero].filter(Boolean).join(', ') + (im.complemento ? ` — ${im.complemento}` : ''), bairro: im.bairro, cep: im.cep,
  areaTerreno: im.areaTerreno, areaConstruida: im.areaConstruida, valorVenal: im.valorVenal, valorVenalAno: im.valorVenalAno,
  matricula: im.matriculaCartorio || '', loteCodigo: im.loteCodigo || '', centroide: im.centroide || null,
});
async function exigirImovelDo(req, imovelId) {
  const r = (await query('SELECT id FROM imoveis WHERE id = $1 AND municipio = $2 AND contribuinte_doc = $3', [imovelId, req.cidadao.muni, req.cidadao.doc])).rows[0];
  if (!r) throw erro(404, 'Imóvel não encontrado entre os seus.');
  return r.id;
}

// ---- Rotas ---------------------------------------------------------------------
export const cidadaoRouter = Router();
// Anti-força-bruta: por IP em todas as entradas; por CPF nas falhas.
const limiteEntrada = limitar({ nome: 'cidadao-entrada', janelaMs: 15 * 60000, max: 15 });
const HORA = 3600000;
const bloqueadoDoc = (doc) => excedeu(`cid-falha:${doc}`, { janelaMs: HORA, max: 5 });
const falhou = (req, doc) => { contarFalha(`cid-falha:${doc}`, HORA); contarFalha(`cid-falha-ip:${req.ip}`, HORA); };
const bloqueadoIp = (req) => excedeu(`cid-falha-ip:${req.ip}`, { janelaMs: HORA, max: 20 });

async function entrar(req, res, { doc, metodo, detalhe = '' }) {
  const m = muniDe(req);
  const nome = await nomeDo(m, doc);
  const token = emitirSessao({ doc, nome, metodo, municipio: m });
  req.user = { uid: null, role: 'cidadao', nome: `Cidadão: ${nome || mascararDoc(doc)}` };
  await registrarAcesso(req, { municipio: m, entidade: 'cidadao', dado: `titular consultou os próprios imóveis (${metodo})`, finalidade: 'acesso do titular aos próprios dados — LGPD art. 18' });
  await auditar(null, { municipio: m, entidade: 'portal', acao: 'entrada no portal', detalhe: `${mascararDoc(doc)} via ${metodo}${detalhe ? ' · ' + detalhe : ''}`, usuario: nome || mascararDoc(doc) });
  return { token, expiraEmMin: SESSAO_MIN };
}

cidadaoRouter.get('/api/cidadao/config', asyncRoute(async (req, res) => {
  const cfg = await getConfig(muniDe(req));
  res.json({
    municipio: muniDe(req), nomeOficial: cfg.nomeOficial, secretaria: cfg.secretaria, setor: cfg.setor, telefone: cfg.telefone, email: cfg.email, endereco: cfg.endereco,
    metodos: metodosAtivos(), demonstracao: !PRODUCAO && !emailConfigurado(), sessaoMin: SESSAO_MIN,
    documentos: docsPortal().map((id) => ({ id, titulo: TIPOS_DOC[id].titulo })),
    solicitacoes: REQS_PORTAL.map((id) => ({ id, label: TIPOS_REQ[id].label, prazoDias: TIPOS_REQ[id].prazoDias, exigeImovel: !['inclusao_imovel', 'outro', 'vistoria'].includes(id) })),
    certidoes: Object.entries(TIPOS_DOC).filter(([, t]) => t.imovel === true).map(([id, t]) => ({ id, titulo: t.titulo })),
  });
}));

// 1) CPF + inscrição de um dos seus imóveis (do carnê do IPTU).
cidadaoRouter.post('/api/cidadao/entrar/inscricao', limiteEntrada, asyncRoute(async (req, res) => {
  if (!metodosAtivos().includes('inscricao')) throw erro(403, 'Esta forma de entrada não está habilitada.');
  const doc = normalizarNi(req.body?.doc);
  const inscricao = String(req.body?.inscricao || '').trim();
  if (!niValido(doc) || !inscricao) throw erro(400, 'Informe um CPF/CNPJ válido e a inscrição do imóvel (está no carnê do IPTU).');
  if (bloqueadoDoc(doc) || bloqueadoIp(req)) throw erro(429, 'Muitas tentativas sem sucesso. Aguarde uma hora ou entre com gov.br.');
  const ok = (await query('SELECT 1 FROM imoveis WHERE municipio = $1 AND contribuinte_doc = $2 AND inscricao = $3', [muniDe(req), doc, inscricao])).rows.length;
  if (!ok) { falhou(req, doc); throw erro(401, 'CPF/CNPJ e inscrição não conferem com o cadastro. Confira os dados no carnê do IPTU.'); }
  res.json(await entrar(req, res, { doc, metodo: 'inscricao', detalhe: `inscrição ${inscricao}` }));
}));

// 2) Código por e-mail (para o e-mail que JÁ está no cadastro).
cidadaoRouter.post('/api/cidadao/entrar/codigo', limiteEntrada, asyncRoute(async (req, res) => {
  if (!metodosAtivos().includes('email')) throw erro(403, 'Esta forma de entrada não está habilitada.');
  const doc = normalizarNi(req.body?.doc);
  if (!niValido(doc)) throw erro(400, 'Informe um CPF/CNPJ válido.');
  const m = muniDe(req);
  const aviso = { ok: true, mensagem: 'Se este CPF/CNPJ tiver e-mail no cadastro imobiliário, você receberá um código de 6 dígitos em instantes. Ele vale por 10 minutos.' };
  if (excedeu(`cid-cod:${doc}`, { janelaMs: HORA, max: 3 })) throw erro(429, 'Você já pediu 3 códigos na última hora. Aguarde ou entre com gov.br.');
  contarFalha(`cid-cod:${doc}`, HORA);
  const em = (await query(`SELECT contribuinte_email AS email FROM imoveis WHERE municipio = $1 AND contribuinte_doc = $2 AND contribuinte_email LIKE '%@%' ORDER BY updated_at DESC LIMIT 1`, [m, doc])).rows[0];
  if (!em) return res.json(aviso); // não revela se o CPF tem imóvel
  const codigo = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await query(`INSERT INTO cidadao_codigos (municipio, doc, hash_codigo, email, expira_em, ip) VALUES ($1,$2,$3,$4, now() + interval '10 minutes', $5)`,
    [m, doc, crypto.createHmac('sha256', CHAVE).update(`${doc}:${codigo}`).digest('hex'), em.email, String(req.ip || '')]);
  if (emailConfigurado()) {
    const cfg = await getConfig(m);
    enviarEmail({ para: em.email, assunto: `${codigo} — código de acesso ao ${PORTAL}`,
      texto: `Seu código de acesso ao ${PORTAL} da ${cfg.nomeOficial || m} é ${codigo}.\nEle vale por 10 minutos. Se você não pediu, ignore este e-mail.` })
      .catch((e) => console.error('[cidadao] e-mail:', e.message));
    return res.json(aviso);
  }
  // Sem SMTP (só fora de produção): demonstração mostra o código na tela.
  res.json({ ...aviso, demonstracao: { codigo, email: mascararEmail(em.email), aviso: 'Demonstração: sem servidor de e-mail configurado, o código aparece aqui.' } });
}));
cidadaoRouter.post('/api/cidadao/entrar/confirmar', limiteEntrada, asyncRoute(async (req, res) => {
  const doc = normalizarNi(req.body?.doc);
  const codigo = String(req.body?.codigo || '').replace(/\D/g, '');
  if (!niValido(doc) || codigo.length !== 6) throw erro(400, 'Informe o CPF/CNPJ e o código de 6 dígitos.');
  if (bloqueadoDoc(doc) || bloqueadoIp(req)) throw erro(429, 'Muitas tentativas sem sucesso. Aguarde uma hora.');
  const c = (await query(`SELECT * FROM cidadao_codigos WHERE municipio = $1 AND doc = $2 AND usado_em IS NULL AND expira_em > now() ORDER BY id DESC LIMIT 1`, [muniDe(req), doc])).rows[0];
  const hash = crypto.createHmac('sha256', CHAVE).update(`${doc}:${codigo}`).digest('hex');
  if (!c || c.tentativas >= 5 || !crypto.timingSafeEqual(Buffer.from(c.hash_codigo), Buffer.from(hash))) {
    if (c) await query('UPDATE cidadao_codigos SET tentativas = tentativas + 1 WHERE id = $1', [c.id]);
    falhou(req, doc);
    throw erro(401, c && c.tentativas + 1 >= 5 ? 'Código bloqueado após 5 tentativas. Peça um novo.' : 'Código inválido ou expirado.');
  }
  const uso = await query('UPDATE cidadao_codigos SET usado_em = now() WHERE id = $1 AND usado_em IS NULL RETURNING id', [c.id]);
  if (!uso.rowCount) throw erro(401, 'Código já utilizado.');
  res.json(await entrar(req, res, { doc, metodo: 'email', detalhe: mascararEmail(c.email) }));
}));

// 3) gov.br — OpenID Connect com PKCE.
const estados = new Map(); // state -> { verifier, nonce, criado }
function limparEstados() {
  const lim = Date.now() - 10 * 60000;
  for (const [k, v] of estados) if (v.criado < lim) estados.delete(k);
  while (estados.size > 5000) estados.delete(estados.keys().next().value);
}
const retornoGovbr = (req) => `${origemDe(process.env.PUBLIC_BASE_URL) || `${req.protocol}://${req.get('host')}`}/api/cidadao/govbr/retorno`;

cidadaoRouter.get('/api/cidadao/govbr/entrar', limiteEntrada, (req, res) => {
  const g = govbr();
  if (!metodosAtivos().includes('govbr')) return res.redirect('/cidadao#erro=' + encodeURIComponent('Entrada com gov.br não configurada nesta prefeitura.'));
  limparEstados();
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  estados.set(state, { verifier, nonce, criado: Date.now() });
  const q = new URLSearchParams({ response_type: 'code', client_id: g.clientId, scope: 'openid email profile', redirect_uri: retornoGovbr(req), state, nonce,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  res.redirect(`${g.base}/authorize?${q}`);
});

let jwksCache = { em: 0, chaves: [] };
async function chavesGovbr(g, forcar = false) {
  if (!forcar && Date.now() - jwksCache.em < 3600000 && jwksCache.chaves.length) return jwksCache.chaves;
  const r = await fetch(`${g.base}/jwk`);
  if (!r.ok) throw new Error(`gov.br JWKS HTTP ${r.status}`);
  jwksCache = { em: Date.now(), chaves: (await r.json()).keys || [] };
  return jwksCache.chaves;
}
/** Confere o id_token do gov.br (RS256, emissor, audiência, validade, nonce). */
export async function verificarIdToken(idToken, { g, nonce, chaves }) {
  const [h64, p64, s64] = String(idToken || '').split('.');
  if (!h64 || !p64 || !s64) throw new Error('id_token malformado');
  const header = JSON.parse(Buffer.from(h64, 'base64url').toString());
  if (header.alg !== 'RS256') throw new Error('id_token: algoritmo não aceito');
  const jwk = chaves.find((k) => k.kid === header.kid) || (chaves.length === 1 ? chaves[0] : null);
  if (!jwk) throw new Error('id_token: chave não encontrada');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h64}.${p64}`), crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s64, 'base64url'));
  if (!ok) throw new Error('id_token: assinatura inválida');
  const c = JSON.parse(Buffer.from(p64, 'base64url').toString());
  if (String(c.iss || '').replace(/\/$/, '') !== g.base) throw new Error('id_token: emissor inesperado');
  if (!(Array.isArray(c.aud) ? c.aud.includes(g.clientId) : c.aud === g.clientId)) throw new Error('id_token: audiência inesperada');
  if (!c.exp || c.exp < Math.floor(Date.now() / 1000) - 60) throw new Error('id_token expirado');
  if (c.nonce !== nonce) throw new Error('id_token: nonce não confere');
  const cpf = normalizarNi(c.sub);
  if (cpf.length !== 11 || !niValido(cpf)) throw new Error('id_token sem CPF válido');
  return { cpf, nome: c.name || '', email: c.email || '' };
}

cidadaoRouter.get('/api/cidadao/govbr/retorno', limiteEntrada, async (req, res) => {
  const voltar = (frag) => res.redirect('/cidadao#' + frag);
  try {
    if (req.query.error) return voltar('erro=' + encodeURIComponent('gov.br: ' + (req.query.error_description || req.query.error)));
    const st = estados.get(String(req.query.state || ''));
    estados.delete(String(req.query.state || ''));
    if (!st || Date.now() - st.criado > 10 * 60000) return voltar('erro=' + encodeURIComponent('A entrada com gov.br expirou. Tente de novo.'));
    const g = govbr();
    const r = await fetch(`${g.base}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${g.clientId}:${g.secret}`).toString('base64') },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: String(req.query.code || ''), redirect_uri: retornoGovbr(req), code_verifier: st.verifier }),
    });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.id_token) throw new Error(`gov.br token HTTP ${r.status}`);
    let dados;
    try { dados = await verificarIdToken(tok.id_token, { g, nonce: st.nonce, chaves: await chavesGovbr(g) }); }
    catch (e) { if (!/chave não encontrada/.test(e.message)) throw e; dados = await verificarIdToken(tok.id_token, { g, nonce: st.nonce, chaves: await chavesGovbr(g, true) }); }
    const s = await entrar(req, res, { doc: dados.cpf, metodo: 'govbr' });
    voltar('t=' + encodeURIComponent(s.token));
  } catch (e) {
    console.error('[cidadao] gov.br:', e.message);
    voltar('erro=' + encodeURIComponent('Não foi possível concluir a entrada com gov.br. Tente novamente.'));
  }
});

// ---- Área do cidadão ----------------------------------------------------------
const area = Router();
area.use(exigirCidadao);

area.get('/eu', asyncRoute(async (req, res) => {
  const { muni, doc } = req.cidadao;
  const imoveis = await imoveisDo(muni, doc);
  const reqs = (await query(`SELECT r.*, (SELECT count(*) FROM requerimento_anexos a WHERE a.requerimento_id = r.id)::int AS qtd_anexos
    FROM requerimentos r WHERE r.municipio = $1 AND r.requerente_doc = $2 ORDER BY r.id DESC LIMIT 100`, [muni, doc])).rows;
  const docs = (await query(`SELECT d.* FROM documentos d LEFT JOIN requerimentos r ON r.id = d.requerimento_id
    WHERE d.municipio = $1 AND (d.solicitante_doc = $2 OR r.requerente_doc = $2) ORDER BY d.emitido_em DESC LIMIT 100`, [muni, doc])).rows;
  res.json({
    nome: req.cidadao.nome || imoveis[0]?.contribuinteNome || '', doc: formatarDoc(doc), metodo: req.cidadao.metodo, expiraEm: new Date(req.cidadao.exp * 1000).toISOString(),
    imoveis: await Promise.all(imoveis.map(async (im) => ({ ...imovelDoCidadao(im), documentos: await disponibilidade(muni, im) }))),
    solicitacoes: reqs.map((r) => {
      const m = mapReq(r);
      return { id: m.id, numero: m.numero, tipo: m.tipo, assunto: m.tipoLabel, inscricao: m.inscricao, status: m.status, prazo: m.prazo, atrasado: m.atrasado,
        criadoEm: m.criadoEm, atualizadoEm: m.atualizadoEm, parecer: ['deferido', 'indeferido', 'concluido', 'pendente_documentacao'].includes(m.status) ? m.parecer : '',
        historico: m.historico.map((h) => ({ em: h.em, status: h.status })), documentoId: m.documentoId, qtdAnexos: m.qtdAnexos, canal: m.canal,
        podeAnexar: ABERTOS.includes(m.status) };
    }),
    documentos: docs.map((d) => { const m = mapDoc(d); return { id: m.id, titulo: m.titulo, numero: m.numero, inscricao: m.inscricao, codigo: m.codigoValidacao, emitidoEm: m.emitidoEm, validade: m.validade, status: m.status, canal: m.canal }; }),
  });
}));

// Emitir documento na hora (só do próprio imóvel, só os tipos liberados).
area.post('/documentos', asyncRoute(async (req, res) => {
  const { muni, doc } = req.cidadao;
  const tipo = String(req.body?.tipo || '');
  if (!docsPortal().includes(tipo)) throw erro(400, 'Este documento não é emitido pelo portal. Faça uma solicitação.');
  const imovelId = await exigirImovelDo(req, req.body?.imovelId);
  if (excedeu(`cid-doc:${doc}`, { janelaMs: 24 * HORA, max: 20 })) throw erro(429, 'Limite de 20 documentos por dia atingido.');
  contarFalha(`cid-doc:${doc}`, 24 * HORA);
  const nome = req.cidadao.nome || await nomeDo(muni, doc);
  const d = await emitirDocumento({ municipio: muni, tipo, imovelId, interessado: nome, usuario: PORTAL, canal: 'portal', solicitanteDoc: doc });
  await registrarAcesso(req, { municipio: muni, entidade: 'documento', entidadeId: d.id, dado: `titular emitiu ${d.titulo} nº ${d.numero}`, finalidade: 'acesso do titular aos próprios dados — LGPD art. 18' });
  res.status(201).json({ id: d.id, titulo: d.titulo, numero: d.numero, codigo: d.codigo_validacao, validade: isoData(d.validade), emitidoEm: d.emitido_em });
}));

async function documentoDoCidadao(req) {
  const d = (await query(`SELECT d.*, r.numero AS requerimento_numero FROM documentos d LEFT JOIN requerimentos r ON r.id = d.requerimento_id
    WHERE d.id = $1 AND d.municipio = $2 AND (d.solicitante_doc = $3 OR r.requerente_doc = $3)`, [req.params.id, req.cidadao.muni, req.cidadao.doc])).rows[0];
  if (!d) throw erro(404, 'Documento não encontrado.');
  return d;
}
area.get('/documentos/:id/html', asyncRoute(async (req, res) => {
  const d = await documentoDoCidadao(req);
  const cfg = await getConfig(d.municipio);
  res.type('html').send(renderDocumento(d, { cfg, origem: origemDe(process.env.PUBLIC_BASE_URL) || `${req.protocol}://${req.get('host')}`, mascarar: false }));
}));

// Solicitações (requerimentos) com anexos.
area.post('/solicitacoes', asyncRoute(async (req, res) => {
  const { muni, doc } = req.cidadao;
  const b = req.body || {};
  if (!REQS_PORTAL.includes(b.tipo)) throw erro(400, 'Escolha o assunto da solicitação.');
  const t = TIPOS_REQ[b.tipo];
  let imovelId = null, inscricao = '';
  if (b.imovelId) {
    imovelId = await exigirImovelDo(req, b.imovelId);
    inscricao = (await query('SELECT inscricao FROM imoveis WHERE id = $1', [imovelId])).rows[0].inscricao;
  } else if (!['inclusao_imovel', 'outro', 'vistoria'].includes(b.tipo)) throw erro(400, 'Escolha o imóvel da solicitação.');
  const descricao = String(b.descricao || '').trim();
  if (descricao.length < 10) throw erro(400, 'Descreva o pedido (mínimo 10 caracteres).');
  const email = String(b.email || '').trim().slice(0, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw erro(400, 'E-mail de contato inválido.');
  if (excedeu(`cid-req:${doc}`, { janelaMs: 24 * HORA, max: 10 })) throw erro(429, 'Limite de 10 solicitações por dia atingido.');
  const anexos = validarAnexos(b.anexos);
  contarFalha(`cid-req:${doc}`, 24 * HORA);
  const nome = req.cidadao.nome || await nomeDo(muni, doc) || String(b.nome || '').trim();
  if (!nome) throw erro(400, 'Informe o seu nome completo.');
  const r = await protocolarRequerimento({
    municipio: muni, tipo: b.tipo, documentoTipo: b.tipo === 'certidao' ? b.documentoTipo : '', requerenteNome: nome, requerenteDoc: doc,
    requerenteEmail: email, requerenteTelefone: String(b.telefone || '').slice(0, 40), imovelId, inscricao, descricao,
    dados: b.endereco ? { enderecoInformado: String(b.endereco).slice(0, 300) } : {}, usuario: `${nome} (${PORTAL})`, canal: 'portal', anexos,
  });
  res.status(201).json({ id: r.id, numero: r.numero, assunto: t.label, prazo: isoData(r.prazo), status: r.status, qtdAnexos: r.qtd_anexos });
}));
area.post('/solicitacoes/:id/anexos', asyncRoute(async (req, res) => {
  const r = (await query('SELECT * FROM requerimentos WHERE id = $1 AND municipio = $2 AND requerente_doc = $3', [req.params.id, req.cidadao.muni, req.cidadao.doc])).rows[0];
  if (!r) throw erro(404, 'Solicitação não encontrada.');
  if (!ABERTOS.includes(r.status)) throw erro(409, 'Esta solicitação já foi decidida; abra uma nova se precisar.');
  const arquivos = validarAnexos(req.body?.anexos);
  if (!arquivos.length) throw erro(400, 'Nenhum arquivo enviado.');
  const salvos = await withTransaction(async (db) => {
    const s = await salvarAnexos(db, r.id, arquivos, { por: `${r.requerente_nome} (portal)`, canal: 'portal' });
    const hist = [...(r.historico || []), { em: new Date().toISOString(), status: r.status, por: `${r.requerente_nome} (${PORTAL})`, obs: `Enviou ${s.length} documento(s): ${s.map((x) => x.nome).join(', ')}` }];
    await db.query('UPDATE requerimentos SET historico = $2::jsonb, updated_at = now() WHERE id = $1', [r.id, JSON.stringify(hist)]);
    await auditar(db, { municipio: r.municipio, entidade: 'requerimento', entidadeId: r.id, acao: 'anexar (portal)', detalhe: `${r.numero}: ${s.map((x) => x.nome).join(', ')}`, usuario: r.requerente_nome });
    return s;
  });
  res.status(201).json(salvos);
}));
area.get('/solicitacoes/:id/anexos', asyncRoute(async (req, res) => {
  const r = (await query('SELECT id FROM requerimentos WHERE id = $1 AND municipio = $2 AND requerente_doc = $3', [req.params.id, req.cidadao.muni, req.cidadao.doc])).rows[0];
  if (!r) throw erro(404, 'Solicitação não encontrada.');
  res.json((await listarAnexos({ query }, r.id)).map(({ sha256, ...a }) => a));
}));
area.get('/solicitacoes/:id/comprovante', asyncRoute(async (req, res) => {
  const r = (await query('SELECT * FROM requerimentos WHERE id = $1 AND municipio = $2 AND requerente_doc = $3', [req.params.id, req.cidadao.muni, req.cidadao.doc])).rows[0];
  if (!r) throw erro(404, 'Solicitação não encontrada.');
  const cfg = await getConfig(r.municipio);
  res.type('html').send(renderComprovante({ ...r, tipo_label: TIPOS_REQ[r.tipo]?.label || r.tipo }, cfg, origemDe(process.env.PUBLIC_BASE_URL) || `${req.protocol}://${req.get('host')}`));
}));

cidadaoRouter.use('/api/cidadao', area);
