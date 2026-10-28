-- 0015 — Telegram, one platform bot for every organisation (decision F1=a).
--
-- 1. telegram_links: a person's own chat with the bot, made by opening
--    t.me/<bot>?start=<code> from their profile. Announcements for their
--    events arrive there. blocked_at is set when they block the bot.
-- 2. telegram_link_codes: the one-time codes behind those links, and behind
--    linking an event's channel (the organiser posts /link <code> there).
--    Only a hash is stored; a code works once, for a quarter of an hour.
-- 3. event_telegram_channels: the channel (or group) an event posts its
--    announcements to. With mirror_posts, what the organiser posts there
--    themselves also appears among the event's announcements in the app.
-- 4. telegram_updates: update ids already handled, so Telegram re-sending a
--    webhook call does not link or post twice.
--
-- Additive only.

-- 1 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telegram_links (
  user_id    INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chat_id    BIGINT NOT NULL UNIQUE,
  username   VARCHAR(64),
  first_name VARCHAR(128),
  language   VARCHAR(8),
  blocked_at TIMESTAMPTZ,
  linked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code_hash  CHAR(64) PRIMARY KEY,
  purpose    VARCHAR(10) NOT NULL,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   INT REFERENCES events(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT telegram_link_codes_purpose_chk CHECK (purpose IN ('user', 'channel')),
  CONSTRAINT telegram_link_codes_event_chk CHECK (purpose = 'user' OR event_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_telegram_link_codes_user ON telegram_link_codes (user_id, purpose);

-- 3 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_telegram_channels (
  event_id     INT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  chat_id      BIGINT NOT NULL,
  chat_type    VARCHAR(12) NOT NULL,
  title        VARCHAR(255),
  username     VARCHAR(64),
  linked_by    INT REFERENCES users(id) ON DELETE SET NULL,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  mirror_posts BOOLEAN NOT NULL DEFAULT true,
  last_post_at TIMESTAMPTZ,
  last_error   TEXT
);
CREATE INDEX IF NOT EXISTS idx_event_telegram_channels_chat ON event_telegram_channels (chat_id);

-- 4 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id   BIGINT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
