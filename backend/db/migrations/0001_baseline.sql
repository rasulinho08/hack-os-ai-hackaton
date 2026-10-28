-- =============================================================================
-- 0001_baseline.sql — HackOS consolidated schema
--
-- Single source of truth for the database. Replaces the old db_init.sql,
-- migrate.sql, database/*.sql and migrations/*.sql files (kept under
-- db/legacy/ for reference only — do NOT run them).
--
-- Fully idempotent: safe on an empty database AND on a database that was
-- created by the legacy scripts (every statement uses IF NOT EXISTS /
-- ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current on UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$fn$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  full_name       VARCHAR(200) NOT NULL,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            VARCHAR(50) NOT NULL DEFAULT 'hacker',
  avatar          TEXT,
  github_link     TEXT,
  phone           VARCHAR(30),
  age             SMALLINT,
  country         VARCHAR(100),
  timezone        VARCHAR(100),
  linkedin        TEXT,
  attendance_mode VARCHAR(20) DEFAULT 'online',
  university      VARCHAR(200),
  cohort          VARCHAR(100),
  skills          JSONB DEFAULT '[]'::jsonb,
  experience      VARCHAR(50),
  role_preference VARCHAR(100),
  dietary         VARCHAR(100),
  tshirt_size     VARCHAR(10),
  motivation      TEXT,
  how_heard       VARCHAR(100),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar          TEXT,
  ADD COLUMN IF NOT EXISTS github_link     TEXT,
  ADD COLUMN IF NOT EXISTS phone           VARCHAR(30),
  ADD COLUMN IF NOT EXISTS age             SMALLINT,
  ADD COLUMN IF NOT EXISTS country         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS timezone        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS linkedin        TEXT,
  ADD COLUMN IF NOT EXISTS attendance_mode VARCHAR(20) DEFAULT 'online',
  ADD COLUMN IF NOT EXISTS university      VARCHAR(200),
  ADD COLUMN IF NOT EXISTS cohort          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS skills          JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS experience      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS role_preference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS dietary         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS tshirt_size     VARCHAR(10),
  ADD COLUMN IF NOT EXISTS motivation      TEXT,
  ADD COLUMN IF NOT EXISTS how_heard       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_allowed;
ALTER TABLE users ADD CONSTRAINT users_role_allowed
  CHECK (role IN ('admin', 'org_admin', 'hacker', 'pending', 'mentor', 'judge', 'volunteer'));

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON users (LOWER(email));

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id                     SERIAL PRIMARY KEY,
  event_code             VARCHAR(100) NOT NULL UNIQUE,
  name                   VARCHAR(255) NOT NULL,
  description            TEXT,
  start_date             TIMESTAMPTZ NOT NULL,
  end_date               TIMESTAMPTZ NOT NULL,
  registration_start     TIMESTAMPTZ,
  registration_end       TIMESTAMPTZ,
  submission_deadline    TIMESTAMPTZ,
  demo_day               TIMESTAMPTZ,
  status                 VARCHAR(50) NOT NULL DEFAULT 'upcoming',
  team_size_limit        INT NOT NULL DEFAULT 4,
  min_team_size          INT NOT NULL DEFAULT 1,
  is_published           BOOLEAN NOT NULL DEFAULT false,
  allow_team_formation   BOOLEAN NOT NULL DEFAULT true,
  require_submission     BOOLEAN NOT NULL DEFAULT true,
  allow_late_submissions BOOLEAN NOT NULL DEFAULT false,
  created_by             INT REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS description            TEXT,
  ADD COLUMN IF NOT EXISTS registration_start     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_end       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submission_deadline    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS demo_day               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status                 VARCHAR(50) NOT NULL DEFAULT 'upcoming',
  ADD COLUMN IF NOT EXISTS team_size_limit        INT NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS min_team_size          INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_published           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_team_formation   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_submission     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_late_submissions BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by             INT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_min_team_size_valid;
ALTER TABLE events ADD CONSTRAINT events_min_team_size_valid
  CHECK (min_team_size >= 1 AND (team_size_limit IS NULL OR min_team_size <= team_size_limit));

CREATE INDEX IF NOT EXISTS idx_events_status ON events (status);
CREATE INDEX IF NOT EXISTS idx_events_code   ON events (event_code);

DROP TRIGGER IF EXISTS trg_events_updated_at ON events;
CREATE TRIGGER trg_events_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- event_invites — admin pre-assigns a role to an email before signup
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_invites (
  id         SERIAL PRIMARY KEY,
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email      VARCHAR(255) NOT NULL,
  role       VARCHAR(50) NOT NULL,
  used_at    TIMESTAMPTZ,
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, email)
);

ALTER TABLE event_invites
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE event_invites DROP CONSTRAINT IF EXISTS event_invites_role_check;
ALTER TABLE event_invites ADD CONSTRAINT event_invites_role_check
  CHECK (role IN ('hacker', 'mentor', 'judge', 'volunteer'));

CREATE INDEX IF NOT EXISTS idx_event_invites_email ON event_invites (LOWER(email));

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id                 SERIAL PRIMARY KEY,
  name               VARCHAR(255) NOT NULL,
  event_id           INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  leader_id          INT REFERENCES users(id) ON DELETE SET NULL,
  join_code          VARCHAR(50) NOT NULL UNIQUE,
  status             VARCHAR(32) NOT NULL DEFAULT 'active',
  eliminated_at      TIMESTAMPTZ,
  elimination_reason TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS status             VARCHAR(32) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS eliminated_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS elimination_reason TEXT;

ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_status_allowed;
ALTER TABLE teams ADD CONSTRAINT teams_status_allowed
  CHECK (LOWER(status) IN ('active', 'eliminated'));

CREATE INDEX IF NOT EXISTS idx_teams_event     ON teams (event_id);
CREATE INDEX IF NOT EXISTS idx_teams_join_code ON teams (join_code);

-- ---------------------------------------------------------------------------
-- team_members
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_members (
  team_id   INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_leader BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS is_leader BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members (user_id);

-- A user may belong to at most ONE team per event. Backs up the application
-- checks in team.service / teamInvite.service against race conditions.
CREATE OR REPLACE FUNCTION enforce_single_team_per_event()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM team_members tm
    JOIN teams t  ON t.id  = tm.team_id
    JOIN teams nt ON nt.id = NEW.team_id
    WHERE tm.user_id = NEW.user_id
      AND t.event_id = nt.event_id
      AND tm.team_id <> NEW.team_id
  ) THEN
    RAISE EXCEPTION 'User % is already on a team for this event', NEW.user_id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_team_members_single_team ON team_members;
CREATE TRIGGER trg_team_members_single_team
  BEFORE INSERT OR UPDATE OF user_id, team_id ON team_members
  FOR EACH ROW EXECUTE FUNCTION enforce_single_team_per_event();

-- ---------------------------------------------------------------------------
-- team_invites — peer-to-peer invites between hackers in the lobby
-- (used by teamInvite.service; was missing from every legacy SQL file)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_invites (
  id           SERIAL PRIMARY KEY,
  from_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id     INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_user_id, to_user_id, event_id)
);

ALTER TABLE team_invites DROP CONSTRAINT IF EXISTS team_invites_status_allowed;
ALTER TABLE team_invites ADD CONSTRAINT team_invites_status_allowed
  CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_team_invites_to   ON team_invites (to_user_id, status);
CREATE INDEX IF NOT EXISTS idx_team_invites_from ON team_invites (from_user_id, status);

DROP TRIGGER IF EXISTS trg_team_invites_updated_at ON team_invites;
CREATE TRIGGER trg_team_invites_updated_at BEFORE UPDATE ON team_invites
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- participants — a user registered for an event
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS participants (
  id            SERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id      INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id       INT REFERENCES teams(id) ON DELETE SET NULL,
  status        VARCHAR(50) NOT NULL DEFAULT 'pending',
  is_solo       BOOLEAN NOT NULL DEFAULT false,
  is_team_lead  BOOLEAN NOT NULL DEFAULT false,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS is_solo      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_team_lead BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_status_allowed;
ALTER TABLE participants ADD CONSTRAINT participants_status_allowed
  CHECK (LOWER(status) IN ('pending', 'approved', 'rejected', 'eliminated', 'waitlisted'));

CREATE INDEX IF NOT EXISTS idx_participants_event        ON participants (event_id);
CREATE INDEX IF NOT EXISTS idx_participants_user         ON participants (user_id);
CREATE INDEX IF NOT EXISTS idx_participants_event_status ON participants (event_id, status);

-- ---------------------------------------------------------------------------
-- submissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS submissions (
  id                SERIAL PRIMARY KEY,
  team_id           INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id          INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  project_name      VARCHAR(255) NOT NULL,
  description       TEXT,
  repo_link         TEXT,
  demo_link         TEXT,
  tech_stack        TEXT,
  presentation_link TEXT,
  status            VARCHAR(50) NOT NULL DEFAULT 'submitted',
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, event_id)
);

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS tech_stack        TEXT,
  ADD COLUMN IF NOT EXISTS presentation_link TEXT,
  ADD COLUMN IF NOT EXISTS status            VARCHAR(50) NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_submissions_event ON submissions (event_id);
CREATE INDEX IF NOT EXISTS idx_submissions_team  ON submissions (team_id);

DROP TRIGGER IF EXISTS trg_submissions_updated_at ON submissions;
CREATE TRIGGER trg_submissions_updated_at BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- presentations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presentations (
  id                 SERIAL PRIMARY KEY,
  submission_id      INT REFERENCES submissions(id) ON DELETE CASCADE,
  event_id           INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id            INT REFERENCES teams(id) ON DELETE CASCADE,
  scheduled_at       TIMESTAMPTZ,
  duration           INT NOT NULL DEFAULT 10,
  status             VARCHAR(50) NOT NULL DEFAULT 'waiting',
  presentation_order INT,
  drive_link         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE presentations
  ADD COLUMN IF NOT EXISTS drive_link TEXT;
ALTER TABLE presentations ALTER COLUMN status SET DEFAULT 'waiting';

CREATE INDEX IF NOT EXISTS idx_presentations_event ON presentations (event_id);

-- ---------------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id         SERIAL PRIMARY KEY,
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  author_id  INT REFERENCES users(id) ON DELETE SET NULL,
  title      VARCHAR(255) NOT NULL,
  content    TEXT NOT NULL,
  type       VARCHAR(50) NOT NULL DEFAULT 'info',
  priority   VARCHAR(50) NOT NULL DEFAULT 'normal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS author_id  INT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority   VARCHAR(50) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_announcements_event ON announcements (event_id);

DROP TRIGGER IF EXISTS trg_announcements_updated_at ON announcements;
CREATE TRIGGER trg_announcements_updated_at BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- help_tickets (mentor help queue)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS help_tickets (
  id                    SERIAL PRIMARY KEY,
  event_id              INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id               INT REFERENCES teams(id) ON DELETE SET NULL,
  requester_id          INT REFERENCES users(id) ON DELETE SET NULL,
  mentor_id             INT REFERENCES users(id) ON DELETE SET NULL,
  topic                 VARCHAR(255) NOT NULL,
  description           TEXT NOT NULL,
  table_location        VARCHAR(100),
  preferred_mentor_name VARCHAR(255),
  contact_phone         VARCHAR(50),
  status                VARCHAR(50) NOT NULL DEFAULT 'open',
  priority              VARCHAR(50) NOT NULL DEFAULT 'normal',
  escalated_to_admin    BOOLEAN NOT NULL DEFAULT false,
  escalated_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ
);

ALTER TABLE help_tickets
  ADD COLUMN IF NOT EXISTS requester_id          INT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mentor_id             INT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preferred_mentor_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_phone         VARCHAR(50),
  ADD COLUMN IF NOT EXISTS priority              VARCHAR(50) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS escalated_to_admin    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalated_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_at           TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_help_tickets_event  ON help_tickets (event_id);
CREATE INDEX IF NOT EXISTS idx_help_tickets_status ON help_tickets (status);
CREATE INDEX IF NOT EXISTS idx_help_tickets_escalated
  ON help_tickets (escalated_at DESC NULLS LAST) WHERE escalated_to_admin = true;

-- ---------------------------------------------------------------------------
-- tracks / prizes / sponsors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracks (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  color       VARCHAR(50),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prizes (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  track_id    INT REFERENCES tracks(id) ON DELETE SET NULL,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  value       VARCHAR(255),
  position    INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sponsors (
  id         SERIAL PRIMARY KEY,
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  logo       TEXT,
  tier       VARCHAR(100),
  website    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracks_event   ON tracks (event_id);
CREATE INDEX IF NOT EXISTS idx_prizes_event   ON prizes (event_id);
CREATE INDEX IF NOT EXISTS idx_sponsors_event ON sponsors (event_id);

-- ---------------------------------------------------------------------------
-- mentor_assignments / judges / volunteers (event <-> staff pivots)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mentor_assignments (
  id           SERIAL PRIMARY KEY,
  event_id     INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expertise    TEXT,
  availability VARCHAR(255),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS judges (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS volunteers (
  id             SERIAL PRIMARY KEY,
  event_id       INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id        INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_tasks TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mentor_assignments_user ON mentor_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_judges_user             ON judges (user_id);
CREATE INDEX IF NOT EXISTS idx_volunteers_user         ON volunteers (user_id);

-- ---------------------------------------------------------------------------
-- scoring_criteria / scores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scoring_criteria (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  max_score   INT NOT NULL DEFAULT 10,
  weight      NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One rubric name per event (normalised: trimmed, lower-cased, single spaces)
CREATE UNIQUE INDEX IF NOT EXISTS scoring_criteria_event_norm_name_uidx
  ON scoring_criteria (
    event_id,
    (lower(regexp_replace(trim(coalesce(name, '')), '[[:space:]]+', ' ', 'g')))
  );

CREATE TABLE IF NOT EXISTS scores (
  id            SERIAL PRIMARY KEY,
  judge_id      INT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  submission_id INT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  criterion_id  INT NOT NULL REFERENCES scoring_criteria(id) ON DELETE CASCADE,
  score         NUMERIC(5,2) NOT NULL,
  feedback      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (judge_id, submission_id, criterion_id)
);

ALTER TABLE scores
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_scores_submission ON scores (submission_id);

DROP TRIGGER IF EXISTS trg_scores_updated_at ON scores;
CREATE TRIGGER trg_scores_updated_at BEFORE UPDATE ON scores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- feedback / event_settings / certificates / event_resources
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
  id         SERIAL PRIMARY KEY,
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     INT CHECK (rating >= 1 AND rating <= 5),
  comment    TEXT,
  type       VARCHAR(50) NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_settings (
  id       SERIAL PRIMARY KEY,
  event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key      VARCHAR(255) NOT NULL,
  value    TEXT,
  UNIQUE (event_id, key)
);

CREATE TABLE IF NOT EXISTS certificates (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(100) NOT NULL,
  template_id VARCHAR(255),
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_resources (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  section     VARCHAR(100) NOT NULL DEFAULT 'General',
  label       VARCHAR(255) NOT NULL,
  description TEXT,
  url         TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_event        ON feedback (event_id);
CREATE INDEX IF NOT EXISTS idx_certificates_event    ON certificates (event_id);
CREATE INDEX IF NOT EXISTS idx_event_resources_event ON event_resources (event_id, sort_order);

DROP TRIGGER IF EXISTS trg_event_resources_updated_at ON event_resources;
CREATE TRIGGER trg_event_resources_updated_at BEFORE UPDATE ON event_resources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
