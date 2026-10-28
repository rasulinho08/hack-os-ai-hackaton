-- =============================================================================
-- 0006_superadmin_role.sql
-- A platform-owner role, distinct from the customers who administer their own
-- events.
--
-- `admin` and `org_admin` are customer roles: the person running a hackathon
-- for their university or bank holds one. There was no role above them, so the
-- owner console could only be gated in the browser — the API had no way to
-- tell the platform's owner apart from a customer, and any `admin` account
-- could call the commercial endpoints directly.
--
-- Widening a CHECK constraint cannot reject a row that already exists, so this
-- is safe to apply to a live database. Nobody holds the new role until it is
-- granted deliberately; `scripts/grant-superadmin.js` does that.
-- =============================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_allowed;
ALTER TABLE users ADD CONSTRAINT users_role_allowed
  CHECK (role IN (
    'superadmin',
    'admin', 'org_admin',
    'hacker', 'pending',
    'mentor', 'judge', 'volunteer'
  ));

-- Event visibility is resolved by checking four membership tables per event.
-- Each already has a UNIQUE (event_id, user_id), which serves lookups by event;
-- these serve the reverse direction — "which events does this user belong to" —
-- which is the question the new scope asks on every request.
CREATE INDEX IF NOT EXISTS idx_participants_user        ON participants (user_id);
CREATE INDEX IF NOT EXISTS idx_judges_user              ON judges (user_id);
CREATE INDEX IF NOT EXISTS idx_mentor_assignments_user  ON mentor_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_volunteers_user          ON volunteers (user_id);
CREATE INDEX IF NOT EXISTS idx_events_created_by        ON events (created_by);
