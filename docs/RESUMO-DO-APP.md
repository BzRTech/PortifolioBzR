# BzR — Gestão Pública Municipal · Resumo do app

> Plataforma da **BzR Technology** (geoprocessamento + software) para prefeituras.
> Junta num único sistema o mapa do município, a coleta de campo, a gestão das
> equipes, o cadastro imobiliário integrado ao **Sinter/CIB** e a emissão de
> documentos oficiais com validação pública.
>
> **Lema:** *Menos planilha, mais território.* · **Contato:** Filipe Bezerra da Costa — WhatsApp (83) 99345-4556

---

## 1. Para que serve

A Reforma Tributária (LC nº 214/2025 e IN RFB nº 2.275/2025) deu a cada imóvel do
país um código nacional, o **CIB** ("CPF do imóvel"). A prefeitura é quem fornece
os dados urbanos ao **Sinter**, a base da Receita Federal. Os municípios do interior
têm até **31/12/2026** para integrar o cadastro. Depois disso, a obrigação continua:
cada inclusão, alteração, baixa e reativação de imóvel precisa chegar ao Sinter.

O app resolve as duas pontas:

| Fase | O que entrega |
|------|---------------|
| **Fase 1 — Implantação** (com prazo) | Diagnóstico → Saneamento → Integração → Conciliação → Internalização |
| **Fase 2 — Manutenção contínua** (rotina mensal) | Capturar → Validar → Transmitir → Conciliar → Prestar contas |

E, em volta disso, a gestão do dia a dia da equipe da prefeitura: mapa, campo,
tarefas, ordens de serviço, atendimento ao cidadão e emissão de certidões e declarações.

---

## 2. Módulos (o que existe em cada tela)

| Endereço | Módulo | Resumo |
|----------|--------|--------|
| `/` | **Landing institucional** | Apresentação da BzR, proposta CIB/Sinter (as duas fases), recursos, módulos, diferenciais e contato (WhatsApp/QR). |
| `/territorio` | **Território (WebGIS)** | Mapa de lotes, quadras, ruas, edificações e bairros; ortofoto; mapa de calor; dashboard (vias não pavimentadas, bairros mais populosos, uso do solo). Popup do lote leva ao BCI e ao imóvel/CIB. |
| `/importar` | **Importação de GeoJSON** | Carrega as camadas do município direto pela plataforma (detecção de camada, áreas em m², descarte de dados pessoais). |
| `/cib` | **CIB/Sinter** *(módulo central)* | Cadastro fiscal, implantação em 5 etapas, ciclo mensal, remessas, conciliação, vistoria por IA, PGV, configuração e auditoria. Detalhes na seção 3. |
| `/documentos` | **Documentos e Atendimento** | Protocolo de requerimentos e emissão de 12 modelos de documentos oficiais. Detalhes na seção 4. |
| `/validar` | **Validação pública** | Sem login: o cidadão ou o cartório confere a autenticidade de um documento e acompanha o protocolo. |
| `/bci` | **Cadastro de campo (BCI)** | Boletim de Cadastro Imobiliário com formulário por município, fotos, GPS e fluxo de aprovação. **BCI aprovado entra sozinho no ciclo mensal do Sinter.** |
| `/demandas` | **Demandas da equipe** | Tarefas internas em Kanban, lista, "minhas" e calendário, com prioridade, prazo e responsáveis. Recebe as vistorias agendadas. |
| `/os` | **Ordens de Serviço** | O.S. da Infraestrutura com fotos, histórico, relatórios e buracos reportados no Waze. |
| `/login` | **Login** (opcional) | Três perfis: admin, coordenador e técnico. Vem desligado por padrão. |

---

## 3. CIB/Sinter (`/cib`) — por aba

