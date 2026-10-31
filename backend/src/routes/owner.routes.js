/**
 * @file owner.routes.js
 * @description Platform-owner endpoints that belong to no single customer.
 *
 *   GET /api/owner/audit?customerId=&eventId=&actorId=&action=&since=&until=&limit=&before=&format=csv
 *                                                      → audit trail, newest first (CSV: up to 5000 rows)
 *   GET /api/owner/audit/actions                       → the actions in the trail, for the filter
 *   GET /api/owner/jobs                                → background jobs: counts, recent failures,
 *                                                        stuck deliveries, Telegram and mail readiness
 *   GET /api/owner/overview?customerId=&list=false     → organisations, orders, revenue, users, events
 *                                                        (list=false: totals only, no event list)
 *   GET /api/owner/health                              → database, jobs, requests, integrations
 *   GET /api/owner/settings/notice, PUT …              → the notice shown on every page
 *   GET /api/owner/settings/billing, PUT …             → the seller's legal and bank details and VAT
 *                                                        status, for invoices (billing.service.js)
 *   GET /api/owner/pricing, PUT /api/owner/pricing/:plan, GET …/pricing/history
 *                                                      → the price catalogue, its edits and history
 *   /api/owner/coupons…                                → discount codes and campaigns
 *                                                        (pricing.controller.js)
 *   /api/owner/showcase…                               → stories from past hackathons for the
 *                                                        public site (showcase.controller.js)
 *
 *   The console's lists and detail pages (ownerDirectory.controller.js). Lists take
 *   q, sort, dir (asc|desc), page and pageSize (≤ 100) and answer { rows, total, page, pageSize }:
 *   GET /api/owner/customers?status=&plan=&flags=      → organisations with their figures
 *   GET /api/owner/customers/:id                       → profile, plan, usage, members, orders, audit
 *   GET /api/owner/events?phase=&customerId=&unassigned=          → events with their counts
 *   GET /api/owner/events/:id                          → one event: organisation, plan, order, counts,
 *                                                        judging coverage, staff, audit
 *   GET|PATCH /api/owner/events/:id/page               → the public page's fields (ownerEvents.controller.js)
 *   PATCH /api/owner/events/:id/flags                  → pinned in the directory, marked as a test
 *   POST /api/owner/events/:id/publish|unpublish|archive|unarchive
 *   GET /api/owner/users?role=&verified=&customerId=   → accounts
 *   GET /api/owner/users/:id                           → account, memberships, roles, teams, orders, audit
 *   POST /api/owner/users/:id/verification             → e-mail a new confirmation link
 *   POST /api/owner/users/:id/sign-out                 → end every session of that account
 *   GET /api/owner/orders?status=&customerId=&unpaid=  → orders, with totals by status
 *   GET /api/owner/orders/:id                          → lines, totals, history, audit, entitlement
 *   GET /api/owner/search?q=                           → organisations, people, orders, events
 *   GET /api/owner/insights                            → revenue by month, funnel, top organisations,
 *                                                        what is waiting on the owner
 *   GET /api/owner/activity?after=                     → the newest audit rows, for the live feed
 *   GET /api/owner/analytics                           → totals by month, registration status, largest events
 *   GET /api/owner/judging?phase=&panel=               → scoring coverage per event
 *   GET /api/owner/tickets?status=&eventId=&escalated= → the help queue across events, counts by status
 *   GET /api/owner/feedback?eventId=&rating=           → ratings and comments, average and spread
 *
 * Owner only, which on a configured installation means the address on
 * SUPERADMIN_EMAILS after the PIN step (see authMw).
 */

const express = require('express');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const audit = require('../services/audit.service');
const db = require('../config/db');
const jobs = require('../services/jobs.service');
const telegram = require('../services/telegram.service');
const { getReadiness } = require('../services/mailer');
const platform = require('../services/platform.service');
const billing = require('../services/billing.service');
const { sendCsv } = require('../utils/csv');
const { errorFromException } = require('../utils/responseFormat');
const showcase = require('../controllers/showcase.controller');
const directory = require('../controllers/ownerDirectory.controller');
const pricing = require('../controllers/pricing.controller');
const ownerEvents = require('../controllers/ownerEvents.controller');
const { PURPOSES } = require('../services/file.service');
const { uploadLimiter } = require('../middlewares/authRateLimit');

const router = express.Router();
const owner = [authMw, roleMw('superadmin')];
// A story photo arrives as the request body itself.
const rawPhoto = express.raw({ type: () => true, limit: PURPOSES.showcase.maxBytes + 64 * 1024 });

const AUDIT_COLUMNS = [
  { key: 'created_at', header: 'When' },
  { key: 'action', header: 'Action' },
  { key: 'actor_name', header: 'Who' },
  { key: 'customer_name', header: 'Organisation' },
  { key: 'event_name', header: 'Event' },
  { key: 'target_type', header: 'Target' },
  { key: 'target_id', header: 'Target id' },
  { key: 'meta', header: 'Details' },
  { key: 'ip', header: 'Address' },
];

const { exportLimiter } = require('../middlewares/authRateLimit');

const csvLimited = (req, res, next) => (req.query.format === 'csv' ? exportLimiter(req, res, next) : next());

router.get('/audit', authMw, roleMw('superadmin'), csvLimited, async (req, res, next) => {
  try {
    if (req.query.format === 'csv') {
      const rows = await platform.auditSearch({ ...req.query, limit: req.query.limit || 5000 }, { max: 5000 });
      await audit.record(req, 'owner.audit.export', { meta: { rows: rows.length } });
      return sendCsv(res, `hackos-audit-${new Date().toISOString().slice(0, 10)}`, AUDIT_COLUMNS, rows);
    }
    const rows = await platform.auditSearch(req.query);
    return res.status(200).json({ success: true, data: rows });
  } catch (error) { next(error); }
});

