-- 0011 — from an order to a working organisation.
--
-- 1. customers.status gains 'pending_review': an organisation created at
--    checkout waits there until the platform owner approves the order.
--    customers.plan_exempt marks the organisations that existed before plans
--    did: they keep every module and unlimited events until the owner moves
--    them onto a plan. customers.onboarded_at records the setup link's use.
-- 2. orders: the card brand and last four digits (never the number), and the
--    reason shown to the buyer when an order is refused or revoked.
-- 3. entitlements: what an approved order grants — one event (per-event
--    plans, to be started within a year) or a year of events (annual plans),
--    with the plan's limits copied in so a later price-list change does not
--    rewrite what was sold. events.entitlement_id records which one an event
--    used.
-- 4. org_module_overrides: modules the owner switches on or off for one
--    organisation, on top of its plan.
-- 5. setup_tokens: the one-time link e-mailed on approval (stored hashed).
--
-- Additive only: no column is dropped, no existing row loses data.

-- 1 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_chk;
ALTER TABLE customers ADD CONSTRAINT customers_status_chk
  CHECK (status IN ('pending_review', 'pending_setup', 'active', 'suspended', 'cancelled'));

ALTER TABLE customers ADD COLUMN IF NOT EXISTS plan_exempt  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

-- Every organisation that exists when this runs predates plans. Nothing
-- they use today switches off; the owner moves them onto a plan by hand.
UPDATE customers SET plan_exempt = true;

-- 2 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS card_brand    VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS card_last4    CHAR(4);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_reason TEXT;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_card_last4_chk;
ALTER TABLE orders ADD CONSTRAINT orders_card_last4_chk
  CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$');
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_card_brand_chk;
ALTER TABLE orders ADD CONSTRAINT orders_card_brand_chk
  CHECK (card_brand IS NULL OR card_brand IN
    ('visa', 'mastercard', 'amex', 'maestro', 'unionpay', 'discover', 'jcb', 'other'));

-- 3 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entitlements (
  id                SERIAL PRIMARY KEY,
  customer_id       INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id          INT UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  plan              VARCHAR(40) NOT NULL,
  kind              VARCHAR(20) NOT NULL,
  starts_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Annual: the end of the year bought. Per event: the last day the event
  -- may start.
  ends_at           TIMESTAMPTZ NOT NULL,
  -- NULL = unlimited.
  events_allowed    INT,
  events_used       INT NOT NULL DEFAULT 0,
  participant_limit INT,
  seat_limit        INT,
  storage_gb        INT,
  revoked_at        TIMESTAMPTZ,
  created_by        INT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entitlements_plan_chk
    CHECK (plan IN ('starter', 'professional', 'business', 'enterprise')),
  CONSTRAINT entitlements_kind_chk CHECK (kind IN ('per_event', 'annual')),
  CONSTRAINT entitlements_events_chk
    CHECK (events_used >= 0 AND (events_allowed IS NULL OR events_allowed >= 0))
);
CREATE INDEX IF NOT EXISTS idx_entitlements_customer ON entitlements (customer_id);

ALTER TABLE events ADD COLUMN IF NOT EXISTS entitlement_id INT
  REFERENCES entitlements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_events_entitlement
  ON events (entitlement_id) WHERE entitlement_id IS NOT NULL;

-- 4 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_module_overrides (
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  module_key  VARCHAR(40) NOT NULL,
  enabled     BOOLEAN NOT NULL,
  note        TEXT,
  set_by      INT REFERENCES users(id) ON DELETE SET NULL,
  set_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, module_key)
);

-- 5 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS setup_tokens (
  id          SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id    INT REFERENCES orders(id) ON DELETE SET NULL,
  email       VARCHAR(255) NOT NULL,
  token_hash  CHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_setup_tokens_customer ON setup_tokens (customer_id);
