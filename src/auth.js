// Autenticacao leve com 3 perfis (admin / coordenador / tecnico).
// Sem dependencias externas: hash de senha com scrypt (crypto) e token
// stateless assinado com HMAC-SHA256 (formato tipo-JWT). Reaproveita o mesmo
// pool de conexao (src/db.js) dos demais modulos.
import { Router } from 'express';
import crypto from 'crypto';
import { query, isConfigured } from './db.js';

export const ROLES = ['admin', 'coordenador', 'tecnico'];
const SECRET = process.env.AUTH_SECRET || 'bzr-dev-secret-troque-em-producao';
const TOKEN_TTL_S = 60 * 60 * 12; // 12h

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
  const payload = b64u(JSON.stringify(payloadObj));
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function emitirToken(user) {
  return assinar({ uid: user.id, role: user.role, nome: user.nome, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_S });
}
export function verificarToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
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
function tokenDaRequest(req) {
  const h = req.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}
export function requireAuth(req, res, next) {
  const claims = verificarToken(tokenDaRequest(req));
  if (!claims) return res.status(401).json({ error: 'Não autenticado.' });
  req.user = claims;
  next();
}
export const requireRole = (...roles) => (req, res, next) => {
  const claims = verificarToken(tokenDaRequest(req));
  if (!claims) return res.status(401).json({ error: 'Não autenticado.' });
  if (!roles.includes(claims.role)) return res.status(403).json({ error: 'Sem permissão.' });
  req.user = claims;
  next();
};

// ---- Schema + seed do admin ----------------------------------------------
export async function ensureAuthSchema() {
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

  // Seed inicial: cria os usuarios de demonstracao se a tabela estiver vazia.
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM usuarios');
  if (rows[0].n === 0) {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@bzr.com';
    const adminSenha = process.env.ADMIN_PASSWORD || 'bzr1234';
    const semente = [
      ['Administrador BzR', adminEmail, adminSenha, 'admin', ''],
      ['Coordenação (demo)', 'coordenador@bzr.com', 'bzr1234', 'coordenador', 'CTM'],
      ['Técnico de Campo (demo)', 'tecnico@bzr.com', 'bzr1234', 'tecnico', 'PD'],
    ];
    for (const [nome, email, senha, role, equipe] of semente) {
      await query(
        `INSERT INTO usuarios (nome, email, senha_hash, role, equipe) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (email) DO NOTHING`,
        [nome, email.toLowerCase(), hashSenha(senha), role, equipe]
      );
    }
    console.log(`[auth] usuários de demonstração criados (admin: ${adminEmail}).`);
  }
  return true;
}

// ---- Rotas ---------------------------------------------------------------
const publicUser = (r) => ({ id: r.id, nome: r.nome, email: r.email, role: r.role, equipe: r.equipe || '', ativo: r.ativo });

export const authRouter = Router();

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

// Lista de usuários (para atribuir responsáveis nas demandas). Qualquer
// usuário autenticado pode ler a lista (apenas dados públicos).
authRouter.get('/api/usuarios', requireAuth, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM usuarios WHERE ativo = TRUE ORDER BY nome');
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
  if (!nome || !email || senha.length < 4) {
    return res.status(400).json({ error: 'Nome, e-mail e senha (mín. 4) são obrigatórios.' });
  }
  try {
    const { rows } = await query(
      `INSERT INTO usuarios (nome, email, senha_hash, role, equipe)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [nome, email, hashSenha(senha), role, equipe]
    );
    res.json(publicUser(rows[0]));
  } catch (e) {
    if (String(e.message).includes('duplicate')) return res.status(409).json({ error: 'E-mail já cadastrado.' });
    res.status(500).json({ error: e.message });
  }
});
