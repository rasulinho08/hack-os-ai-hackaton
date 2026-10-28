-- Event chat (plan, Phase 6).
--
-- Channels of one event:
--   general  everyone on the event (one per event)
--   support  one person and the organisers (one per person and event)
--   team     a team's members (one per team)
--   ticket   a help request: its team and the mentor (one per ticket)
-- Organisers see every channel of their event, for moderation.
CREATE TABLE IF NOT EXISTS chat_channels (
  id              SERIAL PRIMARY KEY,
  event_id        INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind            VARCHAR(16) NOT NULL,
  team_id         INT REFERENCES teams(id) ON DELETE CASCADE,
  user_id         INT REFERENCES users(id) ON DELETE CASCADE,
  ticket_id       INT REFERENCES help_tickets(id) ON DELETE CASCADE,
  -- Locked: only the organisers write.
  locked_at       TIMESTAMPTZ,
  locked_by       INT REFERENCES users(id) ON DELETE SET NULL,
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_channels_kind_chk CHECK (kind IN ('general', 'support', 'team', 'ticket')),
  CONSTRAINT chat_channels_shape_chk CHECK (
    (kind = 'general' AND team_id IS NULL AND user_id IS NULL AND ticket_id IS NULL)
    OR (kind = 'support' AND user_id IS NOT NULL AND team_id IS NULL AND ticket_id IS NULL)
    OR (kind = 'team' AND team_id IS NOT NULL AND user_id IS NULL AND ticket_id IS NULL)
    OR (kind = 'ticket' AND ticket_id IS NOT NULL AND user_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_general ON chat_channels (event_id) WHERE kind = 'general';
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_support ON chat_channels (event_id, user_id) WHERE kind = 'support';
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_team ON chat_channels (team_id) WHERE kind = 'team';
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_ticket ON chat_channels (ticket_id) WHERE kind = 'ticket';
CREATE INDEX IF NOT EXISTS idx_chat_channels_event ON chat_channels (event_id, kind);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  channel_id  INT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  author_id   INT REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Removed by its author or an organiser: the text is gone, the place stays.
  deleted_at  TIMESTAMPTZ,
  deleted_by  INT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages (channel_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_event ON chat_messages (event_id, created_at DESC);

-- How far each person has read each channel (for unread counts).
CREATE TABLE IF NOT EXISTS chat_reads (
  channel_id   INT NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id BIGINT NOT NULL DEFAULT 0,
  read_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

-- Muted people cannot write in the event's channels (their own support
-- thread stays open, so they can talk to the organisers about it).
CREATE TABLE IF NOT EXISTS chat_mutes (
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  until      TIMESTAMPTZ,
  reason     TEXT,
  muted_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_reports (
  id          SERIAL PRIMARY KEY,
  message_id  BIGINT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reporter_id INT REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by INT REFERENCES users(id) ON DELETE SET NULL,
  resolution  VARCHAR(16),
  CONSTRAINT chat_reports_once UNIQUE (message_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_reports_open ON chat_reports (event_id) WHERE resolved_at IS NULL;
