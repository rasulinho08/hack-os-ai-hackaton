/**
 * @file tenancy.controller.js
 * @description The team screen a customer administers for itself, and the
 * owner-side controls over seats and event ownership.
 *
 * The authorization rule that runs through all of it: **the customer comes from
 * the session, never from the request**. A customer administrator managing
 * their own team cannot name a different customer, so there is no id to
 * tamper with. Only a platform owner may pass `customerId`, and only because
 * they can already read every customer anyway.
 */

const audit = require('../services/audit.service');
const tenancy = require('../services/tenancy.service');
const { successResponse, errorResponse, httpError } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { isOwnerUser } = require('../utils/authz');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const { sendCustomerInviteEmail, isMailConfigured } = require('../services/email.service');

/**
 * Which customer this request is allowed to act on.
 *
 * For an owner, `customerId` in the query or body names it. For everybody else
 * it is whichever customer their account belongs to, full stop. A customer
 * administrator with no customer gets a 403 rather than an empty screen,
 * because "you are not on a team" and "your team is empty" are different
 * answers and only one of them is actionable.
 */
async function resolveScope(req) {
  if (isOwnerUser(req.user)) {
    const asked = req.query.customerId ?? req.body?.customerId ?? req.params.customerId;
    if (asked != null && String(asked).trim() !== '') {
      const id = Number(asked);
      if (!Number.isInteger(id)) {
        throw httpError(400, 'customerId must be a number', 'VALIDATION_ERROR');
      }
      return id;
    }
  }
  const mine = await tenancy.getCustomerForUser(req.user.id);
  if (!mine) {
    throw httpError(
      403,
      'Your account is not attached to a customer, so there is no team to manage.',
      'NO_CUSTOMER',
    );
  }
  return mine.id;
}

/** Everything the team screen needs, in one read. */
const getTeam = async (req, res, next) => {
  try {
    const customerId = await resolveScope(req);
    const [seats, members, invites] = await Promise.all([
      tenancy.getSeatUsage(customerId),
      tenancy.listMembers(customerId),
      tenancy.listInvites(customerId),
    ]);
    return successResponse(res, HTTP.OK, 'OK', { customerId, seats, members, invites });
  } catch (error) { next(error); }
};

const getSeats = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await tenancy.getSeatUsage(await resolveScope(req)));
  } catch (error) { next(error); }
};

const listMembers = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await tenancy.listMembers(await resolveScope(req)));
  } catch (error) { next(error); }
};

/**
 * Give up a seat.
 *
 * Refuses to remove the caller's own membership: an administrator who removes
 * themselves loses the screen they would need to undo it, and on a
 * single-member team that leaves the customer with nobody who can invite.
 */
const removeMember = async (req, res, next) => {
  try {
    const customerId = await resolveScope(req);
    const members = await tenancy.listMembers(customerId);
    const target = members.find((m) => String(m.id) === String(req.params.contactId));
    if (!target) return errorResponse(res, HTTP.NOT_FOUND, 'Contact not found');
    if (target.user_id && target.user_id === req.user.id && !isOwnerUser(req.user)) {
      return errorResponse(
        res, HTTP.CONFLICT,
        'You cannot remove your own seat. Ask a colleague, or contact us.',
        null, 'CANNOT_REMOVE_SELF',
      );
    }
    const removed = await tenancy.removeMember(customerId, req.params.contactId);
    return successResponse(res, HTTP.OK, 'Seat released', removed);
  } catch (error) { next(error); }
};

const listInvites = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await tenancy.listInvites(await resolveScope(req)));
  } catch (error) { next(error); }
};

/**
 * Invite a colleague.
 *
 * The response says whether the mail actually went out. Reporting "invited"
 * when SMTP is not configured would leave the inviter waiting for a delivery
 * that never happens, so the link comes back in the payload for them to send by
 * hand — which is also the honest answer on a free tier with no mail service.
 */
const createInvite = async (req, res, next) => {
  try {
    const customerId = await resolveScope(req);
    const { email, fullName, roleTitle, grantRole } = req.body || {};

    const { invite, token, customerName } = await tenancy.createInvite({
      customerId,
      email,
      fullName,
      roleTitle,
      grantRole,
      invitedBy: req.user.id,
    });

    const acceptUrl = `${resolveFrontendBaseUrl().replace(/\/+$/, '')}/invite/${token}`;

    // A failed send is not a failed invite — the row is committed and the link
    // below still works either way. The mailer reports rather than throws, so
    // the only thing to do here is pass the truth on to the caller.
    let emailed = false;
    if (isMailConfigured()) {
      const sent = await sendCustomerInviteEmail({
        to: invite.email,
        customerName,
        inviterName: req.user.full_name,
        inviteUrl: acceptUrl,
        expiresInDays: tenancy.INVITE_TTL_DAYS,
      });
      emailed = sent.ok === true;
      if (!emailed) console.error('[tenancy] invite email not sent:', sent.message);
    }

    return successResponse(res, HTTP.CREATED, emailed ? 'Invite sent' : 'Invite created', {
      invite,
      acceptUrl,
      emailed,
    });
  } catch (error) { next(error); }
};

