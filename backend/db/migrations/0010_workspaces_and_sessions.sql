-- 0010 — organisations as workspaces, revocable sessions, an audit trail.
--
-- 1. customer_contacts.member_role: what a person may do at an organisation.
--    The table already links people to customers and is what tenancy checks
--    read; it now also says owner / admin / organizer / viewer, so the
--    platform can work out a person's role per organisation instead of from
--    one global users.role.
-- 2. customers: the fields an organisation's workspace needs (slug, status,
--    time zone, language, logo, brand colour).
-- 3. users.token_version: bumping it signs every existing session out —
--    on password change, password reset, or "sign out everywhere".
-- 4. audit_log: who did what, by id only. Never personal data.

-- 1 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS member_role VARCHAR(20) NOT NULL DEFAULT 'admin';

ALTER TABLE customer_contacts DROP CONSTRAINT IF EXISTS customer_contacts_member_role_chk;
ALTER TABLE customer_contacts ADD CONSTRAINT customer_contacts_member_role_chk
  CHECK (member_role IN ('owner', 'admin', 'organizer', 'viewer'));

-- The primary contact is the person who bought the product.
UPDATE customer_contacts SET member_role = 'owner'
 WHERE is_primary = true AND member_role = 'admin';

-- 2 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS slug        VARCHAR(80);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status      VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS timezone    VARCHAR(64) NOT NULL DEFAULT 'Asia/Baku';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS locale      VARCHAR(8)  NOT NULL DEFAULT 'az';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS logo_url    TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS brand_color VARCHAR(16);

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_chk;
ALTER TABLE customers ADD CONSTRAINT customers_status_chk
  CHECK (status IN ('pending_setup', 'active', 'suspended', 'cancelled'));

-- Archived customers read as cancelled from now on.
UPDATE customers SET status = 'cancelled' WHERE archived_at IS NOT NULL AND status = 'active';

-- Slugs from the name, at most 60 characters (names run to 255, the column
-- to 80); an empty one, or one already taken, gets the id appended. Done row
-- by row, as for events in 0012, so the unique index below never fails —
-- appending ids in one statement let "Acme Ltd", "Acme-Ltd" and "Acme Ltd 2"
-- end up with the same slug.
DO $slugs$
DECLARE
  r     RECORD;
  base  TEXT;
  cand  TEXT;
  n     INT;
BEGIN
  FOR r IN SELECT id, name FROM customers WHERE slug IS NULL ORDER BY id LOOP
    base := trim(both '-' from regexp_replace(lower(r.name), '[^a-z0-9]+', '-', 'g'));
    base := trim(both '-' from left(base, 60));
    cand := CASE WHEN base = '' THEN 'org-' || r.id ELSE base END;
    IF base = '' THEN base := 'org'; END IF;
    n := 0;
    WHILE EXISTS (SELECT 1 FROM customers WHERE slug = cand) LOOP
      n := n + 1;
      cand := base || '-' || r.id || CASE WHEN n > 1 THEN '-' || n ELSE '' END;
    END LOOP;
    UPDATE customers SET slug = cand WHERE id = r.id;
  END LOOP;
END
$slugs$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_slug ON customers (slug);

-- 3 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

-- 4 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  customer_id   INT REFERENCES customers(id) ON DELETE SET NULL,
  event_id      INT REFERENCES events(id) ON DELETE SET NULL,
  action        VARCHAR(80) NOT NULL,
  target_type   VARCHAR(40),
  target_id     VARCHAR(64),
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip            VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created  ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_customer ON audit_log (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor    ON audit_log (actor_user_id, created_at DESC);
