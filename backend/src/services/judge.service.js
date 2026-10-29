/**
 * @file judge.service.js
 * @description Business logic for judge management, scoring criteria, scores, and leaderboard.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');

// ─────────────────────────────────────────────────────────────────────────────
// Judge Assignment
// ─────────────────────────────────────────────────────────────────────────────

const isUserJudgeForEvent = async (userId, eventId) => {
  const result = await db.query(
    `SELECT 1 FROM judges WHERE event_id = $1 AND user_id = $2 LIMIT 1`,
    [eventId, userId],
  );
  return result.rows.length > 0;
};

const getJudgeRow = async (userId, eventId) => {
  const result = await db.query(
    `SELECT * FROM judges WHERE event_id = $1 AND user_id = $2 LIMIT 1`,
    [eventId, userId],
  );
  return result.rows[0] || null;
};

const getJudges = async (eventId) => {
  const result = await db.query(
    `SELECT j.*, u.full_name, u.email
     FROM judges j
     JOIN users u ON j.user_id = u.id
     WHERE j.event_id = $1
     ORDER BY j.assigned_at ASC`,
    [eventId],
  );
  return result.rows;
};

/** Assign a user as judge for an event (idempotent). Does NOT change users.role. */
const assignJudge = async (eventId, userId) => {
  let result = await db.query(
    `INSERT INTO judges (event_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (event_id, user_id) DO NOTHING
     RETURNING *`,
    [eventId, userId],
  );
  if (!result.rows[0]) {
    result = await db.query(`SELECT * FROM judges WHERE event_id = $1 AND user_id = $2`, [eventId, userId]);
  }
  return result.rows[0];
};

/** Remove a judge assignment by judges.id, scoped to the event. */
const removeJudge = async (eventId, id) => {
  const result = await db.query(
    'DELETE FROM judges WHERE id = $1 AND event_id = $2 RETURNING id',
    [id, eventId],
  );
  return Boolean(result.rows[0]);
};

// ─────────────────────────────────────────────────────────────────────────────
// Scoring Criteria
// ─────────────────────────────────────────────────────────────────────────────

/** Normalized key for duplicate detection (align with frontend dedupe). */
const criterionNameDedupeKey = (name) =>
  String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const clampMaxScore = (v) => Math.max(1, Math.min(100, Math.floor(Number(v ?? 10)) || 10));
const clampWeight = (v) => {
  const w = Number(v ?? 1);
  return Number.isFinite(w) && w > 0 ? Math.min(w, 99.99) : 1;
};

/** Collapse duplicate criterion names in a payload; later rows win. */
const dedupeCriteriaPayload = (criteriaList) => {
  if (!Array.isArray(criteriaList)) return [];
  const merged = new Map();
  const order = [];
  for (const c of criteriaList) {
    const name = String(c.name ?? '').trim();
    if (!name) continue;
    const key = criterionNameDedupeKey(name);
    const max_score = clampMaxScore(c.maxScore ?? c.max_score ?? c.scoreMax ?? 10);
    const weight = clampWeight(c.weight);
    const description = c.description != null ? String(c.description) : null;
    if (!merged.has(key)) order.push(key);
    merged.set(key, { name, description, max_score, weight });
  }
  return order.map((k) => merged.get(k));
};

const criterionNameExistsForEvent = async (eventId, nameTrimmed, excludeCriterionId) => {
  const key = criterionNameDedupeKey(nameTrimmed);
  if (!key) return false;
  const normExpr = `lower(regexp_replace(trim(coalesce(name, '')), '[[:space:]]+', ' ', 'g'))`;
  const q = excludeCriterionId != null
    ? `SELECT id FROM scoring_criteria WHERE event_id = $1 AND ${normExpr} = $2 AND id <> $3 LIMIT 1`
    : `SELECT id FROM scoring_criteria WHERE event_id = $1 AND ${normExpr} = $2 LIMIT 1`;
  const params = excludeCriterionId != null ? [eventId, key, excludeCriterionId] : [eventId, key];
  const r = await db.query(q, params);
  return r.rows.length > 0;
};

const getCriterionById = async (id) => {
  const r = await db.query('SELECT * FROM scoring_criteria WHERE id = $1', [id]);
  return r.rows[0] || null;
};

