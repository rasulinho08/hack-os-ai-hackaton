CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(50) DEFAULT 'participant', -- can be 'admin', 'judge', 'participant', 'mentor'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
