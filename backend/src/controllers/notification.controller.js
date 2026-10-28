/**
 * @file notification.controller.js
 * @description The bell, and the calendar feeds.
 *
 *   GET  /api/me/notifications            newest first, unread count, role per event
 *   GET  /api/me/notifications/unread     the badge
 *   POST /api/me/notifications/read       { ids } | { all: true }
 *   GET  /api/me/calendar                 the personal feed's link
 *   POST /api/me/calendar/reset           a new link; the old one stops working
 *   GET  /api/calendar/:token.ics         the personal feed (public, signed link)
 *   GET  /api/public/events/:slug/calendar.ics  an event's public dates
 */

const notifications = require('../services/notification.service');
const calendar = require('../services/calendar.service');
const audit = require('../services/audit.service');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const wrap = (fn) => async (req, res, next) => {
  try {
    return await fn(req, res);
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

const list = wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  return successResponse(res, HTTP.OK, 'OK', await notifications.list(req.user, { limit: req.query.limit }));
});
const unread = wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  return successResponse(res, HTTP.OK, 'OK', await notifications.unreadCount(req.user.id));
});
const read = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await notifications.markRead(req.user.id, req.body || {})));

const feedInfo = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await calendar.feedInfo(req.user.id)));
const resetFeed = wrap(async (req, res) => {
  const out = await calendar.resetFeed(req.user.id);
  audit.record(req, 'calendar.feed.reset', { targetType: 'user', targetId: req.user.id });
  return successResponse(res, HTTP.OK, 'A new calendar link', out);
});

function sendIcs(res, ics, filename) {
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `inline; filename="${filename}.ics"`);
  // Calendar apps poll; a few minutes of caching spares the database.
  res.set('Cache-Control', 'private, max-age=300');
  return res.status(200).send(ics);
}

const personalFeed = wrap(async (req, res) => {
  const ics = await calendar.personalFeed(req.params.token);
  if (!ics) return errorResponse(res, HTTP.NOT_FOUND, 'Calendar not found', null, 'NOT_FOUND');
  return sendIcs(res, ics, 'hackos');
});

const publicFeed = wrap(async (req, res) => {
  const out = await calendar.publicFeed(req.params.slug);
  if (!out) return errorResponse(res, HTTP.NOT_FOUND, 'Calendar not found', null, 'NOT_FOUND');
  return sendIcs(res, out.ics, String(out.name).replace(/[^a-z0-9-]/gi, '') || 'event');
});

module.exports = { list, unread, read, feedInfo, resetFeed, personalFeed, publicFeed };
