// Troca de município entre instâncias (docs/adr/0002-troca-de-municipio.md).
//
// Cada prefeitura continua com o seu deploy e o seu banco (ADR 0001). Quem
// atende várias (equipe BzR, consórcio) troca de município pelo seletor do
// topo: o navegador vai para o endereço da outra instância.
//
// Com SSO_SECRET (o mesmo valor em todas as instâncias que trocam entre si), a
// troca não pede senha de novo: a instância de origem emite um ticket assinado
// (HMAC-SHA256) com o e-mail do usuário, válido por 60 s, para UMA instância de
// destino e uso ÚNICO. O destino só aceita se o e-mail estiver cadastrado e
// ativo LÁ — e o perfil é o de lá (técnico numa, gestor noutra). Ninguém ganha
// acesso a um município em que não foi cadastrado.
import { Router } from 'express';
import crypto from 'crypto';
import { query, isConfigured } from './db.js';
import { requireAuth, emitirToken, AUTH_ENABLED } from './auth.js';
import { MUNICIPIO_FIXO, lerInstancias, origemDe } from './env.js';
import { limitar } from './ratelimit.js';
import { auditar } from './cib.js';
import { rotaAsync } from './util.js';

const SSO_SECRET = String(process.env.SSO_SECRET || '');
export const TICKET_TTL_S = 60;
const asyncRoute = rotaAsync('sso');

// ---- Ticket ---------------------------------------------------------------
export function emitirTicket(segredo, { email, nome, iss, issMunicipio, aud }, agora = Date.now()) {
  if (!segredo) throw new Error('SSO_SECRET não configurado.');
  const payload = Buffer.from(JSON.stringify({
    v: 1, email: String(email).toLowerCase(), nome: String(nome || ''), iss, issMunicipio: issMunicipio || '', aud,
    exp: Math.floor(agora / 1000) + TICKET_TTL_S, jti: crypto.randomBytes(16).toString('hex'),
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', segredo).update('bzr-sso.' + payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Confere assinatura, destino e validade. Devolve {ok, motivo, dados}. */
export function verificarTicket(segredo, ticket, { aud }, agora = Date.now()) {
  if (!segredo) return { ok: false, motivo: 'Troca sem senha não está habilitada nesta instância.' };
  const [payload, sig] = String(ticket || '').split('.');
  if (!payload || !sig) return { ok: false, motivo: 'Ticket inválido.' };
  const esperado = crypto.createHmac('sha256', segredo).update('bzr-sso.' + payload).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return { ok: false, motivo: 'Ticket inválido.' };
  let d;
  try { d = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return { ok: false, motivo: 'Ticket inválido.' }; }
  if (d.v !== 1 || !d.email || !d.jti) return { ok: false, motivo: 'Ticket inválido.' };
  if (d.aud !== aud) return { ok: false, motivo: 'Ticket emitido para outra instância.' };
  if (!d.exp || d.exp < Math.floor(agora / 1000)) return { ok: false, motivo: 'Ticket expirado: volte e troque de município de novo.' };
  return { ok: true, dados: d };
}

/** Endereço desta instância (PUBLIC_BASE_URL; fora de produção, o host da requisição). */
export const origemPropria = (req) => origemDe(process.env.PUBLIC_BASE_URL) || `${req.protocol}://${req.get('host')}`;

// ---- Rotas ----------------------------------------------------------------
export const ssoRouter = Router();

// Para o seletor do topo: este município e as outras instâncias.
ssoRouter.get('/api/instancias', requireAuth, (req, res) => {
  const { lista } = lerInstancias();
  res.json({
    atual: { municipio: MUNICIPIO_FIXO || null, url: origemPropria(req) },
    outras: lista,
    sso: Boolean(SSO_SECRET) && AUTH_ENABLED,
  });
});

// Origem: emite o ticket para o destino escolhido (que precisa estar em INSTANCIAS).
ssoRouter.post('/api/sso/emitir', requireAuth, asyncRoute(async (req, res) => {
  if (!AUTH_ENABLED) return res.status(400).json({ error: 'Login desligado nesta instância (demonstração).' });
  if (!SSO_SECRET) return res.status(400).json({ error: 'Troca sem senha não configurada (SSO_SECRET).' });
  const destino = origemDe(req.body?.destino);
  const inst = lerInstancias().lista.find((i) => i.url === destino);
  if (!inst) return res.status(400).json({ error: 'Destino não está na lista de instâncias (INSTANCIAS).' });
  const { rows } = await query('SELECT id, nome, email, ativo FROM usuarios WHERE id = $1', [req.user.uid]);
  const u = rows[0];
  if (!u || !u.ativo) return res.status(401).json({ error: 'Sessão inválida.' });
  const ticket = emitirTicket(SSO_SECRET, { email: u.email, nome: u.nome, iss: origemPropria(req), issMunicipio: MUNICIPIO_FIXO, aud: inst.url });
  await auditar(null, { municipio: MUNICIPIO_FIXO, entidade: 'acesso', entidadeId: u.id, acao: 'troca de município', detalhe: `Saiu para ${inst.municipio} (${inst.url})`, usuario: u.nome });
  res.json({ ticket, url: `${inst.url}/login?sso=${encodeURIComponent(ticket)}`, municipio: inst.municipio });
}));

// Destino: troca o ticket por uma sessão local (perfil desta instância).
ssoRouter.post('/api/auth/sso',
  limitar({ nome: 'sso', janelaMs: 15 * 60000, max: 30 }),
  asyncRoute(async (req, res) => {
    if (!AUTH_ENABLED || !isConfigured) return res.status(400).json({ error: 'Login desligado nesta instância.' });
    const r = verificarTicket(SSO_SECRET, req.body?.ticket, { aud: origemPropria(req) });
    if (!r.ok) return res.status(401).json({ error: r.motivo });
    const d = r.dados;
    // Uso único.
    const uso = await query('INSERT INTO sso_tickets_usados (jti, email, origem) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING jti', [d.jti, d.email, d.iss || '']);
    if (!uso.rowCount) return res.status(401).json({ error: 'Ticket já utilizado.' });
    query("DELETE FROM sso_tickets_usados WHERE created_at < now() - interval '2 days'").catch(() => {});
    const { rows } = await query('SELECT * FROM usuarios WHERE lower(email) = $1', [d.email]);
    const u = rows[0];
    if (!u || !u.ativo) {
      await auditar(null, { municipio: MUNICIPIO_FIXO, entidade: 'acesso', acao: 'troca recusada', detalhe: `${d.email} veio de ${d.issMunicipio || d.iss} sem cadastro ativo aqui`, usuario: d.nome || d.email });
      return res.status(403).json({ error: `Você não tem acesso a ${MUNICIPIO_FIXO || 'este município'}. Peça ao administrador da prefeitura para cadastrar o seu e-mail (${d.email}).` });
    }
    await auditar(null, { municipio: MUNICIPIO_FIXO, entidade: 'acesso', entidadeId: u.id, acao: 'entrada por troca de município', detalhe: `Veio de ${d.issMunicipio || d.iss}`, usuario: u.nome });
    res.json({ token: emitirToken(u), user: { id: u.id, nome: u.nome, email: u.email, role: u.role, equipe: u.equipe || '', ativo: u.ativo } });
  }));
