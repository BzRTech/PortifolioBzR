# Portal do Cidadão (`/cidadao`)

No portal, o munícipe:
- vê os imóveis cadastrados no seu CPF/CNPJ;
- emite certidões e declarações na hora;
- faz solicitações à prefeitura, com anexos, e acompanha cada uma pelo protocolo.

## Por que o CPF sozinho não basta

CPF não é segredo: ele aparece em nota fiscal, boleto e cadastro de loja. Se o portal mostrasse imóveis só com o CPF, qualquer pessoa veria o patrimônio imobiliário de outra. Isso é um vazamento de dado pessoal (LGPD) e um risco real de golpe. Por isso a entrada pede uma **segunda prova**, e a prefeitura escolhe quais aceita em `PORTAL_ENTRADA`:

| Entrada | Como prova que é a pessoa | Força | Precisa de |
|---|---|---|---|
| **gov.br** | O CPF vem verificado pelo Login Único (OIDC + PKCE). | Alta | Credenciamento da prefeitura no gov.br: `GOVBR_CLIENT_ID` e `GOVBR_CLIENT_SECRET`. |
| **Código por e-mail** | Código de 6 dígitos enviado ao e-mail **que já está no cadastro** do imóvel, nunca a um e-mail digitado na hora. Vale 10 minutos e aceita 5 tentativas. | Média | `SMTP_URL`. Sem SMTP, fora de produção o código aparece na tela (demonstração). |
| **CPF + inscrição** | A inscrição de um dos seus imóveis, que está no carnê do IPTU. | Básica | Nada. É comum em portais de IPTU, mas quem tem o carnê de outra pessoa consegue entrar. |

Recomendação: gov.br como entrada principal, código por e-mail como alternativa, e a inscrição só se a prefeitura aceitar o risco.

### Proteções

- **Sessão separada da equipe.** A sessão do cidadão é assinada com uma chave derivada própria, então não vale nas APIs da equipe (testado). Dura 30 minutos e fica só na aba do navegador (`sessionStorage`).
- **Só os próprios dados.** O cidadão só enxerga e só age sobre os imóveis cujo `contribuinte_doc` é o CPF/CNPJ dele. Documentos e solicitações de outra pessoa respondem 404.
- **Sem revelar quem tem imóvel.** O pedido de código responde a mesma frase tenha o CPF imóvel ou não, e a falha na entrada por inscrição dá a mesma mensagem nos dois casos.
- **Limites de uso:**
  - entradas: 15 a cada 15 minutos por IP;
  - falhas: 5 por hora por CPF e 20 por hora por IP;
  - códigos: 3 por hora por CPF;
  - documentos: 20 por dia por CPF;
  - solicitações: 10 por dia por CPF.
- **gov.br:**
  - o `state` é de uso único e expira em 10 minutos, o PKCE usa S256 e o `nonce` é conferido;
  - o `id_token` é verificado (RS256 pelas chaves públicas do gov.br, emissor, audiência e validade);
  - a sessão volta ao navegador no fragmento da URL (`#t=`), que não chega ao servidor.
- **Anexos:**
  - formatos PDF, JPG ou PNG, conferidos pelo conteúdo do arquivo e não pela extensão;
  - até 5 MB cada, 5 por envio e 15 por solicitação;
  - nome do arquivo saneado;
  - guardados no banco com SHA-256, em tabela somente-inserção;
  - o gestor (perfil somente leitura) não abre anexos.
- **LGPD.** Ficam registrados a entrada, cada documento emitido e cada anexo aberto pela equipe. Documentos emitidos pelo portal guardam `canal = 'portal'` e o CPF de quem emitiu, e continuam imutáveis (trigger).

## O que o cidadão emite sozinho

Por padrão (`PORTAL_DOCUMENTOS`):
- certidão de dados cadastrais;
- declaração de situação cadastral;
- certidão de valor venal;
- certidão de numeração predial;
- declaração de inscrição e CIB;
- certidão de baixa (só para imóvel baixado).

Antes de mostrar o botão, o portal roda as mesmas checagens da emissão no balcão. Quando um documento não pode sair, por exemplo um imóvel ainda sem CIB, o portal mostra o motivo e oferece a solicitação.

> Se o município cobra taxa de expediente por certidão, tire esses tipos de `PORTAL_DOCUMENTOS`. Eles passam a ser pedidos por solicitação, até a integração com a guia de pagamento.

## Solicitações

Assuntos disponíveis:
- certidão que exige análise;
- revisão cadastral;
- transferência (ITBI);
- numeração predial;
- desmembramento ou remembramento;
- baixa;
- reativação;
- vistoria;
- inclusão de imóvel;
- outro assunto.

Cada solicitação recebe protocolo e prazo na hora. Ela cai no **Atendimento** da equipe marcada como 🌐 portal e segue a mesma tramitação do balcão. Quando a equipe marca "pendência documental", o cidadão vê o pedido no portal e envia os documentos por lá, e o envio fica registrado no histórico do protocolo.

## Configuração

```
MODULOS=…,portal
PORTAL_ENTRADA=govbr,email,inscricao
PORTAL_DOCUMENTOS=                       # vazio = padrão acima
GOVBR_CLIENT_ID=…  GOVBR_CLIENT_SECRET=…  GOVBR_AMBIENTE=homologacao|producao
SMTP_URL=smtps://usuario:senha@smtp.prefeitura.gov.br:465
SMTP_FROM="Prefeitura <nao-responda@prefeitura.gov.br>"
```

No credenciamento do gov.br, cadastre como URL de retorno `<PUBLIC_BASE_URL>/api/cidadao/govbr/retorno`. Faça o primeiro teste no ambiente de **homologação** (`GOVBR_AMBIENTE=homologacao`). O fluxo foi testado de ponta a ponta contra um servidor OIDC simulado no formato do gov.br; com as credenciais reais, falta só a validação no ambiente deles.

## Limites conhecidos

- Coproprietários: o portal usa o contribuinte do cadastro (`contribuinte_doc`). Quem é coproprietário sem estar como contribuinte não vê o imóvel e deve pedir a inclusão pela solicitação.
- Débitos de IPTU e certidão negativa de débitos dependem do sistema tributário e ainda não estão no portal.
