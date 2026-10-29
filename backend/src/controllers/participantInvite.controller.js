/**
 * @file participantInvite.controller.js
 * @description The organiser's Invitations screen (participantInvite.service.js).
 *
 *   GET  /api/events/:eventId/participant-invites             the list, counts and capacity
 *   POST /api/events/:eventId/participant-invites             { invitees: [{ email, fullName?, team? }], expiresInDays? }
 *   POST /api/events/:eventId/participant-invites/resend      { ids }
 *   POST /api/events/:eventId/participant-invites/revoke      { ids }
 *   GET  /api/events/:eventId/participant-invites/:id/link    the personal link, to pass on by hand
 *   GET  /api/events/:eventId/participant-invites/export.csv  every invitation, spreadsheet-safe
 *   GET  /api/public/invitations/:token                       what the registration page needs (public)
 *
 * Only the event's organisers reach the first six (eventAccess + admin role).
 * Every action is in the audit log, one row per invitation it touched.
 */

const invites = require('../services/participantInvite.service');
const audit = require('../services/audit.service');
const { sendCsv } = require('../utils/csv');
const { successResponse, errorFromException, httpError } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const eventIdOf = (req) => Number(req.params.eventId);
const wrap = (fn) => async (req, res, next) => {
  try {
    return await fn(req, res);
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

const list = wrap(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return successResponse(res, HTTP.OK, 'OK', await invites.list(eventIdOf(req)));
});

const create = wrap(async (req, res) => {
  const out = await invites.create(eventIdOf(req), req.user, req.body || {});
  const failed = new Set(out.failedIds);
  await audit.recordMany(req, 'invitation.sent', {
    eventId: eventIdOf(req),
    targetType: 'invite',
    items: [...out.created, ...out.reinvited].map((id) => ({ targetId: id, meta: { again: out.reinvited.includes(id), emailed: !failed.has(id) } })),
  });
  return successResponse(res, HTTP.CREATED, 'Invitations sent', out);
});

const resend = wrap(async (req, res) => {
  const out = await invites.resend(eventIdOf(req), req.user, req.body?.ids);
  await audit.recordMany(req, 'invitation.resent', {
    eventId: eventIdOf(req),
    targetType: 'invite',
    items: [...out.sentIds, ...out.failedIds].map((id) => ({ targetId: id, meta: { emailed: out.sentIds.includes(id) } })),
  });
  return successResponse(res, HTTP.OK, 'Invitations sent again', out);
});

const revoke = wrap(async (req, res) => {
  const out = await invites.revoke(eventIdOf(req), req.user, req.body?.ids);
  await audit.recordMany(req, 'invitation.revoked', {
    eventId: eventIdOf(req),
    targetType: 'invite',
    items: out.revoked.map((id) => ({ targetId: id })),
  });
  return successResponse(res, HTTP.OK, 'Invitations withdrawn', out);
});

const link = wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw httpError(404, 'Invitation not found', 'NOT_FOUND');
  const out = await invites.link(eventIdOf(req), id);
  await audit.record(req, 'invitation.link_copied', { eventId: eventIdOf(req), targetType: 'invite', targetId: id });
  res.setHeader('Cache-Control', 'private, no-store');
  return successResponse(res, HTTP.OK, 'OK', out);
});

const COLUMNS = [
  { key: 'email', header: 'E-mail' },
  { key: 'fullName', header: 'Name' },
  { key: 'team', header: 'Team' },
  { key: 'status', header: 'Status' },
  { key: 'sentAt', header: 'Sent' },
  { key: 'sendCount', header: 'Times sent' },
  { key: 'openedAt', header: 'Opened' },
  { key: 'registeredAt', header: 'Registered' },
  { key: 'participantStatus', header: 'Registration status' },
  { key: 'expiresAt', header: 'Expires' },
  { key: 'revokedAt', header: 'Withdrawn' },
  { key: 'invitedBy', header: 'Invited by' },
];

const exportCsv = wrap(async (req, res) => {
  const rows = await invites.exportRows(eventIdOf(req));
  await audit.record(req, 'invitation.exported', { eventId: eventIdOf(req), targetType: 'event', targetId: eventIdOf(req), meta: { rows: rows.length } });
  return sendCsv(res, `invitations-${eventIdOf(req)}`, COLUMNS, rows);
});

const preview = wrap(async (req, res) => {
  const out = await invites.preview(String(req.params.token || '').slice(0, 200));
  res.setHeader('Cache-Control', 'private, no-store');
  if (!out) throw httpError(404, 'This invitation link is not valid.', 'INVALID_INVITE_TOKEN');
  return successResponse(res, HTTP.OK, 'OK', out);
});

module.exports = { list, create, resend, revoke, link, exportCsv, preview, COLUMNS };
