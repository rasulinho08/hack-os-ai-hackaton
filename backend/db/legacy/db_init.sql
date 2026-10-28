-- =============================================
-- HACKATHON MANAGEMENT SYSTEM - FULL SCHEMA
-- =============================================

-- Drop in reverse dependency order
DROP TABLE IF EXISTS certificates CASCADE;
DROP TABLE IF EXISTS feedback CASCADE;
DROP TABLE IF EXISTS event_settings CASCADE;
DROP TABLE IF EXISTS scores CASCADE;
DROP TABLE IF EXISTS scoring_criteria CASCADE;
DROP TABLE IF EXISTS judges CASCADE;
DROP TABLE IF EXISTS presentations CASCADE;
DROP TABLE IF EXISTS sponsors CASCADE;
DROP TABLE IF EXISTS prizes CASCADE;
DROP TABLE IF EXISTS tracks CASCADE;
DROP TABLE IF EXISTS mentor_assignments CASCADE;
DROP TABLE IF EXISTS help_tickets CASCADE;
DROP TABLE IF EXISTS announcements CASCADE;
DROP TABLE IF EXISTS submissions CASCADE;
DROP TABLE IF EXISTS participants CASCADE;
DROP TABLE IF EXISTS team_members CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS event_invites CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- =============================================
-- A3: USERS
-- =============================================
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(200) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(50) DEFAULT 'hacker',
    avatar TEXT,
    github_link TEXT,
    phone VARCHAR(30),
    age SMALLINT,
    country VARCHAR(100),
    timezone VARCHAR(100),
    linkedin TEXT,
    attendance_mode VARCHAR(20) DEFAULT 'online',
    university VARCHAR(200),
    cohort VARCHAR(100),
    skills JSONB DEFAULT '[]',
    experience VARCHAR(50),
    role_preference VARCHAR(100),
    dietary VARCHAR(100),
    tshirt_size VARCHAR(10),
    motivation TEXT,
    how_heard VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- A4: EVENTS (expanded with description, status, config)
-- =============================================
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    event_code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    registration_start TIMESTAMP,
    registration_end TIMESTAMP,
    submission_deadline TIMESTAMP,
    demo_day TIMESTAMP,
    status VARCHAR(50) DEFAULT 'upcoming',
    team_size_limit INT DEFAULT 4,
    min_team_size INT NOT NULL DEFAULT 1,
    is_published BOOLEAN DEFAULT false,
    allow_team_formation BOOLEAN DEFAULT true,
    require_submission BOOLEAN DEFAULT true,
    allow_late_submissions BOOLEAN DEFAULT false,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- EVENT EMAIL INVITES (admin dəvət edir, qeydiyyatda rol + event bağlanır)
-- =============================================
CREATE TABLE event_invites (
    id SERIAL PRIMARY KEY,
    event_id INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('hacker', 'mentor', 'judge', 'volunteer')),
    used_at TIMESTAMP,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_id, email)
);

CREATE INDEX idx_event_invites_email ON event_invites (LOWER(email));

-- =============================================
-- A5: TEAMS
-- =============================================
CREATE TABLE teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    leader_id INT REFERENCES users(id) ON DELETE SET NULL,
    join_code VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- A6: TEAM MEMBERS
-- =============================================
CREATE TABLE team_members (
    team_id INT REFERENCES teams(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    is_leader BOOLEAN DEFAULT false,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, user_id)
);

-- =============================================
-- A7: PARTICIPANTS
-- =============================================
CREATE TABLE participants (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    team_id INT REFERENCES teams(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'pending',
    is_solo BOOLEAN NOT NULL DEFAULT FALSE,
    is_team_lead BOOLEAN NOT NULL DEFAULT FALSE,
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, event_id)
);

-- =============================================
-- A8: SUBMISSIONS (fixed: added UNIQUE constraint)
-- =============================================
CREATE TABLE submissions (
    id SERIAL PRIMARY KEY,
    team_id INT REFERENCES teams(id) ON DELETE CASCADE,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    project_name VARCHAR(255) NOT NULL,
    description TEXT,
    repo_link TEXT,
    demo_link TEXT,
    tech_stack TEXT,
    status VARCHAR(50) DEFAULT 'submitted',
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (team_id, event_id)
);

