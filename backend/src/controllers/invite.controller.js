/**
 * @file invite.controller.js
 * @description HTTP handlers for event-level admin invitations.
 */

const db = require('../config/db');
const inviteService = require('../services/invite.service');
const judgeService = require('../services/judge.service');
const mentorService = require('../services/mentor.service');
const volunteerService = require('../services/volunteer.service');
const participantService = require('../services/participant.service');
const audit = require('../services/audit.service');
const emailService = require('../services/email.service');
const { eventSender } = require('../services/eventSender');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const { successResponse, errorResponse } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { ROLES } = require('../constants/roles');
const inviteTokens = require('../services/inviteToken');
const verification = require('../services/emailVerification.service');
const authController = require('./auth.controller');

/** Roles that can be assigned via event invites */
const INVITABLE_ROLES = [ROLES.HACKER, ROLES.MENTOR, ROLES.JUDGE, ROLES.VOLUNTEER];

const list = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const data = await inviteService.listInvites(eventId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const add = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const { email, role } = req.body;
    if (!email || !role) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'email and role are required');
    }
    if (!INVITABLE_ROLES.includes(role)) {
      return errorResponse(
        res, HTTP.BAD_REQUEST,
        `role must be one of: ${INVITABLE_ROLES.join(', ')}`
      );
    }
    const row = await inviteService.addInvite(eventId, email, role, req.body.meta);
    const meta = row.meta || {};

    /*
     * Someone who already has an account is put on the event straight away.
     * The invite used to wait for a registration that never came, because
     * the person was registered already — so an existing account could
     * never be made a judge or mentor of a second event.
     */
    const normalized = String(email).trim().toLowerCase();
    const found = await db.query(
      'SELECT id, full_name, email_verified_at FROM users WHERE LOWER(TRIM(email)) = $1',
      [normalized],
    );
    if (found.rows[0] && !found.rows[0].email_verified_at) {
      /*
       * An account with this address exists but nobody has shown it is
       * theirs: anyone can sign up with any address. The invitation waits
       * for the confirmation, which hands it over; the account gets a fresh
       * confirmation link that says so.
       */
      const account = found.rows[0];
      const eventInfo = await inviteService.getEventInfo(eventId);
      if ((await verification.cooldownLeft(account.id)) === 0) {
        const link = await verification.createToken(account.id, normalized);
        authController.sendVerification({
          to: normalized,
          fullName: account.full_name,
          token: link.token,
          lang: eventInfo?.language || 'en',
          invite: { eventName: eventInfo?.name, role },
        });
      }
      audit.record(req, 'event.invite.awaiting_verification', { eventId: Number(eventId), targetType: 'user', targetId: account.id, meta: { role } });
      return successResponse(res, HTTP.CREATED, 'Invite created: it opens when the account confirms its e-mail', { ...row, assigned: false, awaitingVerification: true });
    }
    if (found.rows[0]) {
      const account = found.rows[0];
      if (role === ROLES.JUDGE) await judgeService.assignJudge(eventId, account.id);
      else if (role === ROLES.MENTOR) await mentorService.assignMentor(eventId, account.id, req.body.expertise ?? meta.expertise, req.body.availability);
      else if (role === ROLES.VOLUNTEER) await volunteerService.addVolunteer(eventId, normalized, req.body.assignedTasks ?? req.body.assigned_tasks ?? meta.tasks);
      else if (role === ROLES.HACKER) await participantService.addParticipant(account.id, eventId, 'approved');
      await inviteService.markInviteUsed(row.id, account.id);
      audit.record(req, 'event.staff.add', { eventId: Number(eventId), targetType: 'user', targetId: account.id, meta: { role } });

      const eventInfo = await inviteService.getEventInfo(eventId);
      emailService.sendAddedToEventEmail({
        to: normalized,
        fullName: account.full_name,
        role,
        eventName: eventInfo?.name,
        frontendUrl: resolveFrontendBaseUrl(),
        inviterName: req.user?.full_name,
        sender: await eventSender(eventId),
      });
      return successResponse(res, HTTP.CREATED, 'Added to the event', { ...row, assigned: true, used_at: new Date().toISOString() });
    }

    // Event-invite row emails (judge/mentor/hacker links) are OFF by default.
    // Use dashboard "Send registration link" for staff, or set SEND_EMAIL_ON_EVENT_INVITE=true.
    const sendOnInvite =
      String(process.env.SEND_EMAIL_ON_EVENT_INVITE || '').trim().toLowerCase() === 'true';
    // Said in the answer, so the organiser knows whether to pass the link on themselves.
    let emailed = false;
    if (sendOnInvite) {
      const eventInfo = await inviteService.getEventInfo(eventId);
      if (eventInfo) {
        emailed = true;
        const frontendUrl = resolveFrontendBaseUrl();
        emailService
          .sendInviteEmail({
            to: email,
            role,
            eventName: eventInfo.name,
            eventCode: eventInfo.event_code,
            frontendUrl,
            inviterName: req.user?.full_name,
            sender: await eventSender(eventId),
            inviteToken: inviteTokens.sign(row, 'mail'),
          })
          .catch((err) => {
            console.error('[Invite] Email send failed:', err.message);
          });
      }
    }

    return successResponse(res, HTTP.CREATED, 'Invite created successfully', { ...row, emailed });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/events/:eventId/invites/:id/link — the invitation's own sign-up
 * link, for the organiser to pass on in a chat or by phone when e-mail is
 * not an option. It opens this one invitation for its address, and only
 * until the invitation is used or deleted.
 */
const link = async (req, res, next) => {
  try {
    const { eventId, id } = req.params;
    const invite = (await db.query(
      `SELECT ei.id, ei.email, ei.role, ei.used_at, ei.revoked_at, ei.expires_at, ei.token_nonce, e.event_code
         FROM event_invites ei JOIN events e ON e.id = ei.event_id
        WHERE ei.id = $1 AND ei.event_id = $2`,
      [id, eventId],
    )).rows[0];
    if (!invite) return errorResponse(res, HTTP.NOT_FOUND, 'Invite not found', null, 'NOT_FOUND');
    if (invite.used_at) return errorResponse(res, HTTP.CONFLICT, 'This invitation has already been used.', null, 'INVITE_USED');
    if (invite.revoked_at) return errorResponse(res, HTTP.CONFLICT, 'This invitation was withdrawn.', null, 'INVITE_REVOKED');
    if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
      return errorResponse(res, HTTP.CONFLICT, 'This invitation has expired.', null, 'INVITE_EXPIRED');
    }
    const url = emailService.buildInviteRegisterUrl(
      resolveFrontendBaseUrl(), invite.event_code, invite.email, inviteTokens.sign(invite, 'link'),
    );
    audit.record(req, 'event.invite.link', { eventId: Number(eventId), targetType: 'invite', targetId: invite.id, meta: { role: invite.role } });
    return successResponse(res, HTTP.OK, 'OK', { url, email: invite.email, role: invite.role });
  } catch (error) {
    next(error);
  }
};

const remove = async (req, res, next) => {
  try {
    const { eventId, id } = req.params;
    const deleted = await inviteService.deleteInvite(eventId, id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Dəvət tapılmadı' });
    }
    res.status(200).json({ success: true, message: 'Dəvət silindi' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  list,
  add,
  link,
  remove,
};
