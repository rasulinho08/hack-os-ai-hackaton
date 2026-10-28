CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    status VARCHAR(50) DEFAULT 'upcoming', -- can be 'upcoming', 'ongoing', 'completed'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
