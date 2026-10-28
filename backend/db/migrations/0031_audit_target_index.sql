-- The owner console's person and order pages read the audit trail by what an
-- action was about (target_type, target_id): "everything done to this account",
-- "every step of this order". The log only grows, and without this each of
-- those pages scans all of it. Additive and safe to run twice.

CREATE INDEX IF NOT EXISTS idx_audit_log_target
  ON audit_log (target_type, target_id, created_at DESC)
  WHERE target_type IS NOT NULL;