| Aba | O que faz |
|-----|-----------|
| **Painel** | Imóveis com CIB, pendências, alterações no mês, última remessa, contagem até o prazo legal, o ciclo mensal com as filas de trabalho, mapa do cadastro colorido por situação e últimas movimentações. |
| **Imóveis** | Cadastro fiscal ligando **inscrição ↔ lote do mapa ↔ CIB**, com os campos exigidos pelo Sinter (tipo arquitetônico, destinação, tipo de logradouro, titularidade, CNM). CPF/CNPJ (inclusive alfanumérico) mascarado; ver o completo exige finalidade e fica registrado. **Importação incremental e idempotente** da base do sistema tributário, com relatório do que mudou. |
| **Ciclo mensal** | Registro de eventos (ITBI, alvará, habite-se, BCI, requerimento, manual) e de **parcelamento** (desmembramento/remembramento: baixa das origens + inclusão das novas). "Validar" aplica a mudança no cadastro e coloca na fila da remessa. |
| **Remessas** | Remessa no **leiaute oficial do Sinter** (Manual Operacional 1.17): um registro NDJSON por imóvel (inclusão, alteração ou desativação) em .zip, validado antes de gerar; arquivo congelado com SHA-256; envio pela API do Sinter ou em lote; retorno oficial idempotente; fila de reprocessamento dos rejeitados. |
| **Conciliação** | Divergências apontadas no retorno (Sinter ou cartório): adotar o dado externo, manter o municipal (retransmite com justificativa) ou desconsiderar. |
| **Vistoria IA** | Cruza as edificações extraídas da ortofoto com o cadastro: **edificação nova, ampliação ou possível demolição** viram lista de vistoria. Agendar cria uma demanda de campo, confirmar registra o evento, notificar emite a notificação ao contribuinte. |
| **Implantação** | As 5 etapas com indicadores em tempo real, checklist de adesão ao convênio, raio-x da base (erros e alertas por regra, lacunas, duplicidades) e prazo estimado. Gera o relatório de diagnóstico e as minutas de ofício e termo. |
| **PGV** | Planta Genérica de Valores por **exercício** (rascunho → vigente → encerrado). Publicar recalcula o valor venal da base numa única transação; certidões já emitidas não mudam. |
| **Município** | Dados da prefeitura usados nos documentos e nas remessas: nome oficial, CNPJ, secretaria, brasão, prefeito, responsável técnico, convênio, prazo e transmissores. |
| **Auditoria** | Histórico de tudo: importações, edições (antes → depois), validações, remessas, retornos, conciliações, documentos e etapas — com data e responsável. |
| **Acesso externo** (admin) | Chaves de API por parceiro (cartório, secretarias, Receita Estadual, consórcio) para baixar os dados de cada lote em JSON, GeoJSON ou CSV: escopos, limite por minuto, validade, IPs, revogação e o registro de cada chamada. Documentação para o parceiro em `/api-externa`. |

**Seletor de município (topo):** cada prefeitura tem o seu deploy; quem atende várias troca de prefeitura pelo seletor e cai logado na outra (com `SSO_SECRET`), com o perfil que tem lá.

**Regras de validação para o Sinter**

- **Bloqueiam o envio** (as regras do leiaute oficial): inscrição, tipo do imóvel, área do terreno, tipo e nome do logradouro, CEP (8 dígitos), bairro (até 30), indicador de bairro; para predial, tipo arquitetônico, área construída e destinação; BICE para bem especial.
- **Só alertam:** titular incompleto (não vai ao Sinter), CPF/CNPJ ausente ou inválido, sem CNM/matrícula, sem vínculo com o lote, área divergente da geometria, territorial com área construída.

**Situação de cada imóvel no Sinter:** pendente de correção → pronto → aguardando envio → enviado → conciliado (CIB atribuído), além de *divergente* e *baixado*.

---

## 4. Documentos e Atendimento (`/documentos` e `/validar`)

**Atendimento (protocolo)**
- Requerimento com número `AAAA/NNNNN`, prazo por assunto e tramitação: protocolado → em análise → pendente de documentação → deferido/indeferido → concluído.
- **Ao deferir, o sistema age sozinho:**
  - certidão ou numeração predial → o documento é emitido na hora;
  - revisão cadastral, inclusão, transferência (ITBI), baixa, reativação → vira evento do ciclo mensal (e vai ao Sinter);
  - vistoria → vira demanda para a equipe de campo.
- Comprovante de protocolo com QR para acompanhamento.

**Os 12 modelos de documento**

| Grupo | Documentos |
|-------|------------|
| Certidões | Dados Cadastrais do Imóvel · Numeração Predial · Valor Venal · Baixa de Inscrição |
| Declarações | Inscrição Imobiliária e CIB · Situação Cadastral · Declaração livre |
| Notificações | Notificação para Atualização Cadastral |
| Relatórios | Relatório Mensal de Manutenção (prestação de contas ao gestor) · Relatório de Diagnóstico da Base |
| Ofícios e termos (minutas) | Ofício de Adesão ao Convênio Sinter/CIB · Termo de Indicação de Transmissor PJ |

**Todo documento sai com:** numeração oficial por tipo e ano, conteúdo congelado no momento da emissão, brasão e assinatura do município, **QR + código de validação + hash SHA-256**, validade (nas certidões) e página A4 pronta para imprimir ou salvar em PDF. Erro se corrige cancelando com justificativa e emitindo outro — o cancelamento aparece na validação pública.

