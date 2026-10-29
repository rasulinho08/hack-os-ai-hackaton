/**
 * @file judge.controller.js
 * @description HTTP handlers for judge assignment, scoring criteria, scores, and leaderboard.
 *
 * Routes (all under /api/events/:eventId/judging):
 *   GET    /judges             → getJudges
 *   POST   /judges             → assignJudge
 *   DELETE /judges/:id         → removeJudge
 *   GET    /criteria           → getCriteria
 *   POST   /criteria           → createCriterion (or bulk replace if body.criteria is array)
 *   PUT    /criteria           → replaceCriteria (bulk replace)
 *   PUT    /criteria/:id       → updateCriterion
 *   DELETE /criteria/:id       → deleteCriterion
 *   POST   /scores             → submitScore
 *   GET    /scores             → getScores
 *   PUT    /scores/:id         → updateScore
 *   GET    /leaderboard        → getLeaderboard
 */

const judgeService = require('../services/judge.service');
const judging      = require('../services/judging.service');
const results      = require('../services/results.service');
const db           = require('../config/db');
const { resolveUserIdFromBody } = require('../utils/resolveUserId');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { isAdminUser, normalizeRole } = require('../utils/authz');

const isHackerLike = (u) => ['hacker', 'pending'].includes(normalizeRole(u && u.role));

const parseScore = (raw) => {
  const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  return Number.isFinite(n) ? n : NaN;
};

// ─────────────────────────────────────────────────────────────────────────────
// Judges
// ─────────────────────────────────────────────────────────────────────────────

const getJudges = async (req, res, next) => {
  try {
    const judges = await judgeService.getJudges(req.params.eventId);
    // Participants see who judges, not how to reach them privately.
    const rows = isHackerLike(req.user) ? judges.map(({ email, ...rest }) => rest) : judges;
    return successResponse(res, HTTP.OK, 'OK', rows);
  } catch (error) { next(error); }
};

