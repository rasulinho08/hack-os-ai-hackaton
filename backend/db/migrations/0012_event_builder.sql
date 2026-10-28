-- 0012 — everything the event builder asks, stored where it is used.
--
-- 1. events: the builder's twenty sections. Columns for what the server
--    enforces or queries (place, timezone, timeline, registration mode,
--    limits, approval), JSONB for nested settings read as a whole
--    (eligibility, submission, judging, mentors, presentation, messages,
--    certificates, FAQ). A slug for the public page /e/<slug>.
-- 2. files + file_blobs: uploaded logos, banners, sponsor logos, signatures
--    and registration attachments. Bytes live in Postgres for now (one
--    database, nothing else to run); the files row says where, so moving to
--    object storage later changes the driver, not the callers.
-- 3. registration_fields + registration_answers: the per-event registration
--    form (standard fields the organiser switches on, and their own
--    questions) and what each participant answered.
-- 4. tracks, prizes, sponsors, scoring criteria: order, sponsor of a track,
--    kind of prize, sponsor logo upload. teams/submissions get a track.
-- 5. participants: where the registration came from (tracked share links).
-- 6. event_invites: when the invitation e-mail went out, and per-role notes.
--
-- Additive only. Existing events keep behaving exactly as before: every new
-- column is nullable or defaults to today's behaviour (no participant limit,
-- manual approval, solo and teams allowed, English registration page).

-- 1 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS slug                VARCHAR(80),
  ADD COLUMN IF NOT EXISTS tagline             VARCHAR(200),
  ADD COLUMN IF NOT EXISTS category            VARCHAR(20) NOT NULL DEFAULT 'hackathon',
  ADD COLUMN IF NOT EXISTS brand_color         VARCHAR(7),
  ADD COLUMN IF NOT EXISTS format              VARCHAR(10) NOT NULL DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS venue_name          VARCHAR(200),
  ADD COLUMN IF NOT EXISTS venue_address       VARCHAR(300),
  ADD COLUMN IF NOT EXISTS city                VARCHAR(100),
  ADD COLUMN IF NOT EXISTS country             CHAR(2),
  ADD COLUMN IF NOT EXISTS map_url             TEXT,
  ADD COLUMN IF NOT EXISTS online_url          TEXT,
  ADD COLUMN IF NOT EXISTS timezone            VARCHAR(64) NOT NULL DEFAULT 'Asia/Baku',
  ADD COLUMN IF NOT EXISTS team_deadline       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS judging_start       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS judging_end         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS results_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_mode   VARCHAR(5) NOT NULL DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS max_participants    INT,
  ADD COLUMN IF NOT EXISTS waitlist_enabled    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS approval_mode       VARCHAR(10) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS eligibility         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rules               TEXT,
  ADD COLUMN IF NOT EXISTS faq                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS submission_config   JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS judging_config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS mentor_config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS presentation_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS comms_config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS certificate_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS template            VARCHAR(20),
  ADD COLUMN IF NOT EXISTS builder_state       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS published_at        TIMESTAMPTZ;

