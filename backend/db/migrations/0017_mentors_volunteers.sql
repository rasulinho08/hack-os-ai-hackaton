-- 0017 — Mentors and volunteers while the event runs.
--
-- Mentors: skills as a list (matched against help requests), a short bio,
-- where to find them, their own status (available / busy / away) and when
-- they were last active in HackOS (the "online" dot); time slots when they
-- are around. Help requests: the mentor a participant asked for, why a
-- request was closed (resolved, withdrawn, event over) and when it was
-- claimed. Volunteers: real tasks with an assignee, a place, a due time and
-- a status instead of one free-text note.

ALTER TABLE mentor_assignments
  ADD COLUMN IF NOT EXISTS skills       JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bio          TEXT,
  ADD COLUMN IF NOT EXISTS location     VARCHAR(120),
  ADD COLUMN IF NOT EXISTS presence     VARCHAR(20) NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

ALTER TABLE mentor_assignments DROP CONSTRAINT IF EXISTS mentor_assignments_presence_chk;
ALTER TABLE mentor_assignments
  ADD CONSTRAINT mentor_assignments_presence_chk CHECK (presence IN ('available', 'busy', 'away'));

-- The free-text expertise ("React, Node; design") becomes the first skills list.
UPDATE mentor_assignments ma
   SET skills = sub.list
  FROM (
    SELECT id, COALESCE(jsonb_agg(DISTINCT trim(s)) FILTER (WHERE trim(s) <> ''), '[]'::jsonb) AS list
      FROM mentor_assignments, unnest(regexp_split_to_array(COALESCE(expertise, ''), '[,;/]')) AS s
     GROUP BY id
  ) sub
 WHERE sub.id = ma.id AND ma.skills = '[]'::jsonb AND ma.expertise IS NOT NULL;

CREATE TABLE IF NOT EXISTS mentor_slots (
  id         SERIAL PRIMARY KEY,
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at  TIMESTAMPTZ NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL,
  mode       VARCHAR(20) NOT NULL DEFAULT 'onsite',
  note       VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mentor_slots_order_chk CHECK (ends_at > starts_at),
  CONSTRAINT mentor_slots_mode_chk CHECK (mode IN ('onsite', 'online'))
);
CREATE INDEX IF NOT EXISTS idx_mentor_slots_event ON mentor_slots (event_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_mentor_slots_user  ON mentor_slots (user_id);

ALTER TABLE help_tickets
  ADD COLUMN IF NOT EXISTS preferred_mentor_id INT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_reason       VARCHAR(30),
  ADD COLUMN IF NOT EXISTS claimed_at          TIMESTAMPTZ;

ALTER TABLE help_tickets DROP CONSTRAINT IF EXISTS help_tickets_closed_reason_chk;
ALTER TABLE help_tickets
  ADD CONSTRAINT help_tickets_closed_reason_chk
  CHECK (closed_reason IS NULL OR closed_reason IN ('resolved', 'withdrawn', 'event_ended'));

-- Requests already resolved were resolved by a mentor.
UPDATE help_tickets SET closed_reason = 'resolved'
 WHERE closed_reason IS NULL AND LOWER(status) = 'resolved';

CREATE INDEX IF NOT EXISTS idx_help_tickets_preferred ON help_tickets (preferred_mentor_id) WHERE preferred_mentor_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS volunteer_tasks (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title       VARCHAR(160) NOT NULL,
  details     TEXT,
  location    VARCHAR(120),
  due_at      TIMESTAMPTZ,
  assignee_id INT REFERENCES users(id) ON DELETE SET NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'todo',
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at     TIMESTAMPTZ,
  CONSTRAINT volunteer_tasks_status_chk CHECK (status IN ('todo', 'doing', 'done'))
);
CREATE INDEX IF NOT EXISTS idx_volunteer_tasks_event    ON volunteer_tasks (event_id, status);
CREATE INDEX IF NOT EXISTS idx_volunteer_tasks_assignee ON volunteer_tasks (assignee_id);
