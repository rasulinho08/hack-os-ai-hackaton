/**
 * @file auth.controller.js
 * @description HTTP handlers for authentication endpoints.
 *
 * Routes:
 *   POST /api/auth/register            → register
 *   POST /api/auth/login               → login
 *   POST /api/auth/logout              → logout
 *   GET  /api/auth/me                  → me (requires authMw)
 *   POST /api/auth/verify-email        → verifyEmail   { token }
 *   POST /api/auth/verify-email/resend → resendVerification (requires authMw)
 */

const authService = require('../services/auth.service');
const emailService = require('../services/email.service');
const { isDevLike } = require('../utils/runtimeEnv');
const { eventSender } = require('../services/eventSender');
const eventService = require('../services/event.service');
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} = require('../validations/auth.schema');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const crypto = require('crypto');
const { setSessionCookie, clearSessionCookie, setElevationCookie, clearElevationCookie } = require('../utils/cookies');
const { signToken } = require('../utils/jwtHelper');
const audit = require('../services/audit.service');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const { finishUser } = require('../middlewares/authMw');
const verification = require('../services/emailVerification.service');

/** Where the confirmation link points. */
const verifyUrlFor = (token) => `${resolveFrontendBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;

/**
 * Sends the confirmation link; the response goes out first and a mail
 * problem never fails the request. In development without a mail provider
 * the link is handed back instead (as for password resets).
 */
function sendVerification({ to, fullName, token, lang, invite }) {
  const verifyUrl = verifyUrlFor(token);
  emailService.sendVerifyEmail({ to, fullName, verifyUrl, lang, invite })
    .catch((err) => console.error('[Auth] confirmation e-mail skipped:', err.message));
  return isDevLike() && !emailService.isMailConfigured() ? { verifyUrl } : {};
}

/** The language and the waiting invitation a confirmation e-mail mentions. */
async function verificationContext(pendingInvite, registration) {
  const eventId = pendingInvite?.eventId ?? registration?.eventId ?? null;
  if (eventId == null) return { lang: null, invite: null };
  const ev = await eventService.getEventById(eventId).catch(() => null);
  return {
    lang: ev?.language || null,
    invite: pendingInvite ? { eventName: ev?.name, role: pendingInvite.role } : null,
  };
}

/**
 * Confirmation e-mail for a hacker who just registered for an event. Runs
 * after the response is on its way; a mail problem never fails a sign-up.
 * Opt-out: SEND_EMAIL_ON_REGISTRATION=false.
 */
function notifyRegistration(user, registration) {
  if (String(process.env.SEND_EMAIL_ON_REGISTRATION || 'true').trim().toLowerCase() === 'false') return;
  Promise.all([eventService.getEventById(registration.eventId), eventSender(registration.eventId)])
    .then(([ev, sender]) =>
      emailService.sendRegistrationReceivedEmail({
        to: user.email,
        fullName: user.full_name,
        eventName: ev?.name,
        eventCode: ev?.event_code,
        status: registration.status,
        frontendUrl: resolveFrontendBaseUrl(),
        sender,
        lang: ev?.language,
      }),
    )
    .catch((err) => console.error('[Auth] registration e-mail skipped:', err.message));
}

/**
 * POST /api/auth/register
 * Register a new user. Role is determined server-side (invite or default 'hacker').
 */
const register = async (req, res, next) => {
  try {
    const validatedData = registerSchema.parse(req.body);
    const { registration, verification: link, pendingInvite, ...user } = await authService.registerUser(validatedData);
    if (registration) notifyRegistration(user, registration);
    let extras = {};
    if (link) {
      const { lang, invite } = await verificationContext(pendingInvite, registration);
      extras = sendVerification({ to: user.email, fullName: user.full_name, token: link.token, lang, invite });
    }
    return successResponse(res, HTTP.CREATED, 'User registered successfully', {
      ...user,
      verificationRequired: !user.email_verified,
      // An invitation for this address that opens once it is confirmed.
      pendingInvite: pendingInvite || null,
      ...extras,
    });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** POST /api/auth/verify-email  { token } — the link from the confirmation e-mail. */
const verifyEmail = async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (token.length < 16 || token.length > 200) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'This confirmation link is invalid or has expired.', null, 'INVALID_VERIFY_TOKEN');
    }
    const out = await verification.verifyWithToken(token);
    if (!out.alreadyVerified) {
      audit.record(req, 'user.email.verify', {
        targetType: 'user', targetId: out.userId, meta: { invites: out.applied.length },
      });
    }
    return successResponse(res, HTTP.OK, 'E-mail confirmed', {
      verified: true,
      alreadyVerified: out.alreadyVerified,
      email: out.email,
      // The invitations that opened with it: { eventId, role }.
      applied: out.applied,
    });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** POST /api/auth/verify-email/resend — a new link to the signed-in account's address. */
const resendVerification = async (req, res, next) => {
  try {
    const me = await authService.getMeById(req.user.id);
    if (!me) return errorResponse(res, HTTP.NOT_FOUND, 'User not found');
    if (me.email_verified) return successResponse(res, HTTP.OK, 'Already confirmed', { alreadyVerified: true });
    const wait = await verification.cooldownLeft(me.id);
    if (wait > 0) {
      res.set('Retry-After', String(wait));
      return errorResponse(res, HTTP.TOO_MANY_REQUESTS, `A link was just sent. You can ask for another in ${wait} s.`, { retryAfter: wait }, 'VERIFY_COOLDOWN');
    }
    const link = await verification.createToken(me.id, me.email);
    const first = me.pending_invites[0] || null;
    const ev = first ? await eventService.getEventById(first.eventId).catch(() => null) : null;
    const extras = sendVerification({
      to: me.email,
      fullName: me.full_name,
      token: link.token,
      lang: ev?.language || null,
      invite: first ? { eventName: first.eventName, role: first.role } : null,
    });
    return successResponse(res, HTTP.OK, 'Confirmation link sent', { sent: true, email: me.email, ...extras });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/login
 * Authenticate user and set an HTTP-only access_token cookie.
 */
const login = async (req, res, next) => {
  try {
    const validatedData = loginSchema.parse(req.body);
    const { user, token, tokenVersion } = await authService.loginUser(
      validatedData.email,
      validatedData.password,
    );

    setSessionCookie(res, token);
    // Answer with the role this browser works under from now on, the one
    // /api/auth/me reports for the same cookies, not the stored one: a
    // customer who manages an organisation is org_admin, a judge in the
    // event picked last is a judge. The web app keeps that role in a cookie
    // and the API refuses requests whose cookie disagrees with it.
    const session = await finishUser(req, {
      id: user.id, role: user.role, email: user.email, token_version: tokenVersion,
    });
    const status = session.role === user.role && !session.contextEventId
      ? user.status
      : await authService.getHackerApprovalStatus(user.id, session.role, null, session.contextEventId ?? null);
    return successResponse(res, HTTP.OK, 'Logged in successfully', {
      ...user,
      role: session.role,
      status,
      baseRole: session.dbRole || user.role,
      eventRole: session.eventRole || null,
      contextEventId: session.contextEventId || null,
      platformRole: session.platformRole || null,
      elevationRequired: Boolean(session.elevationRequired),
    });
  } catch (error) {
    if (error.message === 'Invalid email or password') {
      return errorResponse(res, HTTP.UNAUTHORIZED, error.message, null, 'INVALID_CREDENTIALS');
    }
    return errorFromException(res, next, error);
  }
};

/**
 * POST /api/auth/logout
 * Clear the access_token cookie. No DB interaction needed.
 */
const logout = (req, res) => {
  clearSessionCookie(res);
  clearElevationCookie(res);
  return successResponse(res, HTTP.OK, 'Logged out successfully');
};

/** POST /api/auth/logout-all — ends every session of this account. */
const logoutAll = async (req, res, next) => {
  try {
    await authService.signOutEverywhere(req.user.id);
    clearSessionCookie(res);
    clearElevationCookie(res);
    audit.record(req, 'session.revoke_all', { targetType: 'user', targetId: req.user.id });
    return successResponse(res, HTTP.OK, 'Signed out on every device');
  } catch (error) { next(error); }
};

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest();

/**
 * POST /api/auth/elevate  { pin }
 * The platform owner's second step: the PIN in SUPERADMIN_PIN. The value
 * lives only in the server's environment, never in code, so knowing the
 * source does not reveal it. Five tries per 15 minutes (route limiter).
 */
const elevate = async (req, res, next) => {
  try {
    const expected = String(process.env.SUPERADMIN_PIN || '').trim();
    if (req.user.platformRole !== 'superadmin' && req.user.dbRole !== 'superadmin') {
      return errorResponse(res, HTTP.FORBIDDEN, 'Not available for this account', null, 'NOT_OWNER');
    }
    if (req.user.ownerDenied) {
      return errorResponse(res, HTTP.FORBIDDEN, 'This account is not on the platform owner list', null, 'NOT_OWNER');
    }
    if (!expected) {
      return successResponse(res, HTTP.OK, 'No second step is configured', { elevated: true });
    }
    const pin = String(req.body?.pin || '').trim();
    const ok = pin.length > 0 && crypto.timingSafeEqual(sha256(pin), sha256(expected));
    if (!ok) {
      audit.record(req, 'owner.elevate.failed', { targetType: 'user', targetId: req.user.id });
      return errorResponse(res, HTTP.UNAUTHORIZED, 'Incorrect code', null, 'INVALID_PIN');
    }
    setElevationCookie(res, signToken({ id: req.user.id, tv: req.user.token_version || 0, purpose: 'elevate' }, '12h'));
    audit.record(req, 'owner.elevate', { targetType: 'user', targetId: req.user.id });
    return successResponse(res, HTTP.OK, 'Verified', { elevated: true });
  } catch (error) { next(error); }
};

/**
 * GET /api/auth/me
 * Return the currently authenticated user's profile.
 */
const me = async (req, res, next) => {
  try {
    const user = await authService.getMeById(req.user.id, {
      role: req.user.role,
      eventId: req.user.contextEventId ?? null,
    });
    if (!user) {
      return errorResponse(res, HTTP.NOT_FOUND, 'User not found');
    }
    // `role` is the role for the workspace in use (see effectiveRole.service);
    // the stored one is `baseRole`.
    return successResponse(res, HTTP.OK, 'OK', {
      ...user,
      role: req.user.role,
      baseRole: req.user.dbRole || user.role,
      eventRole: req.user.eventRole || null,
      contextEventId: req.user.contextEventId || null,
      platformRole: req.user.platformRole || null,
      elevationRequired: Boolean(req.user.elevationRequired),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/forgot-password  { email }
 * Always answers 200 so the endpoint cannot be used to enumerate accounts.
 * Sends a reset e-mail when SMTP is configured; in development the reset
 * URL is also returned in the response for convenience.
 */
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const result = await authService.createPasswordResetToken(email);
    const generic = 'If an account exists for this e-mail, a password reset link has been sent.';
    if (!result) return successResponse(res, HTTP.OK, generic);

    const resetUrl = `${resolveFrontendBaseUrl()}/reset-password?token=${encodeURIComponent(result.token)}`;
    // The mailer logs its own failures and never rejects.
    emailService.sendPasswordResetEmail({ to: result.user.email, fullName: result.user.full_name, resetUrl });

    const devExtras =
      isDevLike() && !emailService.isMailConfigured()
        ? { resetUrl, expiresInMinutes: result.expiresInMinutes }
        : undefined;
    return successResponse(res, HTTP.OK, generic, devExtras);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** POST /api/auth/reset-password  { token, password } */
const resetPassword = async (req, res, next) => {
  try {
    const { token, password } = resetPasswordSchema.parse(req.body);
    await authService.resetPasswordWithToken(token, password);
    clearSessionCookie(res);
    return successResponse(res, HTTP.OK, 'Password updated. You can sign in with your new password.');
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** POST /api/auth/change-password  { currentPassword, newPassword }  (signed in) */
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const updated = await authService.changePassword(req.user.id, currentPassword, newPassword);
    // Every other device is signed out; this one keeps going on a new token.
    if (updated) setSessionCookie(res, authService.issueToken(updated));
    clearElevationCookie(res);
    audit.record(req, 'user.password.change', { targetType: 'user', targetId: req.user.id });
    return successResponse(res, HTTP.OK, 'Password changed successfully');
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

module.exports = {
  register, login, logout, logoutAll, elevate, me, forgotPassword, resetPassword, changePassword,
  verifyEmail, resendVerification, sendVerification, verificationContext,
};
