-- Stories from past hackathons for the public site, and each event's photo
-- gallery (Phase 7).

-- 1 ─────────────────────────────────────────────────────────────────────────
-- Their photos: images, readable by anyone who has the link (a random UUID).
-- A story's photos belong to the platform (no event, no organisation); a
-- gallery's to its event.
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_purpose_chk;
ALTER TABLE files ADD CONSTRAINT files_purpose_chk CHECK (purpose IN
  ('event_logo', 'event_banner', 'sponsor_logo', 'signature', 'registration', 'submission', 'showcase', 'gallery'));

-- 2 ─────────────────────────────────────────────────────────────────────────
-- A story the platform owner writes about a hackathon run on HackOS. Words
-- are { az, en, ru } plain text (never HTML); photos are [{ fileId, caption }].
CREATE TABLE IF NOT EXISTS showcase_posts (
  id            SERIAL PRIMARY KEY,
  slug          VARCHAR(80) NOT NULL UNIQUE,
  status        VARCHAR(10) NOT NULL DEFAULT 'draft',
  title         JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary       JSONB NOT NULL DEFAULT '{}'::jsonb,
  body          JSONB NOT NULL DEFAULT '{}'::jsonb,
  held_from     DATE,
  held_to       DATE,
  location      VARCHAR(160),
  organisers    VARCHAR(240),
  figures       JSONB NOT NULL DEFAULT '{}'::jsonb,
  cover_file_id UUID REFERENCES files(id) ON DELETE SET NULL,
  photos        JSONB NOT NULL DEFAULT '[]'::jsonb,
  event_id      INT REFERENCES events(id) ON DELETE SET NULL,
  created_by    INT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ,
  CONSTRAINT showcase_posts_status_chk CHECK (status IN ('draft', 'published')),
  CONSTRAINT showcase_posts_slug_chk CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT showcase_posts_dates_chk CHECK (held_to IS NULL OR held_from IS NULL OR held_to >= held_from)
);
CREATE INDEX IF NOT EXISTS idx_showcase_posts_public
  ON showcase_posts (held_from DESC NULLS LAST, published_at DESC) WHERE status = 'published';

-- 3 ─────────────────────────────────────────────────────────────────────────
-- An event's photos, shown to its people after the event.
CREATE TABLE IF NOT EXISTS event_gallery_photos (
  id         SERIAL PRIMARY KEY,
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  file_id    UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  caption    VARCHAR(200),
  position   INT NOT NULL DEFAULT 0,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, file_id)
);
CREATE INDEX IF NOT EXISTS idx_event_gallery_photos_event ON event_gallery_photos (event_id, position, id);

-- When the organisers last told people about the photos.
CREATE TABLE IF NOT EXISTS event_gallery_shares (
  event_id   INT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  chat_at    TIMESTAMPTZ,
  email_at   TIMESTAMPTZ,
  updated_by INT REFERENCES users(id) ON DELETE SET NULL
);

-- 4 ─────────────────────────────────────────────────────────────────────────
-- The gallery's link goes to the people who took part: accepted participants
-- and the event's staff (announcementAudience.js, 'attendees').
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_audience_chk;
ALTER TABLE announcements ADD CONSTRAINT announcements_audience_chk
  CHECK (audience IN ('everyone', 'attendees', 'participants', 'waiting', 'no_team', 'no_submission', 'track',
                      'staff', 'judges', 'mentors', 'volunteers'));