const getCriteria = async (eventId) => {
  const result = await db.query(
    'SELECT * FROM scoring_criteria WHERE event_id = $1 ORDER BY sort_order NULLS LAST, id',
    [eventId],
  );
  return result.rows;
};

const createCriterion = async (eventId, data) => {
  const nameTrimmed = String(data.name ?? '').trim();
  if (!nameTrimmed) throw httpError(400, 'Criterion name is required', 'VALIDATION_ERROR');
  if (await criterionNameExistsForEvent(eventId, nameTrimmed, undefined)) {
    throw httpError(409, 'A criterion with this name already exists for this event', 'DUPLICATE');
  }
  const description = data.description != null ? String(data.description) : null;
  const max_score = clampMaxScore(data.max_score ?? data.maxScore ?? 10);
  const weight = clampWeight(data.weight);
  const result = await db.query(
    `INSERT INTO scoring_criteria (event_id, name, description, max_score, weight)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [eventId, nameTrimmed, description, max_score, weight],
  );
  return result.rows[0];
};

/** Update a criterion; `eventId` (when given) must match the row's event. */
const updateCriterion = async (id, data, eventId) => {
  const row = await getCriterionById(id);
  if (!row) return undefined;
  if (eventId != null && String(row.event_id) !== String(eventId)) return undefined;

  const nameTrimmed = data.name != null ? String(data.name).trim() : String(row.name).trim();
  if (!nameTrimmed) throw httpError(400, 'Criterion name cannot be empty', 'VALIDATION_ERROR');
  if (await criterionNameExistsForEvent(row.event_id, nameTrimmed, id)) {
    throw httpError(409, 'A criterion with this name already exists for this event', 'DUPLICATE');
  }

  const description = data.description !== undefined ? data.description : row.description;
  const max_score =
    data.max_score !== undefined || data.maxScore !== undefined
      ? clampMaxScore(data.max_score ?? data.maxScore)
      : Number(row.max_score);
  const weight = data.weight !== undefined ? clampWeight(data.weight) : Number(row.weight);

  const result = await db.query(
    `UPDATE scoring_criteria
     SET name=$1, description=$2, max_score=$3, weight=$4
     WHERE id=$5 RETURNING *`,
    [nameTrimmed, description, max_score, weight, id],
  );
  return result.rows[0];
};

/** Delete a criterion, scoped to the event. Returns false when not found. */
const deleteCriterion = async (id, eventId) => {
  const params = [id];
  let sql = 'DELETE FROM scoring_criteria WHERE id = $1';
  if (eventId != null) {
    sql += ' AND event_id = $2';
    params.push(eventId);
  }
  const result = await db.query(`${sql} RETURNING id`, params);
  return Boolean(result.rows[0]);
};

/** Atomically replace ALL scoring criteria for an event (wizard bulk save). */
const replaceCriteriaForEvent = async (eventId, criteriaList) => {
  if (!Array.isArray(criteriaList)) {
    throw httpError(400, 'criteria must be an array', 'VALIDATION_ERROR');
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM scoring_criteria WHERE event_id = $1', [eventId]);

    const normalized = dedupeCriteriaPayload(criteriaList);
    const rows = [];
    for (const c of normalized) {
      const r = await client.query(
        `INSERT INTO scoring_criteria (event_id, name, description, max_score, weight)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [eventId, c.name, c.description, c.max_score, c.weight],
      );
      rows.push(r.rows[0]);
    }

    await client.query('COMMIT');
    return rows;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Scores
// ─────────────────────────────────────────────────────────────────────────────

/** Upsert a judge's score for a submission on a criterion. */
const submitScore = async (judgeId, submissionId, criterionId, score, feedback) => {
  const result = await db.query(
    `INSERT INTO scores (judge_id, submission_id, criterion_id, score, feedback)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (judge_id, submission_id, criterion_id)
     DO UPDATE SET score = $4, feedback = COALESCE($5, scores.feedback)
     RETURNING *`,
    [judgeId, submissionId, criterionId, score, feedback ?? null],
  );
  return result.rows[0];
};

/** A score row joined with its judge's user/event and criterion bounds. */
const getScoreById = async (id) => {
  const result = await db.query(
    `SELECT sc.*, j.user_id AS judge_user_id, j.event_id, cr.max_score
       FROM scores sc
       JOIN judges j ON j.id = sc.judge_id
       JOIN scoring_criteria cr ON cr.id = sc.criterion_id
      WHERE sc.id = $1`,
    [id],
  );
  return result.rows[0] || null;
};

