-- Problem 7: minimum team size for submissions.
-- Admins want to block 1-person "teams" from submitting final projects in
-- events that are meant to be collaborative. We keep the existing
-- `team_size_limit` (max) and add `min_team_size` (default 1 → no change
-- in behaviour for existing events). Events that want to enforce a floor
-- can set this to 2, 3, etc. at create/update time.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS min_team_size INTEGER NOT NULL DEFAULT 1;

-- Safety clamp: never allow min to exceed team_size_limit. This avoids an
-- impossible configuration where a team can never satisfy the minimum
-- because max is lower. (Kept as a CHECK rather than a trigger so the
-- constraint is visible in schema dumps.)
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_min_team_size_valid;
ALTER TABLE events
  ADD CONSTRAINT events_min_team_size_valid
  CHECK (
    min_team_size >= 1
    AND (team_size_limit IS NULL OR min_team_size <= team_size_limit)
  );
