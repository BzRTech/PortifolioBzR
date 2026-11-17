// Numeração oficial sem duplicidade sob acesso simultâneo.
//
// Um único UPDATE/INSERT … ON CONFLICT … RETURNING trava a linha do contador
// até o fim da transação: duas emissões simultâneas do mesmo tipo/ano
// recebem números diferentes, e um rollback devolve o número (sem buracos
// por erro). As tabelas mantêm índices UNIQUE como rede de segurança.
//   escopo 'documento' — chave = municipio|tipo, reinicia por ano
//   escopo 'protocolo' — chave = municipio, reinicia por ano
//   escopo 'remessa'   — chave = municipio, ano = 0 (sequência contínua)
export async function proximoNumero(db, escopo, chave, ano = 0) {
  const { rows } = await db.query(
    `INSERT INTO numeradores (escopo, chave, ano, ultimo) VALUES ($1, $2, $3, 1)
     ON CONFLICT (escopo, chave, ano) DO UPDATE SET ultimo = numeradores.ultimo + 1
     RETURNING ultimo`,
    [escopo, String(chave), Number(ano) || 0]
  );
  return rows[0].ultimo;
}
