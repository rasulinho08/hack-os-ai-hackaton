/**
 * @file judgeAudit.service.js
 * @description Judge audit: every score given or changed (score_history,
 * kept by a trigger on scores), newest first, and how often each judge
 * changed their mind about each project.
 */

const db = require('../config/db');

/**
 * @param {number} eventId
 * @param {{ submissionId?: number, judgeId?: number, limit?: number }} [opts]
 */
async function history(eventId, { submissionId = null, judgeId = null, limit = 300 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 300, 1), 1000);
  const r = await db.query(
    `SELECT h.id, h.changed_at, h.old_score, h.new_score, h.submission_id, h.judge_id, h.criterion_id,
            u.full_name AS judge_name, t.name AS team_name, s.project_name, c.name AS criterion, c.max_score
       FROM score_history h
       JOIN judges j ON j.id = h.judge_id
       JOIN users u ON u.id = j.user_id
       JOIN submissions s ON s.id = h.submission_id
       JOIN teams t ON t.id = s.team_id
       JOIN scoring_criteria c ON c.id = h.criterion_id
      WHERE h.event_id = $1
        AND ($2::int IS NULL OR h.submission_id = $2::int)
        AND ($3::int IS NULL OR h.judge_id = $3::int)
      ORDER BY h.changed_at DESC, h.id DESC
      LIMIT $4`,
    [eventId, submissionId, judgeId, lim],
  );
  const changes = await db.query(
    `SELECT submission_id, judge_id, COUNT(*) FILTER (WHERE old_score IS NOT NULL)::int AS changed
       FROM score_history WHERE event_id = $1 GROUP BY submission_id, judge_id`,
    [eventId],
  );
  return {
    entries: r.rows.map((x) => ({
      id: Number(x.id),
      at: x.changed_at,
      judge: { id: Number(x.judge_id), name: x.judge_name },
      submissionId: Number(x.submission_id),
      teamName: x.team_name,
      projectName: x.project_name || null,
      criterion: { id: Number(x.criterion_id), name: x.criterion, max: Number(x.max_score) },
      from: x.old_score == null ? null : Number(x.old_score),
      to: x.new_score == null ? null : Number(x.new_score),
    })),
    // How many times each judge changed a score they had already given, per project.
    changed: changes.rows.filter((x) => x.changed > 0).map((x) => ({ submissionId: Number(x.submission_id), judgeId: Number(x.judge_id), times: x.changed })),
  };
}

module.exports = { history };
