// Autenticação com 4 perfis:
//   admin        — tudo, inclusive usuários
//   coordenador  — remessas/retorno do Sinter, configuração, PGV, documentos
//   tecnico      — operação do cadastro, campo e atendimento
//   gestor       — SOMENTE LEITURA (prefeito, controle interno): painel e relatórios
// Sem dependências externas: hash scrypt e token HMAC-SHA256 (tipo JWT).
// Em produção o login é obrigatório e o segredo não tem valor padrão (src/env.js).
import { Router } from 'express';
import crypto from 'crypto';
import { query, isConfigured } from './db.js';
import { PRODUCAO, senhaAdminInicial } from './env.js';

export const ROLES = ['admin', 'coordenador', 'tecnico', 'gestor'];
const SECRET = process.env.AUTH_SECRET || (PRODUCAO ? '' : 'bzr-dev-secret-troque-em-producao');
const TOKEN_TTL_S = 60 * 60 * 12; // 12h

// Login LIGA/DESLIGA. Desligado só é aceito fora de produção (demonstração).
export const AUTH_ENABLED = String(process.env.AUTH_ENABLED || 'false') === 'true';
const ANON = { uid: null, role: 'anon', nome: '' };

// ---- Hash de senha (scrypt) ----------------------------------------------
export function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(String(senha), salt, 32).toString('hex');
  return `scrypt$${salt}$${dk}`;
}
export function verificaSenha(senha, armazenado) {
  try {
    const [alg, salt, dk] = String(armazenado || '').split('$');
    if (alg !== 'scrypt' || !salt || !dk) return false;
    const calc = crypto.scryptSync(String(senha), salt, 32);
    const ref = Buffer.from(dk, 'hex');
    return calc.length === ref.length && crypto.timingSafeEqual(calc, ref);
  } catch { return false; }
}

// ---- Token assinado (payload.b64 . hmac.b64) -----------------------------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function assinar(payloadObj) {
  if (!SECRET) throw new Error('AUTH_SECRET não configurado.');
  const payload = b64u(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function emitirToken(user) {
  return assinar({ uid: user.id, role: user.role, nome: user.nome, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S });
}
export function verificarToken(token) {
  if (!SECRET || !token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const esperado = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!obj.exp || obj.exp < Math.floor(Date.now() / 1000)) return null;
    return obj;
  } catch { return null; }
}

