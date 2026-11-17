-- 002_producao_sinter — estrutura para operar o serviço mensal em produção.
--  * numeradores transacionais (documentos, protocolos, remessas)
--  * documentos imutáveis no banco (trigger) + algoritmo de hash registrado
--  * trilhas append-only (auditoria, acessos LGPD, arquivos de remessa)
--  * campos do leiaute oficial do Sinter (Manual Operacional v1.17) no imóvel
--  * remessa com arquivo congelado, retornos idempotentes, fila de reprocessamento
--  * importação incremental do sistema tributário com relatório
--  * PGV versionada por exercício e histórico de recálculos

-- ---------------------------------------------------------------- numeradores
CREATE TABLE IF NOT EXISTS numeradores (
  escopo  TEXT NOT NULL,              -- 'documento' | 'protocolo' | 'remessa'
  chave   TEXT NOT NULL,              -- municipio|tipo  (ou só municipio)
  ano     INTEGER NOT NULL DEFAULT 0, -- 0 quando a numeração não reinicia por ano
  ultimo  INTEGER NOT NULL,
  PRIMARY KEY (escopo, chave, ano)
);
INSERT INTO numeradores (escopo, chave, ano, ultimo)
  SELECT 'documento', municipio || '|' || tipo, ano, MAX(seq) FROM documentos GROUP BY municipio, tipo, ano
  ON CONFLICT DO NOTHING;
INSERT INTO numeradores (escopo, chave, ano, ultimo)
  SELECT 'protocolo', municipio, split_part(numero, '/', 1)::int, MAX(split_part(numero, '/', 2)::int)
  FROM requerimentos WHERE numero ~ '^\d{4}/\d+$' GROUP BY municipio, split_part(numero, '/', 1)
  ON CONFLICT DO NOTHING;
INSERT INTO numeradores (escopo, chave, ano, ultimo)
  SELECT 'remessa', municipio, 0, MAX(numero) FROM cib_remessas GROUP BY municipio
  ON CONFLICT DO NOTHING;

-- ------------------------------------------------- bloqueio de manutenção (GUC)
-- Só scripts de manutenção/demonstração ligam `SET LOCAL bzr.manutencao = 'on'`.
-- A aplicação nunca liga. Fora disso, as tabelas protegidas abaixo são imutáveis.
CREATE OR REPLACE FUNCTION bzr_em_manutencao() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('bzr.manutencao', true), '') = 'on' $$;

CREATE OR REPLACE FUNCTION bzr_somente_insercao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF bzr_em_manutencao() THEN RETURN COALESCE(NEW, OLD); END IF;
  RAISE EXCEPTION 'Tabela % é somente-inserção (registro de auditoria): % não permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- ------------------------------------------------------- documentos imutáveis
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS hash_alg TEXT NOT NULL DEFAULT 'sha256/jcs-rfc8785';

CREATE OR REPLACE FUNCTION documentos_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF bzr_em_manutencao() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Documento emitido não pode ser excluído (nº %). Cancele com justificativa.', OLD.numero USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Única mudança permitida: cancelamento (valido -> cancelado), uma vez.
  IF OLD.status <> 'valido' OR NEW.status <> 'cancelado'
     OR NEW.motivo_cancelamento IS NULL OR length(trim(NEW.motivo_cancelamento)) < 5
     OR (NEW.id, NEW.municipio, NEW.tipo, NEW.numero, NEW.seq, NEW.ano, NEW.titulo, NEW.imovel_id, NEW.inscricao,
         NEW.requerimento_id, NEW.interessado, NEW.conteudo, NEW.hash_conteudo, NEW.hash_alg, NEW.codigo_validacao,
         NEW.emitido_por_nome, NEW.emitido_em, NEW.validade)
        IS DISTINCT FROM
        (OLD.id, OLD.municipio, OLD.tipo, OLD.numero, OLD.seq, OLD.ano, OLD.titulo, OLD.imovel_id, OLD.inscricao,
         OLD.requerimento_id, OLD.interessado, OLD.conteudo, OLD.hash_conteudo, OLD.hash_alg, OLD.codigo_validacao,
         OLD.emitido_por_nome, OLD.emitido_em, OLD.validade)
  THEN
    RAISE EXCEPTION 'Documento emitido é imutável (nº %): só é permitido cancelar, com motivo.', OLD.numero USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_documentos_imutavel ON documentos;
