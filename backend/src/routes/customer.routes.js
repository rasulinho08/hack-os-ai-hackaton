/**
 * @file customer.routes.js
 * @description Customers and their contacts — the owner's view.
 *
 *   GET    /api/customers                     → list           (admin)
 *   POST   /api/customers                     → create         (admin)
 *   GET    /api/customers/:id                 → one + contacts (admin)
 *   PATCH  /api/customers/:id                 → update         (admin)
 *   DELETE /api/customers/:id                 → archive        (admin)
 *   POST   /api/customers/:id/restore         → un-archive     (admin)
 *   POST   /api/customers/:id/contacts        → add or update  (admin)
 *   DELETE /api/customers/:id/contacts/:cid   → remove         (admin)
 *   GET    /api/customers/:id/seats           → seat usage     (admin)
 *   PUT    /api/customers/:id/seats           → set seat limit (admin)
 *   GET    /api/customers/:id/events          → their events   (admin)
 *   POST   /api/customers/:id/community       → grant the free Community plan (admin)
 *
 * Every route is owner-only. Commercial records are not event data — a
 * customer administrator running their hackathon has no business reading what
 * anyone paid, including what they themselves were charged relative to others.
 * The browser-side gate on the owner console is convenience; this is the lock.
 */

const express = require('express');
const commerce = require('../controllers/commerce.controller');
const orderActions = require('../controllers/orderActions.controller');
const tenancy = require('../controllers/tenancy.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { ROLES } = require('../constants/roles');

const router = express.Router();

router.get('/', authMw, roleMw(ROLES.SUPERADMIN), commerce.listCustomers);
router.post('/', authMw, roleMw(ROLES.SUPERADMIN), commerce.createCustomer);
router.get('/:id', authMw, roleMw(ROLES.SUPERADMIN), commerce.getCustomer);
router.patch('/:id', authMw, roleMw(ROLES.SUPERADMIN), commerce.updateCustomer);
router.delete('/:id', authMw, roleMw(ROLES.SUPERADMIN), commerce.archiveCustomer);
router.post('/:id/restore', authMw, roleMw(ROLES.SUPERADMIN), commerce.restoreCustomer);
router.post('/:id/contacts', authMw, roleMw(ROLES.SUPERADMIN), commerce.upsertContact);
router.delete('/:id/contacts/:contactId', authMw, roleMw(ROLES.SUPERADMIN), commerce.removeContact);

// Tenancy: what the deal includes, and what has been delivered against it.
router.get('/:id/seats', authMw, roleMw(ROLES.SUPERADMIN), tenancy.getCustomerSeats);
router.put('/:id/seats', authMw, roleMw(ROLES.SUPERADMIN), tenancy.setSeatLimit);
router.get('/:id/events', authMw, roleMw(ROLES.SUPERADMIN), tenancy.listCustomerEvents);
router.get('/:id/plan', authMw, roleMw(ROLES.SUPERADMIN), orderActions.customerPlan);
router.put('/:id/modules/:key', authMw, roleMw(ROLES.SUPERADMIN), orderActions.setCustomerModule);
router.put('/:id/plan-exempt', authMw, roleMw(ROLES.SUPERADMIN), orderActions.setPlanExempt);
router.post('/:id/community', authMw, roleMw(ROLES.SUPERADMIN), orderActions.grantCommunity);
router.post('/:id/setup-link', authMw, roleMw(ROLES.SUPERADMIN), orderActions.resendCustomerSetupLink);

module.exports = router;
