/**
 * @file results.controller.js
 * @description Results: the organiser's ranking and publishing, the
 * winners of special prizes, and what a participant sees.
 *
 *   GET   /api/events/:eventId/results                    organiser
 *   POST  /api/events/:eventId/results/publish            organiser: { visibility?, showScores?, confirmIncomplete?, confirmOutdated? }
 *   GET   /api/events/:eventId/results/outdated           organiser: reviews older than their project's last change
 *   POST  /api/events/:eventId/results/recheck            organiser: { judgeIds? } ask those judges to look again
 *   POST  /api/events/:eventId/results/unpublish          organiser
 *   PATCH /api/events/:eventId/results/prizes/:prizeId    organiser: { teamId | null }
 *   GET   /api/events/:eventId/results/me                 participant
 */

const results = require('../services/results.service');
const audit = require('../services/audit.service');
const { successResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const eventIdOf = (req) => Number(req.params.eventId);
const wrap = (fn) => async (req, res, next) => {
  try {
    return await fn(req, res);
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

const organiser = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await results.organiserResults(eventIdOf(req))));

const publish = wrap(async (req, res) => {
  const out = await results.publish(eventIdOf(req), req.user.id, {
    visibility: req.body?.visibility,
    showScores: req.body?.showScores,
    confirmIncomplete: req.body?.confirmIncomplete === true,
    confirmOutdated: req.body?.confirmOutdated === true,
  });
  await audit.record(req, 'results.published', {
    eventId: eventIdOf(req),
    targetType: 'event',
    targetId: eventIdOf(req),
    meta: {
      teams: out.teams,
      visibility: out.published?.visibility,
      showScores: out.published?.showScores,
      judgingIncomplete: out.judgingIncomplete,
      certificates: out.certificates.reason || 'issuing',
      // Published over outdated reviews: the organiser confirmed it.
      ...(out.outdated ? { confirmOutdated: true, outdatedReviews: out.outdated.count, outdatedJudges: out.outdated.judges, outdatedTeams: out.outdated.teams } : {}),
    },
  });
  return successResponse(res, HTTP.OK, 'Results published', out);
});

const outdated = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await results.outdatedReviews(eventIdOf(req))));

const recheck = wrap(async (req, res) => {
  const raw = req.body?.judgeIds;
  const judgeIds = Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500) : null;
  const out = await results.requestRecheck(eventIdOf(req), { judgeIds });
  await audit.record(req, 'results.recheck_requested', {
    eventId: eventIdOf(req),
    targetType: 'event',
    targetId: eventIdOf(req),
    meta: { judges: out.judges, notified: out.notified, emailed: out.emailed, skipped: out.skipped, outdated: out.outdated },
  });
  return successResponse(res, HTTP.OK, 'Judges asked to look again', out);
});

const unpublish = wrap(async (req, res) => {
  const out = await results.unpublish(eventIdOf(req));
  await audit.record(req, 'results.unpublished', { eventId: eventIdOf(req), targetType: 'event', targetId: eventIdOf(req), meta: { certificatesRevoked: out.certificatesRevoked } });
  return successResponse(res, HTTP.OK, 'Results unpublished', out);
});

const setPrizeWinner = wrap(async (req, res) => {
  const raw = req.body?.teamId;
  const out = await results.setPrizeWinner(eventIdOf(req), Number(req.params.prizeId), raw == null || raw === '' ? null : Number(raw));
  await audit.record(req, 'results.prize_winner', { eventId: eventIdOf(req), targetType: 'prize', targetId: out.prizeId, meta: { teamId: out.teamId } });
  return successResponse(res, HTTP.OK, 'Winner saved', out);
});

const mine = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await results.participantResults(req.user.id, eventIdOf(req))));

module.exports = { organiser, publish, unpublish, setPrizeWinner, mine, outdated, recheck };
