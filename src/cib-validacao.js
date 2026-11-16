// Regras de validacao do cadastro imobiliario para o Sinter/CIB.
// Cada regra devolve { codigo, campo, nivel, mensagem }:
//   nivel 'erro'   -> bloqueia o envio ao Sinter (imovel fica "pendente de correcao")
//   nivel 'alerta' -> nao bloqueia, mas aparece no saneamento/diagnostico
// As mesmas regras alimentam o Diagnostico (Fase 1), o Saneamento e a etapa
// "Validar" do ciclo mensal (Fase 2) — uma unica fonte de verdade.

export const soDigitos = (v) => String(v ?? '').replace(/\D+/g, '');

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

export function cnpjValido(v) {
  const c = soDigitos(v);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = base.split('').reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(c.slice(0, 12)) === Number(c[12]) && calc(c.slice(0, 13)) === Number(c[13]);
}

export function docValido(v) {
  const c = soDigitos(v);
  if (c.length === 11) return cpfValido(c);
  if (c.length === 14) return cnpjValido(c);
  return false;
}

/** Mascara para listas e paginas publicas (LGPD): ***.456.789-** / **.345.678/0001-** */
export function mascararDoc(v) {
  const c = soDigitos(v);
  if (c.length === 11) return `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**`;
  if (c.length === 14) return `**.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-**`;
  return c ? '***' : '';
}

export function formatarDoc(v) {
  const c = soDigitos(v);
  if (c.length === 11) return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
  if (c.length === 14) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
  return String(v ?? '');
}

export const REGRAS = {
  INSCRICAO_VAZIA: 'Inscrição imobiliária ausente',
  LOGRADOURO_VAZIO: 'Logradouro ausente',
  NUMERO_VAZIO: 'Número predial ausente (use "S/N" quando não houver)',
  BAIRRO_VAZIO: 'Bairro ausente',
  AREA_TERRENO: 'Área do terreno ausente ou zerada',
  AREA_CONSTRUIDA: 'Imóvel predial sem área construída',
  CONTRIBUINTE_VAZIO: 'Contribuinte (nome) ausente',
  DOC_AUSENTE: 'CPF/CNPJ do contribuinte ausente',
  DOC_INVALIDO: 'CPF/CNPJ do contribuinte inválido',
  SEM_GEOMETRIA: 'Imóvel sem vínculo com lote do CTM (sem geometria)',
  AREA_DIVERGENTE: 'Área do terreno diverge mais de 10% da área geométrica do lote',
  CEP_INVALIDO: 'CEP com formato inválido',
  SEM_MATRICULA: 'Matrícula do cartório não informada',
};

/**
 * Valida um imovel (objeto com as colunas da tabela `imoveis`, mais
 * `lote_area_m2` quando houver lote vinculado).
 */
export function validarImovel(im) {
  const out = [];
  const add = (codigo, campo, nivel) => out.push({ codigo, campo, nivel, mensagem: REGRAS[codigo] });
  const vazio = (v) => v === undefined || v === null || String(v).trim() === '';

  if (vazio(im.inscricao)) add('INSCRICAO_VAZIA', 'inscricao', 'erro');
  if (vazio(im.logradouro)) add('LOGRADOURO_VAZIO', 'logradouro', 'erro');
  if (vazio(im.numero)) add('NUMERO_VAZIO', 'numero', 'alerta');
  if (vazio(im.bairro)) add('BAIRRO_VAZIO', 'bairro', 'erro');
  if (!(Number(im.area_terreno_m2) > 0)) add('AREA_TERRENO', 'area_terreno_m2', 'erro');
  if (im.tipo === 'predial' && !(Number(im.area_construida_m2) > 0)) add('AREA_CONSTRUIDA', 'area_construida_m2', 'erro');
  if (vazio(im.contribuinte_nome)) add('CONTRIBUINTE_VAZIO', 'contribuinte_nome', 'erro');
  if (vazio(im.contribuinte_doc)) add('DOC_AUSENTE', 'contribuinte_doc', 'erro');
  else if (!docValido(im.contribuinte_doc)) add('DOC_INVALIDO', 'contribuinte_doc', 'erro');
  if (!im.lote_id) add('SEM_GEOMETRIA', 'lote_id', 'alerta');
  else if (Number(im.lote_area_m2) > 0 && Number(im.area_terreno_m2) > 0) {
    const dif = Math.abs(Number(im.area_terreno_m2) - Number(im.lote_area_m2)) / Number(im.lote_area_m2);
    if (dif > 0.10) add('AREA_DIVERGENTE', 'area_terreno_m2', 'alerta');
  }
  if (!vazio(im.cep) && soDigitos(im.cep).length !== 8) add('CEP_INVALIDO', 'cep', 'alerta');
  if (vazio(im.matricula_cartorio)) add('SEM_MATRICULA', 'matricula_cartorio', 'alerta');
  return out;
}

export const temErro = (pendencias) => (pendencias || []).some((p) => p.nivel === 'erro');

/** Normaliza DATE do Postgres (Date local do servidor ou string) para 'AAAA-MM-DD'. */
export function isoData(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

/** JSON com chaves ordenadas (o JSONB do Postgres reordena chaves) — base dos hashes de integridade. */
export function jsonCanonico(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : jsonCanonico(x))).join(',')}]`;
  const ks = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${ks.map((k) => `${JSON.stringify(k)}:${jsonCanonico(v[k])}`).join(',')}}`;
}