// ---- Middleware ----------------------------------------------------------
export function tokenDaRequest(req) {
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}
/** Usuário da requisição (sem exigir login). */
export function usuarioDa(req) {
  if (!AUTH_ENABLED) return ANON;
  return verificarToken(tokenDaRequest(req)) || null;
}
export function requireAuth(req, res, next) {
  if (!AUTH_ENABLED) { req.user = ANON; return next(); }
  const claims = verificarToken(tokenDaRequest(req));
  if (!claims) return res.status(401).json({ error: 'Não autenticado.' });
  req.user = claims;
  next();
}
export const requireRole = (...roles) => (req, res, next) => {
  if (!AUTH_ENABLED) { req.user = ANON; return next(); }
  const claims = verificarToken(tokenDaRequest(req));
  if (!claims) return res.status(401).json({ error: 'Não autenticado.' });
  if (!roles.includes(claims.role)) return res.status(403).json({ error: 'Sem permissão para esta ação.' });
  req.user = claims;
  next();
};
/** Perfil "gestor" é somente leitura: bloqueia qualquer escrita na API. */
export function bloquearEscritaGestor(req, res, next) {
  if (!AUTH_ENABLED || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Entrar e trocar de município não alteram dados.
  if (['/api/auth/login', '/api/auth/sso', '/api/sso/emitir'].includes(req.originalUrl.split('?')[0])) return next();
  const claims = verificarToken(tokenDaRequest(req));
  if (claims?.role === 'gestor') return res.status(403).json({ error: 'Perfil gestor é somente leitura.' });
  next();
}

// ---- Schema (legado) + usuário inicial -----------------------------------
/** Tabela de usuários — usada só na adoção de bancos anteriores às migrations. */
export async function ensureAuthSchemaLegado() {
  if (!isConfigured) return false;
  await query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      nome       TEXT NOT NULL,
      email      TEXT UNIQUE NOT NULL,
      senha_hash TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'tecnico',
      equipe     TEXT DEFAULT '',
      ativo      BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  return true;
}

/**
 * Cria o admin inicial quando não há usuários. Contas de demonstração
 * (coordenador/técnico/gestor com senha conhecida) só fora de produção.
 */
export async function semearUsuarios() {
  if (!isConfigured) return false;
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM usuarios');
  if (rows[0].n > 0) return false;
  const adminEmail = String(process.env.ADMIN_EMAIL || 'admin@bzr.com').toLowerCase();
  const semente = [['Administrador', adminEmail, senhaAdminInicial(), 'admin', '']];
  if (!PRODUCAO) {
    semente.push(
      ['Coordenação (demo)', 'coordenador@bzr.com', 'bzr1234', 'coordenador', 'CTM'],
      ['Técnico de Campo (demo)', 'tecnico@bzr.com', 'bzr1234', 'tecnico', 'PD'],
      ['Gestor — somente leitura (demo)', 'gestor@bzr.com', 'bzr1234', 'gestor', 'Gabinete'],
    );
  }
  for (const [nome, email, senha, role, equipe] of semente) {
    await query(`INSERT INTO usuarios (nome, email, senha_hash, role, equipe) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (email) DO NOTHING`,
      [nome, email, hashSenha(senha), role, equipe]);
  }
  console.log(`[auth] usuário inicial criado (admin: ${adminEmail})${PRODUCAO ? '' : ' + contas de demonstração'}.`);
  return true;
}

// Compatibilidade com scripts antigos.
export async function ensureAuthSchema() { await ensureAuthSchemaLegado(); await semearUsuarios(); return true; }

// ---- Rotas ---------------------------------------------------------------
const publicUser = (r) => ({ id: r.id, nome: r.nome, email: r.email, role: r.role, equipe: r.equipe || '', ativo: r.ativo });

export const authRouter = Router();

// Config publica: o front decide se mostra a tela de login.
authRouter.get('/api/auth/config', (req, res) => res.json({ authEnabled: AUTH_ENABLED }));

authRouter.post('/api/auth/login', async (req, res) => {
  if (!isConfigured) return res.status(503).json({ error: 'Banco não configurado.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  if (!email || !senha) return res.status(400).json({ error: 'Informe e-mail e senha.' });
  try {
    const { rows } = await query('SELECT * FROM usuarios WHERE email = $1', [email]);
    const u = rows[0];
    if (!u || !u.ativo || !verificaSenha(senha, u.senha_hash)) {
      return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    }
    res.json({ token: emitirToken(u), user: publicUser(u) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

authRouter.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM usuarios WHERE id = $1', [req.user.uid]);
    if (!rows[0] || !rows[0].ativo) return res.status(401).json({ error: 'Sessão inválida.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista de usuários (para atribuir responsáveis). Qualquer usuário autenticado.
authRouter.get('/api/usuarios', requireAuth, async (req, res) => {
  try {
    const todos = req.query.todos === '1' && (!AUTH_ENABLED || req.user.role === 'admin');
    const { rows } = await query(`SELECT * FROM usuarios ${todos ? '' : 'WHERE ativo = TRUE'} ORDER BY nome`);
    res.json(rows.map(publicUser));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cadastro de usuários — somente admin.
authRouter.post('/api/usuarios', requireRole('admin'), async (req, res) => {
  const nome = String(req.body?.nome || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const senha = String(req.body?.senha || '');
  const role = ROLES.includes(req.body?.role) ? req.body.role : 'tecnico';
  const equipe = String(req.body?.equipe || '').trim().slice(0, 40);
  if (!nome || !email || senha.length < (PRODUCAO ? 10 : 4)) {
    return res.status(400).json({ error: `Nome, e-mail e senha (mín. ${PRODUCAO ? 10 : 4} caracteres) são obrigatórios.` });
  }
  try {
    const { rows } = await query(
      `INSERT INTO usuarios (nome, email, senha_hash, role, equipe) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [nome, email, hashSenha(senha), role, equipe]
    );
    res.json(publicUser(rows[0]));
  } catch (e) {
    if (String(e.message).includes('duplicate')) return res.status(409).json({ error: 'E-mail já cadastrado.' });
    res.status(500).json({ error: e.message });
  }
});

// Perfil / ativo / senha — somente admin.
authRouter.patch('/api/usuarios/:id', requireRole('admin'), async (req, res) => {
  const sets = [], params = [];
  const push = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (req.body?.role !== undefined) { if (!ROLES.includes(req.body.role)) return res.status(400).json({ error: 'Perfil inválido.' }); push('role', req.body.role); }
  if (req.body?.ativo !== undefined) push('ativo', Boolean(req.body.ativo));
  if (req.body?.senha) { if (String(req.body.senha).length < (PRODUCAO ? 10 : 4)) return res.status(400).json({ error: 'Senha curta.' }); push('senha_hash', hashSenha(req.body.senha)); }
  if (!sets.length) return res.status(400).json({ error: 'Nada a alterar.' });
  if (AUTH_ENABLED && Number(req.params.id) === Number(req.user.uid) && (req.body?.ativo === false || (req.body?.role && req.body.role !== 'admin'))) {
    return res.status(409).json({ error: 'Você não pode rebaixar nem desativar a própria conta.' });
  }
  params.push(req.params.id);
  try {
    const { rows } = await query(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json(publicUser(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
