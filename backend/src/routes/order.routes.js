/**
 * @file order.routes.js
 * @description Orders — the owner's view.
 *
 *   GET   /api/orders            → list, filterable by status/customer/event
 *   POST  /api/orders            → create (starts in draft)
 *   GET   /api/orders/:id        → one, with its status history
 *   PATCH /api/orders/:id        → edit the terms
 *   PATCH /api/orders/:id/status  → move it through the flow
 *   POST  /api/orders/:id/invoice → allocate an invoice number
 *   POST  /api/orders/:id/discount/remove → take a claimed discount off before approval
 *
 * Owner-only, like the customer routes.
 *
 * Status is its own endpoint rather than a field on PATCH: moving an order to
 * `paid` is an event that gets recorded and refused if the flow does not allow
 * it, which is different from correcting a typo in the notes.
 */

const express = require('express');
const commerce = require('../controllers/commerce.controller');
const orderActions = require('../controllers/orderActions.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { ROLES } = require('../constants/roles');

const router = express.Router();

router.get('/', authMw, roleMw(ROLES.SUPERADMIN), commerce.listOrders);
router.post('/', authMw, roleMw(ROLES.SUPERADMIN), commerce.createOrder);
router.get('/:id', authMw, roleMw(ROLES.SUPERADMIN), commerce.getOrder);
router.patch('/:id', authMw, roleMw(ROLES.SUPERADMIN), commerce.updateOrder);
router.patch('/:id/status', authMw, roleMw(ROLES.SUPERADMIN), commerce.setOrderStatus);
router.post('/:id/invoice', authMw, roleMw(ROLES.SUPERADMIN), commerce.issueInvoice);
router.get('/:id/invoice.pdf', authMw, roleMw(ROLES.SUPERADMIN), orderActions.ownerInvoicePdf);
router.post('/:id/approve', authMw, roleMw(ROLES.SUPERADMIN), orderActions.approve);
router.post('/:id/reject', authMw, roleMw(ROLES.SUPERADMIN), orderActions.reject);
router.post('/:id/discount/remove', authMw, roleMw(ROLES.SUPERADMIN), orderActions.removeDiscount);
router.post('/:id/payment', authMw, roleMw(ROLES.SUPERADMIN), orderActions.recordPayment);
router.post('/:id/setup-link', authMw, roleMw(ROLES.SUPERADMIN), orderActions.resendSetupLink);

module.exports = router;
