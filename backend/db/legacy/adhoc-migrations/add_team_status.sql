-- Problem 11: let admins mark a whole team as eliminated.
--
-- We need a lightweight lifecycle column on `teams` so the admin Teams
-- page can flip a team between "active" and "eliminated" (and back).
-- The participants.status column already supports 'eliminated' values
-- and the auth middleware already blocks hackers whose participant row
-- is eliminated, so team elimination just fans the status out to every
-- member. Keeping the flag on `teams` itself also lets us render the
-- team's state in list views without having to aggregate all members.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active';

-- Guardrail: accept only the values the frontend/backend actually use.
-- NULL was excluded via NOT NULL above; DEFAULT keeps existing rows sane.
ALTER TABLE teams
  DROP CONSTRAINT IF EXISTS teams_status_allowed;
ALTER TABLE teams
  ADD CONSTRAINT teams_status_allowed
  CHECK (LOWER(status) IN ('active', 'eliminated'));

-- Timestamp + reason for auditability. Optional reason lets admins
-- explain why a team was eliminated — we expose this on the member's
-- "you were eliminated" page so they know what happened.
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS eliminated_at TIMESTAMP NULL;
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS elimination_reason TEXT NULL;

-- Backfill: any rows that were created before this migration ran default
-- to 'active' thanks to the DEFAULT clause; nothing to migrate.