const revokeInvite = async (req, res, next) => {
  try {
    const customerId = await resolveScope(req);
    return successResponse(
      res, HTTP.OK, 'Invite withdrawn',
      await tenancy.revokeInvite(customerId, req.params.inviteId),
    );
  } catch (error) { next(error); }
};

/**
 * What an invite link is, before signing in.
 *
 * Open by design — the recipient has to know what they are being asked to join
 * before they authenticate. It discloses only the customer's name and the
 * address the invite was sent to, both of which the recipient already knows,
 * and nothing at all about the customer's events or people.
 */
const peekInvite = async (req, res, next) => {
  try {
    const invite = await tenancy.peekInvite(req.params.token);
    if (!invite) return errorResponse(res, HTTP.NOT_FOUND, 'This invite link is not valid');
    return successResponse(res, HTTP.OK, 'OK', invite);
  } catch (error) { next(error); }
};

const acceptInvite = async (req, res, next) => {
  try {
    const result = await tenancy.acceptInvite(req.params.token, req.user);
    return successResponse(res, HTTP.OK, `You have joined ${result.customerName}`, result);
  } catch (error) { next(error); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Owner-side
// ─────────────────────────────────────────────────────────────────────────────

/** Set (or clear, with null) how many seats a customer's deal includes. */
const setSeatLimit = async (req, res, next) => {
  try {
    const customerId = Number(req.params.id);
    const raw = req.body?.seatLimit;
    let seatLimit = null;
    if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
      seatLimit = Number(raw);
      if (!Number.isInteger(seatLimit) || seatLimit < 0) {
        return errorResponse(res, HTTP.BAD_REQUEST, 'seatLimit must be zero or a positive whole number, or null for no limit');
      }
    }
    const db = require('../config/db');
    const result = await db.query(
      'UPDATE customers SET seat_limit = $1, updated_at = now() WHERE id = $2 RETURNING id, name, seat_limit',
      [seatLimit, customerId],
    );
    if (!result.rows[0]) return errorResponse(res, HTTP.NOT_FOUND, 'Customer not found');
    await audit.record(req, 'customer.seat_limit', { customerId, targetType: 'customer', targetId: customerId, meta: { seatLimit } });
    return successResponse(res, HTTP.OK, 'Seat limit updated', {
      ...result.rows[0],
      seats: await tenancy.getSeatUsage(customerId),
    });
  } catch (error) { next(error); }
};

/**
 * Seat usage for a named customer.
 *
 * Separate from `getSeats`, which answers for whichever customer the caller
 * belongs to. Sharing one resolver between the two audiences was a bug: this
 * route's parameter is `:id`, so `resolveScope` never saw it, fell through to
 * "your own customer", and refused a platform owner who belongs to none.
 * Two audiences, two entry points, no guessing.
 */
const getCustomerSeats = async (req, res, next) => {
  try {
    const customerId = Number(req.params.id);
    if (!Number.isInteger(customerId)) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'Customer id must be a number');
    }
    return successResponse(res, HTTP.OK, 'OK', await tenancy.getSeatUsage(customerId));
  } catch (error) { next(error); }
};

const listCustomerEvents = async (req, res, next) => {
  try {
    const customerId = Number(req.params.id);
    if (!Number.isInteger(customerId)) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'Customer id must be a number');
    }
    return successResponse(res, HTTP.OK, 'OK', await tenancy.listCustomerEvents(customerId));
  } catch (error) { next(error); }
};

/**
 * Put an event under a customer.
 *
 * Owner-only, and deliberately so: this is the control that decides who can see
 * an event, and a customer administrator must not be able to claim one.
 */
const assignEventCustomer = async (req, res, next) => {
  try {
    const raw = req.body?.customerId;
    const customerId = raw === null || raw === undefined || String(raw).trim() === ''
      ? null
      : Number(raw);
    if (customerId !== null && !Number.isInteger(customerId)) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'customerId must be a number, or null to unassign');
    }
    const updated = await tenancy.assignEventToCustomer(Number(req.params.id), customerId);
    await audit.record(req, 'event.customer', {
      customerId, eventId: Number(req.params.id), targetType: 'event', targetId: req.params.id, meta: { customerId },
    });
    return successResponse(
      res, HTTP.OK,
      customerId === null ? 'Event unassigned' : 'Event assigned',
      updated,
    );
  } catch (error) { next(error); }
};

module.exports = {
  getTeam,
  getSeats,
  listMembers,
  removeMember,
  listInvites,
  createInvite,
  revokeInvite,
  peekInvite,
  acceptInvite,
  setSeatLimit,
  getCustomerSeats,
  listCustomerEvents,
  assignEventCustomer,
};
