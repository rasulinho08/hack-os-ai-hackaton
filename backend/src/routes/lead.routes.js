/**
 * @file lead.routes.js
 * @description POST /api/leads — the website contact form.
 *
 * The form used to build a mailto: link, so a visitor without a mail client
 * set up (most people on a work laptop) sent nothing and we never knew. Now it
 * posts here and the sales inbox gets the message, with Reply-To set to the
 * visitor.
 *
 * Public, so it is narrow: one fixed recipient (our own inbox — never the
 * address the visitor typed, which would make this a way to mail strangers),
 * plain-text fields with length caps, a honeypot, and a tight rate limit.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const emailService = require('../services/email.service');
const { successResponse, errorResponse } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const router = express.Router();

// Outside production, requests from this machine (tests, local dev) are not
// counted; everywhere else five per 15 minutes per address.
const isLoopback = (ip) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(ip || ''));
const limiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production' && isLoopback(req.ip),
});

const leadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  organisation: z.string().trim().max(200).optional().default(''),
  topic: z.string().trim().max(80).optional().default(''),
  message: z.string().trim().max(4000).optional().default(''),
  // Honeypot: hidden on the page, so only bots fill it.
  website: z.string().max(200).optional().default(''),
});

router.post('/', limiter, async (req, res, next) => {
  try {
    const parsed = leadSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'Please give your name and a valid e-mail address.', null, 'VALIDATION_ERROR');
    }
    const lead = parsed.data;
    // Pretend success to a bot; tell it nothing.
    if (lead.website) return successResponse(res, HTTP.OK, 'Thanks — we will be in touch.');

    const out = await emailService.sendSalesAlert({
      subject: `Website enquiry — ${lead.organisation || lead.name}${lead.topic ? ` (${lead.topic})` : ''}`,
      heading: 'New enquiry from the website',
      fields: [
        ['Name', lead.name],
        ['E-mail', lead.email],
        ['Organisation', lead.organisation],
        ['Topic', lead.topic],
        ['Message', lead.message],
      ],
      replyTo: lead.email,
    });
    if (!out.ok) {
      return errorResponse(res, HTTP.SERVICE_UNAVAILABLE || 503, 'The message could not be sent right now. Please e-mail us directly.', null, 'LEAD_NOT_SENT');
    }
    return successResponse(res, HTTP.OK, 'Thanks — we will be in touch.');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