CREATE TRIGGER trg_documentos_imutavel BEFORE UPDATE OR DELETE ON documentos FOR EACH ROW EXECUTE FUNCTION documentos_imutavel();
DROP TRIGGER IF EXISTS trg_documentos_truncate ON documentos;
CREATE TRIGGER trg_documentos_truncate BEFORE TRUNCATE ON documentos FOR EACH STATEMENT EXECUTE FUNCTION bzr_somente_insercao();
-- imovel_id/requerimento_id eram ON DELETE SET NULL, o que alteraria o documento: passam a RESTRICT.
ALTER TABLE documentos DROP CONSTRAINT IF EXISTS documentos_imovel_id_fkey;
ALTER TABLE documentos ADD CONSTRAINT documentos_imovel_id_fkey FOREIGN KEY (imovel_id) REFERENCES imoveis(id) ON DELETE RESTRICT;
ALTER TABLE documentos DROP CONSTRAINT IF EXISTS documentos_requerimento_id_fkey;
ALTER TABLE documentos ADD CONSTRAINT documentos_requerimento_id_fkey FOREIGN KEY (requerimento_id) REFERENCES requerimentos(id) ON DELETE RESTRICT;

-- --------------------------------------------------------- auditoria e LGPD
DROP TRIGGER IF EXISTS trg_auditoria_append ON cib_auditoria;
CREATE TRIGGER trg_auditoria_append BEFORE UPDATE OR DELETE ON cib_auditoria FOR EACH ROW EXECUTE FUNCTION bzr_somente_insercao();