const getScores = async (eventId) => {
  const result = await db.query(
    `SELECT sc.*, j.user_id, u.full_name AS judge_name,
            s.project_name, s.team_id, cr.name AS criterion_name, cr.max_score, cr.weight
     FROM scores sc
     JOIN judges j ON sc.judge_id = j.id
     JOIN users u ON j.user_id = u.id
     JOIN submissions s ON sc.submission_id = s.id
     JOIN scoring_criteria cr ON sc.criterion_id = cr.id
     WHERE j.event_id = $1
     ORDER BY sc.submission_id, sc.judge_id, sc.criterion_id`,
    [eventId],
  );
  return result.rows;
};

const updateScore = async (id, score, feedback) => {
  const result = await db.query(
    `UPDATE scores
        SET score = COALESCE($1, score),
            feedback = CASE WHEN $3::boolean THEN $2 ELSE feedback END
      WHERE id = $4 RETURNING *`,
    [score ?? null, feedback ?? null, feedback !== undefined, id],
  );
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// Leaderboard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weighted leaderboard.
 *
 * Each judge is measured on their own terms first: the weighted points they
 * awarded divided by the maximum they could have awarded for the criteria they
 * actually filled in. Those per-judge fractions are then averaged.
 *
 * The previous formula divided one combined total by the number of judges,
 * which punished a submission whenever a judge left criteria blank — the
 * divisor grew while the numerator did not, so a half-finished review dragged a
 * strong project down. Judges running out of time is normal at a live event and
 * must not decide the winner.
 *
 * `avg_score` stays on the original points scale so existing UI keeps reading
 * sensibly; `percent` is the same figure as a percentage.
 */
const getLeaderboard = async (eventId) => {
  const result = await db.query(
    `WITH per_judge AS (
       SELECT
         sc.submission_id,
         sc.judge_id,
         SUM(sc.score * cr.weight)     AS points,
         SUM(cr.max_score * cr.weight) AS max_points
       FROM scores sc
       JOIN scoring_criteria cr ON cr.id = sc.criterion_id
       JOIN submissions s2 ON s2.id = sc.submission_id
       WHERE s2.event_id = $1
       GROUP BY sc.submission_id, sc.judge_id
     ),
     event_max AS (
       SELECT COALESCE(SUM(max_score * weight), 0) AS full_max
       FROM scoring_criteria WHERE event_id = $1
     )
     SELECT
       s.id, s.project_name, s.team_id,
       t.name AS team_name,
       COALESCE(SUM(pj.points), 0)     AS total_score,
       COUNT(DISTINCT pj.judge_id)     AS judges_count,
       ROUND(COALESCE(AVG(pj.points / NULLIF(pj.max_points, 0)), 0) * 100, 2) AS percent,
       ROUND(
         COALESCE(AVG(pj.points / NULLIF(pj.max_points, 0)), 0)
           * (SELECT full_max FROM event_max),
         2
       )                               AS avg_score
     FROM submissions s
     JOIN teams t ON s.team_id = t.id
     LEFT JOIN per_judge pj ON pj.submission_id = s.id
     WHERE s.event_id = $1
     GROUP BY s.id, s.project_name, s.team_id, t.name
     ORDER BY avg_score DESC, s.submitted_at ASC`,
    [eventId],
  );
  return result.rows;
};

/** Event ids the user judges (judge dashboard fan-out). */
const listJudgeEventIdsForUser = async (userId) => {
  const result = await db.query(
    `SELECT j.event_id
       FROM judges j
       JOIN events e ON e.id = j.event_id
      WHERE j.user_id = $1
      ORDER BY e.start_date DESC NULLS LAST, j.event_id DESC`,
    [userId],
  );
  return result.rows
    .map((r) => Number(r.event_id))
    .filter((n) => Number.isFinite(n) && n > 0);
};

module.exports = {
  isUserJudgeForEvent,
  getJudgeRow,
  getJudges,
  assignJudge,
  removeJudge,
  getCriterionById,
  getCriteria,
  createCriterion,
  updateCriterion,
  deleteCriterion,
  replaceCriteriaForEvent,
  submitScore,
  getScoreById,
  getScores,
  updateScore,
  getLeaderboard,
  listJudgeEventIdsForUser,
};
