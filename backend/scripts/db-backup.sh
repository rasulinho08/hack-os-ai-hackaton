#!/usr/bin/env bash
# A full backup of the database: the `public` schema (everything the API
# keeps, uploaded files included) in pg_dump's custom format, compressed and
# restorable with scripts/db-restore.sh.
#
#   DATABASE_URL='postgresql://…' bash scripts/db-backup.sh [out-dir]
#
# Take one before every deploy that brings migrations, besides the daily
# backups the database host makes. On Supabase use the session pooler
# (port 5432) or the direct connection; the transaction pooler (6543) cannot
# run pg_dump. pg_dump must be at least the server's major version.
#
# The file holds personal data and password hashes: keep it out of git and
# off shared drives, in storage only you can read, and delete old ones.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
FILE="$OUT_DIR/hackos-$(date -u +%Y%m%dT%H%M%SZ).dump"

umask 077
pg_dump --format=custom --schema=public --no-owner --no-privileges --file="$FILE" "$DATABASE_URL"

# A file pg_restore cannot read is no backup.
TABLES=$(pg_restore --list "$FILE" | grep -c " TABLE DATA " || true)
if [ "$TABLES" -eq 0 ]; then
  echo "backup has no table data: $FILE" >&2
  exit 1
fi
echo "$FILE  $(du -h "$FILE" | cut -f1)  $TABLES tables"
