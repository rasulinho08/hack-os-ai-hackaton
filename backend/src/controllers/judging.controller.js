/**
 * @file judging.controller.js
 * @description The judge portal (their teams, one review at a time, the
 * conflict-of-interest declaration) and the organiser's judging tools
 * (assignments, conflicts, tracks, progress). Rules live in judging.service.
 *
 *   GET    /api/events/:eventId/judging/me                  judge: what to judge
 *   POST   /api/events/:eventId/judging/me/reviews          judge: save one review
 *   POST   /api/events/:eventId/judging/me/coi              judge: confirm the declaration
 *   POST   /api/events/:eventId/judging/me/conflicts        judge: declare a conflict { teamId, reason }
 *   DELETE /api/events/:eventId/judging/me/conflicts/:teamId
 *   PATCH  /api/events/:eventId/judging/judges/:id          organiser: { trackId }
 *   GET    /api/events/:eventId/judging/conflicts           organiser
 *   POST   /api/events/:eventId/judging/conflicts           organiser: { judgeId, teamId, reason }
 *   DELETE /api/events/:eventId/judging/conflicts/:id       organiser
 *   GET    /api/events/:eventId/judging/assignments         organiser
 *   POST   /api/events/:eventId/judging/assignments/generate organiser: { replace }
 *   PUT    /api/events/:eventId/judging/assignments/:judgeId organiser: { teamIds }
 *   GET    /api/events/:eventId/judging/progress            organiser: the matrix
 *   GET    /api/events/:eventId/judging/history             organiser: every score given or changed
 *                                                           (?submissionId=&judgeId=)
 *   GET    /api/events/:eventId/judging/repo-checks         organiser: the GitHub check per project
 *   POST   /api/events/:eventId/judging/repo-checks         organiser: check again { submissionIds? }
 */

const db = require('../config/db');
const judging = require('../services/judging.service');
const audit = require('../services/audit.service');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const eventIdOf = (req) => Number(req.params.eventId);
const wrap = (fn) => async (req, res, next) => {
  try {
    return await fn(req, res);
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

const me = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await judging.myJudging(req.user.id, eventIdOf(req))));

const saveReview = wrap(async (req, res) => {
  const out = await judging.saveReview(req.user.id, eventIdOf(req), req.body || {});
  return successResponse(res, HTTP.OK, 'Review saved', out);
});

const confirmCoi = wrap(async (req, res) => successResponse(res, HTTP.OK, 'Thank you', await judging.confirmCoi(req.user.id, eventIdOf(req))));

const declareMine = wrap(async (req, res) => {
  const judge = await judging.judgeFor(req.user.id, eventIdOf(req));
  if (!judge) return errorResponse(res, HTTP.FORBIDDEN, 'You are not a judge for this event', null, 'NOT_EVENT_JUDGE');
  const row = await judging.declareConflict(eventIdOf(req), judge.id, Number(req.body?.teamId), req.body?.reason, req.user.id);
  return successResponse(res, HTTP.CREATED, 'Conflict recorded', row);
});

const clearMine = wrap(async (req, res) => {
  const judge = await judging.judgeFor(req.user.id, eventIdOf(req));
  if (!judge) return errorResponse(res, HTTP.FORBIDDEN, 'You are not a judge for this event', null, 'NOT_EVENT_JUDGE');
  const ok = await judging.clearConflict(eventIdOf(req), judge.id, Number(req.params.teamId));
  if (!ok) return errorResponse(res, HTTP.NOT_FOUND, 'No such conflict', null, 'NOT_FOUND');
  return successResponse(res, HTTP.OK, 'Conflict removed');
});

const setTrack = wrap(async (req, res) => {
  const raw = req.body?.trackId;
  const row = await judging.setJudgeTrack(eventIdOf(req), Number(req.params.id), raw == null || raw === '' ? null : Number(raw));
  return successResponse(res, HTTP.OK, 'Judge updated', row);
});

const listConflicts = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await judging.listConflicts(eventIdOf(req))));

const declareFor = wrap(async (req, res) => {
  const row = await judging.declareConflict(eventIdOf(req), Number(req.body?.judgeId), Number(req.body?.teamId), req.body?.reason, req.user.id);
  await audit.record(req, 'judging.conflict', { eventId: eventIdOf(req), targetType: 'team', targetId: row.team_id, meta: { judgeId: row.judge_id } });
  return successResponse(res, HTTP.CREATED, 'Conflict recorded', row);
});

const clearById = wrap(async (req, res) => {
  const r = await db.query('DELETE FROM judge_conflicts WHERE id = $1 AND event_id = $2 RETURNING id', [Number(req.params.id), eventIdOf(req)]);
  if (!r.rows[0]) return errorResponse(res, HTTP.NOT_FOUND, 'No such conflict', null, 'NOT_FOUND');
  return successResponse(res, HTTP.OK, 'Conflict removed');
});

const listAssignments = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await judging.listAssignments(eventIdOf(req))));

const generate = wrap(async (req, res) => {
  const out = await judging.generateAssignments(eventIdOf(req), { replace: req.body?.replace === true });
  await audit.record(req, 'judging.assignments', { eventId: eventIdOf(req), targetType: 'event', targetId: eventIdOf(req), meta: { assigned: out.assigned, replace: req.body?.replace === true } });
  return successResponse(res, HTTP.OK, 'Assignments made', out);
});

const setForJudge = wrap(async (req, res) => {
  const ids = await judging.setAssignments(eventIdOf(req), Number(req.params.judgeId), req.body?.teamIds);
  return successResponse(res, HTTP.OK, 'Assignments saved', { judgeId: Number(req.params.judgeId), teamIds: ids });
});

const progress = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await judging.progress(eventIdOf(req))));

const optionalId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const history = wrap(async (req, res) => {
  // eslint-disable-next-line global-require
  const { history: list } = require('../services/judgeAudit.service');
  return successResponse(res, HTTP.OK, 'OK', await list(eventIdOf(req), {
    submissionId: optionalId(req.query.submissionId), judgeId: optionalId(req.query.judgeId), limit: req.query.limit,
  }));
});

const repoChecks = wrap(async (req, res) => {
  // eslint-disable-next-line global-require
  const repoCheck = require('../services/repoCheck.service');
  const ev = (await db.query('SELECT submission_config FROM events WHERE id = $1', [eventIdOf(req)])).rows[0];
  return successResponse(res, HTTP.OK, 'OK', {
    enabled: Boolean(ev?.submission_config?.githubCheck),
    projects: await repoCheck.listForEvent(eventIdOf(req)),
  });
});

const runRepoChecks = wrap(async (req, res) => {
  // eslint-disable-next-line global-require
  const repoCheck = require('../services/repoCheck.service');
  // eslint-disable-next-line global-require
  const jobs = require('../services/jobs.service');
  const out = await repoCheck.queueForEvent(eventIdOf(req), req.body?.submissionIds, jobs);
  await audit.record(req, 'judging.repo_check', { eventId: eventIdOf(req), targetType: 'event', targetId: eventIdOf(req), meta: { queued: out.queued } });
  return successResponse(res, HTTP.OK, 'Checks queued', out);
});

module.exports = {
  me, saveReview, confirmCoi, declareMine, clearMine, setTrack, listConflicts, declareFor, clearById,
  listAssignments, generate, setForJudge, progress, history, repoChecks, runRepoChecks,
};