router.get('/audit/actions', authMw, roleMw('superadmin'), async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await platform.auditActions() });
  } catch (error) { next(error); }
});

router.get('/overview', authMw, roleMw('superadmin'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: await platform.overview({ customerId: req.query.customerId, list: req.query.list !== 'false' }) });
  } catch (error) { next(error); }
});

router.get('/health', authMw, roleMw('superadmin'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: await platform.health() });
  } catch (error) { next(error); }
});

router.get('/settings/notice', authMw, roleMw('superadmin'), async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: await platform.getNotice() });
  } catch (error) { next(error); }
});

router.put('/settings/notice', authMw, roleMw('superadmin'), async (req, res, next) => {
  try {
    const data = await platform.setNotice(req.body || {}, req.user.id);
    await audit.record(req, 'owner.notice.update', { meta: { active: data.active, level: data.level } });
    return res.status(200).json({ success: true, message: 'Saved', data });
  } catch (error) { return errorFromException(res, next, error); }
});

router.get('/settings/billing', ...owner, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, data: await billing.getBilling() });
  } catch (error) { next(error); }
});

router.put('/settings/billing', ...owner, async (req, res, next) => {
  try {
    const data = await billing.setBilling(req.body || {}, req.user.id);
    await audit.record(req, 'owner.billing.update', { meta: { ready: data.ready, vatRegistered: data.vatRegistered } });
    return res.status(200).json({ success: true, message: 'Saved', data });
  } catch (error) { return errorFromException(res, next, error); }
});

router.get('/jobs', authMw, roleMw('superadmin'), async (req, res, next) => {
  try {
    const [queue, deliveries] = await Promise.all([
      jobs.stats(),
      db.query(
        `SELECT channel, status, COUNT(*)::int AS n FROM announcement_deliveries
          WHERE created_at > now() - interval '7 days' GROUP BY 1, 2 ORDER BY 1, 2`,
      ),
    ]);
    const bot = telegram.isEnabled() ? await telegram.getBot() : null;
    const mail = getReadiness();
    return res.status(200).json({
      success: true,
      data: {
        queue,
        deliveries: deliveries.rows,
        telegram: { configured: telegram.isEnabled(), botUsername: bot?.username || null, webhookReady: Boolean(telegram.webhookSecret()) },
        mail: { configured: mail.configured, provider: mail.provider, problem: mail.problem },
        worker: { disabled: String(process.env.JOBS_DISABLED || '').toLowerCase() === 'true', intervalMs: Number(process.env.JOBS_INTERVAL_MS) || 15000 },
      },
    });
  } catch (error) { next(error); }
});

router.get('/customers', ...owner, directory.listCustomers);
router.get('/customers/:id', ...owner, directory.customerDetail);
router.get('/events', ...owner, directory.listEvents);
router.get('/events/:id', ...owner, directory.eventDetail);
router.get('/events/:id/page', ...owner, ownerEvents.getPage);
router.patch('/events/:id/page', ...owner, ownerEvents.updatePage);
router.patch('/events/:id/flags', ...owner, ownerEvents.updateFlags);
router.post('/events/:id/publish', ...owner, ownerEvents.publish);
router.post('/events/:id/unpublish', ...owner, ownerEvents.unpublish);
router.post('/events/:id/archive', ...owner, ownerEvents.archive);
router.post('/events/:id/unarchive', ...owner, ownerEvents.unarchive);
router.get('/users', ...owner, directory.listUsers);
router.get('/users/:id', ...owner, directory.userDetail);
router.post('/users/:id/verification', ...owner, directory.resendVerification);
router.post('/users/:id/sign-out', ...owner, directory.signOutEverywhere);
router.get('/orders', ...owner, directory.listOrders);
router.get('/orders/:id', ...owner, directory.orderDetail);
router.get('/search', ...owner, directory.search);
router.get('/insights', ...owner, directory.insights);
router.get('/activity', ...owner, directory.activity);
router.get('/analytics', ...owner, directory.analytics);
router.get('/judging', ...owner, directory.listJudging);
router.get('/tickets', ...owner, directory.listTickets);
router.get('/feedback', ...owner, directory.listFeedback);

router.get('/pricing', ...owner, pricing.getPricing);
router.get('/pricing/history', ...owner, pricing.priceHistory);
router.put('/pricing/:plan', ...owner, pricing.updatePlan);
router.get('/coupons', ...owner, pricing.listCoupons);
router.post('/coupons', ...owner, pricing.createCoupon);
router.get('/coupons/:id', ...owner, pricing.getCoupon);
router.patch('/coupons/:id', ...owner, pricing.updateCoupon);
router.post('/coupons/:id/pause', ...owner, pricing.pauseCoupon);
router.post('/coupons/:id/resume', ...owner, pricing.resumeCoupon);
router.delete('/coupons/:id', ...owner, pricing.deleteCoupon);

router.get('/showcase', ...owner, showcase.ownerList);
router.post('/showcase', ...owner, showcase.create);
router.post('/showcase/files', ...owner, uploadLimiter, rawPhoto, showcase.upload);
router.get('/showcase/:id', ...owner, showcase.ownerGet);
router.patch('/showcase/:id', ...owner, showcase.update);
router.delete('/showcase/:id', ...owner, showcase.remove);
router.post('/showcase/:id/publish', ...owner, showcase.publish);
router.post('/showcase/:id/unpublish', ...owner, showcase.unpublish);
router.post('/showcase/:id/schedule', ...owner, showcase.schedule);

module.exports = router;
