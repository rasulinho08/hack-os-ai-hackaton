-- =============================================================================
-- 0039_discounts.sql
-- Discount codes, automatic campaigns, and what an order was discounted by.
--
-- One table for both kinds (discount.service.js):
--
--   kind 'code'      the buyer types the code at checkout.
--   kind 'campaign'  no code. `eligibility` says who it is for:
--                      'all'        every order it fits (a launch offer);
--                      'education'  the buyer says they are a university or
--                                   a school,
--                      'nonprofit'  or a non-profit; the claim is shown on
--                                   the order and the owner approves or
--                                   removes it before approving the order.
--
-- A code can belong to one organisation (`customer_id`): a launch partner's
-- code works for that organisation only. Nothing is seeded: the presets in
-- the console are templates, and no discount applies until the owner makes
-- one.
--
-- A percentage (percent_off, up to two decimals) or a fixed amount
-- (amount_off_minor, qəpik, never more than the price). `plans` and `periods`
-- limit what it applies to (NULL = everything self-serve); `valid_from` /
-- `valid_until` bound when; `max_uses` in total and `max_uses_per_customer`
-- per organisation; `first_purchase_only` for organisations with no earlier
-- order. `active` false is paused. `note` is for the owner only.
--
-- `uses_count` is the number of orders holding a use. It is raised in the
-- transaction that places the order, under the coupon's row lock, so two
-- checkouts at once cannot take the last use twice; a refused order or a
-- removed claim gives its use back (coupon_redemptions.released_at).
--
-- On the order: `list_amount_minor` is the plan's price before the discount,
-- `discount_minor` what was taken off, `amount_minor` (as before) what is
-- charged. The code and the label are copied, so renaming or deleting a
-- coupon never rewrites an order. `discount_status`: applied (a code or an
-- automatic campaign), claimed (waiting for the owner), approved, removed.
-- `tax_rate_percent` is the VAT rate the order was priced with, so removing a
-- claim recomputes VAT at the same rate.
--
-- Additive and safe to run twice.
-- =============================================================================

CREATE TABLE IF NOT EXISTS coupons (
  id                    SERIAL PRIMARY KEY,
  kind                  VARCHAR(10) NOT NULL DEFAULT 'code' CHECK (kind IN ('code', 'campaign')),
  code                  VARCHAR(40),
  name                  VARCHAR(120) NOT NULL,
  eligibility           VARCHAR(20),
  discount_type         VARCHAR(10) NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  percent_off           NUMERIC(5, 2) CHECK (percent_off IS NULL OR (percent_off > 0 AND percent_off <= 100)),
  amount_off_minor      INTEGER CHECK (amount_off_minor IS NULL OR amount_off_minor > 0),
  plans                 TEXT[],
  periods               TEXT[],
  valid_from            TIMESTAMPTZ,
  valid_until           TIMESTAMPTZ,
  max_uses              INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  max_uses_per_customer INTEGER CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer > 0),
  first_purchase_only   BOOLEAN NOT NULL DEFAULT false,
  active                BOOLEAN NOT NULL DEFAULT true,
  note                  TEXT,
  uses_count            INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'code') = (code IS NOT NULL)),
  CHECK ((kind = 'campaign') = (eligibility IS NOT NULL)),
  CHECK ((discount_type = 'percent') = (percent_off IS NOT NULL)),
  CHECK ((discount_type = 'fixed') = (amount_off_minor IS NOT NULL)),
  CHECK (max_uses IS NULL OR uses_count <= max_uses)
);

ALTER TABLE coupons ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_eligibility_check;
ALTER TABLE coupons ADD CONSTRAINT coupons_eligibility_check
  CHECK (eligibility IS NULL OR eligibility IN ('all', 'education', 'nonprofit'));

-- Codes are matched without regard to case: "launch20" is LAUNCH20.
CREATE UNIQUE INDEX IF NOT EXISTS uq_coupons_code ON coupons (UPPER(code)) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id              BIGSERIAL PRIMARY KEY,
  coupon_id       INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id     INTEGER,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  discount_minor  INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The use was given back: the order was refused or the claim removed.
  released_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_coupon_redemptions_order ON coupon_redemptions (order_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions (coupon_id, customer_id) WHERE released_at IS NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS list_amount_minor INTEGER,
  ADD COLUMN IF NOT EXISTS discount_minor    INTEGER,
  ADD COLUMN IF NOT EXISTS coupon_id         INTEGER REFERENCES coupons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_code     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS discount_label    VARCHAR(160),
  ADD COLUMN IF NOT EXISTS discount_status   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS discount_claim    JSONB,
  ADD COLUMN IF NOT EXISTS tax_rate_percent  NUMERIC(5, 2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_discount_status_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_discount_status_check
      CHECK (discount_status IS NULL OR discount_status IN ('applied', 'claimed', 'approved', 'removed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_coupon ON orders (coupon_id) WHERE coupon_id IS NOT NULL;
