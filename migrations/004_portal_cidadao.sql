-- 004 — Portal do Cidadão: o munícipe entra com CPF/CNPJ + uma segunda prova
-- (gov.br, código por e-mail ou inscrição do carnê), vê os seus imóveis, emite
-- documentos e faz solicitações com anexos.

-- Canal de origem do requerimento e do documento.
ALTER TABLE requerimentos ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'balcao';   -- balcao | portal
ALTER TABLE documentos    ADD COLUMN IF NOT EXISTS canal TEXT NOT NULL DEFAULT 'interno';  -- interno | portal
ALTER TABLE documentos    ADD COLUMN IF NOT EXISTS solicitante_doc TEXT NOT NULL DEFAULT ''; -- CPF/CNPJ de quem emitiu pelo portal

-- O documento continua imutável: as colunas novas entram na comparação.
CREATE OR REPLACE FUNCTION documentos_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF bzr_em_manutencao() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Documento emitido não pode ser excluído (nº %). Cancele com justificativa.', OLD.numero USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'valido' OR NEW.status <> 'cancelado'
     OR NEW.motivo_cancelamento IS NULL OR length(trim(NEW.motivo_cancelamento)) < 5
     OR (NEW.id, NEW.municipio, NEW.tipo, NEW.numero, NEW.seq, NEW.ano, NEW.titulo, NEW.imovel_id, NEW.inscricao,
         NEW.requerimento_id, NEW.interessado, NEW.conteudo, NEW.hash_conteudo, NEW.hash_alg, NEW.codigo_validacao,
         NEW.emitido_por_nome, NEW.emitido_em, NEW.validade, NEW.canal, NEW.solicitante_doc)
        IS DISTINCT FROM
        (OLD.id, OLD.municipio, OLD.tipo, OLD.numero, OLD.seq, OLD.ano, OLD.titulo, OLD.imovel_id, OLD.inscricao,
         OLD.requerimento_id, OLD.interessado, OLD.conteudo, OLD.hash_conteudo, OLD.hash_alg, OLD.codigo_validacao,
         OLD.emitido_por_nome, OLD.emitido_em, OLD.validade, OLD.canal, OLD.solicitante_doc)
  THEN
    RAISE EXCEPTION 'Documento emitido é imutável (nº %): só é permitido cancelar, com motivo.', OLD.numero USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

-- Anexos dos requerimentos (PDF/JPG/PNG, até 5 MB cada). Somente inserção.
CREATE TABLE IF NOT EXISTS requerimento_anexos (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  requerimento_id BIGINT NOT NULL REFERENCES requerimentos(id) ON DELETE RESTRICT,
  nome            TEXT NOT NULL,
  tipo_mime       TEXT NOT NULL,
  tamanho         INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  conteudo        BYTEA NOT NULL,
  enviado_por     TEXT NOT NULL DEFAULT '',
  canal           TEXT NOT NULL DEFAULT 'portal',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_anexo_tamanho CHECK (tamanho > 0 AND tamanho <= 5242880),
  CONSTRAINT ck_anexo_mime CHECK (tipo_mime IN ('application/pdf','image/jpeg','image/png'))
);
CREATE INDEX IF NOT EXISTS ix_anexos_req ON requerimento_anexos (requerimento_id);
DROP TRIGGER IF EXISTS trg_anexos_append ON requerimento_anexos;
CREATE TRIGGER trg_anexos_append BEFORE UPDATE OR DELETE ON requerimento_anexos FOR EACH ROW EXECUTE FUNCTION bzr_somente_insercao();

-- Códigos de acesso enviados por e-mail (só o hash; 10 min; 5 tentativas).
CREATE TABLE IF NOT EXISTS cidadao_codigos (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  municipio   TEXT NOT NULL DEFAULT '',
  doc         TEXT NOT NULL,
  hash_codigo TEXT NOT NULL,
  email       TEXT NOT NULL DEFAULT '',
  tentativas  INTEGER NOT NULL DEFAULT 0,
  expira_em   TIMESTAMPTZ NOT NULL,
  usado_em    TIMESTAMPTZ,
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cidadao_codigos_doc ON cidadao_codigos (municipio, doc, created_at DESC);

-- Busca dos imóveis, solicitações e documentos de um CPF/CNPJ.
CREATE INDEX IF NOT EXISTS ix_imoveis_contribuinte ON imoveis (municipio, contribuinte_doc);
CREATE INDEX IF NOT EXISTS ix_req_requerente ON requerimentos (municipio, requerente_doc);
CREATE INDEX IF NOT EXISTS ix_doc_solicitante ON documentos (municipio, solicitante_doc);
