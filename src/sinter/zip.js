// Gerador ZIP mínimo (PKZIP, método DEFLATE) — sem dependências.
// O Sinter recebe as UIs por arquivo como um .zip contendo um NDJSON.
import zlib from 'zlib';

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDataHora(d) {
  const tempo = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const data = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { tempo, data };
}

/** Cria um ZIP com os arquivos [{ nome, conteudo (string|Buffer) }]. */
export function criarZip(arquivos, quando = new Date()) {
  const partes = [], central = [];
  let offset = 0;
  const { tempo, data } = dosDataHora(quando);
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const bruto = Buffer.isBuffer(a.conteudo) ? a.conteudo : Buffer.from(a.conteudo, 'utf8');
    const comp = zlib.deflateRawSync(bruto, { level: 9 });
    const crc = crc32(bruto);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(8, 8); local.writeUInt16LE(tempo, 10); local.writeUInt16LE(data, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(bruto.length, 22);
    local.writeUInt16LE(nome.length, 26); local.writeUInt16LE(0, 28);
    partes.push(local, nome, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10); c.writeUInt16LE(tempo, 12); c.writeUInt16LE(data, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(bruto.length, 24);
    c.writeUInt16LE(nome.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(offset, 42);
    central.push(c, nome);
    offset += local.length + nome.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(0, 4); fim.writeUInt16LE(0, 6);
  fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(centralBuf.length, 12); fim.writeUInt32LE(offset, 16); fim.writeUInt16LE(0, 20);
  return Buffer.concat([...partes, centralBuf, fim]);
}

/** Lê um ZIP gerado por criarZip (usado em testes e na conferência). */
export function lerZip(buf) {
  const out = [];
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const metodo = buf.readUInt16LE(p + 8), tam = buf.readUInt32LE(p + 18), crc = buf.readUInt32LE(p + 14);
    const n = buf.readUInt16LE(p + 26), extra = buf.readUInt16LE(p + 28);
    const nome = buf.slice(p + 30, p + 30 + n).toString('utf8');
    const dados = buf.slice(p + 30 + n + extra, p + 30 + n + extra + tam);
    const conteudo = metodo === 8 ? zlib.inflateRawSync(dados) : dados;
    out.push({ nome, conteudo, crcOk: crc32(conteudo) === crc });
    p += 30 + n + extra + tam;
  }
  return out;
}
