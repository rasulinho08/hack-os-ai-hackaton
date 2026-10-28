-- 0014 — background work and announcements that reach people.
--
-- 1. jobs: a queue in Postgres for everything that should not happen inside
--    a request — scheduled announcements, Telegram and e-mail deliveries, the
--    automatic announcement planner. Instances claim due jobs with
--    FOR UPDATE SKIP LOCKED; failures are retried with growing delays.
-- 2. event_auto_announcements: which automatic announcement (builder →
--    Messages) has gone out for which event, so each is sent once even when
--    several instances plan at the same moment. Events created before this
--    migration have them all switched off.
-- 3. announcements: who an announcement is for (audience, optionally one
--    track), where it goes besides the app (Telegram, e-mail), and when
--    (now, or scheduled), and where it came from (the app, the automatic
--    planner, a post in the event's Telegram channel). Existing
--    announcements are kept as sent to everyone, in the app only — what
--    they were.
-- 4. announcement_deliveries: one row per e-mail or Telegram message an
--    announcement sends, with its own attempts and error, so the organiser
--    sees how many arrived and a failed address does not stop the rest.
--
-- Additive only.

-- 1 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id            BIGSERIAL PRIMARY KEY,
  type          VARCHAR(60) NOT NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        VARCHAR(10) NOT NULL DEFAULT 'queued',
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts      SMALLINT NOT NULL DEFAULT 0,
  max_attempts  SMALLINT NOT NULL DEFAULT 5,
  dedupe_key    VARCHAR(200),
  locked_at     TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jobs_status_chk CHECK (status IN ('queued', 'running', 'retry', 'done', 'failed', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs (run_at, id) WHERE status IN ('queued', 'retry');
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_uniq ON jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 2 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_auto_announcements (
  event_id        INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key             VARCHAR(20) NOT NULL,
  announcement_id INT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, key)
);

-- Events that exist now were set up before automatic announcements could
-- be switched on or off; their organisers never chose them. They start with
-- every automatic announcement off (the builder shows it), new events with
-- the defaults.
UPDATE events
   SET comms_config = jsonb_set(COALESCE(comms_config, '{}'::jsonb), '{auto}',
       '{"reg24":false,"regclosed":false,"start30":false,"started":false,"sub24":false,"sub1":false,"subclosed":false,"pres1":false,"results":false,"certs":false}'::jsonb)
 WHERE NOT (COALESCE(comms_config, '{}'::jsonb) ? 'auto');

-- 3 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS audience     VARCHAR(20) NOT NULL DEFAULT 'everyone',
  ADD COLUMN IF NOT EXISTS track_id     INT REFERENCES tracks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS channels     JSONB NOT NULL DEFAULT '["platform"]'::jsonb,
  ADD COLUMN IF NOT EXISTS status       VARCHAR(10) NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_key     VARCHAR(20),
  ADD COLUMN IF NOT EXISTS source       VARCHAR(10) NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS external_ref VARCHAR(64);

UPDATE announcements SET sent_at = created_at WHERE sent_at IS NULL AND status = 'sent';

ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_status_chk;
ALTER TABLE announcements ADD CONSTRAINT announcements_status_chk
  CHECK (status IN ('scheduled', 'sent', 'cancelled'));
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_audience_chk;
ALTER TABLE announcements ADD CONSTRAINT announcements_audience_chk
  CHECK (audience IN ('everyone', 'participants', 'waiting', 'no_team', 'no_submission', 'track',
                      'staff', 'judges', 'mentors', 'volunteers'));
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_source_chk;
ALTER TABLE announcements ADD CONSTRAINT announcements_source_chk CHECK (source IN ('app', 'auto', 'telegram'));
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_channels_chk;
ALTER TABLE announcements ADD CONSTRAINT announcements_channels_chk
  CHECK (jsonb_typeof(channels) = 'array');

CREATE INDEX IF NOT EXISTS idx_announcements_event_status ON announcements (event_id, status, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_scheduled ON announcements (scheduled_at) WHERE status = 'scheduled';
-- A post copied from the event's Telegram channel, found again when it is edited there.
CREATE INDEX IF NOT EXISTS idx_announcements_external ON announcements (event_id, external_ref) WHERE external_ref IS NOT NULL;

-- 4 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcement_deliveries (
  id              BIGSERIAL PRIMARY KEY,
  announcement_id INT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  channel         VARCHAR(20) NOT NULL,
  user_id         INT REFERENCES users(id) ON DELETE CASCADE,
  status          VARCHAR(10) NOT NULL DEFAULT 'queued',
  attempts        SMALLINT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  locked_at       TIMESTAMPTZ,
  external_id     VARCHAR(64),
  last_error      TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT announcement_deliveries_channel_chk CHECK (channel IN ('email', 'telegram', 'telegram_channel')),
  CONSTRAINT announcement_deliveries_status_chk
    CHECK (status IN ('queued', 'sending', 'retry', 'sent', 'failed', 'skipped'))
);
-- One e-mail and one Telegram message per person, one post per channel.
CREATE UNIQUE INDEX IF NOT EXISTS announcement_deliveries_uniq
  ON announcement_deliveries (announcement_id, channel, COALESCE(user_id, 0));
CREATE INDEX IF NOT EXISTS idx_announcement_deliveries_pending
  ON announcement_deliveries (announcement_id, channel) WHERE status IN ('queued', 'retry', 'sending');
