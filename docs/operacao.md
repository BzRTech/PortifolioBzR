# Operação em produção

## Subir uma prefeitura (um deploy por prefeitura — ver `docs/adr/0001`)

Variáveis obrigatórias com `NODE_ENV=production` (sem elas o servidor **não sobe**):

| Variável | Regra |
|----------|-------|
| `AUTH_ENABLED` | `true` |
| `AUTH_SECRET` | aleatório, 32+ caracteres (`openssl rand -hex 32`) |
| `MUNICIPIO` | nome do município da instância |
| `PUBLIC_BASE_URL` | `https://…` (vai no QR dos documentos) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | admin inicial; senha com 12+ caracteres (só no 1º boot) |

Bloqueados em produção: `CIB_SIMULAR_RETORNO`, `SEED_DEMO`, `SEED_OS_DEMO`, `SEED_DEMANDAS_DEMO`, `SEED_BCI_DEMO`, `SEED_CIB_DEMO` (boot falha) e os scripts de seed/`reset-db` (saem com erro). Um ambiente de demonstração usa `NODE_ENV=demo`.

Opcionais: `MODULOS=cib,documentos,territorio,api` (pacote contratado), `INSTANCIAS` e `SSO_SECRET` (troca de município — ver abaixo), `SINTER_AMBIENTE=teste|producao`, `SINTER_CLIENT_ID`, `SINTER_CLIENT_SECRET`, `MAPA_ZOOM_DETALHE`, `MAPA_LIMITE_FEICOES`, `MAPA_MAX_FEICOES`.

## Banco: migrations

```bash
npm run migrate            # aplica o que falta (também roda no boot)
npm run migrate:status
npm run migrate:nova -- descricao_da_mudanca
```

Migrations ficam em `migrations/NNN_nome.sql`, rodam em transação, com advisory lock, e **não podem ser editadas depois de aplicadas** (checksum). Bancos anteriores às migrations são adotados automaticamente.

## Backup e restauração (testada)

```bash
DATABASE_URL=… npm run backup -- /caminho/seguro
RESTORE_URL=postgres://…/descartavel ORIGEM_URL=$DATABASE_URL npm run restore-test -- /caminho/seguro/bzr-AAAAMMDDTHHMMSSZ.dump
```

O teste restaura num banco descartável e confere checksum do arquivo, contagem de linhas por tabela contra a origem, o SHA-256/JCS de **todos** os documentos e arquivos de remessa e a presença das travas de imutabilidade. Rode após cada mudança de schema e ao menos mensalmente. O arquivo contém dados pessoais: guarde criptografado, com acesso restrito, fora do repositório. O Neon também oferece restauração point-in-time — use as duas.

## Rotina mensal

1. **Importar a base do sistema tributário** (pode ser agendado): `npm run importar-base -- --arquivo base.csv [--completa]`. Idempotente; relatório por importação na tela.
2. Validar a fila do ciclo mensal → preparar remessa → enviar (API ou lote) → consultar/importar retorno.
3. Reprocessar rejeitados; resolver divergências.
4. Emitir o **Relatório Mensal** (o gestor vê a prévia sem emitir).

## Imutabilidade e trilhas

`documentos` (só cancelamento com motivo), `cib_auditoria`, `lgpd_acessos` e `cib_remessa_arquivos` são protegidos por **trigger** no banco. Scripts de manutenção liberam com `SET LOCAL bzr.manutencao = 'on'` dentro de uma transação — a aplicação nunca faz isso. Hash dos documentos: SHA-256 sobre o JCS (RFC 8785) do conteúdo (`hash_alg = sha256/jcs-rfc8785`).

## Testes

```bash
npm test                                   # unidade (validação, leiaute, retorno, ambiente)
TEST_DATABASE_URL=postgres://…/teste npm test   # + integração com banco descartável
```

## Equipe que atende várias prefeituras

Cada prefeitura continua com o seu deploy e o seu banco (ADR 0001). Para trocar de uma para outra pelo seletor do topo:

1. Em **cada** instância, liste as outras em `INSTANCIAS` (ex.: `Patos=https://patos.bzr.app.br; Sousa=https://sousa.bzr.app.br`). A própria pode estar na lista; ela é ignorada.
2. Opcional: defina o **mesmo** `SSO_SECRET` em todas (32+ caracteres, `openssl rand -hex 32`, diferente do `AUTH_SECRET`). Com ele, a troca não pede senha de novo; sem ele, o navegador vai para o login da outra prefeitura.
3. Cadastre o usuário (mesmo e-mail) em cada prefeitura em que ele trabalha, com o perfil daquela prefeitura. Quem não está cadastrado no destino é recusado, e a tentativa fica na auditoria.

Para trocar o `SSO_SECRET` (por exemplo, se vazar), mude o valor em todas as instâncias. Os tickets antigos param de valer na hora; as sessões já abertas continuam, porque cada instância tem o seu próprio `AUTH_SECRET`.

## Acesso externo (API de dados por lote)

- O admin cria uma chave por parceiro em CIB/Sinter → **Acesso externo**, com escopos (`lotes`, `cadastro`, `valores`, `pessoais`), limite por minuto, validade e IPs permitidos. A chave aparece **uma vez**: envie-a ao parceiro por canal seguro.
- O escopo `pessoais` (nome e CPF/CNPJ) exige a finalidade com a base legal e validade de até 1 ano. Cada chamada entra no registro LGPD.
- Toda chamada fica em `api_acessos` (somente inserção). Chaves não se apagam; revogue-as.
- Documentação para o parceiro: `https://<instância>/api-externa`. Para desligar o recurso, tire `api` de `MODULOS`.

## Portal do Cidadão

- Ligue `portal` em `MODULOS` e escolha as entradas em `PORTAL_ENTRADA`. Prefira gov.br, com `GOVBR_CLIENT_ID` e `GOVBR_CLIENT_SECRET` do credenciamento da prefeitura, e código por e-mail, com `SMTP_URL`. Sem SMTP, a entrada por e-mail fica desligada em produção.
- URL de retorno a cadastrar no gov.br: `<PUBLIC_BASE_URL>/api/cidadao/govbr/retorno`. Teste primeiro com `GOVBR_AMBIENTE=homologacao`.
- Para que o cidadão encontre os seus imóveis, o CPF/CNPJ do contribuinte precisa estar correto no cadastro. O raio-x da Implantação aponta os CPFs inválidos ou ausentes. Para a entrada por e-mail, importe também o e-mail do contribuinte.
- Detalhes e modelo de segurança: [`docs/portal-cidadao.md`](portal-cidadao.md).
