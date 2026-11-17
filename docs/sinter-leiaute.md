# Leiaute de envio ao Sinter (CADURB) — como o sistema implementa

**Fonte oficial:** Manual Operacional de Integração do Sinter — Módulo Urbano (Receita Federal/Serpro), **versão 1.17 de 03/11/2026**:
<https://docs.receitafederal.gov.br/sinter/literal/guide/ui/> (Modelo de Dados, Exemplos de Requisição, Domínios, Apêndice 1 — Segurança).

| Item | Implementação |
|------|---------------|
| Registro | Uma linha NDJSON por imóvel: `{"ui": {...}, "operacao": "I" \| "A" \| "D"}` (`src/sinter/leiaute.js`) |
| Inclusão (I) | UI completa: `DadosGeraisImovel`, `EnderecoImovel`, `Titular[]` (se completo), `ServicoRegistroImovel` (se houver CNM) |
| Alteração (A) | `cib` + UI completa no estado atual |
| Desativação (D) | `inscricaoImobiliaria`, `cib`, `tipoDesativacao`, `motivoDesativacao`, `complemento` |
| Arquivo | `.zip` com o NDJSON (`src/sinter/zip.js`), enviado em `POST /api/v1/arquivos/{codigoIbge}` |
| Retorno | `GET /api/v1/{codigoIbge}/arquivo/{idArquivo}/consulta` — efetivados, rejeitados e códigos de falha (`src/sinter/retorno.js`) |
| Token | `POST {base}/v1/keycloak/oidc/token` (client credentials, expira em ~60 s) — `src/sinter/cliente.js` |
| Ambientes | teste `https://api.receitafederal.gov.br/prr-sinter` · produção `https://api.sinter.receitafederal.gov.br` |
| Domínios | 13 tabelas geradas da documentação oficial (`src/sinter/dominios.js`) — 311 tipos de logradouro, 25 códigos de falha etc. |

## Validação antes de gerar

Cada registro é validado contra o modelo de dados (tipos, tamanhos, decimais 12+4 e 18+2, datas `AAAA-MM-DD`, domínios e as regras condicionais do `tipoImovel` — falhas 0011, 0012, 0013, 0014, 0015). Registro com erro **não entra** no arquivo: as movimentações voltam ao ciclo mensal com a falha apontada. O mesmo validador alimenta as pendências do cadastro, então "pronto para o Sinter" significa "passa no leiaute oficial".

## Pontos do manual que exigiram decisão

- **`percTitular` × `percTitularidade`:** a tabela do modelo usa `percTitular`; todos os exemplos, o fluxo e as consultas usam `percTitularidade`. Adotado **`percTitularidade`**.
- **`temBairro`:** fica em `DadosGeraisImovel` (tabela do modelo e falha 0014), embora um exemplo o mostre em `EnderecoImovel`.
- **Reativação:** a API v1.17 só tem I, A e D. A reativação vale no cadastro municipal e abre divergência para tratar com o suporte do Sinter.
- **CNPJ alfanumérico:** o manual 1.17 ainda define `niTitular` como numérico; titular com CNPJ alfanumérico vai só com o nome (o CIB não depende do titular).
- **Grupos opcionais incompletos** (titular sem tipo/documento/data; registro sem CNM) não são enviados — o Sinter descartaria o grupo — e viram alerta no cadastro.

Quando a Receita publicar nova versão, atualize `src/sinter/dominios.js` e `src/sinter/leiaute.js` e rode `npm test` (os testes de leiaute cobrem nomes de campo, regras e formato).