const assignJudge = async (req, res, next) => {
  try {
    const userId = await resolveUserIdFromBody(req.body);
    const judge  = await judgeService.assignJudge(req.params.eventId, userId);
    return successResponse(res, HTTP.CREATED, 'Judge assigned successfully', judge);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const removeJudge = async (req, res, next) => {
  try {
    // Removing a judge removes their scores with them: not under published
    // results, which were counted with those scores.
    const scored = await db.query(
      `SELECT 1 FROM scores sc JOIN judges j ON j.id = sc.judge_id
         JOIN events e ON e.id = j.event_id
        WHERE j.id = $1 AND j.event_id = $2 AND e.results_published_at IS NOT NULL LIMIT 1`,
      [req.params.id, req.params.eventId],
    );
    if (scored.rows[0]) {
      return errorResponse(res, HTTP.CONFLICT, 'The results were published with this judge\'s scores. Unpublish them first.', null, 'RESULTS_PUBLISHED');
    }
    const removed = await judgeService.removeJudge(req.params.eventId, req.params.id);
    if (!removed) return errorResponse(res, HTTP.NOT_FOUND, 'Judge assignment not found');
    return successResponse(res, HTTP.OK, 'Judge removed successfully');
  } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Scoring Criteria
// ─────────────────────────────────────────────────────────────────────────────

/** Scores exist for this event: criteria may no longer be replaced or removed. */
async function eventHasScores(eventId) {
  const r = await db.query(
    'SELECT 1 FROM scores sc JOIN scoring_criteria cr ON cr.id = sc.criterion_id WHERE cr.event_id = $1 LIMIT 1',
    [eventId],
  );
  return Boolean(r.rows[0]);
}

async function criterionHasScores(criterionId) {
  const r = await db.query('SELECT 1 FROM scores WHERE criterion_id = $1 LIMIT 1', [criterionId]);
  return Boolean(r.rows[0]);
}

const SCORED = 'Judges have already scored with these criteria. Change them in the event builder, where scored criteria are kept.';

const getCriteria = async (req, res, next) => {
  try {
    const criteria = await judgeService.getCriteria(req.params.eventId);
    return successResponse(res, HTTP.OK, 'OK', criteria);
  } catch (error) { next(error); }
};

/** POST /criteria — bulk replace when body.criteria is an array, else create one. */
const createCriterion = async (req, res, next) => {
  try {
    if (Array.isArray(req.body.criteria)) {
      // Replacing deletes every criterion, and with them every score.
      if (await eventHasScores(req.params.eventId)) return errorResponse(res, HTTP.CONFLICT, SCORED, null, 'CRITERION_SCORED');
      const rows = await judgeService.replaceCriteriaForEvent(req.params.eventId, req.body.criteria);
      return successResponse(res, HTTP.CREATED, 'Criteria saved successfully', rows);
    }
    const criterion = await judgeService.createCriterion(req.params.eventId, req.body);
    return successResponse(res, HTTP.CREATED, 'Criterion created successfully', criterion);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** PUT /criteria — atomically replace all criteria for the event. */
const replaceCriteria = async (req, res, next) => {
  try {
    const { criteria } = req.body;
    if (!Array.isArray(criteria)) {
      return errorResponse(
        res, HTTP.BAD_REQUEST,
        'Body must include criteria: [{ name, maxScore?, weight?, description? }, ...]',
      );
    }
    if (await eventHasScores(req.params.eventId)) return errorResponse(res, HTTP.CONFLICT, SCORED, null, 'CRITERION_SCORED');
    const rows = await judgeService.replaceCriteriaForEvent(req.params.eventId, criteria);
    return successResponse(res, HTTP.OK, 'Criteria replaced successfully', rows);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const updateCriterion = async (req, res, next) => {
  try {
    const maxChanges = req.body.max_score !== undefined || req.body.maxScore !== undefined;
    if (maxChanges && (await criterionHasScores(req.params.id))) {
      const current = await judgeService.getCriterionById(req.params.id);
      if (current && Number(current.max_score) !== Number(req.body.max_score ?? req.body.maxScore)) {
        return errorResponse(res, HTTP.CONFLICT, SCORED, null, 'CRITERION_SCORED');
      }
    }
    const updated = await judgeService.updateCriterion(req.params.id, req.body, req.params.eventId);
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'Criterion not found');
    return successResponse(res, HTTP.OK, 'Criterion updated successfully', updated);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const deleteCriterion = async (req, res, next) => {
  try {
    if (await criterionHasScores(req.params.id)) return errorResponse(res, HTTP.CONFLICT, SCORED, null, 'CRITERION_SCORED');
    const removed = await judgeService.deleteCriterion(req.params.id, req.params.eventId);
    if (!removed) return errorResponse(res, HTTP.NOT_FOUND, 'Criterion not found');
    return successResponse(res, HTTP.OK, 'Criterion deleted successfully');
  } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Scores
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /scores — the calling judge scores a submission on one criterion.
 * Body: { submissionId, criterionId, score, feedback? }
 */
const submitScore = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const submissionId = req.body.submissionId ?? req.body.submission_id;
    const criterionId = req.body.criterionId ?? req.body.criterion_id;
    const feedback = req.body.feedback;

    const judgeRow = await judgeService.getJudgeRow(req.user.id, eventId);
    if (!judgeRow) {
      return errorResponse(res, HTTP.FORBIDDEN, 'You are not a judge for this event', null, 'NOT_EVENT_JUDGE');
    }

    if (submissionId == null || criterionId == null) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'submissionId and criterionId are required');
    }

    // The same rules as a whole review: window, assignment, conflicts, eliminated teams.
    await judging.assertCanScore(req.user.id, eventId, submissionId);

    const criterion = await judgeService.getCriterionById(criterionId);
    if (!criterion || String(criterion.event_id) !== String(eventId)) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'Criterion does not belong to this event');
    }

    const score = parseScore(req.body.score);
    const max = Number(criterion.max_score) || 10;
    if (!Number.isFinite(score) || score < 0 || score > max) {
      return errorResponse(res, HTTP.BAD_REQUEST, `Score must be a number between 0 and ${max}`, null, 'SCORE_OUT_OF_RANGE');
    }

    const result = await judgeService.submitScore(judgeRow.id, submissionId, criterionId, score, feedback);
    if (typeof feedback === 'string') {
      await db.query(
        `INSERT INTO judge_reviews (judge_id, submission_id, feedback) VALUES ($1, $2, $3)
         ON CONFLICT (judge_id, submission_id) DO UPDATE SET feedback = EXCLUDED.feedback, updated_at = now()`,
        [judgeRow.id, submissionId, feedback.trim().slice(0, 4000) || null],
      );
    }
    await judging.refreshSubmissionStatus(eventId, submissionId);

    return successResponse(res, HTTP.CREATED, 'Score submitted successfully', result);
  } catch (error) { return errorFromException(res, next, error); }
};

/** Organisers see every score; a judge sees only their own (no anchoring on others). */
const getScores = async (req, res, next) => {
  try {
    const scores = await judgeService.getScores(req.params.eventId);
    if (isAdminUser(req.user)) return successResponse(res, HTTP.OK, 'OK', scores);
    return successResponse(res, HTTP.OK, 'OK', scores.filter((s) => Number(s.user_id) === Number(req.user.id)));
  } catch (error) { next(error); }
};

/** PUT /scores/:id — only the judge who gave the score (or an admin) may edit it. */
const updateScore = async (req, res, next) => {
  try {
    const { eventId, id } = req.params;
    const existing = await judgeService.getScoreById(id);
    if (!existing || String(existing.event_id) !== String(eventId)) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Score not found');
    }
    if (!isAdminUser(req.user) && Number(existing.judge_user_id) !== Number(req.user.id)) {
      return errorResponse(res, HTTP.FORBIDDEN, 'You can only edit your own scores', null, 'NOT_SCORE_OWNER');
    }
    if (isAdminUser(req.user)) judging.assertWindow(await judging.loadEvent(eventId));
    else await judging.assertCanScore(req.user.id, eventId, existing.submission_id);

    let score;
    if (req.body.score !== undefined) {
      score = parseScore(req.body.score);
      const max = Number(existing.max_score) || 10;
      if (!Number.isFinite(score) || score < 0 || score > max) {
        return errorResponse(res, HTTP.BAD_REQUEST, `Score must be a number between 0 and ${max}`, null, 'SCORE_OUT_OF_RANGE');
      }
    }

    const updated = await judgeService.updateScore(id, score, req.body.feedback);
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'Score not found');
    return successResponse(res, HTTP.OK, 'Score updated successfully', updated);
  } catch (error) { return errorFromException(res, next, error); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Leaderboard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ranking. Organisers see it live; everyone else only once results are
 * published with the full leaderboard visible (decision E8) — and then the
 * published ranking, not the live one.
 */
const getLeaderboard = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const shape = (r) => ({
      id: r.submissionId, team_id: r.teamId, team_name: r.teamName, project_name: r.projectName,
      place: r.place, percent: r.score, judges_count: r.judgesCount,
    });
    if (isAdminUser(req.user)) {
      const live = await results.ranking(eventId);
      return successResponse(res, HTTP.OK, 'OK', live.ranked.map(shape));
    }
    const event = await judging.loadEvent(eventId);
    const state = results.publishedState(event);
    if (!state || state.visibility !== 'full') {
      return errorResponse(res, HTTP.FORBIDDEN, 'Results are not published.', null, 'RESULTS_NOT_PUBLISHED');
    }
    const rows = await results.snapshot(eventId);
    return successResponse(res, HTTP.OK, 'OK', rows.map((r) => ({ ...shape(r), percent: state.showScores ? r.score : null })));
  } catch (error) { return errorFromException(res, next, error); }
};

/** GET /api/judge/me/events — event ids the current user judges. */
const getMyJudgeEventIds = async (req, res, next) => {
  try {
    const event_ids = await judgeService.listJudgeEventIdsForUser(req.user.id);
    return successResponse(res, HTTP.OK, 'OK', { event_ids });
  } catch (error) { next(error); }
};

module.exports = {
  getJudges,
  assignJudge,
  removeJudge,
  getCriteria,
  replaceCriteria,
  createCriterion,
  updateCriterion,
  deleteCriterion,
  submitScore,
  getScores,
  updateScore,
  getLeaderboard,
  getMyJudgeEventIds,
};
