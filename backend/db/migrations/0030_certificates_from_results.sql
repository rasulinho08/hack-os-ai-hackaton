-- 0030 — Certificates that publishing the results issued, and taking them back.
--
-- Publishing the results issues certificates in the background (when the
-- organiser chose so). Unpublishing has to revoke what that publication
-- issued, and a later publication has to be able to issue them again, while
-- a certificate the organiser revoked by hand stays revoked:
--
--   issued_by       'results' for a certificate the results publication
--                   issued; NULL for one issued by hand
--   revoked_reason  'results_unpublished' when unpublishing revoked it; NULL
--                   for one revoked by hand (or not revoked)
--
-- Additive and idempotent: existing rows keep NULL in both, which is what
-- they were (issued and revoked by hand, as far as anyone can tell).

ALTER TABLE certificates ADD COLUMN IF NOT EXISTS issued_by VARCHAR(20);
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(40);
