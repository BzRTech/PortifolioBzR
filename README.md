# BzR — Gestão Pública Municipal

Plataforma da **BzR Technology** (geoprocessamento + software) para gestão
pública municipal. Reúne, num único sistema, os dois módulos que antes
viviam em repositórios separados:

- **Landing institucional** (`/`) — página pública de apresentação da
  plataforma (CIB/Sinter, recursos, módulos municipais, diferenciais e contato).
- **[CIB/Sinter](#módulo-cibsinter)** (`/cib`) — o módulo central: implantação do
  CIB em 5 etapas e manutenção mensal do cadastro imobiliário integrado ao Sinter.
- **[Documentos e Atendimento](#módulo-documentos-e-atendimento)** (`/documentos`, `/validar`) —
  protocolo de requerimentos e emissão de certidões, declarações, notificações,
  ofícios e relatórios com número oficial, QR e código de validação.
- **[Território](#módulo-território)** (`/territorio`) — WebGIS de **lotes, quadras,
  ruas, edificações e bairros**, com mapa de calor, ortofoto e um dashboard
  de gestão territorial.
- **[Ordens de Serviço](#módulo-ordens-de-serviço)** (`/os`) — gestão de
  **O.S. da Secretaria de Infraestrutura** (abertura, acompanhamento,
  fotos, relatórios) com sincronização de **buracos reportados no Waze**.

Os dois módulos compartilham o mesmo servidor Node/Express, o mesmo banco
PostgreSQL/PostGIS e a mesma identidade visual da BzR.

![Visão geral do WebGIS](docs/screenshot.png)

> Acima, dados de demonstração do módulo Território. Vias pavimentadas em
> verde, não pavimentadas em vermelho; o painel da direita resume os
> indicadores.

## Stack

| Camada    | Tecnologia |
|-----------|------------|
| Front-end | HTML + CSS + JS (ES Modules), [Leaflet](https://leafletjs.com) (render em canvas), Leaflet.heat, [Chart.js](https://www.chartjs.org) — **sem build**, libs em `public/vendor/` |
| Back-end  | Node.js + Express |
| Banco     | PostgreSQL + **PostGIS** (Neon) via `pg` |
| Deploy    | Render (`render.yaml` / `Dockerfile`) |

> Usamos o driver `pg` (e não `@neondatabase/serverless`) porque no Render o
> serviço é um servidor persistente: o `pg` conecta no Neon por TCP+SSL, suporta
> transações e consultas espaciais, e roda igual num Postgres local.

## Estrutura

```
server.js               # Express: estáticos + API dos dois módulos + tiles da ortofoto
src/
  db.js                 # pool de conexão (pg), compartilhado pelos dois módulos
  schema.js             # schema do Território: extensão PostGIS, tabelas e índices
  queries.js            # GeoJSON das camadas, dashboard, mapa de calor, extent
  import.js             # núcleo do importador de GeoJSON (de-para de atributos, LGPD)
  os.js                 # API + schema do módulo de Ordens de Serviço e buracos do Waze
scripts/
  init-db.js            # cria o schema            (npm run init-db)
  seed-demo.js          # cidade de demonstração   (npm run seed)
  import-geojson.js     # importa seus GeoJSON     (npm run import)
  derive-bairros.js     # bairros a partir de quadras/lotes (npm run derive-bairros)
  reset-db.js           # limpa todas as tabelas   (npm run reset-db)
public/
  index.html                                      # landing institucional (raiz do site)
  territorio.html, styles.css, js/, vendor/, assets/  # módulo Território (/territorio)
  os/                                             # módulo Ordens de Serviço (/os)
data/                   # coloque aqui seus .geojson (ver data/README.md)
tiles/                  # tiles XYZ da ortofoto (ver tiles/README.md)
```

## Rodando localmente

Pré-requisitos: Node 18+ e um PostgreSQL com PostGIS (uma conta gratuita no
[Neon](https://neon.tech) já basta).

```bash
npm install
cp .env.example .env        # edite e cole a DATABASE_URL do Neon
npm run migrate             # aplica as migrations (PostGIS, tabelas, índices, travas)
npm run seed                # (opcional) carrega a cidade de demonstração
npm start                   # http://localhost:3000  (landing), /territorio  e  /os
```

As tabelas do módulo de Ordens de Serviço (`ordens_servico`, `waze_buracos`)
são criadas automaticamente no boot, junto com o schema do Território.

## Módulo CIB/Sinter

Implementa o serviço descrito na revista *Território* nº 01 (BzR Technology —
Manutenção CIB/SINTER). A Reforma Tributária (LC nº 214/2025, IN RFB nº 2.275/2025)
deu a cada imóvel um código nacional, o **CIB**; quem fornece os dados urbanos é a
prefeitura, e a obrigação continua depois do prazo: cada inclusão, alteração,
baixa e reativação precisa chegar ao Sinter. Tudo em `/cib/`, por município:

| Aba | O que faz |
|-----|-----------|
| **Painel** | Imóveis com CIB, pendências, alterações no mês, contagem até o prazo, o ciclo mensal com filas de trabalho, mapa do cadastro por status e últimas movimentações. |
| **Imóveis** | Cadastro fiscal (inscrição ↔ lote do CTM ↔ CIB) com os campos do leiaute (tipo arquitetônico, destinação, tipo de logradouro, titularidade, CNM): ficha com pendências, histórico Sinter e documentos; CPF/CNPJ (inclusive **alfanumérico**) mascarado, com acesso registrado; **importação incremental e idempotente** da base do sistema tributário, com relatório do que mudou (também por linha de comando agendada). |
| **Ciclo mensal** | *Capturar → Validar*: eventos de ITBI, alvará, habite-se, BCI, requerimento ou manual; **parcelamento** (baixa das origens + inclusão das novas). Validar aplica no cadastro e põe na fila da remessa. |
| **Remessas** | *Transmitir*: remessa numerada no **leiaute oficial do Sinter** (Manual Operacional 1.17 — NDJSON `{ui, operacao: I/A/D}` em .zip), cada registro validado antes de gerar, arquivo congelado com SHA-256, envio pela API do Sinter (OAuth) ou em lote (idArquivo), retorno oficial (efetivados/rejeitados/falhas) **idempotente** e fila de reprocessamento dos rejeitados. Ver [`docs/sinter-leiaute.md`](docs/sinter-leiaute.md). |
| **Conciliação** | Divergências do retorno (Sinter/cartório): adotar o dado externo, manter o municipal (retransmite) ou desconsiderar — com justificativa. |
| **Vistoria IA** | Cruza a camada de edificações (extraída da ortofoto) com o cadastro: edificação nova, ampliação ou possível demolição viram lista de vistoria; agendar cria demanda de campo, confirmar captura o evento, notificar emite a notificação. |
| **Implantação** | As 5 etapas (Diagnóstico, Saneamento, Integração, Conciliação, Internalização) com indicadores em tempo real, checklist de adesão ao convênio e raio-x da base com prazo estimado. |
| **PGV** | Planta Genérica de Valores **versionada por exercício** (rascunho → vigente → encerrado); publicar recalcula a base numa única transação, com histórico; certidões emitidas não mudam. |
| **Município** | Dados do órgão emissor (brasão, secretaria, assinaturas, convênio, transmissores) usados nos documentos e nas remessas. |
| **Auditoria** | Trilha de tudo: importações, edições (antes → depois), validações, remessas, retornos, conciliações, documentos e etapas. |

Integrações: BCI aprovado vira evento capturado no ciclo mensal; o popup do lote
no Território tem o atalho "Imóvel / CIB"; vistoria agendada cria demanda.
As regras de validação (CPF/CNPJ, logradouro, bairro, áreas, vínculo e área
geométrica do lote, matrícula, CEP) ficam em `src/cib-validacao.js`.

> O CIB e o retorno vêm da Receita Federal. Com as credenciais do convênio
> (`SINTER_CLIENT_ID/SECRET`) o envio e a consulta do retorno são automáticos;
> sem elas, o envio é em lote (arquivo .zip + idArquivo). `CIB_SIMULAR_RETORNO=true`
> gera retornos fictícios **só fora de produção** (CIBs marcados como simulados).

## Produção e operação

- **Um deploy e um banco por prefeitura** — decisão em [`docs/adr/0001-um-deploy-por-prefeitura.md`](docs/adr/0001-um-deploy-por-prefeitura.md); `MUNICIPIO` trava a instância.
- **`NODE_ENV=production` falha o boot** sem login (`AUTH_ENABLED=true`), com `AUTH_SECRET` fraco/ausente, sem `MUNICIPIO`/`PUBLIC_BASE_URL`, ou com qualquer flag de demonstração (`SEED_*_DEMO`, `CIB_SIMULAR_RETORNO`).
- Login em todas as APIs internas (Território e O.S. inclusive); perfis **admin, coordenador, técnico e gestor (somente leitura)**; limite de tentativas no login e nas páginas públicas de validação/protocolo.
- **Migrations versionadas** (`migrations/`, `npm run migrate`), **backup com restauração testada** (`npm run backup` / `npm run restore-test`), documentos e trilhas **imutáveis no banco** (trigger), numeração sem duplicidade (numeradores transacionais).
- **LGPD:** CPF/CNPJ mascarado nas listas e fichas, acesso ao dado completo com finalidade e registro; exportações com CPF só para admin/coordenador.
- Módulos por cliente: `MODULOS=cib,documentos,territorio`.
- Testes: `npm test` (com `TEST_DATABASE_URL`, também os de integração).
- Passo a passo: [`docs/operacao.md`](docs/operacao.md).

## Módulo Documentos e Atendimento

- **Atendimento** (`/documentos/`): requerimentos com protocolo `AAAA/NNNNN`, prazo
  por assunto e tramitação (protocolado → em análise → pendente → deferido/indeferido
  → concluído). **Deferir dispara o efeito**: certidões são emitidas na hora;
  revisão, inclusão, transferência (ITBI), baixa e reativação viram eventos do
  ciclo mensal; vistoria vira demanda de campo. Comprovante de protocolo com QR.
- **Emissão**: 12 modelos — Certidão de Dados Cadastrais, de Numeração Predial, de
  Valor Venal, de Baixa; Declaração de Inscrição e CIB, de Situação Cadastral,
  declaração livre; Notificação para Atualização Cadastral; Relatório Mensal
  (prestação de contas) e Relatório de Diagnóstico; minutas de Ofício de Adesão
  ao Sinter e de Termo de Indicação de Transmissor PJ. Conteúdo congelado na
  emissão, número sequencial por tipo/ano, **código de validação + QR + hash
  SHA-256**, página A4 pronta para imprimir/PDF. Cancelamento só com justificativa.
- **Validação pública** (`/validar`): o cidadão ou o cartório confere autenticidade,
  integridade, validade e cancelamento; vê o documento com CPF/CNPJ mascarado
  (LGPD) e acompanha o protocolo (número + CPF/CNPJ).

Os textos são **modelos de referência** (`src/doc-templates.js`): revise-os com
a procuradoria conforme o Código Tributário e a legislação de cada município.

### Demonstração

```bash
npm run seed-cib              # "Município Exemplo": 462 imóveis, 4 remessas, divergências, vistorias, protocolos e documentos
npm run seed-cib -- --truncate
```

No deploy sem shell: `SEED_CIB_DEMO=true` (carrega a cidade de demonstração do
Território, se faltar, e o cadastro fiscal fictício).

### API — CIB/Sinter e Documentos (principais)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/cib/painel` · `/diagnostico` · `/implantacao` · `/relatorio-mensal` | Indicadores (todas com `?municipio=`) |
| GET/POST | `/api/cib/imoveis` | Lista (filtros `q`, `status`, `regra`…) / cria |
| GET/PUT | `/api/cib/imoveis/:id` | Ficha completa / edita (gera alteração se já está no Sinter) |
| POST | `/api/cib/imoveis/:id/baixa` · `/reativar` · `/api/cib/imoveis/importar` | Baixa, reativação, importação da base |
| GET/POST | `/api/cib/movimentacoes` · `/parcelamento` · `/carga-inicial` | Eventos do ciclo mensal |
| POST | `/api/cib/movimentacoes/:id/validar` · `/validar-lote` | Validar (aplica no cadastro) |
| GET/POST | `/api/cib/remessas` · `/:id/arquivo` · `/:id/enviar` · `/:id/retorno` | Transmissão e retorno |
| GET/POST | `/api/cib/divergencias` · `/:id/resolver` | Conciliação |
| GET/POST/PATCH | `/api/cib/vistorias` · `/detectar` · `/:id` | Vistoria por imagem |
| GET/PUT | `/api/cib/pgv` · `/api/cib/config` · `/api/cib/implantacao` | PGV, município, etapas |
| GET/POST | `/api/requerimentos` · `/:id/tramitar` · `/:id/comprovante` | Protocolo |
| GET/POST | `/api/documentos` · `/:id/html` · `/:id/cancelar` | Emissão e livro de registro |
| GET | `/api/publico/validar/:codigo` · `/api/publico/documento/:codigo` · `/api/publico/protocolo` | Público (sem login) |

Escritas sensíveis (remessas, retorno, configuração, PGV, emissão e cancelamento
de documentos) exigem perfil **admin** ou **coordenador** quando `AUTH_ENABLED=true`.

## Módulo Território

WebGIS para análise territorial de municípios. Visualiza lotes, quadras,
ruas, edificações e bairros a partir de GeoJSON, com mapa de calor,
ortofoto e um dashboard de gestão que responde perguntas como:

- Quantas ruas (e quantos km) **não são pavimentadas**?
- Quais **bairros não possuem pavimentação**?
- Quais são os **bairros mais populosos** (e a densidade)?
- Como está distribuído o **uso do solo** dos lotes?

### Importando dados reais

**Pela plataforma (recomendado):** abra **`/importar`** (botão "Importar" no
topo do mapa), informe o município, arraste seus `.geojson`/`.json` e clique em
**Importar tudo**. A camada de cada arquivo é detectada pelo nome (ajustável),
os dados vão em lotes direto para o banco (nada precisa ser reimplantado) e as
áreas/extensões em metros são calculadas automaticamente. Em produção, proteja
a página definindo `IMPORT_TOKEN` (veja `.env.example`).

**Pela linha de comando:** copie os arquivos para `data/` e rode:

```bash
# 1a cidade (o --municipio marca os dados e habilita o seletor de cidade):
npm run import -- --dir data/ --municipio "Tabira" --truncate

# outra cidade depois (coloque os GeoJSON dela em data/ ou numa subpasta):
npm run import -- --dir data/outra-cidade/ --municipio "Outra Cidade" --truncate
```

Com `--municipio`, o `--truncate` substitui **apenas aquela cidade** (preserva as
demais). Sem `--municipio`, `--truncate` limpa a tabela inteira. Para um GeoJSON
de bairros derivado (quando o município não fornece), use `npm run derive-bairros`.
Para limpar tudo (`npm run reset-db`) ou só uma cidade (`npm run reset-db -- --municipio "Nome"`).

A camada é detectada pelo nome do arquivo (ou use `--layer`). O importador
mapeia as propriedades mais comuns (PT-BR/EN), **descarta campos pessoais
(LGPD) e vazios** e preserva o restante em `props`. As coordenadas devem estar
em **WGS84 (EPSG:4326)**. Quando o município não fornece um GeoJSON de bairros,
`derive-bairros` gera os polígonos a partir do campo `BAIRRO`. Detalhes em
[`data/README.md`](data/README.md).

### Ortofoto (tiles XYZ)

Coloque sua pasta de tiles em `tiles/ortho/{z}/{x}/{y}.png` — com
`SERVE_LOCAL_TILES=true` (padrão) ela é servida automaticamente e aparece como
camada **Ortofoto** no mapa. Para hospedar fora, aponte `ORTHO_TILE_URL`.
Detalhes em [`tiles/README.md`](tiles/README.md).

### API — Território

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Status do banco e versão do PostGIS (sempre 200) |
| GET | `/api/config` | Configuração pública (mapa, ortofoto, camadas) |
| GET | `/api/counts` | Contagem de feições por camada |
| GET | `/api/bairros` | Lista de bairros (para filtros) |
| GET | `/api/extent` | Bounding-box de todos os dados |
| GET | `/api/dashboard` | Indicadores do painel do gestor |
| GET | `/api/heatmap?metric=` | Pontos do mapa de calor (`populacao`, `nao_pavimentadas`, `edificacoes`, `lotes`) |
| GET | `/api/layers/:layer` | Camada em GeoJSON (`bbox`, `bairro`, `limit`, `simplify`, `props`) |

Camadas válidas: `bairros`, `quadras`, `lotes`, `ruas`, `edificacoes`.

## Módulo Ordens de Serviço

Gestão de ordens de serviço da Secretaria de Infraestrutura: abertura com
fotos, acompanhamento por status (aberta → validada → andamento →
concluída/cancelada), histórico, importação em lote via CSV, exportação e
um dashboard de indicadores. Inclui também a sincronização de **buracos
reportados no Waze** (via BigQuery), exibidos num mapa próprio
(`/os/dashboard-waze.html`).

Interface **dark** e responsiva (celular e desktop), servida em `/os` (app
principal), com dois relatórios em janelas próprias: `/os/dashboard.html` e
`/os/dashboard-waze.html`.

### Dados de demonstração (apresentação ao cliente)

Para mostrar o módulo com dados fictícios antes dos reais, carregue 10 O.S. de
demonstração (João Pessoa, com coordenadas para aparecerem no mapa):

```bash
npm run seed-os              # recusa se já houver O.S. no banco
npm run seed-os -- --truncate # substitui o que existir por dados de demonstração
```

No deploy, sem shell, defina `SEED_OS_DEMO=true`: no boot, se **não houver
nenhuma O.S.**, o servidor carrega as ordens de demonstração automaticamente
(não apaga dados existentes). Volte para `false` ao operar com dados reais.

### Waze / BigQuery (opcional)

A sincronização com o Waze depende de uma tabela no BigQuery. Configure
`WAZE_BQ_PROJECT`, `WAZE_BQ_DATASET`, `WAZE_BQ_TABLE` e `WAZE_BQ_LOCATION`
(veja `.env.example`). Sem essas variáveis, o módulo de O.S. funciona
normalmente — apenas a sincronização com o Waze fica indisponível. O token
OAuth é informado na própria tela (`gcloud auth print-access-token`) e usado
só no momento da sincronização; os dados sincronizados ficam salvos no banco.

### API — Ordens de Serviço

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/ping` | Testa a conexão com o banco |
| GET | `/api/diagnostico` | Esquema real da tabela `ordens_servico` (depuração) |
| GET | `/api/proximo-numero` | Próximo número sequencial de O.S. do ano |
| GET | `/api/ordens` | Lista todas as ordens de serviço |
| GET | `/api/ordens/:id` | Detalhe de uma ordem (com fotos) |
| POST | `/api/ordens` | Abre uma nova ordem de serviço |
| POST | `/api/ordens/importar` | Importa até 2000 ordens em lote (CSV processado no front) |
| PUT | `/api/ordens/:id` | Atualiza status, responsável, fotos, histórico etc. |
| DELETE | `/api/ordens/:id` | Remove uma ordem de serviço |
| POST | `/api/waze/token` | Sincroniza o BigQuery → banco com um token OAuth |
| GET | `/api/waze/config` | Configuração atual do BigQuery (sem expor o token) |
| GET | `/api/waze/buracos` | Buracos sincronizados (filtros: `dataInicio`, `dataFim`, `minRelatos`, `rua`) |

## Módulo Demandas

Gestão de tarefas internas da equipe (PD/CTM), em `/demandas`: prioridade,
status (**Pendente → Em andamento → Concluída/Cancelada**), múltiplos
responsáveis, prazo e vínculo opcional a município/lote. Quatro visões —
**Quadro (Kanban** com arrastar), **Lista**, **Minhas** e **Calendário** — mais
resumo e modal de criar/editar. Interface dark e responsiva.

Demonstração: `npm run seed-demandas` (ou `SEED_DEMANDAS_DEMO=true` no boot).

## Módulo Cadastro (BCI)

Coleta de campo do **Boletim de Cadastro Imobiliário**, em `/bci`, vinculada aos
**lotes** do Território. Formulário **dinâmico e versionável por município**
(padrão: o BCI oficial de Malta-PB, 9 seções / 68 campos), com **fotos**
(geral/croqui), **captura de GPS**, **fluxo de aprovação**
(Rascunho → Enviado → Aprovado/Rejeitado → Arquivado) e o sinal de **ajuste de
geometria** (o técnico marca que a divisa do lote precisa fundir/desmembrar/
redesenhar; o coordenador resolve). A lista traz um mapa dos pontos coletados
coloridos por status, e o popup de cada lote no Território tem um atalho
"Preencher BCI".

Demonstração: `npm run seed-bci` (ou `SEED_BCI_DEMO=true` no boot).

### Login e perfis (opcional)

Os módulos Demandas e BCI já preveem 3 perfis (**admin/coordenador/técnico**),
mas o login vem **desligado** por padrão (`AUTH_ENABLED=false`): tudo abre sem
autenticar e a tabela de usuários serve só como diretório de responsáveis.
Ligue `AUTH_ENABLED=true` para exigir login (tela `/login`) e aplicar os perfis
— útil para o fluxo real de aprovação do BCI. Defina também `AUTH_SECRET` e,
opcionalmente, `ADMIN_EMAIL`/`ADMIN_PASSWORD` (contas de demonstração são
criadas no primeiro boot).

### API — Demandas e BCI (principais)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST | `/api/demandas` | Lista (filtros) / cria demanda |
| PUT/DELETE | `/api/demandas/:id` | Atualiza / remove |
| PATCH | `/api/demandas/:id/status` | Transição de status (Kanban) |
| GET | `/api/bci/formulario?municipio=` | Definição do formulário (seções/campos) |
| GET/POST | `/api/bci` | Lista (filtros) / cria BCI |
| GET/PUT/DELETE | `/api/bci/:id` | Detalhe / atualiza / remove |
| PATCH | `/api/bci/:id/status` | Fluxo: `enviar`/`aprovar`/`rejeitar`/`arquivar`/`reabrir` |
| PATCH | `/api/bci/:id/ajuste` | Marca o ajuste de geometria como resolvido |
| POST/DELETE | `/api/bci/:id/fotos[/:fid]` | Anexa / remove fotos |
| GET | `/api/bci/mapa` | Pontos coletados (para o mapa) |

## Deploy no Render

1. Crie um banco no **Neon** e copie a connection string (com `?sslmode=require`).
2. No Render, crie o serviço a partir deste repositório (Blueprint usando o
   `render.yaml`, ou Docker usando o `Dockerfile`).
3. Defina `DATABASE_URL` (e, opcionalmente, `ORTHO_TILE_URL` e as variáveis
   `WAZE_BQ_*`). Para subir já com o demo do Território, use `SEED_DEMO=true`
   (carrega no primeiro boot se o banco estiver vazio).

O schema (Território + Ordens de Serviço) é criado automaticamente no boot.
Health check em `/api/health`.

## Licença

MIT — © BzR Technology
