// Cliente da API do Sinter (Módulo Urbano / CADURB), conforme o Manual
// Operacional 1.17 e o Apêndice 1 (segurança):
//   token:    POST {base}/v1/keycloak/oidc/token  (client_credentials; expira em ~60 s)
//   arquivo:  POST {base}/api/v1/arquivos/{codigoIbge}   multipart "arquivo" (.zip com NDJSON)
//             → { idArquivo, nomeArquivo, status: "PENDENTE" }
//   consulta: GET  {base}/api/v1/{codigoIbge}/arquivo/{idArquivo}/consulta?pagina=N&qtdeRegistrosPagina=…
//   UI:       GET  {base}/api/v1/ui/{cib}
// Retry só para 5xx, 429 e timeout (máx. 3 tentativas), como orienta o manual.
// Variáveis: SINTER_AMBIENTE (teste|producao), SINTER_CLIENT_ID, SINTER_CLIENT_SECRET,
// SINTER_BASE_URL (opcional, sobrepõe a tabela de ambientes).
export const AMBIENTES = {
  teste: 'https://api.receitafederal.gov.br/prr-sinter',
  producao: 'https://api.sinter.receitafederal.gov.br',
};

export function configSinter(env = process.env) {
  const ambiente = env.SINTER_AMBIENTE === 'producao' ? 'producao' : 'teste';
  return {
    ambiente,
    base: String(env.SINTER_BASE_URL || AMBIENTES[ambiente]).replace(/\/+$/, ''),
    clientId: env.SINTER_CLIENT_ID || '',
    clientSecret: env.SINTER_CLIENT_SECRET || '',
    configurado: Boolean(env.SINTER_CLIENT_ID && env.SINTER_CLIENT_SECRET),
  };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export class ClienteSinter {
  constructor(cfg = configSinter(), { fetchImpl = globalThis.fetch, timeoutMs = 60000 } = {}) {
    this.cfg = cfg; this.fetch = fetchImpl; this.timeoutMs = timeoutMs; this.token = null; this.expira = 0;
  }

  async obterToken() {
    if (this.token && Date.now() < this.expira - 5000) return this.token;
    if (!this.cfg.configurado) throw Object.assign(new Error('Credenciais do Sinter não configuradas (SINTER_CLIENT_ID / SINTER_CLIENT_SECRET).'), { status: 400 });
    const r = await this.fetch(`${this.cfg.base}/v1/keycloak/oidc/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
    });
    if (!r.ok) throw Object.assign(new Error(`Sinter recusou as credenciais (HTTP ${r.status}).`), { status: 502 });
    const j = await r.json();
    this.token = j.access_token;
    this.expira = Date.now() + (Number(j.expires_in) || 60) * 1000;
    return this.token;
  }

  async chamar(caminho, opts = {}, tentativa = 1) {
    const token = await this.obterToken();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    let r;
    try {
      r = await this.fetch(`${this.cfg.base}${caminho}`, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}), Authorization: `Bearer ${token}` }, signal: ctl.signal });
    } catch (e) {
      clearTimeout(t);
      if (tentativa < 3) { await esperar(1000 * 2 ** tentativa); return this.chamar(caminho, opts, tentativa + 1); }
      throw Object.assign(new Error(`Sinter indisponível: ${e.message}`), { status: 504 });
    }
    clearTimeout(t);
    if (r.status === 401 && tentativa < 3) { this.token = null; return this.chamar(caminho, opts, tentativa + 1); }
    if ((r.status >= 500 || r.status === 429) && tentativa < 3) { await esperar(1000 * 2 ** tentativa); return this.chamar(caminho, opts, tentativa + 1); }
    const texto = await r.text();
    let corpo; try { corpo = texto ? JSON.parse(texto) : {}; } catch { corpo = { mensagem: texto }; }
    if (!r.ok) throw Object.assign(new Error(`Sinter HTTP ${r.status}: ${corpo.mensagem || corpo.message || corpo.error || texto.slice(0, 200)}`), { status: 502, corpo });
    return corpo;
  }

  /** Envia o .zip (NDJSON) — serviço de recepção de UIs por arquivo. */
  async enviarArquivo(codigoIbge, zip, nomeArquivo) {
    const form = new FormData();
    form.append('arquivo', new Blob([zip], { type: 'application/zip' }), nomeArquivo);
    return this.chamar(`/api/v1/arquivos/${encodeURIComponent(codigoIbge)}`, { method: 'POST', body: form });
  }

  /** Consulta o processamento de um arquivo, todas as páginas, com as falhas. */
  async consultarArquivo(codigoIbge, idArquivo, { porPagina = 100, maxPaginas = 500 } = {}) {
    const paginas = [];
    for (let pagina = 1; pagina <= maxPaginas; pagina++) {
      const q = new URLSearchParams({ pagina, qtdeRegistrosPagina: porPagina, listarFalhas: 'true' });
      const p = await this.chamar(`/api/v1/${encodeURIComponent(codigoIbge)}/arquivo/${encodeURIComponent(idArquivo)}/consulta?${q}`, { method: 'GET' });
      paginas.push(p);
      if (p.ultimaPagina !== false || !(p.registros || []).length) break;
    }
    return paginas;
  }

  /** Consulta a UI pelo CIB (conferência/conciliação). */
  async consultarUI(cib) {
    return this.chamar(`/api/v1/ui/${encodeURIComponent(cib)}`, { method: 'GET' });
  }
}
