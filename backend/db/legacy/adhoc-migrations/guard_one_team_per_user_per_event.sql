-- Guarantee at the DB level that a user can hold at most one
-- team_members row per event. Backs up the application-level checks
-- in teamInvite.acceptInvite, team.service.joinTeam and
-- team.service.addTeamMember so a race condition can never produce
-- duplicate memberships (the "Yussef in two teams" bug from problem 17).
--
-- IMPORTANT: this file MUST be executed as a single batch. Use one of:
--   * psql:               \i migrations/guard_one_team_per_user_per_event.sql
--   * Supabase SQL editor: paste, then click Run
--   * dbeaver:            "Execute SQL Script" (Alt+X), NOT "Execute statement"
-- Splitting on `;` will mangle the function body. The function below
-- has been deliberately written with NO local variables and NO `;` in
-- its body so that even a naive splitter can't break it any more, but
-- any tool that splits a CREATE FUNCTION at all is still going to fail.

-- 1) Clean up any existing duplicate memberships, keeping the row
--    with the latest joined_at (highest team_id breaks ties). This must
--    run BEFORE the trigger is installed.
WITH ranked AS (
  SELECT tm.ctid,
         tm.user_id,
         t.event_id,
         ROW_NUMBER() OVER (
           PARTITION BY tm.user_id, t.event_id
           ORDER BY tm.joined_at DESC NULLS LAST, tm.team_id DESC
         ) AS rn
  FROM team_members tm
  JOIN teams t ON t.id = tm.team_id
)
DELETE FROM team_members tm
USING ranked r
WHERE tm.ctid = r.ctid
  AND r.rn > 1;

-- 2) Trigger function. The body is a single SQL expression — no
--    DECLARE block, no intermediate variables, no nested semicolons —
--    so SQL editors that split on `;` cannot truncate it.
CREATE OR REPLACE FUNCTION enforce_single_team_per_event()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM team_members tm
    JOIN teams t  ON t.id  = tm.team_id
    JOIN teams nt ON nt.id = NEW.team_id
    WHERE tm.user_id = NEW.user_id
      AND t.event_id = nt.event_id
      AND tm.team_id <> NEW.team_id
  ) THEN
    RAISE EXCEPTION 'User % is already on a team for this event', NEW.user_id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$func$;

-- 3) Install / re-install the trigger.
DROP TRIGGER IF EXISTS trg_team_members_single_team ON team_members;
CREATE TRIGGER trg_team_members_single_team
  BEFORE INSERT OR UPDATE OF user_id, team_id ON team_members
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_team_per_event();
