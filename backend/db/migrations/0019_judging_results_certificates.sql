-- 0019 — Judging, results, certificates, the archive and the post-event survey.
--
-- Judges: a track (for "by track" judging), the moment they confirmed the
-- conflict-of-interest declaration, which teams they judge (when each team
-- gets N judges), the teams they may not judge, and one written review per
-- judge and project (feedback used to ride on one criterion's score row).
-- Results: the ranking as it was when the organiser published it, and the
-- team that won each special or track prize. Elimination happens in named
-- rounds. Certificates get a public verification code, a kind, the place or
-- prize they are for, the name as it was at issue, and revocation. Events get
-- the moment they were archived. Feedback gets the 0–10 "would you recommend"
-- answer, once per person and event.

-- 1 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE judges
  ADD COLUMN IF NOT EXISTS track_id         INT REFERENCES tracks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coi_confirmed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS judge_assignments (
  id         SERIAL PRIMARY KEY,
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  judge_id   INT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  team_id    INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (judge_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_judge_assignments_event ON judge_assignments (event_id);
CREATE INDEX IF NOT EXISTS idx_judge_assignments_team  ON judge_assignments (team_id);

CREATE TABLE IF NOT EXISTS judge_conflicts (
  id          SERIAL PRIMARY KEY,
  event_id    INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  judge_id    INT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  team_id     INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  reason      VARCHAR(300),
  declared_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (judge_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_judge_conflicts_event ON judge_conflicts (event_id);

CREATE TABLE IF NOT EXISTS judge_reviews (
  judge_id      INT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  submission_id INT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  feedback      TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (judge_id, submission_id)
);

-- Written feedback that older clients stored on a score row becomes the review.
INSERT INTO judge_reviews (judge_id, submission_id, feedback, updated_at)
SELECT sc.judge_id, sc.submission_id,
       string_agg(DISTINCT NULLIF(TRIM(sc.feedback), ''), E'\n'), MAX(sc.updated_at)
  FROM scores sc
 WHERE NULLIF(TRIM(sc.feedback), '') IS NOT NULL
 GROUP BY sc.judge_id, sc.submission_id
ON CONFLICT DO NOTHING;

-- 2 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS results_published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS results_published_by INT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at          TIMESTAMPTZ;

UPDATE events SET archived_at = COALESCE(updated_at, now())
 WHERE LOWER(TRIM(COALESCE(status, ''))) = 'archived' AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS event_results (
  event_id      INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id       INT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  submission_id INT REFERENCES submissions(id) ON DELETE SET NULL,
  place         INT NOT NULL,
  score         NUMERIC(7,3),
  judges_count  INT NOT NULL DEFAULT 0,
  breakdown     JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_event_results_place ON event_results (event_id, place);

ALTER TABLE prizes
  ADD COLUMN IF NOT EXISTS winner_team_id INT REFERENCES teams(id) ON DELETE SET NULL;

-- 3 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS elimination_rounds (
  id         SERIAL PRIMARY KEY,
  event_id   INT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       VARCHAR(120) NOT NULL,
  position   INT NOT NULL DEFAULT 1,
  note       TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_elimination_rounds_event ON elimination_rounds (event_id, position);

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS eliminated_round_id INT REFERENCES elimination_rounds(id) ON DELETE SET NULL;

-- 4 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS code           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS kind           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS team_id        INT REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS place          INT,
  ADD COLUMN IF NOT EXISTS prize_id       INT REFERENCES prizes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS title          VARCHAR(200),
  ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS emailed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at     TIMESTAMPTZ;

-- Rows issued before codes existed: a kind from the old free-text type, the
-- name as it is now, and a code like the new ones (letters and digits that
-- cannot be confused, in three groups of four).
UPDATE certificates c SET
  kind = CASE
    WHEN LOWER(COALESCE(c.type, '')) IN ('winner', 'winners', 'first', 'second', 'third', 'place') THEN 'winner'
    WHEN LOWER(COALESCE(c.type, '')) IN ('special', 'judge', 'mentor', 'volunteer') THEN LOWER(c.type)
    ELSE 'participation' END
 WHERE c.kind IS NULL;
UPDATE certificates c SET recipient_name = u.full_name
  FROM users u WHERE u.id = c.user_id AND c.recipient_name IS NULL;
UPDATE certificates SET code =
  translate(upper(substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 4)), '01', 'XY') || '-' ||
  translate(upper(substr(md5(random()::text || id::text), 9, 4)), '01', 'XY') || '-' ||
  translate(upper(substr(md5(clock_timestamp()::text || id::text), 17, 4)), '01', 'XY')
 WHERE code IS NULL;

ALTER TABLE certificates DROP CONSTRAINT IF EXISTS certificates_kind_chk;
ALTER TABLE certificates ADD CONSTRAINT certificates_kind_chk
  CHECK (kind IN ('participation', 'winner', 'special', 'judge', 'mentor', 'volunteer'));
CREATE UNIQUE INDEX IF NOT EXISTS certificates_code_uniq ON certificates (code);
-- One valid certificate per person, kind and prize in an event.
CREATE UNIQUE INDEX IF NOT EXISTS certificates_one_live
  ON certificates (event_id, user_id, kind, COALESCE(prize_id, 0)) WHERE revoked_at IS NULL;

-- 5 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS nps SMALLINT;
ALTER TABLE feedback DROP CONSTRAINT IF EXISTS feedback_nps_chk;
ALTER TABLE feedback ADD CONSTRAINT feedback_nps_chk CHECK (nps IS NULL OR (nps >= 0 AND nps <= 10));
-- The survey's rating column is 1–5; the NPS answer has no star rating.
ALTER TABLE feedback ALTER COLUMN rating DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS feedback_one_nps
  ON feedback (event_id, user_id) WHERE type = 'nps';
