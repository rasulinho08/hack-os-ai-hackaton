-- =============================================================================
-- 0008_invoices.sql
-- An order can be invoiced, and a payment can say how it arrived.
--
-- `status` already records *that* an order was paid. What it cannot record is
-- the number on the paper, when it went out, when it is due, and how the money
-- came in — the four things anybody asks about a payment three months later.
--
-- Additive. No existing row is rewritten, nothing is dropped, and an order that
-- is never invoiced keeps every column NULL.
-- =============================================================================

ALTER TABLE orders
  -- Set once, when the invoice is issued. Never regenerated: an invoice number
  -- that changes is not an invoice number.
  ADD COLUMN IF NOT EXISTS invoice_number    VARCHAR(40),
  ADD COLUMN IF NOT EXISTS invoice_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_due_at    TIMESTAMPTZ,
  -- How the money arrived. NULL on an unpaid order, and NULL is not 'other'.
  ADD COLUMN IF NOT EXISTS payment_method    VARCHAR(40),
  -- The bank's reference, or the card's last four. Free text on purpose — it is
  -- whatever the other side calls it, and forcing a shape here loses the value.
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(120);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_payment_method_chk;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method_chk
  CHECK (payment_method IS NULL OR payment_method IN
    ('bank_transfer', 'card', 'cash', 'other'));

-- Unique where present. A partial index rather than a plain UNIQUE so the many
-- un-invoiced orders do not all collide on NULL in some future stricter mode.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number
  ON orders (invoice_number) WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_invoice_issued
  ON orders (invoice_issued_at) WHERE invoice_issued_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- invoice_counters — one running number per year
--
-- A plain sequence would number invoices continuously across years, which most
-- accountants read as a gap. This restarts at 1 each January and is allocated
-- under the row lock the UPSERT already takes, so two invoices issued in the
-- same millisecond cannot share a number.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_counters (
  year        INT PRIMARY KEY,
  next_number INT NOT NULL DEFAULT 1
);
