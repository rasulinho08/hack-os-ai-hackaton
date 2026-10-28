-- Migration: add missing columns for frontend compatibility
-- Run this on existing databases that already have the tables

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS tech_stack TEXT;

ALTER TABLE presentations ADD COLUMN IF NOT EXISTS drive_link TEXT;

-- Fix default presentation status to match frontend expectations
ALTER TABLE presentations ALTER COLUMN status SET DEFAULT 'waiting';

-- Event email invites (admin dəvət siyahısı)
CREATE TABLE IF NOT EXISTS event_invites (
    id SERIAL PRIMARY KEY,
    event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('hacker', 'mentor', 'judge')),
    used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_id, email)
);

CREATE INDEX IF NOT EXISTS idx_event_invites_email ON event_invites (LOWER(email));

ALTER TABLE event_invites ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;
