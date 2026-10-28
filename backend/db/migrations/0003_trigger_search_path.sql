-- =============================================================================
-- 0003_trigger_search_path.sql
--
-- Pin search_path on the trigger functions.
--
-- pg_dump emits `SELECT pg_catalog.set_config('search_path', '', false)` at the
-- top of its output, so during a restore every unqualified name inside a
-- function body fails to resolve. `enforce_single_team_per_event` referenced
-- `team_members` and `teams` unqualified, which meant every INSERT into
-- team_members aborted with "relation does not exist" — a restored database
-- silently came back with no team memberships at all.
--
-- Pinning search_path on the function fixes the restore path and also removes
-- the usual search_path-shadowing hazard, where a table of the same name in an
-- earlier schema would be used instead of the intended one.
-- =============================================================================

CREATE OR REPLACE FUNCTION enforce_single_team_per_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.teams t  ON t.id  = tm.team_id
    JOIN public.teams nt ON nt.id = NEW.team_id
    WHERE tm.user_id = NEW.user_id
      AND t.event_id = nt.event_id
      AND tm.team_id <> NEW.team_id
  ) THEN
    RAISE EXCEPTION 'User % is already on a team for this event', NEW.user_id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$fn$;
