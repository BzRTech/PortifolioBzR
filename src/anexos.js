// Anexos dos requerimentos (escritura, contrato, planta, RG…): PDF, JPG ou PNG,
// até 5 MB cada. O tipo é conferido pelos primeiros bytes do arquivo, não pela
// extensão. Guardados no banco (bytea) com SHA-256; somente inserção.
import crypto from 'crypto';

export const ANEXO_MAX_BYTES = 5 * 1024 * 1024;
export const ANEXOS_POR_ENVIO = 5;
export const ANEXOS_POR_REQUERIMENTO = 15;

const erro = (status, msg) => Object.assign(new Error(msg), { status });

/** Tipo real pelo cabeçalho do arquivo. */
export function tipoPorAssinatura(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

const nomeSeguro = (n) => String(n || 'anexo').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 120) || 'anexo';

/**
 * Converte [{nome, base64}] (base64 puro ou data URL) em arquivos conferidos.
 * Lança 400 com a mensagem do primeiro problema.
 */
export function validarAnexos(lista) {
  if (lista == null) return [];
  if (!Array.isArray(lista)) throw erro(400, 'Anexos inválidos.');
  if (lista.length > ANEXOS_POR_ENVIO) throw erro(400, `Envie no máximo ${ANEXOS_POR_ENVIO} arquivos por vez.`);
  return lista.map((a, i) => {
    const nome = nomeSeguro(a?.nome);
    const b64 = String(a?.base64 || '').replace(/^data:[^;]+;base64,/, '');
    if (!b64) throw erro(400, `Arquivo ${i + 1} vazio.`);
    if (b64.length > Math.ceil(ANEXO_MAX_BYTES / 3) * 4 + 8) throw erro(400, `"${nome}" passa de 5 MB.`);
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) throw erro(400, `"${nome}" está vazio ou corrompido.`);
    if (buf.length > ANEXO_MAX_BYTES) throw erro(400, `"${nome}" passa de 5 MB.`);
    const tipo = tipoPorAssinatura(buf);
    if (!tipo) throw erro(400, `"${nome}" não é PDF, JPG ou PNG.`);
    return { nome, tipo, buf, tamanho: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  });
}

export async function salvarAnexos(db, requerimentoId, arquivos, { por = '', canal = 'portal' } = {}) {
  if (!arquivos.length) return [];
  const ja = (await db.query('SELECT count(*)::int AS n FROM requerimento_anexos WHERE requerimento_id = $1', [requerimentoId])).rows[0].n;
  if (ja + arquivos.length > ANEXOS_POR_REQUERIMENTO) throw erro(400, `Limite de ${ANEXOS_POR_REQUERIMENTO} anexos por solicitação.`);
  const out = [];
  for (const a of arquivos) {
    const { rows } = await db.query(
      `INSERT INTO requerimento_anexos (requerimento_id, nome, tipo_mime, tamanho, sha256, conteudo, enviado_por, canal)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, nome, tipo_mime, tamanho, sha256, enviado_por, canal, created_at`,
      [requerimentoId, a.nome, a.tipo, a.tamanho, a.sha256, a.buf, String(por).slice(0, 160), canal]);
    out.push(mapAnexo(rows[0]));
  }
  return out;
}

export const mapAnexo = (a) => ({ id: a.id, nome: a.nome, tipo: a.tipo_mime, tamanho: a.tamanho, sha256: a.sha256, enviadoPor: a.enviado_por, canal: a.canal, enviadoEm: a.created_at });

export async function listarAnexos(db, requerimentoId) {
  const { rows } = await db.query('SELECT id, nome, tipo_mime, tamanho, sha256, enviado_por, canal, created_at FROM requerimento_anexos WHERE requerimento_id = $1 ORDER BY id', [requerimentoId]);
  return rows.map(mapAnexo);
}

/** Envia o arquivo (inline para PDF/imagem; o nome vai codificado no cabeçalho). */
export function enviarAnexo(res, a) {
  res.set('Content-Type', a.tipo_mime);
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  res.send(a.conteudo);
}
