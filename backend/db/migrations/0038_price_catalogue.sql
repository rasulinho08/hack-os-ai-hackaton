-- =============================================================================
-- 0038_price_catalogue.sql
-- What each plan costs, kept in the database so the owner can change it.
--
-- Until now the prices lived in src/constants/plans.js and changing one was a
-- deploy. They are now a row per plan, edited in the owner console (Prices &
-- discounts). The rows are seeded with the prices the owner approved in
-- October 2026, which src/constants/plans.js now carries too; a plan without
-- a row keeps reading the constants (priceCatalogue.service.js).
--
--   Starter       ₼390 per event, ₼790 a year (3 events, 200 participants)
--   Professional  ₼990, ₼3,990 (6 events, 500 participants)
--   Business      ₼2,490, ₼19,900 (12 events, 2,000 participants)
--   Enterprise    quoted
--   Community     free, granted by the owner (2 events, 100 participants);
--                 a new plan, so `orders.plan` and `entitlements.plan` accept it.
--
-- Orders placed before this were sold under the old limits. They keep them:
-- every order without `plan_terms` gets the limits it was priced with, so
-- approving one later never grants less than was bought (Business had 20
-- events a year then, 12 now).
--
--   per_event_minor, annual_minor   the price, in qəpik. NULL: not sold on
--                                   that period (which is not free).
--   per_event_list_minor,           an optional higher "was" price, shown
--   annual_list_minor               struck through next to the price. Never
--                                   charged.
--   active                          false: listed but not on sale; checkout
--                                   refuses it.
--   seats, participants,            the limits an order for the plan
--   events_per_year, storage_gb     grants (NULL = unlimited). An order keeps
--                                   the ones it was placed under.
--
-- Enterprise is quoted, never listed: its row carries no price and the
-- service refuses one.
--
-- plan_price_history keeps every save: who, when, and each changed field as
-- [old, new]. Prices already on orders and issued invoices never change —
-- orders store their amount, invoices their snapshot (0037).
--
-- Additive and safe to run twice.
-- =============================================================================

CREATE TABLE IF NOT EXISTS plan_prices (
  plan_id              VARCHAR(40) PRIMARY KEY,
  per_event_minor      INTEGER CHECK (per_event_minor IS NULL OR per_event_minor >= 0),
  annual_minor         INTEGER CHECK (annual_minor IS NULL OR annual_minor >= 0),
  per_event_list_minor INTEGER CHECK (per_event_list_minor IS NULL OR per_event_list_minor >= 0),
  annual_list_minor    INTEGER CHECK (annual_list_minor IS NULL OR annual_list_minor >= 0),
  active               BOOLEAN NOT NULL DEFAULT true,
  seats                INTEGER CHECK (seats IS NULL OR seats >= 0),
  participants         INTEGER CHECK (participants IS NULL OR participants >= 0),
  events_per_year      INTEGER CHECK (events_per_year IS NULL OR events_per_year >= 0),
  storage_gb           INTEGER CHECK (storage_gb IS NULL OR storage_gb >= 0),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- The numbers in src/constants/plans.js on the day this shipped.
INSERT INTO plan_prices (plan_id, per_event_minor, annual_minor, seats, participants, events_per_year, storage_gb)
VALUES
  ('community',      NULL,    NULL,  3,  100,  2,  1),
  ('starter',       39000,   79000,  3,  200,  3,  1),
  ('professional',  99000,  399000, 10,  500,  6,  5),
  ('business',     249000, 1990000, 25, 2000, 12, 20),
  ('enterprise',     NULL,    NULL, NULL, NULL, NULL, NULL)
ON CONFLICT (plan_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS plan_price_history (
  id          BIGSERIAL PRIMARY KEY,
  plan_id     VARCHAR(40) NOT NULL,
  -- { "annual_minor": [79000, 75000], "seats": [3, 4] }
  changes     JSONB NOT NULL,
  note        TEXT,
  changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_price_history_plan ON plan_price_history (plan_id, changed_at DESC);

-- An order keeps the limits of the plan as it was sold, so a later change to
-- the catalogue never changes what approval grants for it.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS plan_terms JSONB;

-- The limits every order placed before this was sold with (the constants
-- until now). Only orders that have none yet; enterprise orders had none.
UPDATE orders o
   SET plan_terms = t.terms
  FROM (VALUES
    ('starter',      '{"seats": 3,  "participants": 150,  "eventsPerYear": 2,  "storageGb": 1}'::jsonb),
    ('professional', '{"seats": 10, "participants": 500,  "eventsPerYear": 6,  "storageGb": 5}'::jsonb),
    ('business',     '{"seats": 25, "participants": 2000, "eventsPerYear": 20, "storageGb": 20}'::jsonb),
    ('enterprise',   '{"seats": null, "participants": null, "eventsPerYear": null, "storageGb": null}'::jsonb)
  ) AS t(plan, terms)
 WHERE o.plan = t.plan AND o.plan_terms IS NULL;

-- Community is a plan an order and an entitlement can be for.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_plan_chk;
ALTER TABLE orders ADD CONSTRAINT orders_plan_chk
  CHECK (plan IN ('community', 'starter', 'professional', 'business', 'enterprise'));
ALTER TABLE entitlements DROP CONSTRAINT IF EXISTS entitlements_plan_chk;
ALTER TABLE entitlements ADD CONSTRAINT entitlements_plan_chk
  CHECK (plan IN ('community', 'starter', 'professional', 'business', 'enterprise'));
