/**
 * @file me.routes.js
 * @description What the signed-in buyer can see about their own account.
 *
 *   GET /api/me/workspaces  → organisations they manage and events they have a role in
 *   GET /api/me/orders      → their orders and the customers they belong to
 *   GET /api/me/orders/:id/invoice.pdf → an order's invoice, for its organisation's members
 *   GET /api/me/organisations/:id/plan → plan, events left, modules, for its members
 *   POST /api/me/organisations/:id/setup-link → a new setup link to an owner's own address
 *   GET /api/me/entitlement → whether anything is paid for
 *   GET /api/me/event-progress?eventId= → a participant's stages and next step
 *   GET /api/me/certificates → their certificates, across events
 *   GET /api/me/hackathons → every event they took part in: role, team, project, place, certificates
 *   GET|PUT /api/me/public-profile → their public profile at /u/<handle> (off until they switch it on)
 *   GET /api/me/notifications(/unread), POST /api/me/notifications/read → the bell
 *   GET /api/me/calendar, POST /api/me/calendar/reset → their calendar feed link
 *
 * No admin role, and no way to name a customer: the scope comes from the
 * session, so an account cannot widen it by asking. `entitlement` is what the
 * workspace gate reads, and it returns a boolean and nothing else.
 */

const express = require('express');
const commerce = require('../controllers/commerce.controller');
const orderActions = require('../controllers/orderActions.controller');
const authMw = require('../middlewares/authMw');
const certificates = require('../controllers/certificate.controller');
const notifications = require('../controllers/notification.controller');
const profiles = require('../controllers/profile.controller');

const router = express.Router();

router.get('/workspaces', authMw, async (req, res, next) => {
  try {
    const { listWorkspaces } = require('../services/effectiveRole.service');
    const data = await listWorkspaces(req.user.id);
    return res.status(200).json({
      success: true,
      data: {
        ...data,
        platformRole: req.user.platformRole || null,
        elevationRequired: Boolean(req.user.elevationRequired),
        activeEventId: req.user.contextEventId || null,
      },
    });
  } catch (error) { next(error); }
});
router.get('/orders', authMw, commerce.myOrders);
router.get('/orders/:id/invoice.pdf', authMw, orderActions.myInvoicePdf);
router.get('/organisations/:id/plan', authMw, orderActions.myOrganisationPlan);
router.post('/organisations/:id/setup-link', authMw, orderActions.mySetupLink);
router.get('/entitlement', authMw, commerce.myEntitlement);
router.get('/event-progress', authMw, async (req, res, next) => {
  try {
    const { progressFor } = require('../services/eventProgress.service');
    const { participantEventId } = require('../services/effectiveRole.service');
    // The same event the participant routes act in (named, entered, default).
    const eventId = await participantEventId(req);
    const data = eventId ? await progressFor(req.user.id, eventId) : null;
    if (!data) return res.status(404).json({ success: false, message: 'You are not a participant of this event.', code: 'NOT_PARTICIPANT' });
    return res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

router.get('/certificates', authMw, certificates.mine);
router.get('/hackathons', authMw, profiles.mine);
router.get('/public-profile', authMw, profiles.getSettings);
router.put('/public-profile', authMw, profiles.saveSettings);
router.get('/notifications', authMw, notifications.list);
router.get('/notifications/unread', authMw, notifications.unread);
router.post('/notifications/read', authMw, notifications.read);
router.get('/calendar', authMw, notifications.feedInfo);
router.post('/calendar/reset', authMw, notifications.resetFeed);

module.exports = router;
