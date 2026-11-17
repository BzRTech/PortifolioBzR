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
| **Imóveis** | Cadastro fiscal ligando **inscrição ↔ lote do mapa ↔ CIB**. Busca por inscrição, CIB, endereço, contribuinte ou CPF/CNPJ; ficha com pendências, histórico Sinter e documentos; edição, baixa e reativação; **importação da base em CSV** do sistema tributário. |
| **Ciclo mensal** | Registro de eventos (ITBI, alvará, habite-se, BCI, requerimento, manual) e de **parcelamento** (desmembramento/remembramento: baixa das origens + inclusão das novas). "Validar" aplica a mudança no cadastro e coloca na fila da remessa. |
| **Remessas** | Carga inicial, remessa numerada, arquivo JSON/CSV, envio em lote (protocolo) ou por API, hash SHA-256 de cada arquivo e importação do retorno da Receita. |
| **Conciliação** | Divergências apontadas no retorno (Sinter ou cartório): adotar o dado externo, manter o municipal (retransmite com justificativa) ou desconsiderar. |
| **Vistoria IA** | Cruza as edificações extraídas da ortofoto com o cadastro: **edificação nova, ampliação ou possível demolição** viram lista de vistoria. Agendar cria uma demanda de campo, confirmar registra o evento, notificar emite a notificação ao contribuinte. |
| **Implantação** | As 5 etapas com indicadores em tempo real, checklist de adesão ao convênio, raio-x da base (erros e alertas por regra, lacunas, duplicidades) e prazo estimado. Gera o relatório de diagnóstico e as minutas de ofício e termo. |
| **PGV** | Planta Genérica de Valores: R$/m² por bairro (terreno) e por padrão construtivo (construção). Salvar recalcula o valor venal de toda a base. |
| **Município** | Dados da prefeitura usados nos documentos e nas remessas: nome oficial, CNPJ, secretaria, brasão, prefeito, responsável técnico, convênio, prazo e transmissores. |
| **Auditoria** | Histórico de tudo: importações, edições (antes → depois), validações, remessas, retornos, conciliações, documentos e etapas — com data e responsável. |

**Regras de validação para o Sinter**

- **Bloqueiam o envio:** inscrição, logradouro, bairro, área do terreno, área construída (imóvel predial), nome do contribuinte, CPF/CNPJ ausente ou com dígito errado.
- **Só alertam:** número predial, sem vínculo com lote do mapa, área diverge mais de 10% da área do lote, CEP inválido, sem matrícula do cartório.

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
| **Admin** | Tudo, inclusive cadastrar usuários. |
| **Coordenador** | Remessas, retorno do Sinter, configuração, PGV, emissão e cancelamento de documentos, aprovação de BCI. |
| **Técnico** | Consultar, coletar em campo, registrar e validar eventos, protocolar requerimentos. |

O login vem **desligado** (`AUTH_ENABLED=false`): tudo abre sem senha, bom para demonstração. Ligado, aplica os três perfis. A página `/validar` é sempre pública.

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
npm run init-db
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
| `SINTER_API_URL`, `SINTER_API_TOKEN` | Envio de remessas por API (opcional) |
| `CIB_SIMULAR_RETORNO` | Botão "Simular retorno" — **só para demonstração** |
| `CIB_PRAZO_SINTER`, `CIB_CAPACIDADE_SEMANAL` | Prazo padrão e base da estimativa do diagnóstico |
| `IMPORT_TOKEN`, `ORTHO_TILE_URL`, `WAZE_BQ_*` | Importação, ortofoto e Waze |

---

## 9. Pontos de atenção

- **O CIB vem da Receita Federal.** Sem as credenciais do convênio, o envio é por arquivo (enviado no portal do Sinter, com o protocolo informado no app) e o retorno entra por arquivo. O layout do arquivo (`BzR-Sinter/1.0`) precisa ser ajustado ao Manual Operacional oficial.
- **Retorno simulado** gera CIBs fictícios; manter `CIB_SIMULAR_RETORNO=false` em produção.
- **Textos dos documentos são modelos de referência** (`src/doc-templates.js`): cada prefeitura deve revisá-los com a procuradoria, conforme seu Código Tributário.
- **Pendência conhecida:** com o login ligado, o mapa (Território) e as Ordens de Serviço deixam de carregar, porque o BCI e as Demandas exigem login de todas as rotas. Com o login desligado (padrão), não há impacto. A página `/validar` já está corrigida.
