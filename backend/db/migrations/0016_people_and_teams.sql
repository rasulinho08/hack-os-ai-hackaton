-- 0016 — people and teams while an event runs.
--
-- 1. participants: "looking for a team" with a short note, so teamless
--    participants can be found by skills; when the status last changed.
-- 2. teams: "recruiting", what the team is looking for (skills) and a note.
-- 3. team_join_requests: a participant asks to join a team; its lead accepts
--    or declines. One open request per person and team.
--
-- Additive only.

-- 1 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS looking_for_team  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS looking_note      VARCHAR(280),
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

-- 2 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS recruiting      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recruiting_note VARCHAR(280),
  ADD COLUMN IF NOT EXISTS wanted_skills   JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_wanted_skills_chk;
ALTER TABLE teams ADD CONSTRAINT teams_wanted_skills_chk CHECK (jsonb_typeof(wanted_skills) = 'array');

-- 3 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_join_requests (
  id          SERIAL PRIMARY KEY,
  team_id     INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     VARCHAR(500),
  status      VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at  TIMESTAMPTZ,
  decided_by  INT REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT team_join_requests_status_chk CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS team_join_requests_open
  ON team_join_requests (team_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_team_join_requests_user ON team_join_requests (user_id, status);
CREATE INDEX IF NOT EXISTS idx_participants_looking ON participants (event_id) WHERE looking_for_team;
