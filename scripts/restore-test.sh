#!/usr/bin/env bash
# Teste de restauração: restaura um backup num banco DESCARTÁVEL e confere
#  - checksum do arquivo, migrations, contagem de linhas por tabela (vs. origem, se informada)
#  - integridade de TODOS os documentos (SHA-256/JCS) e dos arquivos de remessa
# Uso: RESTORE_URL=postgres://.../bzr_restore [ORIGEM_URL=postgres://...] scripts/restore-test.sh backups/arquivo.dump
# ATENÇÃO: RESTORE_URL é apagado e recriado (schema public). Nunca aponte para produção.
set -euo pipefail
ARQ="${1:?informe o arquivo .dump}"
: "${RESTORE_URL:?defina RESTORE_URL (banco descartável)}"
if [ -f "$ARQ.sha256" ]; then sha256sum -c "$ARQ.sha256" >/dev/null && echo "✓ checksum do arquivo confere"; fi
psql "$RESTORE_URL" -qc "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" >/dev/null
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_URL" "$ARQ"
echo "✓ pg_restore concluído"
DIR="$(cd "$(dirname "$0")" && pwd)"
RESTORE_URL="$RESTORE_URL" ORIGEM_URL="${ORIGEM_URL:-}" node "$DIR/verificar-integridade.js"
