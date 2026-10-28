-- Platform-wide settings the owner changes from the console (plan, Phase 6),
-- starting with the notice every page shows (maintenance, an incident).
CREATE TABLE IF NOT EXISTS platform_settings (
  key        VARCHAR(64) PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES users(id) ON DELETE SET NULL
);

-- The audit trail is searched by event and by action in the console.
CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action, created_at DESC);
