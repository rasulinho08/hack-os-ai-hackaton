-- Add volunteers table
CREATE TABLE IF NOT EXISTS volunteers (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    assigned_tasks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_id, user_id)
);

-- Add comment for documentation
COMMENT ON TABLE volunteers IS 'Event volunteer assignments with task notes';
