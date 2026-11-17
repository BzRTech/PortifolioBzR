// Identificadores: CPF, CNPJ (numérico e ALFANUMÉRICO) e CNM (matrícula).
//
// CNPJ alfanumérico (IN RFB 2.229/2024; Nota Técnica conjunta COCAD/SUARA/RFB
// nº 49/2024), vigente desde julho de 2026: 12 posições alfanuméricas [0-9A-Z]
// (raiz + ordem) + 2 dígitos verificadores numéricos. O DV continua sendo
// módulo 11 com os mesmos pesos; cada caractere vale (código ASCII − 48):
// '0'..'9' → 0..9, 'A' → 17, 'B' → 18, … 'Z' → 42. CNPJs numéricos antigos
// continuam válidos (é o mesmo cálculo). Exemplo oficial: 12.ABC.345/01DE-35.

export const soDigitos = (v) => String(v ?? '').replace(/\D+/g, '');

/** Normaliza CPF/CNPJ: maiúsculas, só [0-9A-Z]. */
export function normalizarNi(v) {
  return String(v ?? '').toUpperCase().replace(/[^0-9A-Z]+/g, '');
}

export function cpfValido(v) {
  const c = soDigitos(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (base) => {
    let s = 0;
    for (let i = 0; i < base.length; i++) s += Number(base[i]) * (base.length + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9)) === Number(c[9]) && dv(c.slice(0, 10)) === Number(c[10]);
}

const valorCnpj = (ch) => ch.charCodeAt(0) - 48;
/** Calcula os 2 DVs de um CNPJ a partir das 12 primeiras posições (numéricas ou alfanuméricas). */
export function dvCnpj(base12) {
  const b = normalizarNi(base12);
  if (!/^[0-9A-Z]{12}$/.test(b)) return null;
  const calc = (s) => {
    const pesos = s.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = s.split('').reduce((acc, ch, i) => acc + valorCnpj(ch) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(b);
  const d2 = calc(b + d1);
  return `${d1}${d2}`;
}

export function cnpjValido(v) {
  const c = normalizarNi(v);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c)) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  return dvCnpj(c.slice(0, 12)) === c.slice(12);
}

export const cnpjAlfanumerico = (v) => /[A-Z]/.test(normalizarNi(v));

/** CPF (11 dígitos) ou CNPJ (14 posições, numérico ou alfanumérico). */
export function niValido(v) {
  const c = normalizarNi(v);
  if (c.length === 11 && /^\d+$/.test(c)) return cpfValido(c);
  if (c.length === 14) return cnpjValido(c);
  return false;
}
export const docValido = niValido;

/** Máscara para listas e páginas públicas (LGPD). */
export function mascararDoc(v) {
  const c = normalizarNi(v);
  if (c.length === 11) return `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**`;
  if (c.length === 14) return `**.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-**`;
  return c ? '***' : '';
}

export function formatarDoc(v) {
  const c = normalizarNi(v);
  if (c.length === 11) return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
  if (c.length === 14) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
  return String(v ?? '');
}

/**
 * CNM — Código Nacional de Matrícula (Provimento CNJ 143/2023): 16 dígitos
 * CCCCCC.L.NNNNNNN-DD (CNS do cartório, livro '2', nº da matrícula, DV).
 * DV pelo módulo 97 base 10 (ISO 7064:2003): o número inteiro mod 97 = 1.
 */
export function cnmValido(v) {
  const c = soDigitos(v);
  if (c.length !== 16) return false;
  if (c[6] !== '2') return false;
  return BigInt(c) % 97n === 1n;
}
/** DV de um CNM a partir das 14 primeiras posições. */
export function dvCnm(base14) {
  const b = soDigitos(base14);
  if (b.length !== 14) return null;
  const dv = 98n - ((BigInt(b) * 100n) % 97n);
  return String(dv).padStart(2, '0');
}
