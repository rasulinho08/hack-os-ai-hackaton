-- Run once on existing databases: optional mentor preference + requester phone
ALTER TABLE help_tickets ADD COLUMN IF NOT EXISTS preferred_mentor_name VARCHAR(255);
ALTER TABLE help_tickets ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);
