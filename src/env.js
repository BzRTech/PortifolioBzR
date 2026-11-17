// Configuração do ambiente e travas de produção.
//
// NODE_ENV=production liga as travas: o boot FALHA (não sobe) se a
// configuração puder expor dados ou misturar dados fictícios com a base real.
// Um deploy de demonstração usa NODE_ENV=demo (ou development).
//
// Decisão de arquitetura (docs/adr/0001-um-deploy-por-prefeitura.md): cada
// prefeitura tem o seu deploy e o seu banco. MUNICIPIO fixa o município da
// instância — a API ignora qualquer outro município vindo do cliente.
export const PRODUCAO = process.env.NODE_ENV === 'production';

const SEGREDOS_FRACOS = new Set(['', 'troque-por-um-segredo-longo-e-aleatorio', 'bzr-dev-secret-troque-em-producao', 'changeme', 'secret']);
const SENHAS_FRACAS = new Set(['', 'bzr1234', 'admin', '123456', '12345678', 'senha', 'password']);
const FLAGS_DEMO = ['CIB_SIMULAR_RETORNO', 'SEED_DEMO', 'SEED_OS_DEMO', 'SEED_DEMANDAS_DEMO', 'SEED_BCI_DEMO', 'SEED_CIB_DEMO'];
export const MODULOS_TODOS = ['territorio', 'cib', 'documentos', 'bci', 'demandas', 'os', 'waze'];

const ligado = (v) => String(process.env[v] || '').toLowerCase() === 'true';

/** Município fixo desta instância (ou '' quando a instância atende vários, só fora de produção). */
export const MUNICIPIO_FIXO = String(process.env.MUNICIPIO || '').trim();

/** Módulos habilitados para o cliente desta instância (MODULOS=cib,documentos,territorio…). */
export function modulosAtivos() {
  const v = String(process.env.MODULOS || '').trim();
  if (!v) return [...MODULOS_TODOS];
  const lista = v.split(/[\s,;]+/).map((x) => x.toLowerCase()).filter((x) => MODULOS_TODOS.includes(x));
  // Waze depende de O.S.
  return lista.filter((m) => m !== 'waze' || lista.includes('os'));
}

/** Simulação de retorno do Sinter (gera CIBs fictícios): nunca em produção. */
export const SIMULACAO_SINTER = !PRODUCAO && ligado('CIB_SIMULAR_RETORNO');
/** Seeds de demonstração: nunca em produção. */
export const demoPermitido = (flag) => !PRODUCAO && ligado(flag);

/**
 * Confere o ambiente. Em produção, devolve a lista de problemas que impedem o
 * boot; fora de produção, devolve avisos.
 */
export function conferirAmbiente(env = process.env) {
  const prod = env.NODE_ENV === 'production';
  const erros = [], avisos = [];
  const problema = (msg) => (prod ? erros : avisos).push(msg);
  if (String(env.AUTH_ENABLED || '').toLowerCase() !== 'true') problema('AUTH_ENABLED precisa ser "true" (login obrigatório).');
  const segredo = String(env.AUTH_SECRET || '');
  if (SEGREDOS_FRACOS.has(segredo) || segredo.length < 32 || new Set(segredo).size < 10) {
    problema('AUTH_SECRET ausente ou fraco: use um valor aleatório com 32+ caracteres (ex.: openssl rand -hex 32).');
  }
  for (const f of FLAGS_DEMO) {
    if (String(env[f] || '').toLowerCase() === 'true') {
      (prod ? erros : avisos).push(`${f}=true é modo demonstração${prod ? ' e não é permitido em produção (mistura dados fictícios com a base real)' : ''}.`);
    }
  }
  if (prod) {
    if (!String(env.MUNICIPIO || '').trim()) erros.push('MUNICIPIO é obrigatório em produção (um deploy por prefeitura).');
    if (!/^https:\/\//.test(String(env.PUBLIC_BASE_URL || ''))) erros.push('PUBLIC_BASE_URL (https://…) é obrigatório em produção: é o endereço impresso no QR dos documentos.');
    if (!String(env.DATABASE_URL || '')) erros.push('DATABASE_URL é obrigatório.');
  }
  return { erros, avisos };
}

/** Senha do admin inicial (usada só quando a tabela de usuários está vazia). */
export function senhaAdminInicial(env = process.env) {
  const s = String(env.ADMIN_PASSWORD || '');
  if (env.NODE_ENV === 'production' && (SENHAS_FRACAS.has(s.toLowerCase()) || s.length < 12)) {
    throw new Error('ADMIN_PASSWORD fraca ou ausente: em produção o admin inicial exige senha com 12+ caracteres.');
  }
  return s || 'bzr1234';
}
