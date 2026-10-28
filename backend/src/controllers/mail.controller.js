/**
 * @file mail.controller.js
 * @description
 *   GET  /api/mail/status        → which provider and sender are configured (admin)
 *   POST /api/mail/test          → send a test e-mail to the caller's own address (admin)
 *   POST /api/mail/staff-invite  → (re)send an event invite to an invited address (admin)
 *
 * The staff invite used to take the recipient, the link and the event name
 * straight from the request body, which let any organiser account send a
 * HackOS-branded e-mail with any link to any address. Now the body only
 * names who and which event; the address must hold a pending invite on an
 * event the caller may manage, and the event name and link are built here.
 */

const emailService = require('../services/email.service');
const { eventSender } = require('../services/eventSender');
const inviteService = require('../services/invite.service');
const inviteTokens = require('../services/inviteToken');
const { userMayAccessEvent } = require('../services/tenantAccess.service');
const { pickFrontendBase, resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const { successResponse, errorResponse } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const getStatus = (req, res) => successResponse(res, HTTP.OK, 'OK', emailService.getMailReadiness());

const failure = (res, out) =>
  errorResponse(res, out.status && out.status >= 400 ? out.status : HTTP.INTERNAL_ERROR, out.message || 'E-mail not sent');

/** The event id from the body, or from the eventId query of the old inviteUrl field. */
function eventIdFromBody(body) {
  const direct = Number.parseInt(String(body?.eventId ?? ''), 10);
  if (Number.isInteger(direct) && direct > 0) return direct;
  try {
    const fromUrl = Number.parseInt(new URL(String(body?.inviteUrl || '')).searchParams.get('eventId') || '', 10);
    return Number.isInteger(fromUrl) && fromUrl > 0 ? fromUrl : null;
  } catch (_) {
    return null;
  }
}

const postStaffInvite = async (req, res, next) => {
  try {
    const to = String(req.body?.to || '').trim().toLowerCase();
    const eventId = eventIdFromBody(req.body);
    if (!to || !eventId) return errorResponse(res, HTTP.BAD_REQUEST, 'Missing fields: to, eventId');

    if (!(await userMayAccessEvent(req.user, eventId))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Event not found');
    }
    const invite = await inviteService.findPendingInvite(eventId, to);
    if (!invite) {
      return errorResponse(res, HTTP.NOT_FOUND, 'This address has no pending invite for the event. Add it to the roster first.');
    }
    const event = await inviteService.getEventInfo(eventId);
    if (!event) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found');

    const out = await emailService.sendEventInviteEmail({
      to,
      role: invite.role,
      eventName: event.name,
      eventCode: event.event_code,
      frontendUrl: pickFrontendBase(req.body?.inviteUrl || req.get('origin')),
      inviterName: req.user.full_name,
      sender: await eventSender(eventId),
      // Signing up through this link hands the invitation over at once and
      // proves the address (the link came to it).
      inviteToken: inviteTokens.sign(invite, 'mail'),
    });
    if (!out.ok) return failure(res, out);
    return successResponse(res, HTTP.OK, 'Invite e-mail sent', { sent: true, provider: out.provider });
  } catch (error) {
    next(error);
  }
};

const postTest = async (req, res, next) => {
  try {
    const to = String(req.user?.email || '').trim();
    if (!to) return errorResponse(res, HTTP.BAD_REQUEST, 'Your account has no e-mail address');
    const out = await emailService.sendTestEmail({ to, frontendUrl: resolveFrontendBaseUrl() });
    if (!out.ok) return failure(res, out);
    return successResponse(res, HTTP.OK, `Test e-mail sent to ${to}`, {
      sent: true,
      to,
      provider: out.provider,
      logged: Boolean(out.logged),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getStatus, postStaffInvite, postTest };
