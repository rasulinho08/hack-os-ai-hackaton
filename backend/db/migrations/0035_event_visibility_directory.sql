-- Who can find an event, and the public directory of hackathons (Phase 10).
--
-- visibility: 'public'  anyone may find the page and register (the default:
--                       every event published before this kept its page);
--             'private' only people with the link: never listed, never
--                       indexed by search engines;
--             'invite'  as private, and only people the organiser invited
--                       may register.
-- directory_listed: the organiser's "Show in the HackOS directory" switch.
-- It only has an effect on a published, public event. A new event starts
-- with it on: a public event is listed unless the organiser takes it off.
-- Events that existed before the directory start with it off, so nothing
-- already published appears in a public list its organiser never chose;
-- they switch it on in the builder. A draft, a private or invite-only event
-- never appears whatever the switch says.
--
-- Additive and safe to run twice.

ALTER TABLE events ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'public';
-- Added off (existing rows), then on for every event created from here.
ALTER TABLE events ADD COLUMN IF NOT EXISTS directory_listed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events ALTER COLUMN directory_listed SET DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_visibility_chk') THEN
    ALTER TABLE events ADD CONSTRAINT events_visibility_chk CHECK (visibility IN ('public', 'private', 'invite'));
  END IF;
END $$;

-- The directory reads only listed events, ordered by their dates.
CREATE INDEX IF NOT EXISTS idx_events_directory
  ON events (start_date, end_date)
  WHERE is_published = true AND visibility = 'public' AND directory_listed = true AND archived_at IS NULL;
