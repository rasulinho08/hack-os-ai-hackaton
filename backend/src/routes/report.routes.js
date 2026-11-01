/**
 * @file report.routes.js
 * @description The post-event report (plan module 'reports', Professional
 * and above), for the event's organisers, once the event is over.
 *
 *   GET /api/events/:eventId/report          the figures, as data       ?lang=az|en|ru
 *   GET /api/events/:eventId/report/pdf      the same as a PDF          ?lang=az|en|ru&inline=1
 *
 * Aggregates only (report.service.js): no person is named in either.
 */

const express = require('express');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { exportLimiter } = require('../middlewares/authRateLimit');
const reports = require('../services/report.service');
const audit = require('../services/audit.service');
const { successResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const router = express.Router({ mergeParams: true });
const eventIdOf = (req) => Number(req.params.eventId);
const langOf = (req) => (typeof req.query.lang === 'string' ? req.query.lang.toLowerCase() : undefined);

router.get('/', authMw, roleMw('admin'), async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    const data = await reports.build(eventIdOf(req), { lang: langOf(req) });
    return successResponse(res, HTTP.OK, 'OK', reports.publicShape(data));
  } catch (err) {
    return errorFromException(res, next, err);
  }
});

router.get('/pdf', authMw, roleMw('admin'), exportLimiter, async (req, res, next) => {
  try {
    const eventId = eventIdOf(req);
    const { bytes, filename } = await reports.pdf(eventId, { lang: langOf(req) });
    await audit.record(req, 'event.report_downloaded', { eventId, targetType: 'event', targetId: eventId, meta: { lang: langOf(req) || null } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${filename.replace(/[^a-z0-9._-]/gi, '-')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(Buffer.from(bytes));
  } catch (err) {
    return errorFromException(res, next, err);
  }
});

module.exports = router;
