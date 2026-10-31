/**
 * @file checkout.routes.js
 * @description Buying the product.
 *
 *   GET  /api/checkout/plans → what is on sale and what it costs (public)
 *   POST /api/checkout/quote → the price with a discount code or claim
 *                              (public; signed in, the organisation's uses count)
 *   POST /api/checkout       → place an order            (signed in)
 *
 * `plans` is public because a price list is public — and because it is the
 * only place the price is stated. The pricing page renders these rather than
 * its own copy, so a change here cannot leave the site advertising a number
 * the checkout will not honour.
 *
 * `POST` needs a session and nothing more. Buying is how somebody *becomes* a
 * customer, so requiring a customer role first would be a closed loop.
 */

const express = require('express');
const checkout = require('../controllers/checkout.controller');
const authMw = require('../middlewares/authMw');
const { quoteLimiter } = require('../middlewares/authRateLimit');

const router = express.Router();

router.get('/plans', checkout.listPlans);
// Rate-limited like sign-in: it answers whether a code exists.
router.post('/quote', quoteLimiter, authMw.optionalAuthMw, checkout.quote);
router.post('/', authMw, checkout.placeOrder);

module.exports = router;
