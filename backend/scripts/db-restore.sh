#!/usr/bin/env bash
# Restore a backup made by scripts/db-backup.sh into an EMPTY database.
#
#   TARGET_DATABASE_URL='postgresql://…' bash scripts/db-restore.sh backups/hackos-<time>.dump
#
# It refuses a database that already holds HackOS tables, so it can never
# write over live data: restore into a new database (a new Supabase project,
# or `CREATE DATABASE` on the same server), check it, and only then point
# the API's DATABASE_URL at it (docs/OPERATIONS.md).
set -euo pipefail

FILE="${1:?usage: db-restore.sh <backup.dump>}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
[ -r "$FILE" ] || { echo "cannot read $FILE" >&2; exit 1; }

TABLES=$(psql "$TARGET_DATABASE_URL" -AtX -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
if [ "$TABLES" != "0" ]; then
  echo "refusing: the target database already has $TABLES tables in public" >&2
  exit 1
fi

# Everything but the schema itself: the target keeps its own public schema
# (and the grants its host gives it), which the dump would otherwise create again.
LIST=$(mktemp)
trap 'rm -f "$LIST"' EXIT
pg_restore --list "$FILE" | grep -v -E ' SCHEMA - public | COMMENT - SCHEMA public ' > "$LIST"
pg_restore --no-owner --no-privileges --exit-on-error --use-list="$LIST" --dbname="$TARGET_DATABASE_URL" "$FILE"

psql "$TARGET_DATABASE_URL" -AtX -c "
  SELECT 'restored: migrations up to ' || (SELECT max(version) FROM schema_migrations)
      || ', users ' || (SELECT count(*) FROM users)
      || ', organisations ' || (SELECT count(*) FROM customers)
      || ', events ' || (SELECT count(*) FROM events)
      || ', participants ' || (SELECT count(*) FROM participants)
      || ', files ' || (SELECT count(*) FROM files)"
