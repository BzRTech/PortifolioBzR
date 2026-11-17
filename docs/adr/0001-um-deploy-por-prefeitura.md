# ADR 0001 — Um deploy (e um banco) por prefeitura

- **Status:** aceita · 17/11/2026
- **Contexto do item 7** da revisão de produção: "decidir entre um deploy por prefeitura ou `municipio_id` em todas as tabelas, com isolamento, antes do 2º cliente".

## Decisão

Cada prefeitura cliente tem **o seu próprio deploy e o seu próprio banco PostgreSQL**. A instância é travada no município pela variável **`MUNICIPIO`** (obrigatória em produção): toda rota usa o município da instância e **ignora qualquer município enviado pelo cliente** (`src/util.js → muniDe`, `server.js → muni`). Consórcios de municípios são atendidos com um deploy por município-membro (o consórcio divide o custo, não os dados).

## Por quê

1. **Isolamento forte sem depender de cada consulta.** Com `municipio_id` compartilhado, um único `WHERE` esquecido vaza dados de uma prefeitura para outra — e o código tem módulos legados (O.S., Waze) sem município nas tabelas. Com banco separado, o vazamento entre clientes é impossível por construção.
2. **LGPD e contrato.** Cada prefeitura é **controladora** dos seus dados; a BzR é operadora. Banco próprio dá backup, restauração, exportação ("o dado é da prefeitura, sempre exportável") e encerramento de contrato por cliente, sem tocar nos demais.
3. **Convênio Sinter é por município.** Credenciais da API (`SINTER_CLIENT_ID/SECRET`), código IBGE, transmissores e prazos são de cada município — já são configuração por instância.
4. **Liga/desliga de módulos por cliente** (`MODULOS=`) vem de graça: cada instância vende o pacote contratado.
5. **Custo operacional baixo** no tamanho atual: o `render.yaml` cria a instância; Neon dá um banco por projeto.

## Consequências

- O código **mantém** a coluna `municipio` nas tabelas (já existia), então migrar para multi-inquilino no futuro continua possível — mas, enquanto `MUNICIPIO` estiver definido, ela é fixa.
- Migrations rodam em cada banco no boot (`src/migrate.js`, com advisory lock); deploys diferentes podem estar em versões diferentes por pouco tempo — mantenha os deploys no mesmo commit.
- Usuários existem por instância (um técnico da BzR que atende três prefeituras tem três logins).
- Fora de produção (demonstração), `MUNICIPIO` pode ficar vazio e o seletor de município continua disponível.

## Alternativa descartada

`municipio_id` + vínculo usuário↔município + Row-Level Security no Postgres: mais barato em infraestrutura, mas exige revisão de todas as consultas legadas e um pool com `SET LOCAL` por requisição; o risco de vazamento entre prefeituras não compensa para o número atual de clientes. Reavaliar acima de ~20 prefeituras.
