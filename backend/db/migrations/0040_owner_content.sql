-- The owner's hand on events (Phase 11): pinning events to the top of the
-- public directory, marking test events, and keeping old page addresses
-- working after a rename.
--
-- directory_featured / directory_featured_rank: the platform owner pins a
--   listed event to the top of /hackathons; a lower rank comes first, events
--   without a rank follow the ranked ones. Pinning never lists an event by
--   itself: the event still has to be published, public and listed by its
--   organiser.
-- is_test: an event the owner marked as a test. Its page keeps working (a
--   test is often a rehearsal), but it is never in the directory, the
--   sitemap, the platform's public figures or the console's statistics.
-- event_slug_history: an address an event used to have. /e/<old> resolves to
--   the event, and the web app redirects to its current address. An address
--   in use by a live event always wins over a remembered one.
--
-- Additive and safe to run twice.

ALTER TABLE events ADD COLUMN IF NOT EXISTS directory_featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS directory_featured_rank INT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_featured_rank_chk') THEN
    ALTER TABLE events ADD CONSTRAINT events_featured_rank_chk
      CHECK (directory_featured_rank IS NULL OR directory_featured_rank BETWEEN 1 AND 999);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_featured
  ON events (directory_featured_rank NULLS LAST, id)
  WHERE directory_featured = true;

CREATE TABLE IF NOT EXISTS event_slug_history (
  slug       VARCHAR(80) PRIMARY KEY,
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_slug_history_event ON event_slug_history (event_id);