-- =============================================
-- A9: PRESENTATIONS
-- =============================================
CREATE TABLE presentations (
    id SERIAL PRIMARY KEY,
    submission_id INT REFERENCES submissions(id) ON DELETE CASCADE,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    team_id INT REFERENCES teams(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMP,
    duration INT DEFAULT 10,
    status VARCHAR(50) DEFAULT 'waiting',
    presentation_order INT,
    drive_link TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- A10: ANNOUNCEMENTS
-- =============================================
CREATE TABLE announcements (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    author_id INT REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'info',
    priority VARCHAR(50) DEFAULT 'normal',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- A11: HELP TICKETS (fixed: added mentor_id, resolved_at)
-- =============================================
CREATE TABLE help_tickets (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    team_id INT REFERENCES teams(id) ON DELETE SET NULL,
    requester_id INT REFERENCES users(id) ON DELETE SET NULL,
    mentor_id INT REFERENCES users(id) ON DELETE SET NULL,
    topic VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    table_location VARCHAR(100),
    preferred_mentor_name VARCHAR(255),
    contact_phone VARCHAR(50),
    status VARCHAR(50) DEFAULT 'open',
    priority VARCHAR(50) DEFAULT 'normal',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

-- =============================================
-- A15: TRACKS
-- =============================================
CREATE TABLE tracks (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- A16: PRIZES
-- =============================================
CREATE TABLE prizes (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    track_id INT REFERENCES tracks(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    value VARCHAR(255),
    position INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- A17: SPONSORS
-- =============================================
CREATE TABLE sponsors (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    logo TEXT,
    tier VARCHAR(100),
    website TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- A18: MENTOR ASSIGNMENTS (event-mentor pivot)
-- =============================================
CREATE TABLE mentor_assignments (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    expertise TEXT,
    availability VARCHAR(255),
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_id, user_id)
);

-- =============================================
-- A12: JUDGES (event-judge pivot)
-- =============================================
CREATE TABLE judges (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (event_id, user_id)
);

-- =============================================
-- A14: SCORING CRITERIA
-- =============================================
CREATE TABLE scoring_criteria (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    max_score INT DEFAULT 10,
    weight NUMERIC(3,2) DEFAULT 1.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX scoring_criteria_event_norm_name_uidx
  ON scoring_criteria (
    event_id,
    (lower(regexp_replace(trim(coalesce(name, '')), '[[:space:]]+', ' ', 'g')))
  );

-- =============================================
-- A13: SCORES
-- =============================================
CREATE TABLE scores (
    id SERIAL PRIMARY KEY,
    judge_id INT REFERENCES judges(id) ON DELETE CASCADE,
    submission_id INT REFERENCES submissions(id) ON DELETE CASCADE,
    criterion_id INT REFERENCES scoring_criteria(id) ON DELETE CASCADE,
    score NUMERIC(5,2) NOT NULL,
    feedback TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (judge_id, submission_id, criterion_id)
);

-- =============================================
-- A19: FEEDBACK
-- =============================================
CREATE TABLE feedback (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    rating INT CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    type VARCHAR(50) DEFAULT 'general',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- A20: EVENT SETTINGS
-- =============================================
CREATE TABLE event_settings (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    key VARCHAR(255) NOT NULL,
    value TEXT,
    UNIQUE (event_id, key)
);

-- =============================================
-- A21: CERTIFICATES
-- =============================================
CREATE TABLE certificates (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    template_id VARCHAR(255),
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_code ON events(event_code);
CREATE INDEX idx_teams_event ON teams(event_id);
CREATE INDEX idx_teams_join_code ON teams(join_code);
CREATE INDEX idx_team_members_user ON team_members(user_id);
CREATE INDEX idx_participants_event ON participants(event_id);
CREATE INDEX idx_participants_user ON participants(user_id);
CREATE INDEX idx_submissions_event ON submissions(event_id);
CREATE INDEX idx_submissions_team ON submissions(team_id);
CREATE INDEX idx_help_tickets_event ON help_tickets(event_id);
CREATE INDEX idx_help_tickets_status ON help_tickets(status);
CREATE INDEX idx_announcements_event ON announcements(event_id);
CREATE INDEX idx_scores_submission ON scores(submission_id);
CREATE INDEX idx_presentations_event ON presentations(event_id);

-- =============================================
-- Trigger: a user may belong to AT MOST one team per event.
-- Backs up the application-level checks in teamInvite.acceptInvite
-- and team.service.{joinTeam,addTeamMember} so a race condition
-- can never produce duplicate memberships.
-- =============================================
CREATE OR REPLACE FUNCTION enforce_single_team_per_event()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
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
$func$;

DROP TRIGGER IF EXISTS trg_team_members_single_team ON team_members;
CREATE TRIGGER trg_team_members_single_team
  BEFORE INSERT OR UPDATE OF user_id, team_id ON team_members
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_team_per_event();
