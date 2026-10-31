/**
 * @file ownerDirectory.controller.js
 * @description HTTP handlers for the owner console's lists, detail pages,
 * global search, overview insights and the two account actions the owner
 * takes on someone else's behalf (a new confirmation link, signing out
 * everywhere). Mounted under /api/owner, superadmin only.
 */

const directory = require('../services/ownerDirectory.service');
const insightsService = require('../services/ownerInsights.service');
const authService = require('../services/auth.service');
const emailService = require('../services/email.service');
const eventService = require('../services/event.service');
const verification = require('../services/emailVerification.service');
const audit = require('../services/audit.service');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const asId = (raw) => {
  const n = Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 && n < 2 ** 31 ? n : null;
};

/** A list endpoint: the query string in, one page out, never cached. */
const list = (fn) => async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return successResponse(res, HTTP.OK, 'OK', await fn(req.query || {}));
  } catch (error) { return errorFromException(res, next, error); }
};

/** A detail endpoint: 400 for a bad id, 404 when there is no such row. */
const detail = (fn, what) => async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, `Invalid ${what} id`);
    const data = await fn(id);
    if (!data) return errorResponse(res, HTTP.NOT_FOUND, `${what[0].toUpperCase()}${what.slice(1)} not found`);
    res.set('Cache-Control', 'no-store');
    return successResponse(res, HTTP.OK, 'OK', data);
  } catch (error) { return errorFromException(res, next, error); }
};

const listCustomers = list(directory.listCustomers);
const listEvents = list(directory.listEvents);
const listUsers = list(directory.listUsers);
const listOrders = list(directory.listOrders);
const listJudging = list(directory.listJudging);
const listTickets = list(directory.listTickets);
const listFeedback = list(directory.listFeedback);
const analytics = list(() => insightsService.analytics());
const customerDetail = detail(directory.customerDetail, 'organisation');
const userDetail = detail(directory.userDetail, 'user');
const orderDetail = detail(directory.orderDetail, 'order');
const eventDetail = detail(directory.eventDetail, 'event');

const search = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return successResponse(res, HTTP.OK, 'OK', await directory.search(req.query.q, { limit: req.query.limit }));
  } catch (error) { return errorFromException(res, next, error); }
};

const insights = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return successResponse(res, HTTP.OK, 'OK', await insightsService.insights());
  } catch (error) { return errorFromException(res, next, error); }
};

const activity = async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return successResponse(res, HTTP.OK, 'OK', await insightsService.activity(req.query || {}));
  } catch (error) { return errorFromException(res, next, error); }
};

/**
 * POST /api/owner/users/:id/verification — e-mail the person a new
 * confirmation link. The link itself never comes back in the response: it
 * signs the person in to their address, and the owner has no use for it.
 */
const resendVerification = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid user id');
    const person = await authService.getMeById(id);
    if (!person) return errorResponse(res, HTTP.NOT_FOUND, 'User not found');
    if (person.email_verified) {
      return errorResponse(res, HTTP.CONFLICT, 'This address is already confirmed.', null, 'ALREADY_VERIFIED');
    }
    const wait = await verification.cooldownLeft(id);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      return errorResponse(res, HTTP.TOO_MANY_REQUESTS, `A link was just sent. Another can go in ${wait} s.`, { retryAfter: wait }, 'VERIFY_COOLDOWN');
    }
    const link = await verification.createToken(id, person.email);
    const first = person.pending_invites[0] || null;
    const ev = first ? await eventService.getEventById(first.eventId).catch(() => null) : null;
    const mail = await emailService.sendVerifyEmail({
      to: person.email,
      fullName: person.full_name,
      verifyUrl: `${resolveFrontendBaseUrl()}/verify-email?token=${encodeURIComponent(link.token)}`,
      lang: ev?.language || 'en',
      invite: first ? { eventName: first.eventName, role: first.role } : null,
    }).catch((err) => ({ ok: false, message: err.message }));
    const sent = Boolean(mail && mail.ok);
    await audit.record(req, 'owner.user.verification_sent', { targetType: 'user', targetId: id, meta: { sent } });
    return successResponse(res, HTTP.OK, sent ? 'Confirmation link sent' : 'The link was created but the e-mail did not go out', {
      sent,
      mailConfigured: emailService.isMailConfigured(),
      expiresInHours: link.expiresInHours,
    });
  } catch (error) { return errorFromException(res, next, error); }
};

/**
 * POST /api/owner/users/:id/sign-out — end every session of that account
 * (the session version goes up). Not for the owner's own account: that is
 * "Sign out everywhere" in their own settings, and doing it from here would
 * end the session that is asking.
 */
const signOutEverywhere = async (req, res, next) => {
  try {
    const id = asId(req.params.id);
    if (!id) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid user id');
    if (id === req.user.id) {
      return errorResponse(res, HTTP.CONFLICT, 'Use “Sign out everywhere” in your own account for this.', null, 'SELF');
    }
    await directory.signOutEverywhere(id);
    await audit.record(req, 'session.revoke_all', { targetType: 'user', targetId: id, meta: { by: 'owner' } });
    return successResponse(res, HTTP.OK, 'Signed out on every device', { signedOut: true });
  } catch (error) { return errorFromException(res, next, error); }
};

module.exports = {
  listCustomers,
  customerDetail,
  listEvents,
  eventDetail,
  listUsers,
  userDetail,
  listOrders,
  orderDetail,
  search,
  insights,
  activity,
  analytics,
  listJudging,
  listTickets,
  listFeedback,
  resendVerification,
  signOutEverywhere,
};
