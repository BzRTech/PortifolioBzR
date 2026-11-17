#!/usr/bin/env bash
# Backup lógico do banco (pg_dump formato custom) + SHA-256.
# Uso: DATABASE_URL=... scripts/backup.sh [pasta]   (padrão: ./backups)
# O arquivo contém dados pessoais (LGPD): guarde em local com acesso restrito
# e criptografado (ex.: bucket privado com SSE), nunca no repositório.
set -euo pipefail
: "${DATABASE_URL:?defina DATABASE_URL}"
DESTINO="${1:-backups}"
mkdir -p "$DESTINO"
ARQ="$DESTINO/bzr-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-privileges --compress=9 --file="$ARQ" "$DATABASE_URL"
sha256sum "$ARQ" > "$ARQ.sha256"
echo "Backup: $ARQ ($(du -h "$ARQ" | cut -f1)) · $(cut -c1-16 "$ARQ.sha256")…"