**Validação pública (`/validar`):** mostra se o documento é autêntico, íntegro, válido ou cancelado; exibe a versão com CPF/CNPJ mascarado (LGPD) e permite consultar o protocolo pelo número + CPF/CNPJ do requerente.

**Portal do Cidadão (`/cidadao`)** — feito para o celular:
- **Entrar:** CPF/CNPJ + uma segunda prova — gov.br, código de 6 dígitos enviado ao e-mail que já está no cadastro, ou a inscrição de um dos imóveis (carnê do IPTU). A prefeitura escolhe quais aceita.
- **Meus imóveis:** inscrição, endereço, CIB, áreas, valor venal e matrícula de cada imóvel no CPF/CNPJ.
- **Emitir na hora:** certidão de dados cadastrais, situação cadastral, valor venal, numeração predial, declaração do CIB e certidão de baixa — com número, QR e validação, como os emitidos no balcão. Quando um documento não pode sair (ex.: ainda sem CIB), o portal diz por quê.
- **Solicitações:** atualização cadastral, transferência (ITBI), desmembramento, baixa, reativação, numeração predial, vistoria, inclusão de imóvel, certidões que exigem análise e outros — com anexos (PDF/JPG/PNG) e protocolo na hora.
- **Acompanhar:** andamento de cada protocolo, o que a prefeitura pediu ("Aguardando seus documentos") com envio de anexos pelo próprio portal, comprovante e o documento emitido no deferimento.
- **Na prefeitura:** as solicitações caem no Atendimento marcadas como 🌐 portal, com os anexos (abrir um anexo entra no registro LGPD); a equipe também pode anexar documentos digitalizados no balcão.

---

## 5. Como os módulos conversam

```
BCI aprovado ───────────────┐
Requerimento deferido ──────┤
ITBI / alvará / habite-se ──┼──► Ciclo mensal ──► Remessa ──► Sinter
Vistoria IA confirmada ─────┤      (validar)                    │
Edição de imóvel já no Sinter┘                                  ▼
                                         Retorno: CIB atribuído / divergência / rejeição
                                                    │
                                                    ▼
                                    Conciliação ──► Relatório mensal (documento)

Vistoria IA agendada ──► Demanda de campo        Lote no mapa ──► Ficha do imóvel / BCI
Imóvel com CIB ──► Declaração de Inscrição e CIB ──► /validar (público)
```

---

## 6. Perfis e acesso

| Perfil | Pode |
|--------|------|
| **Admin** | Tudo, inclusive usuários (aba Usuários) e o registro de acessos LGPD. |
| **Coordenador** | Remessas, retorno do Sinter, configuração, PGV, emissão e cancelamento de documentos, exportação de arquivos com CPF/CNPJ. |
| **Técnico** | Operar o cadastro, campo, ciclo mensal e atendimento. |
| **Gestor** | **Somente leitura** (prefeito, controle interno): painel, relatórios (prévia do relatório mensal) e documentos, sem CPF/CNPJ completo. |

Em produção o login é **obrigatório** (o servidor não sobe sem ele). Fora de produção pode ficar desligado para demonstração. A página `/validar` é sempre pública, com limite de tentativas.

---

## 7. Tecnologia

| Camada | Tecnologia |
|--------|------------|
| Front-end | HTML + CSS + JavaScript sem build; Leaflet (mapas), Chart.js; modo claro/escuro; tour guiado em cada tela; funciona no celular |
| Back-end | Node.js 18+ com Express |
| Banco | PostgreSQL + PostGIS (Neon em produção) |
| Deploy | Render (`render.yaml`) ou Docker (`Dockerfile`) |
| QR dos documentos | `qrcode-generator` (sem dependências) |

**Estrutura principal**

```
server.js                 servidor: páginas + APIs de todos os módulos
src/
  cib.js                  CIB/Sinter: imóveis, ciclo mensal, remessas, conciliação, vistoria, PGV, painel
  cib-validacao.js        regras de validação Sinter, CPF/CNPJ, máscara LGPD
  documentos.js           protocolo, emissão, validação pública
  doc-templates.js        os 12 modelos de documento (textos editáveis)
  bci.js, demandas.js, os.js, auth.js, queries.js, import.js, schema.js
public/
  index.html              landing        territorio.html   mapa
  cib/  documentos/       módulos novos  validar.html      página pública
  bci/  demandas/  os/    módulos de campo e equipe
scripts/                  seeds de demonstração e importadores
```

---

## 8. Como rodar

