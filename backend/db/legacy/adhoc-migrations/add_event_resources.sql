-- Event Resources — admin-managed links/credentials per event.
-- Each row = one resource card visible to hackers & mentors.

CREATE TABLE IF NOT EXISTS event_resources (
    id          SERIAL PRIMARY KEY,
    event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    section     VARCHAR(100) NOT NULL DEFAULT 'General',
    label       VARCHAR(255) NOT NULL,
    description TEXT,
    url         TEXT,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_event_resources_event ON event_resources(event_id, sort_order);

COMMENT ON TABLE event_resources IS 'Admin-curated resource links (API keys, datasets, docs) per event';
