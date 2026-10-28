-- Personal invitations to register for an event (the organiser's
-- Invitations screen): the hacker rows of event_invites learn who they are
-- for, when they stop working, whether they were withdrawn, and how often
-- they were sent.
--
--   full_name, team_name  from the organiser's list (CSV), to fill in the
--                         registration form; a team name puts the person in
--                         that team when it exists, or offers to create it
--   expires_at            the link stops working after this (NULL: never,
--                         as for the staff invitations made before this)
--   revoked_at/_by        the organiser withdrew it; the link is dead
--   token_nonce           part of the link's signature (inviteToken.js):
--                         withdrawing an invitation changes it, so a link
--                         sent before never works again, even when the same
--                         address is invited a second time
--   last_sent_at,
--   send_count            the invitation e-mail: when it last went out and
--                         how many times (sent_at stays the first time)
--   opened_at             the first time its link opened the registration
--                         page
--   invited_by            the organiser who added it
--
-- Additive and safe to run twice.

ALTER TABLE event_invites ADD COLUMN IF NOT EXISTS full_name    VARCHAR(200);
ALTER TABLE event_invites ADD COLUMN IF NOT EXISTS team_name    VARCHAR(80);
ALTER TABLE event_invites ADD COLUMN IF NOT EXISTS expires_at   TIMESTAMPTZ;
ALTER TABLE event_invites ADD COLUMN IF NOT EXISTS revoked_at   TIMESTAMPTZ;
ALTER TABLE event_invites ADD COLUMN IF NOT EXISTS revoked_by   INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE event_invites ADD COLUMN IF NOT EXISTS token_nonce  VARCHAR(24);
ALTER TABLE event_invites ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;
ALTER TABLE event_invites ADD COLUMN IF NOT EXISTS send_count   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE event_invites ADD COLUMN IF NOT EXISTS opened_at    TIMESTAMPTZ;
ALTER TABLE event_invites ADD COLUMN IF NOT EXISTS invited_by   INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- The Invitations screen lists one event's participant invitations.
CREATE INDEX IF NOT EXISTS idx_event_invites_event_role ON event_invites (event_id, role, created_at DESC);
