/**
 * @file checkout.controller.js
 * @description The public price list, and placing an order against it.
 */

const checkoutService = require('../services/checkout.service');
const billingService = require('../services/billing.service');
const catalogue = require('../services/priceCatalogue.service');
const discounts = require('../services/discount.service');
const cardPayments = require('../services/cardPayments');
const emailService = require('../services/email.service');
const audit = require('../services/audit.service');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const { successResponse, errorResponse } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { CURRENCY, PLANS } = require('../constants/plans');
const { TERMS_VERSION } = require('../constants/legal');

/**
 * What is on sale.
 *
 * Amounts stay in minor units all the way to the browser, which formats them.
 * Converting to a float here is how ₼14,900 becomes ₼14,899.99 on somebody's
 * invoice.
 *
 * Per plan: the price on each period from the owner's catalogue, the
 * struck-through "was" price where the owner set one (`*ListMinor`), the
 * limits, and whether it is on sale (`active`). `campaigns` are the
 * automatic discounts running now: `eligibility: 'all'` applies to every
 * order it fits — the page shows the price after it — and `'education'` to
 * universities and non-profits who say so at checkout.
 *
 * Next to the prices: how the buyer can pay (`payment.methods` — bank transfer
 * only until a card provider is configured), whether VAT is added (`vat`, the
 * seller's setting) and the version of the terms the checkout asks them to
 * accept.
 */
const listPlans = async (req, res, next) => {
  try {
    const [billing, plans, campaigns] = await Promise.all([
      billingService.getBilling(),
      catalogue.getCatalogue(),
      discounts.publicCampaigns(),
    ]);
    // Prices change when the owner saves; a cached list would advertise the old one.
    res.set('Cache-Control', 'no-store');
    return successResponse(res, HTTP.OK, 'OK', {
      payment: { methods: cardPayments.paymentMethods() },
      vat: billingService.vatPolicy(billing),
      termsVersion: TERMS_VERSION,
      currency: CURRENCY,
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        perEventMinor: p.perEventMinor,
        annualMinor: p.annualMinor,
        perEventListMinor: p.perEventListMinor,
        annualListMinor: p.annualListMinor,
        active: p.active,
        seats: p.seats,
        participants: p.participants,
        eventsPerYear: p.eventsPerYear,
        storageGb: p.storageGb,
        quoteOnly: Boolean(p.quoteOnly),
        // Community: free, granted by the owner, never through checkout.
        grantOnly: Boolean(p.grantOnly),
      })),
      campaigns,
    });
  } catch (error) { next(error); }
};

/**
 * POST /api/checkout/quote { plan, billingPeriod, discountCode?, education?, customerId? }
 *
 * The price the checkout would charge, with the discount a code or a claim
 * gives, so the page can say at once whether the code works and why not.
 * A code that does not apply is not an error here: the answer carries the
 * price without it and `code: { ok: false, reason }`. Signed in, the
 * organisation's earlier uses count (`customerId`, only one of the buyer's
 * own); signed out they are checked when the order is placed.
 */
const quote = async (req, res, next) => {
  try {
    const { plan, billingPeriod, discountCode, education, customerId } = req.body || {};
    let mine = null;
    const chosen = Number.parseInt(String(customerId || ''), 10);
    if (req.user && chosen > 0) {
      const own = await checkoutService.findExistingCustomer(req.user.id, req.user.email);
      mine = own.some((c) => c.id === chosen) ? chosen : null;
    }
    const q = await checkoutService.quote({ plan, billingPeriod, discountCode, education, customerId: mine });
    // Only a code that does not exist counts towards the guessing limit.
    if (q.code && q.code.reason === 'COUPON_NOT_FOUND') res.locals.unknownCode = true;
    return successResponse(res, HTTP.OK, 'OK', checkoutService.publicQuote(q));
  } catch (error) {
    if (error && error.statusCode) return errorResponse(res, error.statusCode, error.message, null, error.code);
    next(error);
  }
};

