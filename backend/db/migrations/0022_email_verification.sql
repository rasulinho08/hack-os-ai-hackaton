-- E-mail verification (plan, Phase 6).
--
-- An event invitation names an address. The role it carries (judge, mentor,
-- volunteer, pre-approved participant) used to go to whoever signed up with
-- that address first, with the event code that is printed on the public
-- page. It now goes to the person who shows they read that address: the link
-- in the verification e-mail, a password reset link, or the invitation's own
-- link.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Accounts made before the check keep working as they did.
UPDATE users SET email_verified_at = COALESCE(created_at, now()) WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The address the link went to: a link proves that address, no other.
  email      TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user ON email_verification_tokens (user_id, created_at DESC);
