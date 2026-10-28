-- =============================================================================
-- 0037_invoice_snapshot.sql
-- An issued invoice does not change.
--
-- The invoice PDF is drawn on request. Before this it read the buyer's
-- organisation and the seller's billing settings as they are now, so a VÖEN
-- or IBAN changed later rewrote invoices already sent. When an invoice number
-- is issued the order now keeps what the invoice says — the buyer's billing
-- details, the seller block, the amounts and the VAT line — and the PDF draws
-- from that. Orders without an invoice number (the order confirmation) and
-- invoices issued before this keep reading the live data.
--
-- Additive and safe to run twice.
-- =============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_snapshot JSONB;
