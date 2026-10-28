-- 0018 — The organiser's event home reads the audit log by event.
--
-- The activity feed on the dashboard asks for an event's latest organiser
-- actions; without this index that is a scan of every customer's log.

CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log (event_id, created_at DESC);
