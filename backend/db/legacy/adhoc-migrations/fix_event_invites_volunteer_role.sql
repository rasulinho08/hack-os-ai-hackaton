-- Allow 'volunteer' role in event_invites CHECK constraint.
-- The original constraint only permitted ('hacker', 'mentor', 'judge'),
-- causing 500 errors when admins tried to invite volunteers.

ALTER TABLE event_invites
  DROP CONSTRAINT IF EXISTS event_invites_role_check;

ALTER TABLE event_invites
  ADD CONSTRAINT event_invites_role_check
    CHECK (role IN ('hacker', 'mentor', 'judge', 'volunteer'));
