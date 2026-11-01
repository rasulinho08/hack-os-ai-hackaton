-- Volunteer rows (cədvəl + arxa doldurma) — bu layihə backendində də eyni fayl var
-- (C:\Users\User\backendhackos\hackatonhbtnback-end\migrations\).

-- Cədvəl yoxdursa (PostgreSQL)
CREATE TABLE IF NOT EXISTS volunteers (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    assigned_tasks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_id, user_id)
);

-- Əvvəlki səhv qeydiyyatdan sonra `volunteers` sətrinə düşməyən könüllüləri bərpa etmək
INSERT INTO volunteers (event_id, user_id, assigned_tasks)
SELECT ei.event_id, ei.user_id, NULL
FROM event_invites ei
JOIN users u ON u.id = ei.user_id
WHERE ei.role = 'volunteer'
  AND ei.used_at IS NOT NULL
  AND ei.user_id IS NOT NULL
  AND u.role = 'volunteer'
ON CONFLICT (event_id, user_id) DO NOTHING;
