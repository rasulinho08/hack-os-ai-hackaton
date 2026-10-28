const express = require('express');
const eventController = require('../controllers/event.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { eventAccessById } = require('../middlewares/eventAccess');
const { exportLimiter } = require('../middlewares/authRateLimit');
const tenancyController = require('../controllers/tenancy.controller');
const builderController = require('../controllers/eventBuilder.controller');
const { ROLES } = require('../constants/roles');

const { optionalAuthMw } = authMw;
const router = express.Router();

// Public for anonymous callers (published, non-archived events only — the
// login / register page needs the list); full list for signed-in users.
router.get('/', optionalAuthMw, eventController.getAllEvents);
/** Builder: the vocabulary of the wizard, and a new draft from a template. */
router.get('/builder/catalog', authMw, roleMw('admin'), builderController.catalog);
router.post('/drafts', authMw, roleMw('admin'), builderController.createDraft);
router.get('/active', authMw, eventController.getActiveEvent);
/** Admin: full event row by numeric id (wizard edit). Must be before /:identifier. */
router.get('/details/:id', authMw, roleMw('admin'), eventAccessById, eventController.getEventById);
router.get('/:id/analytics', authMw, roleMw('admin'), eventAccessById, eventController.getEventAnalytics);
/** Organiser home: phase, dates, counts, what needs attention, latest activity. */
router.get('/:id/overview', authMw, roleMw('admin'), eventAccessById, eventController.getEventOverview);

// Smart handler: if param is numeric → get by ID, else → get by code
router.get('/:identifier', optionalAuthMw, eventController.getEventByIdentifier);

router.post('/', authMw, roleMw('admin'), eventController.createEvent);
router.put('/:id', authMw, roleMw('admin'), eventAccessById, eventController.updateEvent);
router.patch('/:id', authMw, roleMw('admin'), eventAccessById, eventController.updateEvent);
router.delete('/:id', authMw, roleMw('admin'), eventAccessById, eventController.deleteEvent);
router.post('/:id/publish', authMw, roleMw('admin'), eventAccessById, eventController.publishEvent);
router.post('/:id/archive', authMw, roleMw('admin'), eventAccessById, eventController.archiveEvent);
router.post('/:id/unarchive', authMw, roleMw('admin'), eventAccessById, eventController.unarchiveEvent);
router.get('/:id/export.zip', authMw, roleMw('admin'), exportLimiter, eventAccessById, eventController.exportEventZip);

/*
 * Which customer an event belongs to. Owner-only: this is the switch that
 * decides who can see the event at all, so a customer administrator must not
 * be able to point it at themselves.
 */
router.put('/:id/customer', authMw, roleMw(ROLES.SUPERADMIN), tenancyController.assignEventCustomer);

module.exports = router;
