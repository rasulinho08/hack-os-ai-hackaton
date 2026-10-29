/**
 * @file elimination.controller.js
 * @description Elimination rounds, for organisers.
 *
 *   GET    /api/events/:eventId/elimination/rounds
 *   POST   /api/events/:eventId/elimination/rounds                 { name, note }
 *   PATCH  /api/events/:eventId/elimination/rounds/:id             { name?, note? }
 *   DELETE /api/events/:eventId/elimination/rounds/:id
 *   POST   /api/events/:eventId/elimination/rounds/:id/eliminate   { teamIds, reason }
 *   POST   /api/events/:eventId/elimination/teams/:teamId/restore
 *   GET    /api/events/:eventId/elimination/suggest?keep=10
 */

const elimination = require('../services/elimination.service');
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

const list = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await elimination.listRounds(eventIdOf(req))));

const create = wrap(async (req, res) => {
  const round = await elimination.createRound(eventIdOf(req), req.body || {}, req.user.id);
  await audit.record(req, 'elimination.round', { eventId: eventIdOf(req), targetType: 'round', targetId: round.id, meta: { name: round.name } });
  return successResponse(res, HTTP.CREATED, 'Round created', round);
});

const update = wrap(async (req, res) => successResponse(res, HTTP.OK, 'Round updated', await elimination.updateRound(eventIdOf(req), Number(req.params.id), req.body || {})));

const remove = wrap(async (req, res) => {
  await elimination.deleteRound(eventIdOf(req), Number(req.params.id));
  return successResponse(res, HTTP.OK, 'Round deleted');
});

const eliminate = wrap(async (req, res) => {
  const out = await elimination.eliminate(eventIdOf(req), Number(req.params.id), req.body?.teamIds, req.body?.reason);
  await audit.record(req, 'elimination.applied', { eventId: eventIdOf(req), targetType: 'round', targetId: Number(req.params.id), meta: { count: out.eliminated.length } });
  return successResponse(res, HTTP.OK, 'Teams eliminated', out);
});

const restore = wrap(async (req, res) => {
  const team = await elimination.restore(eventIdOf(req), Number(req.params.teamId));
  await audit.record(req, 'elimination.restored', { eventId: eventIdOf(req), targetType: 'team', targetId: team.id });
  return successResponse(res, HTTP.OK, 'Team restored', team);
});

const suggest = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await elimination.suggest(eventIdOf(req), req.query.keep)));

module.exports = { list, create, update, remove, eliminate, restore, suggest };
