-- Solo / team lead flags for admin participants list & matchmaking
ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS is_solo BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS is_team_lead BOOLEAN NOT NULL DEFAULT FALSE;
