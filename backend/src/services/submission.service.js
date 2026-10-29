/**
 * @file submission.service.js
 * @description Business logic for project submission management.
 *
 * Teams submit (or re-submit) their projects here. A submission is unique
 * per (team_id, event_id) — upsert semantics are used to allow updates.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { fileUrl } = require('./file.service');

/**
 * Allowed DB columns for dynamic PATCH-style updates.
 * Never expose `team_id`, `event_id`, or timestamps to caller-controlled input.
 * @type {string[]}
 */
// `status` is intentionally NOT updatable here — it is now computed from
// judging progress in getAllSubmissions / getSubmissionById, so any
// caller-supplied status would just get overwritten on the next read
// and confuse admins (the screenshot bug). Allow only true content
// fields, which the frontend "edit submission" form actually sets.
const UPDATABLE_FIELDS = [
  'project_name',
  'description',
  'repo_link',
  'demo_link',
  'tech_stack',
  'presentation_link',
  'video_link',
];

/**
 * SQL: the columns a team hands in, as one row value, to tell whether a save
 * changed anything (judges are told when a project changed after their review).
 */
const CONTENT_TUPLE = (t) => `(${UPDATABLE_FIELDS.map((c) => `${t}.${c}`).join(', ')})`;

/** Record that the team changed what it handed in (texts, links or files). */
const markContentChanged = async (submissionId, exec = db) => {
  await exec.query('UPDATE submissions SET content_changed_at = now() WHERE id = $1', [submissionId]);
};

// ─────────────────────────────────────────────────────────────────────────────
// Write Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create or update a team's project submission for an event (upsert).
 *
 * @param {number|string} teamId
 * @param {number|string} eventId
 * @param {{ project_name: string, description?: string, repo_link?: string, demo_link?: string, tech_stack?: string }} data
 * @returns {Promise<object>} Inserted or updated submission row
 */
