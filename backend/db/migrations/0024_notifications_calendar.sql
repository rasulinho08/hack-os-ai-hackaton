-- Notification centre and calendar feeds (plan, Phase 6).
--
-- One row per thing a person should know about: an announcement, a mentor
-- taking their help request, a team request, results, a certificate, a reply
-- in their thread with the organisers. `target` says which screen it opens;
-- the app picks the path for the person's role in the event. A dedupe key
-- keeps one row per cause: repeated causes either do nothing (an
-- announcement) or bring the same row back to the top as unread with a
-- count (new messages in one chat thread).
CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   INT REFERENCES events(id) ON DELETE CASCADE,
  kind       VARCHAR(40) NOT NULL,
  target     VARCHAR(20),
  title      TEXT,
  body       TEXT,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT,
  count      INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dedupe ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- A personal calendar feed's link is signed with this number; raising it
-- turns every link handed out before into a dead one.
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token_version INT NOT NULL DEFAULT 0;
