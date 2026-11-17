// Limite de tentativas (anti-enumeração / força bruta) — sem dependências.
//
// Janela deslizante em memória por chave (IP, IP+protocolo, IP+e-mail).
// Responde 429 com Retry-After. Em várias instâncias o limite vale por
// instância; com um deploy por prefeitura (1 instância) isso basta.
// Atrás do proxy do Render, server.js usa `trust proxy` para ler o IP real.
const baldes = new Map();
let ultimaLimpeza = Date.now();

function registrar(chave, janelaMs) {
  const agora = Date.now();
  if (agora - ultimaLimpeza > 60000) {
    for (const [k, v] of baldes) if (!v.length || agora - v[v.length - 1] > 3600000) baldes.delete(k);
    ultimaLimpeza = agora;
  }
  const lista = (baldes.get(chave) || []).filter((t) => agora - t < janelaMs);
  lista.push(agora);
  baldes.set(chave, lista);
  return lista;
}
export function excedeu(chave, { janelaMs, max }) {
  const agora = Date.now();
  const lista = (baldes.get(chave) || []).filter((t) => agora - t < janelaMs);
  return lista.length >= max ? Math.ceil((janelaMs - (agora - lista[0])) / 1000) : 0;
}
/** Conta uma falha (ex.: protocolo+CPF que não bateu). */
export const contarFalha = (chave, janelaMs) => registrar(chave, janelaMs);

/** Middleware: cada requisição conta para a chave. */
export function limitar({ nome, janelaMs, max, chave = (req) => req.ip, mensagem = 'Muitas tentativas. Aguarde e tente novamente.' }) {
  return (req, res, next) => {
    const k = `${nome}:${chave(req)}`;
    const espera = excedeu(k, { janelaMs, max });
    if (espera) { res.set('Retry-After', String(espera)); return res.status(429).json({ error: mensagem, aguardeSegundos: espera }); }
    registrar(k, janelaMs);
    next();
  };
}
export function _zerarLimites() { baldes.clear(); }
