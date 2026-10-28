-- After importing data with explicit ids (e.g. a Supabase dump), move every
-- SERIAL sequence past the highest existing id so new inserts do not collide.
-- Usage: docker exec -i hackos-postgres psql -U hackos -d hackos < scripts/reset-sequences.sql
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
      FROM pg_class s
      JOIN pg_depend d   ON d.objid = s.oid AND d.deptype = 'a'
      JOIN pg_class t    ON t.oid = d.refobjid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      JOIN pg_namespace n ON n.oid = s.relnamespace
     WHERE s.relkind = 'S' AND n.nspname = 'public'
  LOOP
    EXECUTE format(
      'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %I), 0) + 1, false)',
      r.seq, r.col, r.tbl
    );
    RAISE NOTICE 'reset % (%.%)', r.seq, r.tbl, r.col;
  END LOOP;
END $$;
