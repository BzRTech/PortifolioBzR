-- 003 — Acesso externo (API com chave) e troca de município entre instâncias (SSO).

-- ---------------------------------------------------------------------------
-- Chaves de API para parceiros (cartórios, secretarias, consórcio, Receita
-- Estadual, sistemas da própria prefeitura). Só o hash SHA-256 da chave é
-- guardado: a chave completa aparece UMA vez, na criação.
CREATE TABLE IF NOT EXISTS api_chaves (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipio         TEXT NOT NULL DEFAULT '',
  nome              TEXT NOT NULL,                 -- quem usa (ex.: "Cartório do 1º Ofício")
  prefixo           TEXT NOT NULL UNIQUE,          -- parte pública, identifica a chave nos logs
  hash              TEXT NOT NULL,                 -- sha256 hex da chave completa
  escopos           TEXT[] NOT NULL DEFAULT '{lotes}',
  finalidade        TEXT NOT NULL DEFAULT '',      -- base legal / convênio (obrigatória p/ dados pessoais)
  limite_min        INTEGER NOT NULL DEFAULT 60,   -- requisições por minuto
  ips_permitidos    TEXT[] NOT NULL DEFAULT '{}',  -- vazio = qualquer IP
  criado_por        BIGINT,
  criado_por_nome   TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em         TIMESTAMPTZ,
  revogada_em       TIMESTAMPTZ,
  revogada_por_nome TEXT NOT NULL DEFAULT '',
  motivo_revogacao  TEXT NOT NULL DEFAULT '',
  ultimo_uso_em     TIMESTAMPTZ,
  usos              BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT ck_api_escopos CHECK (escopos <@ ARRAY['lotes','cadastro','valores','pessoais']::text[] AND cardinality(escopos) > 0),
  CONSTRAINT ck_api_limite CHECK (limite_min BETWEEN 1 AND 6000)
);
CREATE INDEX IF NOT EXISTS ix_api_chaves_muni ON api_chaves (municipio, created_at DESC);

-- Chave não se apaga (o histórico de quem acessou depende dela): revoga-se.
CREATE OR REPLACE FUNCTION api_chaves_sem_exclusao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF bzr_em_manutencao() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Chave de API não pode ser apagada: revogue-a.' USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER IF EXISTS trg_api_chaves_del ON api_chaves;
CREATE TRIGGER trg_api_chaves_del BEFORE DELETE ON api_chaves FOR EACH ROW EXECUTE FUNCTION api_chaves_sem_exclusao();

-- Registro de cada chamada externa (somente inserção).
CREATE TABLE IF NOT EXISTS api_acessos (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chave_id    BIGINT REFERENCES api_chaves(id) ON DELETE RESTRICT,
  municipio   TEXT NOT NULL DEFAULT '',
  rota        TEXT NOT NULL,
  parametros  JSONB NOT NULL DEFAULT '{}'::jsonb,
  formato     TEXT NOT NULL DEFAULT 'json',
  status      INTEGER NOT NULL,
  registros   INTEGER NOT NULL DEFAULT 0,
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_api_acessos_chave ON api_acessos (chave_id, created_at DESC);
DROP TRIGGER IF EXISTS trg_api_acessos_append ON api_acessos;
CREATE TRIGGER trg_api_acessos_append BEFORE UPDATE OR DELETE ON api_acessos FOR EACH ROW EXECUTE FUNCTION bzr_somente_insercao();

-- Índices de apoio às consultas externas.
CREATE INDEX IF NOT EXISTS ix_lotes_codigo ON lotes (municipio, codigo);
CREATE INDEX IF NOT EXISTS ix_imoveis_lote ON imoveis (lote_id);
CREATE INDEX IF NOT EXISTS ix_imoveis_atualizado ON imoveis (municipio, updated_at);

-- ---------------------------------------------------------------------------
-- Troca de município (SSO entre instâncias): cada ticket vale uma única vez.
CREATE TABLE IF NOT EXISTS sso_tickets_usados (
  jti        TEXT PRIMARY KEY,
  email      TEXT NOT NULL DEFAULT '',
  origem     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
