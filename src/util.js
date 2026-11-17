// Utilitários das rotas: município da requisição (travado por instância),
// usuário, números, erros e competência.
import { isConfigured } from './db.js';
import { MUNICIPIO_FIXO } from './env.js';
import { normalizarNi } from './ni.js';

export const TZ = 'America/Recife';

/**
 * Município da requisição. Com MUNICIPIO definido (um deploy por prefeitura),
 * é SEMPRE o da instância — qualquer valor vindo do cliente é ignorado.
 */
export const muniDe = (req) => (MUNICIPIO_FIXO || String(req.query?.municipio ?? req.body?.municipio ?? '').trim());
export const nomeUsuario = (req) => String(req.user?.nome || req.body?.usuarioNome || 'Equipe').slice(0, 80);
export const erro = (status, msg, extra = {}) => Object.assign(new Error(msg), { status, ...extra });

export const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
};

export function competenciaDe(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(d);
  return `${p.find((x) => x.type === 'year').value}-${p.find((x) => x.type === 'month').value}`;
}
export const anoAtual = () => Number(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric' }).format(new Date()));

export const rotaAsync = (prefixo) => (fn) => (req, res) => {
  if (!isConfigured) return res.status(503).json({ error: 'Banco não configurado. Defina DATABASE_URL.' });
  Promise.resolve(fn(req, res)).catch((err) => {
    if (!err.status || err.status >= 500) console.error(`[${prefixo}]`, req.method, req.path, err.message);
    res.status(err.status || 500).json({ error: err.message, ...(err.detalhes ? { detalhes: err.detalhes } : {}) });
  });
};

/** Mascara CPF/CNPJ dentro de um objeto de campos (dados_antes/depois, relatórios). */
export function mascararCampos(obj, mascarar) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  if ('contribuinte_doc' in out && out.contribuinte_doc) out.contribuinte_doc = mascarar(normalizarNi(out.contribuinte_doc));
  return out;
}
