-- =============================================================================
-- 0032_checkout_trust.sql
-- What an order placed at checkout has to remember about how it was placed.
--
--   idempotency_key    one checkout attempt is one order. The browser sends a
--                      key per attempt; a retry, a double click or a reload
--                      with the same key answers with the order it already
--                      made. Unique per buyer, where present.
--   terms_accepted_at  when the buyer ticked "I accept the Terms and Refund
--   terms_version      policy", and which version of them (the date the legal
--                      pages were last changed). The refund policy relies on
--                      "the terms you accepted when you ordered".
--   locale             the language the buyer ordered in, for the order's
--                      e-mails (az, en, ru).
--
-- Additive and safe to run twice. Orders placed before this keep NULL in every
-- new column.
-- =============================================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS idempotency_key   VARCHAR(80),
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_version     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS locale            VARCHAR(5);

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_purchaser_idempotency
  ON orders (purchaser_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
