-- =============================================================================
-- 0004_backfill_team_leaders.sql
--
-- Give every team that still has members a leader.
--
-- An older version of removeTeamMember cleared teams.leader_id when the leader
-- left and never handed the role on, so those teams were locked: only the lead
-- may submit a project or manage the roster, and there was no lead. Two teams
-- with four members each were stuck this way, both with a submission already in.
--
-- The leaver logic was fixed in code; this repairs the rows it left behind.
-- Nothing is deleted: the longest-standing remaining member becomes the lead,
-- which is the same rule the code now applies.
-- =============================================================================

WITH candidate AS (
  SELECT DISTINCT ON (tm.team_id)
         tm.team_id,
         tm.user_id
  FROM team_members tm
  JOIN teams t ON t.id = tm.team_id
  WHERE t.leader_id IS NULL
  ORDER BY tm.team_id, tm.joined_at ASC NULLS LAST, tm.user_id ASC
)
UPDATE teams t
   SET leader_id = c.user_id
  FROM candidate c
 WHERE t.id = c.team_id;

-- Keep the per-member flag in step with teams.leader_id for the repaired rows.
UPDATE team_members tm
   SET is_leader = (tm.user_id = t.leader_id)
  FROM teams t
 WHERE t.id = tm.team_id
   AND t.leader_id IS NOT NULL
   AND tm.is_leader <> (tm.user_id = t.leader_id);
