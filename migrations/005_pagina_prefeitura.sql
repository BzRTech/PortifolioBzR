-- 005 — Página inicial de cada prefeitura (raiz da instância): identidade e
-- informações de atendimento editáveis na aba "Município" do CIB.
ALTER TABLE municipio_config ADD COLUMN IF NOT EXISTS cor_primaria        TEXT NOT NULL DEFAULT '';  -- #RRGGBB
ALTER TABLE municipio_config ADD COLUMN IF NOT EXISTS horario_atendimento TEXT NOT NULL DEFAULT '';
ALTER TABLE municipio_config ADD COLUMN IF NOT EXISTS whatsapp            TEXT NOT NULL DEFAULT '';
ALTER TABLE municipio_config ADD COLUMN IF NOT EXISTS mensagem_inicial    TEXT NOT NULL DEFAULT '';
ALTER TABLE municipio_config ADD COLUMN IF NOT EXISTS aviso               TEXT NOT NULL DEFAULT '';
