-- =============================================================================
-- 006_team_members_is_leader.sql
-- Idempotent migration: ensure team_members.is_leader exists.
--
-- Background: db_init.sql created the column from day one, but the split
-- migration file 004_create_team_members_table.sql shipped without it. Some
-- environments therefore ended up with no `is_leader` column, which made
-- INSERT INTO team_members (..., is_leader) fail (or, worse, silently leave
-- every row with a NULL flag depending on driver behaviour). Either way,
-- GET /api/teams/mine returned no member flagged as leader and the My Team
-- page rendered "Current lead: —" while the founder was labelled just
-- "hacker" (problem 16). Backfill the flag from teams.leader_id so existing
-- teams become consistent immediately.
-- =============================================================================

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS is_leader BOOLEAN DEFAULT FALSE;

UPDATE team_members tm
   SET is_leader = TRUE
  FROM teams t
 WHERE tm.team_id = t.id
   AND tm.user_id = t.leader_id
   AND COALESCE(tm.is_leader, FALSE) <> TRUE;
