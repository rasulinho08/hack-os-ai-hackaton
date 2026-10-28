-- The public page of an event's projects (Phase 8): the organiser opens it
-- once the results are out, and a team lead can keep their team's project off
-- it. Both default to the private side, so nothing becomes public by itself.

ALTER TABLE events ADD COLUMN IF NOT EXISTS projects_public BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS projects_public_at TIMESTAMPTZ;

ALTER TABLE teams ADD COLUMN IF NOT EXISTS projects_hidden BOOLEAN NOT NULL DEFAULT false;
