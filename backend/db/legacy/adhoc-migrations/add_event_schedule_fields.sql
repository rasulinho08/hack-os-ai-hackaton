-- Add additional schedule fields used by the wizard / edit-event UI.
-- These were missing from db_init.sql, so updates from the frontend were
-- silently dropped, making the form appear to "revert" after save.

ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_start  TIMESTAMP;
ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_end    TIMESTAMP;
ALTER TABLE events ADD COLUMN IF NOT EXISTS submission_deadline TIMESTAMP;
ALTER TABLE events ADD COLUMN IF NOT EXISTS demo_day            TIMESTAMP;

COMMENT ON COLUMN events.registration_start  IS 'When registration opens for participants';
COMMENT ON COLUMN events.registration_end    IS 'When registration closes';
COMMENT ON COLUMN events.submission_deadline IS 'Hard deadline for project submission';
COMMENT ON COLUMN events.demo_day            IS 'Demo / presentation day';
