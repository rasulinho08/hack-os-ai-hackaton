/**
 * @file checkin.controller.js
 * @description Check-in at the door (see checkin.service).
 *
 *   GET    /api/events/:eventId/checkin/me                     the caller's own ticket
 *   POST   /api/events/:eventId/checkin/scan                   { code, eventId? } organisers, volunteers
 *   GET    /api/events/:eventId/checkin/stats                  counts, organisers and volunteers
 *   GET    /api/events/:eventId/checkin                        ?q=&filter=all|in|out&limit=&offset= organisers
 *   GET    /api/events/:eventId/checkin/export.csv             organisers
 *   POST   /api/events/:eventId/checkin/participants/:pid      by hand, organisers
 *   DELETE /api/events/:eventId/checkin/participants/:pid      undo, organisers
 */

const checkin = require('../services/checkin.service');
const audit = require('../services/audit.service');
const { successResponse, errorFromException } = require('../utils/responseFormat');
const { sendCsv } = require('../utils/csv');
const { HTTP } = require('../constants/httpStatus');

const eventIdOf = (req) => Number(req.params.eventId);
const wrap = (fn) => async (req, res, next) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    return await fn(req, res);
  } catch (err) {
    return errorFromException(res, next, err);
  }
};
const ok = (res, data, message = 'OK') => successResponse(res, HTTP.OK, message, data);

/** The audit trail keeps every check-in and every undo (the table keeps only who is in now). */
function record(req, action, out, extra = {}) {
  return audit.record(req, action, {
    eventId: eventIdOf(req),
    targetType: 'participant',
    targetId: out.participant?.participantId,
    meta: extra,
  });
}

const mine = wrap(async (req, res) => ok(res, await checkin.ticketFor(req.user, eventIdOf(req))));

const scan = wrap(async (req, res) => {
  const out = await checkin.scan(req.user, eventIdOf(req), req.body);
  if (out.result === 'checked_in') await record(req, 'event.checkin', out, { method: 'qr' });
  return ok(res, out, out.result === 'checked_in' ? 'Checked in' : 'Seen');
});

const stats = wrap(async (req, res) => ok(res, await checkin.statsFor(req.user, eventIdOf(req))));

const list = wrap(async (req, res) => ok(res, await checkin.list(req.user, eventIdOf(req), req.query)));

const checkInById = wrap(async (req, res) => {
  const out = await checkin.checkInById(req.user, eventIdOf(req), req.params.participantId);
  if (out.result === 'checked_in') await record(req, 'event.checkin', out, { method: 'manual' });
  return ok(res, out, out.result === 'checked_in' ? 'Checked in' : 'Already checked in');
});

const undo = wrap(async (req, res) => {
  const out = await checkin.undo(req.user, eventIdOf(req), req.params.participantId);
  await record(req, 'event.checkin.undo', out, { wasCheckedInAt: out.wasCheckedInAt });
  return ok(res, out, 'Undone');
});

const exportCsv = async (req, res, next) => {
  try {
    const eventId = eventIdOf(req);
    const { columns, rows } = await checkin.exportRows(req.user, eventId);
    await audit.record(req, 'event.checkin.exported', { eventId, targetType: 'event', targetId: eventId, meta: { rows: rows.length } });
    return sendCsv(res, `checkin-${eventId}`, columns, rows);
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

module.exports = { mine, scan, stats, list, checkInById, undo, exportCsv };