CREATE TABLE IF NOT EXISTS lgpd_acessos (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipio     TEXT NOT NULL DEFAULT '',
  usuario_id    BIGINT,
  usuario_nome  TEXT NOT NULL DEFAULT '',
  perfil        TEXT NOT NULL DEFAULT '',
  entidade      TEXT NOT NULL,
  entidade_id   BIGINT,
  dado          TEXT NOT NULL,          -- ex.: 'CPF/CNPJ do contribuinte', 'arquivo de remessa'
  finalidade    TEXT NOT NULL DEFAULT '',
  ip            TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lgpd_muni ON lgpd_acessos (municipio, created_at DESC);
DROP TRIGGER IF EXISTS trg_lgpd_append ON lgpd_acessos;
CREATE TRIGGER trg_lgpd_append BEFORE UPDATE OR DELETE ON lgpd_acessos FOR EACH ROW EXECUTE FUNCTION bzr_somente_insercao();

-- ------------------------------------------- imóvel: campos do leiaute Sinter
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS tipo_logradouro      INTEGER;   -- domínio Tipo de Logradouro (1..311)
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS tp_arquitetonico     INTEGER;   -- domínio Tipo Arquitetônico (1..11)
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS destinacao           INTEGER;   -- domínio Destinação do Imóvel
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS bice                 INTEGER;   -- domínio BICE (tipoImovel = 3)
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS tem_bairro           BOOLEAN;
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS titular_tipo         INTEGER;   -- domínio Tipo de Titularidade
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS titular_doc_tipo     INTEGER;   -- domínio Doc Titularidade
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS titular_dt_aquisicao DATE;
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS titular_perc         NUMERIC(5,4);
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS cnm_ri               TEXT NOT NULL DEFAULT '';  -- Código Nacional de Matrícula
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS cns_ri               INTEGER;
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS valor_venal_ano      INTEGER;
ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS cib_simulado         BOOLEAN NOT NULL DEFAULT FALSE;

-- Derivações seguras para a base existente (o restante vem do de-para no saneamento).
UPDATE imoveis SET tem_bairro = (trim(bairro) <> '') WHERE tem_bairro IS NULL;
UPDATE imoveis SET tipo_logradouro = CASE
    WHEN logradouro ~* '^(av\.?|avenida)\s' THEN 26
    WHEN logradouro ~* '^(r\.?|rua)\s' THEN 250
    WHEN logradouro ~* '^(tv\.?|trav\.?|travessa)\s' THEN 273
    WHEN logradouro ~* '^(al\.?|alameda)\s' THEN 10
    WHEN logradouro ~* '^(pc\.?|pça\.?|praça|praca)\s' THEN 215
    WHEN logradouro ~* '^(est\.?|estrada)\s' THEN 117
    WHEN logradouro ~* '^(rod\.?|rodovia)\s' THEN 247
    WHEN logradouro ~* '^(lg\.?|largo)\s' THEN 153
    WHEN logradouro ~* '^(ld\.?|ladeira)\s' THEN 148
    WHEN logradouro ~* '^beco\s' THEN 42
    WHEN logradouro ~* '^viela\s' THEN 297
    WHEN logradouro ~* '^vila\s' THEN 298
    ELSE NULL END
  WHERE tipo_logradouro IS NULL;
UPDATE imoveis SET destinacao = CASE
    WHEN uso ~* 'misto' THEN 14
    WHEN uso ~* 'resid' THEN 1
    WHEN uso ~* 'comerc' THEN 2
    WHEN uso ~* 'servi' THEN 3
    WHEN uso ~* 'indust' THEN 4
    WHEN uso ~* 'institu|p[úu]blic' THEN 9
    WHEN uso ~* 'relig' THEN 8
    WHEN uso ~* 'sa[úu]de' THEN 12
    WHEN uso ~* 'educa|escola' THEN 5
    ELSE NULL END
  WHERE destinacao IS NULL;
UPDATE imoveis SET padrao_construtivo = 'normal' WHERE padrao_construtivo = 'medio';

-- ---------------------------------------- movimentações: desativação e reprocesso
ALTER TABLE cib_movimentacoes ADD COLUMN IF NOT EXISTS desativacao_tipo   INTEGER;  -- 1 Extinção | 2 Nulidade
ALTER TABLE cib_movimentacoes ADD COLUMN IF NOT EXISTS desativacao_motivo INTEGER;  -- domínio Motivos da desativação
ALTER TABLE cib_movimentacoes ADD COLUMN IF NOT EXISTS tentativas         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cib_movimentacoes ADD COLUMN IF NOT EXISTS falhas_sinter      JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE cib_movimentacoes ADD COLUMN IF NOT EXISTS historico          JSONB NOT NULL DEFAULT '[]'::jsonb;
-- Baixas já registradas: motivo "Decisão administrativa" (06) / Extinção (01) como padrão revisável.
UPDATE cib_movimentacoes SET desativacao_tipo = 1, desativacao_motivo = CASE WHEN origem = 'parcelamento' THEN 1 ELSE 6 END
  WHERE tipo = 'baixa' AND desativacao_motivo IS NULL;

-- ------------------------------------------------- remessas, arquivos, retornos
ALTER TABLE cib_remessas ADD COLUMN IF NOT EXISTS leiaute           TEXT NOT NULL DEFAULT 'BzR-Sinter/1.0';
ALTER TABLE cib_remessas ADD COLUMN IF NOT EXISTS id_arquivo_sinter TEXT NOT NULL DEFAULT '';
ALTER TABLE cib_remessas ADD COLUMN IF NOT EXISTS qtd_excluidos     INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS cib_remessa_arquivos (
  remessa_id  BIGINT PRIMARY KEY REFERENCES cib_remessas(id) ON DELETE RESTRICT,
  leiaute     TEXT NOT NULL,
  formato     TEXT NOT NULL DEFAULT 'ndjson',
  conteudo    TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  qtd         INTEGER NOT NULL,
  gerado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_remessa_arquivo_append ON cib_remessa_arquivos;
CREATE TRIGGER trg_remessa_arquivo_append BEFORE UPDATE OR DELETE ON cib_remessa_arquivos FOR EACH ROW EXECUTE FUNCTION bzr_somente_insercao();

CREATE TABLE IF NOT EXISTS cib_retornos (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  remessa_id  BIGINT NOT NULL REFERENCES cib_remessas(id) ON DELETE CASCADE,
  sha256      TEXT NOT NULL,
  origem      TEXT NOT NULL,          -- 'api' | 'arquivo' | 'simulado'
  resumo      JSONB NOT NULL DEFAULT '{}'::jsonb,
  usuario_nome TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (remessa_id, sha256)
);

-- Uma divergência aberta por movimentação e campo (retorno reimportado não duplica).
CREATE UNIQUE INDEX IF NOT EXISTS uq_div_aberta ON cib_divergencias (movimentacao_id, campo) WHERE status = 'aberta' AND movimentacao_id IS NOT NULL;

-- ----------------------------------------------------- importação incremental
CREATE TABLE IF NOT EXISTS cib_importacoes (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipio       TEXT NOT NULL DEFAULT '',
  arquivo_nome    TEXT NOT NULL DEFAULT '',
  arquivo_sha256  TEXT NOT NULL DEFAULT '',
  completa        BOOLEAN NOT NULL DEFAULT FALSE,
  status          TEXT NOT NULL DEFAULT 'em_andamento',   -- em_andamento | concluida
  totais          JSONB NOT NULL DEFAULT '{}'::jsonb,
  colunas         JSONB NOT NULL DEFAULT '[]'::jsonb,
  usuario_nome    TEXT NOT NULL DEFAULT '',
  origem          TEXT NOT NULL DEFAULT 'tela',            -- tela | cli
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalizada_em   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_imp_muni ON cib_importacoes (municipio, created_at DESC);
CREATE TABLE IF NOT EXISTS cib_importacao_itens (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  importacao_id    BIGINT NOT NULL REFERENCES cib_importacoes(id) ON DELETE CASCADE,
  inscricao        TEXT NOT NULL,
  acao             TEXT NOT NULL,          -- novo | alterado | inalterado | erro | ausente
  campos           JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {campo: {antes, depois}} (CPF/CNPJ mascarado)
  mensagem         TEXT NOT NULL DEFAULT '',
  imovel_id        BIGINT,
  movimentacao_id  BIGINT,
  UNIQUE (importacao_id, inscricao)
);
CREATE INDEX IF NOT EXISTS idx_impitem_acao ON cib_importacao_itens (importacao_id, acao);

-- --------------------------------------------------------- PGV por exercício
CREATE TABLE IF NOT EXISTS pgv_exercicios (
  municipio      TEXT NOT NULL DEFAULT '',
  ano            INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'rascunho',  -- rascunho | vigente | encerrado
  ato_legal      TEXT NOT NULL DEFAULT '',
  publicado_em   TIMESTAMPTZ,
  publicado_por  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (municipio, ano)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pgv_vigente ON pgv_exercicios (municipio) WHERE status = 'vigente';
INSERT INTO pgv_exercicios (municipio, ano, status, publicado_em)
  SELECT municipio, MAX(ano), 'vigente', NOW() FROM pgv_valores GROUP BY municipio
  ON CONFLICT DO NOTHING;
ALTER TABLE pgv_valores DROP CONSTRAINT IF EXISTS pgv_valores_municipio_tipo_chave_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pgv_valor ON pgv_valores (municipio, ano, tipo, chave);
UPDATE pgv_valores SET chave = 'normal' WHERE tipo = 'construcao' AND chave = 'medio';

CREATE TABLE IF NOT EXISTS pgv_recalculos (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipio      TEXT NOT NULL DEFAULT '',
  ano            INTEGER NOT NULL,
  qtd_imoveis    INTEGER NOT NULL,
  total_antes    NUMERIC(18,2),
  total_depois   NUMERIC(18,2),
  usuario_nome   TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
UPDATE imoveis i SET valor_venal_ano = e.ano FROM pgv_exercicios e
  WHERE e.municipio = i.municipio AND e.status = 'vigente' AND i.valor_venal_total IS NOT NULL AND i.valor_venal_ano IS NULL;