```bash
npm install
cp .env.example .env        # cole a DATABASE_URL do Neon
npm run migrate
npm run seed-cib            # demonstração completa (cidade + cadastro + documentos)
npm start                   # http://localhost:3000
```

**Dados de demonstração ("Município Exemplo", fictícios):** 462 imóveis (363 com CIB), 4 remessas, divergências, 25 diferenças para vistoria, requerimentos e documentos já emitidos. No deploy sem terminal, basta `SEED_CIB_DEMO=true`.

**Variáveis de ambiente mais importantes**

| Variável | Para quê |
|----------|----------|
| `DATABASE_URL` | Conexão com o PostgreSQL/PostGIS |
| `AUTH_ENABLED`, `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Login e perfis |
| `SEED_DEMO`, `SEED_CIB_DEMO`, `SEED_BCI_DEMO`, `SEED_DEMANDAS_DEMO`, `SEED_OS_DEMO` | Carregar demonstrações no boot |
| `PUBLIC_BASE_URL` | Endereço usado no QR de validação dos documentos |
| `INSTANCIAS`, `SSO_SECRET` | Troca de município pelo seletor do topo (outras prefeituras da equipe); troca sem nova senha |
| `MODULOS` | Pacote contratado (inclui `api` para o acesso externo e `portal` para o Portal do Cidadão) |
| `PORTAL_ENTRADA`, `PORTAL_DOCUMENTOS`, `GOVBR_*`, `SMTP_URL` | Portal do Cidadão: formas de entrada, documentos de autoatendimento, gov.br e e-mail do código |
| `SINTER_API_URL`, `SINTER_API_TOKEN` | Envio de remessas por API (opcional) |
| `CIB_SIMULAR_RETORNO` | Botão "Simular retorno" — **só para demonstração** |
| `CIB_PRAZO_SINTER`, `CIB_CAPACIDADE_SEMANAL` | Prazo padrão e base da estimativa do diagnóstico |
| `IMPORT_TOKEN`, `ORTHO_TILE_URL`, `WAZE_BQ_*` | Importação, ortofoto e Waze |

---

## 9. Produção e pontos de atenção

- **Um deploy e um banco por prefeitura** (`MUNICIPIO` trava a instância) — `docs/adr/0001-um-deploy-por-prefeitura.md`.
- **Vários municípios:** o seletor do topo leva à instância da outra prefeitura (`INSTANCIAS`). Com `SSO_SECRET`, a troca usa um ticket assinado de 60 s, uso único, só para o destino escolhido; o usuário precisa estar ativo lá e entra com o perfil de lá — `docs/adr/0002-troca-de-municipio.md`.
- **Portal do Cidadão:** CPF/CNPJ + segunda prova (gov.br OIDC com PKCE, código de 6 dígitos no e-mail do cadastro, ou inscrição do carnê); sessão própria de 30 min que não vale nas APIs da equipe; respostas que não revelam se um CPF tem imóvel; limites de tentativas; documentos e anexos imutáveis; cada acesso no registro LGPD — `docs/portal-cidadao.md`.
- **Acesso externo:** API somente leitura `/api/externa/v1` (lotes, imóveis) em JSON/GeoJSON/CSV, chave por parceiro (só o hash fica no banco), escopos, limite por minuto, IPs, validade, revogação e registro de cada chamada. Dados pessoais só com finalidade e validade de até 1 ano, e com registro LGPD.
- **Travas de produção** (`NODE_ENV=production`): sem login, com segredo fraco, sem `MUNICIPIO`/`PUBLIC_BASE_URL` ou com flag de demonstração, o servidor não sobe.
- **Integridade:** documentos, auditoria, acessos LGPD e arquivos de remessa são imutáveis no banco (trigger); hash SHA-256 sobre JCS (RFC 8785); numeração transacional.
- **Migrations** versionadas e **backup com restauração testada** — `docs/operacao.md`.
- **Leiaute oficial:** `docs/sinter-leiaute.md` (Manual Operacional 1.17). A API do Sinter não tem reativação; CNPJ alfanumérico ainda não é aceito em `niTitular` no manual 1.17.
- **Credenciais do Sinter** vêm do convênio de cada prefeitura (`SINTER_CLIENT_ID/SECRET`). O cliente da API foi escrito pelo manual e testado com respostas simuladas; o primeiro envio real deve ser feito no ambiente de **teste** da Receita.
- **Textos dos documentos são modelos de referência** (`src/doc-templates.js`): revisar com a procuradoria de cada município.
- **Rate limit** em memória: vale por instância (adequado a um deploy por prefeitura).
