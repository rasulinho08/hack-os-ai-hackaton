/**
 * @file publicProjects.controller.js
 * @description The public page of an event's projects.
 *
 *   GET /api/public/events/:slug/projects                anyone (404 while closed)
 *   GET /api/events/:eventId/results/projects            organiser: the switch and the counts
 *   PUT /api/events/:eventId/results/projects            organiser: { public: boolean }
 *   GET /api/events/:eventId/results/projects/mine       participant: their team's state
 *   PUT /api/events/:eventId/results/projects/mine       team lead: { hidden: boolean }
 */

const projects = require('../services/publicProjects.service');
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

const publicList = wrap(async (req, res) => {
  const data = await projects.publicProjects(req.params.slug);
  if (!data) {
    res.set('Cache-Control', 'no-store');
    return errorResponse(res, HTTP.NOT_FOUND, 'This event has no public project page.', null, 'NOT_FOUND');
  }
  // Short: closing the page or hiding a project shows within a minute.
  res.set('Cache-Control', 'public, max-age=60');
  return successResponse(res, HTTP.OK, 'OK', data);
});

const organiserState = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await projects.organiserState(eventIdOf(req))));

const setPublic = wrap(async (req, res) => {
  const out = await projects.setPublic(eventIdOf(req), req.body?.public);
  await audit.record(req, out.public ? 'projects.public_on' : 'projects.public_off', { eventId: eventIdOf(req), targetType: 'event', targetId: eventIdOf(req) });
  return successResponse(res, HTTP.OK, out.public ? 'The projects page is open' : 'The projects page is closed', out);
});

const mine = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await projects.mine(req.user.id, eventIdOf(req))));

const setHidden = wrap(async (req, res) => {
  const out = await projects.setHidden(req.user.id, eventIdOf(req), req.body?.hidden);
  await audit.record(req, out.team?.hidden ? 'projects.team_hidden' : 'projects.team_shown', { eventId: eventIdOf(req), targetType: 'team', targetId: out.teamId });
  return successResponse(res, HTTP.OK, out.team?.hidden ? 'Your project is kept off the public page' : 'Your project is on the public page', out);
});

module.exports = { publicList, organiserState, setPublic, mine, setHidden };
