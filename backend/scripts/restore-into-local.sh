#!/usr/bin/env bash
# Load a production data dump into a scratch local database.
#
#   bash scripts/restore-into-local.sh ../backups/supabase-data.sql [dbname]
#
# Gives you a throwaway copy of production to test destructive changes against,
# so migrations and fixes are rehearsed before they touch the real database.
#
# The dump is data-only, so the order matters: the schema has to exist first,
# and constraints that legacy rows violate have to be lifted for the load and
# put back afterwards. Doing it the other way round makes one bad row cascade
# into thousands of foreign-key failures.
set -euo pipefail
export MSYS_NO_PATHCONV=1

DUMP="${1:?usage: restore-into-local.sh <dump.sql> [dbname]}"
DB="${2:-hackos_audit}"
CONTAINER="${PG_CONTAINER:-hackos-postgres}"
PGUSER="${PGUSER:-hackos}"
PGPASS="${PGPASS:-hackos_dev_password}"
HOST_URL="postgresql://$PGUSER:$PGPASS@host.docker.internal:5432/$DB"
LOCAL_URL="postgresql://$PGUSER:$PGPASS@localhost:5432/$DB"
DUMP_DIR="$(cd "$(dirname "$DUMP")" && pwd)"
DUMP_FILE="$(basename "$DUMP")"
# /c/Users/... -> C:/Users/... so Docker on Windows accepts the mount
DUMP_MOUNT="$(echo "$DUMP_DIR" | sed 's|^/\([a-z]\)/|\1:/|')"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

psql_run() { docker run --rm postgres:17-alpine psql "$HOST_URL" -q "$@"; }

echo "==> recreating $DB"
docker exec "$CONTAINER" psql -U "$PGUSER" -d postgres -q \
  -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB OWNER $PGUSER;" 2>&1 | grep -v NOTICE || true

echo "==> applying migrations"
# `npm --prefix` chokes on MSYS-style paths on Windows, so change directory instead.
( cd "$HERE/.." && DATABASE_URL="$LOCAL_URL" node src/db/migrate.js 2>&1 | tail -2 )

echo "==> preparing for a legacy dump"
# Columns the old database had and this schema dropped: re-add them so the
# INSERTs parse, then drop them again once the data is in.
psql_run -c "ALTER TABLE events ADD COLUMN IF NOT EXISTS invite_only_registration boolean;"
# Legacy rows carry values these CHECKs reject (e.g. a role of 'judge\n').
psql_run -c "
  ALTER TABLE users         DROP CONSTRAINT IF EXISTS users_role_allowed;
  ALTER TABLE participants  DROP CONSTRAINT IF EXISTS participants_status_allowed;
  ALTER TABLE teams         DROP CONSTRAINT IF EXISTS teams_status_allowed;
  ALTER TABLE event_invites DROP CONSTRAINT IF EXISTS event_invites_role_check;
  ALTER TABLE team_invites  DROP CONSTRAINT IF EXISTS team_invites_status_allowed;"

echo "==> loading $DUMP_FILE"
docker run --rm -v "$DUMP_MOUNT:/in" postgres:17-alpine \
  psql "$HOST_URL" -v ON_ERROR_STOP=0 -q -f "/in/$DUMP_FILE" > /tmp/restore.log 2>&1 || true
echo "    errors: $(grep -ci 'ERROR' /tmp/restore.log || echo 0)   (orphaned rows in the source dump are expected)"

echo "==> normalising and restoring constraints"
W="E' \\t\\r\\n'"
psql_run -c "
  UPDATE users         SET role   = btrim(role,   $W) WHERE role   <> btrim(role,   $W);
  UPDATE participants  SET status = btrim(status, $W) WHERE status <> btrim(status, $W);
  UPDATE teams         SET status = btrim(status, $W) WHERE status <> btrim(status, $W);
  UPDATE event_invites SET role   = btrim(role,   $W) WHERE role   <> btrim(role,   $W);
  UPDATE team_invites  SET status = btrim(status, $W) WHERE status <> btrim(status, $W);"
psql_run -c "
  ALTER TABLE users         ADD CONSTRAINT users_role_allowed CHECK (role IN ('admin','org_admin','hacker','pending','mentor','judge','volunteer'));
  ALTER TABLE participants  ADD CONSTRAINT participants_status_allowed CHECK (LOWER(status) IN ('pending','approved','rejected','eliminated','waitlisted'));
  ALTER TABLE teams         ADD CONSTRAINT teams_status_allowed CHECK (LOWER(status) IN ('active','eliminated'));
  ALTER TABLE event_invites ADD CONSTRAINT event_invites_role_check CHECK (role IN ('hacker','mentor','judge','volunteer'));
  ALTER TABLE team_invites  ADD CONSTRAINT team_invites_status_allowed CHECK (status IN ('pending','accepted','declined','cancelled'));"
psql_run -c "ALTER TABLE events DROP COLUMN IF EXISTS invite_only_registration;"

echo "==> resetting sequences"
docker run --rm -v "$(echo "$HERE" | sed 's|^/\([a-z]\)/|\1:/|'):/s" postgres:17-alpine \
  psql "$HOST_URL" -q -f /s/reset-sequences.sql > /dev/null 2>&1

echo "==> done"
docker exec "$CONTAINER" psql -U "$PGUSER" -d "$DB" -t -c \
  "SELECT '    users='||(SELECT count(*) FROM users)
        ||' events='||(SELECT count(*) FROM events)
        ||' teams='||(SELECT count(*) FROM teams)
        ||' team_members='||(SELECT count(*) FROM team_members)
        ||' participants='||(SELECT count(*) FROM participants)
        ||' submissions='||(SELECT count(*) FROM submissions)
        ||' scores='||(SELECT count(*) FROM scores);"
echo
echo "    DATABASE_URL=$LOCAL_URL"
