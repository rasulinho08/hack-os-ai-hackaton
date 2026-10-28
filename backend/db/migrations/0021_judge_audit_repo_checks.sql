-- Judge audit (plan, Phase 5): every score a judge gives or changes is kept,
-- whichever path wrote it (the review form, the older score endpoints).
CREATE TABLE IF NOT EXISTS score_history (
  id            BIGSERIAL PRIMARY KEY,
  event_id      INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  judge_id      INTEGER NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  criterion_id  INTEGER NOT NULL REFERENCES scoring_criteria(id) ON DELETE CASCADE,
  old_score     NUMERIC,
  new_score     NUMERIC,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_score_history_event ON score_history (event_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_score_history_submission ON score_history (submission_id, judge_id);

CREATE OR REPLACE FUNCTION hackos_record_score_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.score IS NOT DISTINCT FROM OLD.score THEN
    RETURN NULL;
  END IF;
  INSERT INTO score_history (event_id, submission_id, judge_id, criterion_id, old_score, new_score)
  SELECT s.event_id, NEW.submission_id, NEW.judge_id, NEW.criterion_id,
         CASE WHEN TG_OP = 'UPDATE' THEN OLD.score END, NEW.score
    FROM submissions s WHERE s.id = NEW.submission_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scores_history ON scores;
CREATE TRIGGER scores_history AFTER INSERT OR UPDATE OF score ON scores
  FOR EACH ROW EXECUTE FUNCTION hackos_record_score_change();

-- Scores from before the history began count as their first entry.
INSERT INTO score_history (event_id, submission_id, judge_id, criterion_id, old_score, new_score, changed_at)
SELECT s.event_id, sc.submission_id, sc.judge_id, sc.criterion_id, NULL, sc.score, COALESCE(sc.updated_at, sc.created_at, now())
  FROM scores sc JOIN submissions s ON s.id = sc.submission_id
 WHERE NOT EXISTS (SELECT 1 FROM score_history h WHERE h.submission_id = sc.submission_id AND h.judge_id = sc.judge_id AND h.criterion_id = sc.criterion_id);

-- GitHub check (plan, Phase 5; J1 "github"): was the repository made, or
-- worked on, before the event started? A warning for the organiser, not a
-- verdict. One row per project, replaced on every check.
CREATE TABLE IF NOT EXISTS submission_repo_checks (
  submission_id   INTEGER PRIMARY KEY REFERENCES submissions(id) ON DELETE CASCADE,
  repo            VARCHAR(200),
  status          VARCHAR(20) NOT NULL CHECK (status IN ('ok', 'warn', 'skipped', 'error')),
  flags           TEXT[] NOT NULL DEFAULT '{}',
  repo_created_at TIMESTAMPTZ,
  pushed_at       TIMESTAMPTZ,
  commits_before  INTEGER,
  commits_during  INTEGER,
  error           TEXT,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
