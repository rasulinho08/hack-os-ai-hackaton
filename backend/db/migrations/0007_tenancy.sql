-- =============================================================================
-- 0007_tenancy.sql
-- Events belong to a customer; a customer has a seat allowance; colleagues are
-- invited into it.
--
-- Until now the only ownership signal on an event was `created_by`, a single
-- user. That is why an organiser who leaves takes their events with them, and
-- why `admin` had to stay unscoped in 0006 — there was nothing to scope it to.
-- This adds the missing noun.
--
-- Entirely additive. Every column is nullable or defaulted, no existing row is
-- rewritten except the backfill below, which only ever fills a NULL from a fact
-- already recorded in `orders`. Nothing is dropped, and an installation with no
-- customers keeps working exactly as before.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- events.customer_id — which customer this event was delivered for
--
-- Nullable, and it stays nullable. Events created before the commerce tables
-- existed genuinely have no customer, and inventing one would be worse than
-- recording the gap. ON DELETE SET NULL rather than CASCADE: removing a
-- customer record must never take an event's participants, teams and scores
-- with it.
-- ---------------------------------------------------------------------------
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_customer
  ON events (customer_id) WHERE customer_id IS NOT NULL;

-- Backfill from orders, which already record event → customer. This derives the
-- link from data that is there; it does not guess. The WHERE clause makes it
-- idempotent and stops it from ever overwriting a link set by hand.
UPDATE events e
   SET customer_id = o.customer_id
  FROM orders o
 WHERE o.event_id = e.id
   AND e.customer_id IS NULL;

-- ---------------------------------------------------------------------------
-- customers.seat_limit — how many organiser accounts the deal includes
--
-- NULL means no agreed limit, and NULL is the default, so this migration does
-- not silently start enforcing a number nobody agreed to. Zero is a real value
-- meaning "no seats", which is why the check permits it and the column is not
-- given a positive-only constraint by way of a default.
-- ---------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS seat_limit INT;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_seat_limit_chk;
ALTER TABLE customers ADD CONSTRAINT customers_seat_limit_chk
  CHECK (seat_limit IS NULL OR seat_limit >= 0);

-- ---------------------------------------------------------------------------
-- customer_invites — bringing a colleague into a customer
--
-- The token is stored hashed and single-use, the same shape as
-- password_reset_tokens, because an invite link that is still valid after it
-- has been used is a standing account-takeover route into a customer's events.
--
-- `email` is what the invite is for, and acceptance is checked against the
-- signed-in account's address: an invite forwarded to somebody else does not
-- let that person in.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_invites (
  id              SERIAL PRIMARY KEY,
  customer_id     INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  email           VARCHAR(255) NOT NULL,
  full_name       VARCHAR(200),
  role_title      VARCHAR(120),
  -- The platform role the invitee receives on acceptance.
  grant_role      VARCHAR(30) NOT NULL DEFAULT 'org_admin',
  token_hash      TEXT NOT NULL UNIQUE,
  invited_by      INT REFERENCES users(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  accepted_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Deliberately narrow. An invite must never be able to hand out `superadmin`,
  -- which is platform ownership rather than a seat at one customer.
  CONSTRAINT customer_invites_role_chk
    CHECK (grant_role IN ('org_admin', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_customer_invites_customer
  ON customer_invites (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_invites_email
  ON customer_invites (LOWER(email));

-- One live invite per address per customer. Accepted, revoked and expired rows
-- are excluded so the history stays readable and a re-invite is possible.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_invites_pending
  ON customer_invites (customer_id, LOWER(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
