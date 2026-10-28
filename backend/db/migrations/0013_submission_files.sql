-- 0013 — what a team hands in follows the organiser's submission settings
-- (event builder → Submissions).
--
-- 1. submissions.video_link: the demo video the builder can ask for, next to
--    the repository, demo and slides links that already have columns.
-- 2. files: a 'submission' purpose for files attached to a project.
-- 3. submission_files: which uploaded files belong to which submission. A
--    file belongs to one submission at most; deleting either side removes
--    the link.
--
-- Additive only: events without submission settings keep today's rules
-- (repository and description required, the rest optional, no files).

-- 1 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS video_link TEXT;

-- 2 ─────────────────────────────────────────────────────────────────────────
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_purpose_chk;
ALTER TABLE files ADD CONSTRAINT files_purpose_chk CHECK (purpose IN
  ('event_logo', 'event_banner', 'sponsor_logo', 'signature', 'registration', 'submission'));

-- 3 ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS submission_files (
  submission_id INT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  file_id       UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  sort_order    SMALLINT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, file_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS submission_files_file_uniq ON submission_files (file_id);
