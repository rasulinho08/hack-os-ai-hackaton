/**
 * @file setup.routes.js
 * @description The setup link e-mailed when an order is approved.
 *
 *   GET  /api/setup/:token → the organisation's name and the link's state (public)
 *   POST /api/setup/:token → finish setup: profile fields, then the link is spent
 *                            (signed in as the account it was sent to, or an owner)
 *   POST /api/setup/:token/renew → an expired or replaced link: a new one is
 *                            e-mailed to the address the old one went to (public;
 *                            one per organisation every few minutes)
 *
 * Tokens are 256 random bits and stored hashed; the limiter is there to keep
 * the endpoint quiet, not because guessing could work.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const authMw = require('../middlewares/authMw');
const setupService = require('../services/setup.service');
const emailService = require('../services/email.service');
const { resolveAppBaseUrl } = require('../utils/frontendUrl');
const audit = require('../services/audit.service');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

router.get('/:token', limiter, async (req, res, next) => {
  try {
    const info = await setupService.describe(req.params.token);
    if (!info) return errorResponse(res, HTTP.NOT_FOUND, 'This setup link does not exist.', null, 'SETUP_NOT_FOUND');
    return successResponse(res, HTTP.OK, 'OK', info);
  } catch (error) { return errorFromException(res, next, error); }
});

router.post('/:token', limiter, authMw, async (req, res, next) => {
  try {
    const { name, timezone, locale, brandColor, logoUrl, website } = req.body || {};
    const organisation = await setupService.complete(req.params.token, req.user, {
      name, timezone, locale, brandColor, logoUrl, website,
    });
    audit.record(req, 'customer.setup', { customerId: organisation.id, targetType: 'customer', targetId: organisation.id });
    return successResponse(res, HTTP.OK, 'Your organisation is set up', organisation);
  } catch (error) { return errorFromException(res, next, error); }
});

router.post('/:token/renew', limiter, async (req, res, next) => {
  try {
    const out = await setupService.renew(req.params.token);
    if (!out) return errorResponse(res, HTTP.NOT_FOUND, 'This setup link does not exist.', null, 'SETUP_NOT_FOUND');
    const mail = await emailService.sendSetupLinkEmail({
      to: out.email,
      organisation: out.organisation,
      setupUrl: `${resolveAppBaseUrl()}/setup/${encodeURIComponent(out.token)}`,
      expiresHours: setupService.SETUP_TTL_HOURS,
      lang: out.locale,
    });
    return successResponse(res, HTTP.OK, 'A new setup link was sent', {
      email: setupService.maskEmail(out.email),
      mailSent: Boolean(mail && mail.ok),
    });
  } catch (error) { return errorFromException(res, next, error); }
});

module.exports = router;
