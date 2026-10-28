-- Dedupe scoring_criteria per (event_id, normalized name), merge scores safely, then
-- enforce uniqueness. Matches application logic in judge.service.js (criterionNameDedupeKey).
--
-- Run in a transaction; backup DB before applying on production.
--
-- Why a pre-delete on scores: if judge already has a row for (submission, keep_id) and
-- another for (submission, dup_id), repointing dup_id -> keep_id violates
-- scores_judge_id_submission_id_criterion_id_key.

BEGIN;

-- Each criterion row maps to the survivor id for its (event, normalized-name) group.
WITH canon AS (
  SELECT
    id AS criterion_id,
    MIN(id) OVER (
      PARTITION BY event_id,
      lower(regexp_replace(trim(coalesce(name, '')), '[[:space:]]+', ' ', 'g'))
    ) AS keep_id
  FROM scoring_criteria
),
-- All scores that will share the same (judge_id, submission_id, keep_id) after merge.
ranked_scores AS (
  SELECT
    s.id AS score_id,
    ROW_NUMBER() OVER (
      PARTITION BY s.judge_id, s.submission_id, c.keep_id
      ORDER BY
        CASE WHEN s.criterion_id = c.keep_id THEN 0 ELSE 1 END,
        s.score DESC NULLS LAST,
        s.id DESC
    ) AS rn
  FROM scores s
  JOIN canon c ON c.criterion_id = s.criterion_id
)
DELETE FROM scores
WHERE id IN (SELECT score_id FROM ranked_scores WHERE rn > 1);

-- Repoint remaining scores onto the survivor criterion id.
WITH canon AS (
  SELECT
    id AS criterion_id,
    MIN(id) OVER (
      PARTITION BY event_id,
      lower(regexp_replace(trim(coalesce(name, '')), '[[:space:]]+', ' ', 'g'))
    ) AS keep_id
  FROM scoring_criteria
)
UPDATE scores s
SET criterion_id = c.keep_id
FROM canon c
WHERE s.criterion_id = c.criterion_id
  AND c.criterion_id <> c.keep_id;

-- Remove duplicate scoring_criteria rows (same event + normalized name).
DELETE FROM scoring_criteria sc
WHERE sc.id IN (
  SELECT id
  FROM (
    SELECT
      id,
      MIN(id) OVER (
        PARTITION BY event_id,
        lower(regexp_replace(trim(coalesce(name, '')), '[[:space:]]+', ' ', 'g'))
      ) AS keep_id
    FROM scoring_criteria
  ) t
  WHERE t.id <> t.keep_id
);

CREATE UNIQUE INDEX IF NOT EXISTS scoring_criteria_event_norm_name_uidx
  ON scoring_criteria (
    event_id,
    (lower(regexp_replace(trim(coalesce(name, '')), '[[:space:]]+', ' ', 'g')))
  );

COMMIT;
