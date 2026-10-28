-- Check-in at the door (plan module 'checkin', Phase 8): each accepted
-- participant has a ticket code shown as a QR code; the organisers and the
-- event's volunteers scan it (or type it) when the person arrives.

-- 1 ─────────────────────────────────────────────────────────────────────────
-- The ticket code: 8 characters from an alphabet without 0/O/1/I, made the
-- first time it is needed, unique within its event.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS ticket_code VARCHAR(12);
CREATE UNIQUE INDEX IF NOT EXISTS participants_event_ticket_code_key
  ON participants (event_id, ticket_code) WHERE ticket_code IS NOT NULL;

-- 2 ─────────────────────────────────────────────────────────────────────────
-- Who is in. One row per participant while they are checked in; undoing a
-- check-in deletes the row (the audit log keeps both steps).
CREATE TABLE IF NOT EXISTS event_checkins (
  id             SERIAL PRIMARY KEY,
  event_id       INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id INT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  checked_in_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_in_by  INT REFERENCES users(id) ON DELETE SET NULL,
  method         VARCHAR(10) NOT NULL DEFAULT 'qr',
  CONSTRAINT event_checkins_participant_key UNIQUE (participant_id),
  CONSTRAINT event_checkins_method_chk CHECK (method IN ('qr', 'manual'))
);
CREATE INDEX IF NOT EXISTS idx_event_checkins_event ON event_checkins (event_id, checked_in_at DESC);