-- Registration pages of existing events were English-only; new events
-- default to Azerbaijani. Adding the column with 'en' fills existing rows,
-- the second statement changes the default for rows created from now on.
ALTER TABLE events ADD COLUMN IF NOT EXISTS language VARCHAR(2) NOT NULL DEFAULT 'en';
ALTER TABLE events ALTER COLUMN language SET DEFAULT 'az';

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_category_chk;
ALTER TABLE events ADD CONSTRAINT events_category_chk
  CHECK (category IN ('hackathon', 'ideathon', 'datathon', 'designathon', 'gamejam', 'case', 'other'));
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_language_chk;
ALTER TABLE events ADD CONSTRAINT events_language_chk CHECK (language IN ('az', 'en', 'ru'));
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_format_chk;
ALTER TABLE events ADD CONSTRAINT events_format_chk CHECK (format IN ('online', 'offline', 'hybrid'));
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_registration_mode_chk;
ALTER TABLE events ADD CONSTRAINT events_registration_mode_chk
  CHECK (registration_mode IN ('solo', 'team', 'both'));
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_approval_mode_chk;
ALTER TABLE events ADD CONSTRAINT events_approval_mode_chk
  CHECK (approval_mode IN ('manual', 'team', 'auto'));
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_max_participants_chk;
ALTER TABLE events ADD CONSTRAINT events_max_participants_chk
  CHECK (max_participants IS NULL OR (max_participants >= 1 AND max_participants <= 100000));
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_brand_color_chk;
ALTER TABLE events ADD CONSTRAINT events_brand_color_chk
  CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-f]{6}$');
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_country_chk;
ALTER TABLE events ADD CONSTRAINT events_country_chk CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_slug_chk;
ALTER TABLE events ADD CONSTRAINT events_slug_chk
  CHECK (slug IS NULL OR slug ~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$');

-- Published events that predate this column count as published since they
-- were last touched; drafts stay NULL.
UPDATE events SET published_at = updated_at WHERE is_published = true AND published_at IS NULL;

-- Slugs for existing events, from their code. Codes are unique but may
-- differ only in case or punctuation, so a slug already taken gets the
-- event id appended. Done row by row so the unique index below never fails.
DO $slugs$
DECLARE
  r     RECORD;
  base  TEXT;
  cand  TEXT;
  n     INT;
BEGIN
  FOR r IN SELECT id, event_code FROM events WHERE slug IS NULL ORDER BY id LOOP
    base := trim(both '-' from regexp_replace(lower(coalesce(r.event_code, '')), '[^a-z0-9]+', '-', 'g'));
    base := trim(both '-' from left(base, 60));
    IF base = '' THEN base := 'event'; END IF;
    cand := base;
    n := 0;
    WHILE EXISTS (SELECT 1 FROM events WHERE slug = cand) LOOP
      n := n + 1;
      cand := base || '-' || r.id || CASE WHEN n > 1 THEN '-' || n ELSE '' END;
    END LOOP;
    UPDATE events SET slug = cand WHERE id = r.id;
  END LOOP;
END
$slugs$;

CREATE UNIQUE INDEX IF NOT EXISTS events_slug_uidx ON events (slug) WHERE slug IS NOT NULL;

-- 2 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS files (
  id               UUID PRIMARY KEY,
  customer_id      INT REFERENCES customers(id) ON DELETE SET NULL,
  event_id         INT REFERENCES events(id) ON DELETE CASCADE,
  owner_user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  purpose          VARCHAR(20) NOT NULL,
  filename         VARCHAR(200) NOT NULL,
  mime             VARCHAR(100) NOT NULL,
  size_bytes       INT NOT NULL,
  sha256           CHAR(64) NOT NULL,
  storage          VARCHAR(10) NOT NULL DEFAULT 'db',
  is_public        BOOLEAN NOT NULL DEFAULT false,
  -- Uploads made before an account exists (the registration form) are
  -- claimed with this token when the registration is submitted.
  claim_token_hash CHAR(64),
  claimed_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT files_purpose_chk CHECK (purpose IN
    ('event_logo', 'event_banner', 'sponsor_logo', 'signature', 'registration')),
  CONSTRAINT files_size_chk CHECK (size_bytes > 0),
  CONSTRAINT files_storage_chk CHECK (storage IN ('db'))
);
CREATE INDEX IF NOT EXISTS idx_files_event    ON files (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_customer ON files (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_files_unclaimed
  ON files (created_at) WHERE claimed_at IS NULL AND purpose = 'registration';

CREATE TABLE IF NOT EXISTS file_blobs (
  file_id UUID PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  data    BYTEA NOT NULL
);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS logo_file_id   UUID REFERENCES files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS banner_file_id UUID REFERENCES files(id) ON DELETE SET NULL;

-- 3 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS registration_fields (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  field_key   VARCHAR(40) NOT NULL,
  kind        VARCHAR(10) NOT NULL,
  type        VARCHAR(20) NOT NULL,
  label       VARCHAR(200),
  help        VARCHAR(300),
  options     JSONB NOT NULL DEFAULT '[]'::jsonb,
  required    BOOLEAN NOT NULL DEFAULT false,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  -- Hidden from mentors and volunteers (phone numbers, CVs, answers).
  sensitive   BOOLEAN NOT NULL DEFAULT false,
  sort_order  INT NOT NULL DEFAULT 0,
  -- A question somebody already answered is archived, not deleted, so the
  -- answers stay readable and exportable.
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, field_key),
  CONSTRAINT registration_fields_kind_chk CHECK (kind IN ('standard', 'custom')),
  CONSTRAINT registration_fields_type_chk CHECK (type IN
    ('text', 'textarea', 'select', 'multiselect', 'checkbox', 'number', 'date',
     'url', 'email', 'phone', 'university', 'country', 'file', 'skills'))
);
CREATE INDEX IF NOT EXISTS idx_registration_fields_event ON registration_fields (event_id, sort_order);

DROP TRIGGER IF EXISTS trg_registration_fields_updated_at ON registration_fields;
CREATE TRIGGER trg_registration_fields_updated_at BEFORE UPDATE ON registration_fields
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS registration_answers (
  id             SERIAL PRIMARY KEY,
  participant_id INT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  event_id       INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  field_id       INT NOT NULL REFERENCES registration_fields(id) ON DELETE CASCADE,
  value          JSONB,
  file_id        UUID REFERENCES files(id) ON DELETE SET NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_registration_answers_event ON registration_answers (event_id);

-- 4 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE sponsors
  ADD COLUMN IF NOT EXISTS logo_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description  TEXT,
  ADD COLUMN IF NOT EXISTS sort_order   INT NOT NULL DEFAULT 0;

ALTER TABLE tracks
  ADD COLUMN IF NOT EXISTS sponsor_id INT REFERENCES sponsors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

ALTER TABLE prizes
  ADD COLUMN IF NOT EXISTS kind       VARCHAR(10) NOT NULL DEFAULT 'place',
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
ALTER TABLE prizes DROP CONSTRAINT IF EXISTS prizes_kind_chk;
ALTER TABLE prizes ADD CONSTRAINT prizes_kind_chk CHECK (kind IN ('place', 'special', 'track'));
-- Existing prizes tied to a track are track prizes.
UPDATE prizes SET kind = 'track' WHERE track_id IS NOT NULL AND kind = 'place';

ALTER TABLE scoring_criteria ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

ALTER TABLE teams       ADD COLUMN IF NOT EXISTS track_id INT REFERENCES tracks(id) ON DELETE SET NULL;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS track_id INT REFERENCES tracks(id) ON DELETE SET NULL;

ALTER TABLE event_resources ADD COLUMN IF NOT EXISTS visible_from TIMESTAMPTZ;

-- 5 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE participants ADD COLUMN IF NOT EXISTS ref_source VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_participants_event_ref
  ON participants (event_id, ref_source) WHERE ref_source IS NOT NULL;

-- 6 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE event_invites
  ADD COLUMN IF NOT EXISTS meta    JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
