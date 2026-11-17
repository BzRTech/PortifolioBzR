# ADR 0002 — Troca de município entre instâncias (sem juntar os bancos)

- **Status:** aceita · 17/11/2026
- **Complementa:** [ADR 0001](0001-um-deploy-por-prefeitura.md) (um deploy e um banco por prefeitura)

## Contexto

A equipe da BzR, e também um consórcio ou uma consultoria, atende várias prefeituras. Com um deploy por prefeitura, cada uma tinha um endereço e um login próprios, e quem atende três prefeituras guardava três senhas e três abas. A pergunta foi: "se eu tiver mais de um município, tem como trocar de um para o outro na plataforma?"

## Decisão

Trocar de município **sem juntar os bancos**:

1. **Seletor no topo.** Cada instância lista as outras em `INSTANCIAS` (`Nome=https://endereço; …`). Escolher outra leva o navegador para o endereço dela, na mesma tela (CIB, Documentos ou Território).
2. **Troca sem nova senha (opcional).** Se todas as instâncias tiverem o mesmo `SSO_SECRET`, a origem emite um **ticket** assinado (HMAC-SHA256) com:
   - o e-mail do usuário;
   - o destino exato (`aud`);
   - validade de **60 s**;
   - um identificador único (`jti`), gravado no destino para impedir reúso.

   O destino confere a assinatura, o `aud`, a validade e o `jti`, procura o e-mail **no próprio banco** e emite uma sessão local com o **perfil de lá**.
3. **Quem não está cadastrado no destino não entra.** O ticket só prova quem é a pessoa. A autorização continua sendo de cada prefeitura: o admin de cada uma cadastra quem trabalha nela. A recusa fica na auditoria do destino.
4. **Sem `SSO_SECRET`**, o seletor leva ao login da outra prefeitura.

## Por quê

- Mantém tudo o que motivou o ADR 0001: isolamento por construção, LGPD por prefeitura, credenciais do Sinter por convênio e backup por cliente.
- O segredo de login (`AUTH_SECRET`) continua exclusivo de cada instância, e o boot recusa `SSO_SECRET` igual a ele. Um token de uma prefeitura não abre outra (testado).
- Se o `SSO_SECRET` vazar, um atacante não lê nada sozinho. Ele precisaria saber o e-mail de um usuário ativo em cada prefeitura, e cada entrada fica na auditoria. Para revogar, basta trocar o valor em todas as instâncias.

## Consequências

- O usuário precisa ser cadastrado em cada prefeitura (mesmo e-mail). É intencional: o perfil pode ser técnico numa e gestor noutra.
- Os endereços em `INSTANCIAS` precisam ser `https://` em produção, e a lista deve ser igual em todas as instâncias. Quem estiver fora da lista não recebe ticket.
- Não existe uma visão consolidada com várias prefeituras numa mesma tela. Se for necessária, será um relatório que consulta a API externa de cada instância, não um banco compartilhado.
