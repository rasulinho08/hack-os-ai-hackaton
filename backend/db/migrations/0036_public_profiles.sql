-- A participant's public profile at /u/<handle> (Phase 10): their hackathons,
-- projects and certificates, as a portfolio to share.
--
-- Off until the person switches it on, and then it shows only the parts
-- they ticked: every switch starts off. Never an e-mail address or a phone
-- number; there is no column for either here, and the public endpoint reads
-- nothing else of the account than the name, and the name only when the
-- person ticked it.
--
-- Additive and safe to run twice.

CREATE TABLE IF NOT EXISTS public_profiles (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  handle            VARCHAR(30) NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT false,
  show_name         BOOLEAN NOT NULL DEFAULT false,
  show_events       BOOLEAN NOT NULL DEFAULT false,
  show_projects     BOOLEAN NOT NULL DEFAULT false,
  show_certificates BOOLEAN NOT NULL DEFAULT false,
  headline          VARCHAR(120),
  -- Events the person keeps off the page even when the rest is shown.
  hidden_event_ids  INTEGER[] NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'public_profiles_handle_chk') THEN
    ALTER TABLE public_profiles ADD CONSTRAINT public_profiles_handle_chk
      CHECK (handle ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS public_profiles_handle_uidx ON public_profiles (LOWER(handle));
