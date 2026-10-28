-- =============================================================================
-- 007_help_tickets_escalation.sql
-- Idempotent migration: add escalation tracking to help_tickets.
--
-- Background: the mentor "My Tickets" view has had an "Escalate" button
-- since day one, but clicking it only fired a client-side toast — there
-- was no API call, no database update, and no admin-side notification
-- (problem 22). Mentors thought they were forwarding the issue to an
-- organizer, while admins never saw a single escalation request.
--
-- Add two columns so the new PATCH /api/tickets/:id/escalate endpoint
-- has somewhere to record the event and admin-side filters can surface
-- escalated rows distinctly:
--   * escalated_to_admin (boolean) — quick "is this escalated?" filter
--   * escalated_at       (timestamp) — when the mentor escalated it,
--                                       useful for sorting & SLAs
--
-- Both columns default to safe values so existing rows aren't disturbed.
-- =============================================================================

ALTER TABLE help_tickets
  ADD COLUMN IF NOT EXISTS escalated_to_admin BOOLEAN DEFAULT FALSE;

ALTER TABLE help_tickets
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMP WITH TIME ZONE;

-- Lightweight index for the admin "show escalated first" sort & filter.
-- Partial index keeps it tiny (only escalated rows are stored).
CREATE INDEX IF NOT EXISTS idx_help_tickets_escalated
  ON help_tickets (escalated_at DESC NULLS LAST)
  WHERE escalated_to_admin = TRUE;
