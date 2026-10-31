/**
 * @file certificate.controller.js
 * @description Certificates: the organiser's list and actions, a holder's
 * own, and the public check by code.
 *
 *   GET   /api/events/:eventId/certificates              organiser: issued certificates
 *   GET   /api/events/:eventId/certificates/plan         organiser: who would get which
 *   POST  /api/events/:eventId/certificates/issue        organiser: { kinds?, email? }
 *   POST  /api/events/:eventId/certificates/email        organiser: { ids? } (default: every one not sent)
 *   POST  /api/events/:eventId/certificates/:id/revoke   organiser
 *   POST  /api/events/:eventId/certificates/:id/restore  organiser
 *   GET   /api/events/:eventId/certificates/:id/pdf      organiser or the holder
 *   GET   /api/me/certificates                           the signed-in person's own
 *   GET   /api/public/certificates/:code                 anyone with the code
 *   GET   /api/public/certificates/:code/pdf             anyone with the code (410 when revoked)
 */

const db = require('../config/db');
const certificates = require('../services/certificate.service');
const jobs = require('../services/jobs.service');
const audit = require('../services/audit.service');
const { successResponse, errorFromException, httpError } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { isAdminUser } = require('../utils/authz');

const eventIdOf = (req) => Number(req.params.eventId);
const idOf = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw httpError(404, 'Certificate not found', 'NOT_FOUND');
  return n;
};
const wrap = (fn) => async (req, res, next) => {
  try {
    return await fn(req, res);
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

// The builder's names (winners) and the stored kinds (winner) are both accepted.
const KINDS = [...new Set([...Object.keys(certificates.TYPE_TO_KIND), ...Object.values(certificates.TYPE_TO_KIND)])];

function kindsFrom(body) {
  if (body?.kinds == null) return null;
  const list = Array.isArray(body.kinds) ? body.kinds : [body.kinds];
  const bad = list.filter((k) => !KINDS.includes(k));
  if (bad.length) {
    throw httpError(400, 'Unknown certificate kind.', 'VALIDATION_ERROR', { errors: [{ field: 'kinds', code: 'UNKNOWN', message: bad.join(', ') }] });
  }
  return list;
}

function sendPdf(res, bytes, code, inline) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="certificate-${code}.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(Buffer.from(bytes));
}

const list = wrap(async (req, res) => {
  const rows = await certificates.list(eventIdOf(req));
  return successResponse(res, HTTP.OK, 'OK', rows.map((c) => ({
    id: Number(c.id),
    code: c.code,
    kind: c.kind,
    place: c.place,
    title: c.title,
    name: c.recipient_name,
    email: c.email,
    teamName: c.team_name,
    userId: Number(c.user_id),
    issuedAt: c.issued_at,
    emailedAt: c.emailed_at,
    revokedAt: c.revoked_at,
  })));
});

const plan = wrap(async (req, res) => successResponse(res, HTTP.OK, 'OK', await certificates.planView(eventIdOf(req))));

const issue = wrap(async (req, res) => {
  const eventId = eventIdOf(req);
  const kinds = kindsFrom(req.body);
  const out = await certificates.issue(eventId, { kinds });
  let queued = 0;
  if (out.issued > 0 && req.body?.email !== false) {
    queued = (await certificates.queueEmails(eventId, null, jobs)).queued;
    try {
      // eslint-disable-next-line global-require
      await require('../services/autoAnnouncementPlanner').trigger(eventId, 'certs');
    } catch (err) {
      console.warn('[certificates] announcement not queued:', err.message);
    }
  }
  await audit.record(req, 'certificate.issued', { eventId, targetType: 'event', targetId: eventId, meta: { issued: out.issued, kinds: kinds || 'all' } });
  return successResponse(res, HTTP.OK, out.issued ? 'Certificates issued' : 'Nothing new to issue', { ...out, emailsQueued: queued });
});

const email = wrap(async (req, res) => {
  const eventId = eventIdOf(req);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : null;
  const out = await certificates.queueEmails(eventId, ids, jobs);
  await audit.record(req, 'certificate.emailed', { eventId, targetType: 'event', targetId: eventId, meta: { queued: out.queued } });
  return successResponse(res, HTTP.OK, 'E-mails queued', out);
});

const revoke = (revoked) => wrap(async (req, res) => {
  const eventId = eventIdOf(req);
  const out = await certificates.setRevoked(eventId, idOf(req), revoked);
  await audit.record(req, revoked ? 'certificate.revoked' : 'certificate.restored', { eventId, targetType: 'certificate', targetId: out.id });
  return successResponse(res, HTTP.OK, revoked ? 'Certificate revoked' : 'Certificate restored', { id: Number(out.id), revokedAt: out.revoked_at });
});

/** The organiser of the event, or the person it was issued to. */
const pdf = wrap(async (req, res) => {
  const r = await db.query('SELECT code, user_id FROM certificates WHERE id = $1 AND event_id = $2', [idOf(req), eventIdOf(req)]);
  const c = r.rows[0];
  const organiser = isAdminUser(req.user);
  if (!c || (!organiser && Number(c.user_id) !== Number(req.user.id))) throw httpError(404, 'Certificate not found', 'NOT_FOUND');
  const row = await certificates.byCode(c.code);
  if (row.revoked_at && !organiser) throw httpError(410, 'This certificate was revoked.', 'CERTIFICATE_REVOKED');
  return sendPdf(res, await certificates.pdfFor(row), row.code, req.query.inline === '1');
});

const mine = wrap(async (req, res) => {
  const rows = await certificates.mine(req.user.id);
  return successResponse(res, HTTP.OK, 'OK', rows.map((c) => ({
    code: c.code,
    kind: c.kind,
    place: c.place,
    title: c.title,
    issuedAt: c.issued_at,
    event: { id: Number(c.event_id), name: c.event_name },
    teamName: c.team_name,
    url: certificates.verifyUrl(c.code),
  })));
});

const publicView = wrap(async (req, res) => {
  const row = await certificates.byCode(req.params.code);
  if (!row) throw httpError(404, 'No certificate has this code.', 'NOT_FOUND');
  res.setHeader('Cache-Control', 'no-store');
  return successResponse(res, HTTP.OK, 'OK', certificates.publicView(row));
});

const publicPdf = wrap(async (req, res) => {
  const row = await certificates.byCode(req.params.code);
  if (!row) throw httpError(404, 'No certificate has this code.', 'NOT_FOUND');
  if (row.revoked_at) throw httpError(410, 'This certificate was revoked.', 'CERTIFICATE_REVOKED');
  return sendPdf(res, await certificates.pdfFor(row), row.code, req.query.inline === '1');
});

module.exports = { list, plan, issue, email, revoke: revoke(true), restore: revoke(false), pdf, mine, publicView, publicPdf };
