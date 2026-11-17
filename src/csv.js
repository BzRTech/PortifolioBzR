// Leitor de CSV usado na importação da base e no retorno do Sinter.
// Aceita ; , ou TAB (detectado pela 1ª linha), aspas com "" escapado, quebras
// de linha dentro de aspas, CRLF e BOM.

export function detectarSeparador(primeiraLinha) {
  const cont = (s) => (primeiraLinha.match(new RegExp(s === '\t' ? '\t' : '\\' + s, 'g')) || []).length;
  return [';', '\t', ','].sort((a, b) => cont(b) - cont(a))[0];
}

export function parseCsv(texto, { separador } = {}) {
  texto = String(texto ?? '').replace(/^﻿/, '');
  const sep = separador || detectarSeparador(texto.split(/\r?\n/)[0] || '');
  const linhas = [];
  let linha = [], cel = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { cel += '"'; i++; }
      else if (c === '"') aspas = false;
      else cel += c;
      continue;
    }
    if (c === '"' && cel === '') aspas = true;
    else if (c === sep) { linha.push(cel); cel = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(cel); linhas.push(linha); linha = []; cel = '';
    } else cel += c;
  }
  if (cel !== '' || linha.length) { linha.push(cel); linhas.push(linha); }
  const cabecalho = (linhas.shift() || []).map((h) => h.trim());
  return { cabecalho, linhas: linhas.filter((l) => l.some((x) => String(x).trim() !== '')), separador: sep };
}

/** Normaliza nome de coluna: minúsculas, sem acento, separadores → _ */
export const normalizarColuna = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Converte linhas em objetos usando um mapa {campo: [aliases]}. */
export function mapearColunas(cabecalho, aliases) {
  return cabecalho.map((h) => {
    const n = normalizarColuna(h);
    return Object.keys(aliases).find((k) => aliases[k].includes(n)) || null;
  });
}

export function csvEscapar(v, sep = ';') {
  const s = v == null ? '' : String(v);
  return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