/**
 * Receipt to the buyer, alert to the sales inbox. Nothing reported an order
 * before: it sat in the owner console until someone happened to look.
 * After the response; a mail problem never fails a placed order.
 */
function notifyOrderPlaced(user, order, { eventName }) {
  const plan = PLANS[order.plan] || { name: order.plan };
  const frontendUrl = resolveFrontendBaseUrl();
  // The organisation the order is really for, which for a returning buyer is
  // not necessarily what was typed.
  const organisation = order.customer_name;
  emailService.sendOrderPlacedEmail({
    to: user.email,
    fullName: user.full_name,
    orderCode: order.order_code,
    planName: plan.name,
    billingPeriod: order.billing_period,
    amountMinor: order.amount_minor,
    taxMinor: order.tax_minor,
    currency: order.currency,
    organisation,
    frontendUrl,
    paymentMethod: order.payment_method,
    cardLast4: order.card_last4,
    lang: order.locale,
  });
  emailService.sendSalesAlert({
    subject: `New order ${order.order_code} — ${plan.name} — ${organisation}`,
    heading: `New order ${order.order_code}`,
    fields: [
      ['Organisation', organisation],
      ['Buyer', `${user.full_name || ''} <${user.email}>`],
      ['Plan', `${plan.name} (${order.billing_period})`],
      ['Amount', `${(Number(order.amount_minor || 0) / 100).toFixed(2)} ${order.currency}`],
      ['Payment', order.payment_method === 'card'
        ? `Card ${order.card_brand || ''} ending ${order.card_last4}`
        : 'Bank transfer; the invoice is issued when you approve the order'],
      ['Terms', `accepted, version ${order.terms_version || '—'}`],
      ['Event', eventName],
    ],
    replyTo: user.email,
    link: `${frontendUrl}/workspace/orders`,
  });
}

const placeOrder = async (req, res, next) => {
  try {
    const {
      plan, billingPeriod, organisation, customerId, vatId, country, city, eventName, payment,
      acceptTerms, termsVersion, idempotencyKey, lang, discountCode, education,
    } = req.body || {};

    const result = await checkoutService.placeOrder({
      user: req.user,
      plan,
      billingPeriod,
      organisation,
      customerId,
      vatId,
      country,
      city,
      eventName,
      payment,
      acceptTerms,
      termsVersion,
      // In the body or as the usual header; the same thing either way.
      idempotencyKey: idempotencyKey || req.get('Idempotency-Key'),
      lang,
      // A code and a claim, never a price: the server works out what they take off.
      discountCode,
      education,
    });

    // A repeated attempt is answered with the order it made, and told nobody twice.
    if (result.replayed) {
      return successResponse(res, HTTP.OK, `Order ${result.order.order_code} was already placed`, result);
    }
    notifyOrderPlaced(req.user, result.order, { eventName });
    if (result.order.coupon_id) {
      audit.record(req, 'coupon.redeem', {
        customerId: result.order.customer_id, targetType: 'order', targetId: result.order.id,
        meta: {
          couponId: result.order.coupon_id, discount: result.order.discount_label,
          discountMinor: Number(result.order.discount_minor), status: result.order.discount_status,
        },
      });
    }

    return successResponse(
      res, HTTP.CREATED,
      `Order ${result.order.order_code} placed`,
      result,
    );
  } catch (error) {
    // The service refuses bad plans and unavailable names deliberately; those
    // are answers for the buyer, not faults to swallow into a 500.
    if (error && error.statusCode) {
      return errorResponse(res, error.statusCode, error.message, error.field ? [{ field: error.field, message: error.message }] : null, error.code);
    }
    if (error && error.status) {
      return errorResponse(res, error.status, error.message, null, error.code);
    }
    next(error);
  }
};

module.exports = { listPlans, quote, placeOrder };
