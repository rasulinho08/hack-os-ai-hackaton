/**
 * @file voting.controller.js
 * @description People's choice.
 *
 *   GET    /api/events/:eventId/voting      organiser: votes per project
 *   GET    /api/events/:eventId/voting/me   participant: projects and their vote
 *   POST   /api/events/:eventId/voting/me   participant: { submissionId }
 *   DELETE /api/events/:eventId/voting/me   participant: withdraw the vote
 */

const voting = require('../services/voting.service');
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

const tally = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await voting.tally(eventIdOf(req))));
const mine = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await voting.mine(eventIdOf(req), req.user.id)));
const vote = wrap(async (req, res) => successResponse(res, HTTP.OK, 'Vote saved', await voting.vote(eventIdOf(req), req.user.id, req.body?.submissionId)));
const withdraw = wrap(async (req, res) => successResponse(res, HTTP.OK, 'Vote withdrawn', await voting.withdraw(eventIdOf(req), req.user.id)));

module.exports = { tally, mine, vote, withdraw };