const submitProject = async (teamId, eventId, data) => {
  const { project_name, description, repo_link, demo_link, tech_stack, presentation_link, video_link } = data;
  const result = await db.query(
    `INSERT INTO submissions (team_id, event_id, project_name, description, repo_link, demo_link, tech_stack, presentation_link, video_link)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (team_id, event_id) DO UPDATE SET
       project_name = $3,
       description  = $4,
       repo_link    = $5,
       demo_link    = $6,
       tech_stack   = $7,
       presentation_link = $8,
       video_link   = $9,
       content_changed_at = CASE WHEN ${CONTENT_TUPLE('submissions')} IS DISTINCT FROM ${CONTENT_TUPLE('EXCLUDED')}
                                 THEN now() ELSE submissions.content_changed_at END,
       updated_at   = CURRENT_TIMESTAMP
     RETURNING *`,
    [teamId, eventId, project_name, description, repo_link, demo_link, tech_stack, presentation_link, video_link ?? null]
  );
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// Attached files
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Make `fileIds` the submission's files, in that order. Each must be a
 * project upload for this event by a member of the team, and not attached to
 * another submission. Files dropped from the list are deleted.
 *
 * @param {object} submission  { id, team_id, event_id }
 * @param {string[]} fileIds
 */
const setFiles = async (submission, fileIds) => {
  const ids = [...new Set((fileIds || []).map((x) => String(x).toLowerCase()))];
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    if (ids.length) {
      const found = await client.query(
        `SELECT f.id, sf.submission_id
           FROM files f
           LEFT JOIN submission_files sf ON sf.file_id = f.id
          WHERE f.id = ANY($1::uuid[]) AND f.purpose = 'submission' AND f.event_id = $2
            AND f.owner_user_id IN (SELECT user_id FROM team_members WHERE team_id = $3)`,
        [ids, submission.event_id, submission.team_id],
      );
      const usable = new Set(found.rows
        .filter((r) => r.submission_id == null || Number(r.submission_id) === Number(submission.id))
        .map((r) => r.id));
      const missing = ids.filter((id) => !usable.has(id));
      if (missing.length) {
        throw httpError(400, 'An attached file could not be found. Please upload it again.', 'FILE_NOT_FOUND', {
          errors: [{ field: 'fileIds', message: 'An attached file could not be found. Please upload it again.' }],
        });
      }
    }
    const before = (await client.query(
      'SELECT file_id FROM submission_files WHERE submission_id = $1 ORDER BY sort_order, created_at',
      [submission.id],
    )).rows.map((r) => String(r.file_id).toLowerCase());
    const dropped = await client.query(
      `DELETE FROM submission_files WHERE submission_id = $1 AND NOT (file_id = ANY($2::uuid[])) RETURNING file_id`,
      [submission.id, ids],
    );
    if (dropped.rows.length) {
      await client.query('DELETE FROM files WHERE id = ANY($1::uuid[])', [dropped.rows.map((r) => r.file_id)]);
    }
    for (let i = 0; i < ids.length; i += 1) {
      await client.query(
        `INSERT INTO submission_files (submission_id, file_id, sort_order) VALUES ($1, $2, $3)
         ON CONFLICT (submission_id, file_id) DO UPDATE SET sort_order = EXCLUDED.sort_order`,
        [submission.id, ids[i], i],
      );
    }
    if (before.join(',') !== ids.join(',')) await markContentChanged(submission.id, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/** Files of these submissions, as { [submissionId]: [{ id, filename, mime, size, url }] }. */
const filesFor = async (submissionIds) => {
  const ids = (submissionIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return {};
  const r = await db.query(
    `SELECT sf.submission_id, f.id, f.filename, f.mime, f.size_bytes
       FROM submission_files sf JOIN files f ON f.id = sf.file_id
      WHERE sf.submission_id = ANY($1::int[])
      ORDER BY sf.submission_id, sf.sort_order, sf.created_at`,
    [ids],
  );
  const out = {};
  for (const row of r.rows) {
    (out[row.submission_id] ||= []).push({ id: row.id, filename: row.filename, mime: row.mime, size: row.size_bytes, url: fileUrl(row.id) });
  }
  return out;
};

/** Rows with their `files` filled in. */
const withFiles = async (rows) => {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const files = await filesFor(list.map((r) => r.id));
  for (const r of list) r.files = files[r.id] || [];
  return rows;
};

/**
 * Update specific fields on an existing submission (PATCH semantics).
 * Only fields defined in UPDATABLE_FIELDS can be modified.
 *
 * @param {number|string} id   - submissions.id
 * @param {object}        data - Partial update object
 * @returns {Promise<object|undefined>} Updated submission, or current if no changes
 */
const updateSubmission = async (id, data) => {
  const sets   = [];
  const values = [];
  let   i      = 1;

  for (const key of UPDATABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(data, key) || data[key] === undefined) continue;
    // project_name is NOT NULL — skip null submissions
    if (key === 'project_name' && data[key] === null) continue;

    sets.push(`${key} = $${i}::text`);
    values.push(data[key]);
    i += 1;
  }

  // Nothing to update — return existing row unchanged
  if (sets.length === 0) return getSubmissionById(id);

  values.push(id);
  // The judges' "changed since your review" marker moves only when the save
  // really changed something (in SET, submissions.* are the old values).
  const changed = `(${sets.map((x) => `submissions.${x.split(' = ')[0]}::text`).join(', ')}, NULL)
      IS DISTINCT FROM (${sets.map((x) => x.split(' = ')[1]).join(', ')}, NULL)`;
  const result = await db.query(
    `UPDATE submissions
     SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP,
         content_changed_at = CASE WHEN ${changed} THEN now() ELSE content_changed_at END
     WHERE id = $${i}
     RETURNING *`,
    values
  );
  return result.rows[0];
};

/**
 * Permanently delete a submission.
 *
 * @param {number|string} id
 * @returns {Promise<void>}
 */
const deleteSubmission = async (id) => {
  await db.query('DELETE FROM submissions WHERE id = $1', [id]);
};

// ─────────────────────────────────────────────────────────────────────────────
// Read Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per submission: judges who scored every criterion of the event (a complete
 * review, the only kind the ranking counts) and judges who scored anything.
 */
const REVIEWED_BY = `
  SELECT r.submission_id,
         COUNT(*) FILTER (WHERE r.total > 0 AND r.filled >= r.total) AS scored_judges,
         COUNT(*) AS started_judges
    FROM (
      SELECT sc.submission_id, sc.judge_id, COUNT(DISTINCT sc.criterion_id) AS filled,
             (SELECT COUNT(*) FROM scoring_criteria c WHERE c.event_id = sub.event_id) AS total
        FROM scores sc JOIN submissions sub ON sub.id = sc.submission_id
       GROUP BY sc.submission_id, sc.judge_id, sub.event_id
    ) r
   GROUP BY r.submission_id`;

/**
 * Get all submissions for a team.
 *
 * @param {number|string} teamId
 * @returns {Promise<object[]>}
 */
const getTeamSubmissions = async (teamId) => {
  const result = await db.query(
    `SELECT s.*,
            t.name AS team_name,
            s.status AS manual_status,
            COALESCE(jc.judge_count, 0)   AS assigned_judges,
            COALESCE(sc.scored_judges, 0) AS scored_judges,
            CASE
              WHEN COALESCE(jc.judge_count, 0) = 0 THEN 'submitted'
              WHEN COALESCE(sc.started_judges, 0) = 0 THEN 'submitted'
              WHEN COALESCE(sc.scored_judges, 0) >= COALESCE(jc.judge_count, 0) THEN 'graded'
              ELSE 'reviewing'
            END AS status
     FROM submissions s
     JOIN teams t ON s.team_id = t.id
     LEFT JOIN (
       SELECT event_id, COUNT(*) AS judge_count
       FROM judges
       GROUP BY event_id
     ) jc ON jc.event_id = s.event_id
     LEFT JOIN (${REVIEWED_BY}) sc ON sc.submission_id = s.id
     WHERE s.team_id = $1
     ORDER BY s.submitted_at DESC`,
    [teamId]
  );
  return withFiles(result.rows);
};

/**
 * Get all submissions, optionally scoped to an event.
 *
 * The `status` column is COMPUTED from judging progress so admins do
 * not have to keep it in sync by hand (problem from the screenshot
 * where the dropdown was manual). Rules:
 *   - 0 judges have scored this submission     → 'submitted'
 *   - some, but not all, judges have scored it → 'reviewing'
 *   - every assigned judge has scored it       → 'graded'
 * "Scored" means a complete review (every criterion), the rule the ranking
 * counts by (judging.reviewState); `scored_judges` counts only those.
 * "Assigned judges" = all rows in `judges` for the submission's event.
 * If the event has no judges yet, we leave the row in 'submitted' so
 * we never look "graded" by accident.
 *
 * The persisted `status` column is still updated by other paths
 * (manual override, legacy callers) — we expose the computed value
 * under the same `status` key so the frontend doesn't have to know
 * the difference, and we keep the raw value in `manual_status` for
 * debugging / auditing.
 *
 * @param {number|string} [eventId]
 * @returns {Promise<object[]>}
 */
const getAllSubmissions = async (eventId) => {
  const baseSelect = `
    SELECT s.*,
           t.name AS team_name,
           s.status AS manual_status,
           COALESCE(jc.judge_count, 0)              AS assigned_judges,
           COALESCE(sc.scored_judges, 0)            AS scored_judges,
           CASE
             WHEN COALESCE(jc.judge_count, 0) = 0 THEN 'submitted'
             WHEN COALESCE(sc.started_judges, 0) = 0 THEN 'submitted'
             WHEN COALESCE(sc.scored_judges, 0) >= COALESCE(jc.judge_count, 0) THEN 'graded'
             ELSE 'reviewing'
           END AS status
    FROM submissions s
    JOIN teams t ON s.team_id = t.id
    LEFT JOIN (
      SELECT event_id, COUNT(*) AS judge_count
      FROM judges
      GROUP BY event_id
    ) jc ON jc.event_id = s.event_id
    LEFT JOIN (${REVIEWED_BY}) sc ON sc.submission_id = s.id
  `;

  if (eventId) {
    const result = await db.query(
      `${baseSelect}
       WHERE s.event_id = $1
       ORDER BY s.submitted_at DESC`,
      [eventId]
    );
    return withFiles(result.rows);
  }

  const result = await db.query(
    `${baseSelect}
     ORDER BY s.submitted_at DESC`
  );
  return withFiles(result.rows);
};

/**
 * Get a single submission by primary key (includes team and event name).
 *
 * @param {number|string} id
 * @returns {Promise<object|undefined>}
 */
const getSubmissionById = async (id) => {
  const result = await db.query(
    `SELECT s.*,
            t.name AS team_name,
            e.name AS event_name,
            s.status AS manual_status,
            COALESCE(jc.judge_count, 0)   AS assigned_judges,
            COALESCE(sc.scored_judges, 0) AS scored_judges,
            CASE
              WHEN COALESCE(jc.judge_count, 0) = 0 THEN 'submitted'
              WHEN COALESCE(sc.started_judges, 0) = 0 THEN 'submitted'
              WHEN COALESCE(sc.scored_judges, 0) >= COALESCE(jc.judge_count, 0) THEN 'graded'
              ELSE 'reviewing'
            END AS status
     FROM submissions s
     JOIN teams t ON s.team_id = t.id
     JOIN events e ON s.event_id = e.id
     LEFT JOIN (
       SELECT event_id, COUNT(*) AS judge_count
       FROM judges
       GROUP BY event_id
     ) jc ON jc.event_id = s.event_id
     LEFT JOIN (${REVIEWED_BY}) sc ON sc.submission_id = s.id
     WHERE s.id = $1`,
    [id]
  );
  return result.rows[0] ? withFiles(result.rows[0]) : result.rows[0];
};

module.exports = {
  submitProject,
  setFiles,
  filesFor,
  getTeamSubmissions,
  getAllSubmissions,
  getSubmissionById,
  updateSubmission,
  deleteSubmission,
};
