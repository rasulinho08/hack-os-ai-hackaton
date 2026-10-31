/**
 * @file checkout.service.js
 * @description A buyer placing their own order.
 *
 * Everything else commercial on this platform is owner-only, and correctly so.
 * This is the one path where somebody who is not us writes to `customers` and
 * `orders`, so the rules are tighter than anywhere else:
 *
 *   - **The price comes from the catalogue, never from the request.** The
 *     owner sets it (priceCatalogue.service); a checkout that accepts an
 *     amount is a checkout where the Business plan costs whatever the buyer
 *     types. A discount is the same: the buyer names a code or says they are
 *     a university, and the server works out what that takes off
 *     (discount.service). The order keeps the price before the discount, the
 *     discount and the price charged, and the plan's limits as sold.
 *   - **A discount code's use is taken with the order.** In the same
 *     transaction, under the code's row lock: the last use goes to one order,
 *     and an order whose code was used up meanwhile is not placed.
 *   - **A buyer is never attached to a customer they do not already belong
 *     to.** Organisation names are not identity. Two people typing "Azercell"
 *     must not end up reading each other's orders. A returning buyer picks one
 *     of their own organisations (`customerId`, checked against their
 *     memberships); a name that belongs to somebody else's organisation is a
 *     question for the buyer (409 ORGANISATION_NAME_TAKEN), never joined and
 *     never quietly renamed.
 *   - **The order is placed, not paid.** It goes to `pending`. Nothing here
 *     touches `paid_at`, because no money has moved.
 *   - **Nothing is granted until the owner approves.** A new organisation is
 *     created `pending_review`; the buyer's role, the seats and the plan's
 *     entitlement all come with approval (orderLifecycle.service).
 *   - **One attempt, one order.** The browser sends an idempotency key per
 *     checkout attempt; the same key again answers with the order it made.
 *     A buyer's checkouts run one at a time (an advisory lock), so a double
 *     click cannot create two organisations either.
 *   - **The terms are accepted, and recorded.** `acceptTerms: true` is
 *     required; the order keeps the version and the time.
 *   - **Bank transfer against an invoice is the way to pay.** The invoice is
 *     issued when the owner approves the order and is due 14 days later.
 *     A card is taken only when a card provider is configured
 *     (cardPayments.js); even then no card number reaches the server — the
 *     form sends the brand and the last four digits.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const orderService = require('./order.service');
const billingService = require('./billing.service');
const cardPayments = require('./cardPayments');
const catalogue = require('./priceCatalogue.service');
const discounts = require('./discount.service');
const { CURRENCY, PLANS, SELF_SERVE_PLAN_IDS } = require('../constants/plans');
const { TERMS_VERSION } = require('../constants/legal');

const BILLING_PERIODS = ['per_event', 'annual'];
const PAYMENT_CHOICES = ['card', 'bank_transfer'];
const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'maestro', 'unionpay', 'discover', 'jcb', 'other'];
const LOCALES = ['az', 'en', 'ru'];

/** The first key of the advisory lock that runs one buyer's checkouts one at a time. */
const CHECKOUT_LOCK = 41201;

/**
 * How the buyer chose to pay. Card: only while a card provider is configured,
 * and then the brand and last four digits only — any other card field in the
 * request is ignored, so a full number sent by a modified client is never
 * stored.
 */
function paymentChoice(payment) {
  const method = String(payment && payment.method ? payment.method : 'bank_transfer').trim().toLowerCase();
  if (!PAYMENT_CHOICES.includes(method)) {
    throw httpError(400, `Payment method must be one of: ${PAYMENT_CHOICES.join(', ')}`, 'VALIDATION_ERROR');
  }
  if (method !== 'card') return { method, cardBrand: null, cardLast4: null };
  if (!cardPayments.isCardEnabled()) {
    throw httpError(
      400,
      'Card payment is not available. Choose bank transfer: we send the invoice when we approve the order.',
      'CARD_UNAVAILABLE',
    );
  }
  const card = (payment && payment.card) || {};
  const last4 = String(card.last4 || '').trim();
  if (!/^[0-9]{4}$/.test(last4)) throw httpError(400, 'Card details are incomplete.', 'VALIDATION_ERROR');
  const brand = CARD_BRANDS.includes(String(card.brand || '').toLowerCase()) ? String(card.brand).toLowerCase() : 'other';
  return { method, cardBrand: brand, cardLast4: last4 };
}

/** A checkout attempt's key: letters, digits, "-" and "_", 8 to 80 of them. */
function attemptKey(raw) {
  if (raw == null || raw === '') return null;
  const key = String(raw).trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) {
    throw httpError(400, 'The checkout attempt key must be 8–80 letters, digits, "-" or "_".', 'VALIDATION_ERROR');
  }
  return key;
}

/**
 * What the buyer says they are: `true` (a university or a school), or
 * `{ type: 'education' | 'nonprofit', institution }` with its name for the
 * owner's review. Anything else is no claim.
 */
function educationClaim(raw) {
  if (raw === true) return { type: 'education', institution: null };
  if (raw && typeof raw === 'object' && raw.claimed !== false) {
    const type = discounts.CLAIMS.includes(raw.type) ? raw.type : 'education';
    const institution = String(raw.institution || '').trim().slice(0, 200) || null;
    return { type, institution };
  }
  return null;
}

/**
 * What an order for this plan, period and buyer would cost: the catalogue's
 * price, the best discount that applies, VAT on what is left. Used to answer
 * the checkout as the buyer types a code (`POST /api/checkout/quote`) and to
 * price the order itself, so the two cannot disagree.
 */
async function quote({ plan, billingPeriod, discountCode, education, customerId = null }) {
  const planId = String(plan || '').trim().toLowerCase();
  if (!SELF_SERVE_PLAN_IDS.includes(planId)) {
    throw httpError(
      400,
      PLANS[planId] && PLANS[planId].quoteOnly
        ? 'Enterprise is quoted individually — talk to us and we will put a price together.'
        : PLANS[planId] && PLANS[planId].grantOnly
          ? 'Community is free for student clubs and non-commercial university events. Apply through the contact form and we will set it up.'
          : `Plan must be one of: ${SELF_SERVE_PLAN_IDS.join(', ')}`,
      'PLAN_NOT_SELF_SERVE',
    );
  }
  // An unrecognised period used to become "annual" — the dearer one —
  // without a word. It is an error now.
  const period = String(billingPeriod || '').trim();
  if (!BILLING_PERIODS.includes(period)) {
    throw httpError(400, `Billing period must be one of: ${BILLING_PERIODS.join(', ')}`, 'VALIDATION_ERROR');
  }
  const entry = await catalogue.getPlan(planId);
  if (!entry.active) {
    throw httpError(409, `The ${entry.name} plan is not on sale at the moment. Choose another plan or talk to us.`, 'PLAN_NOT_ON_SALE');
  }
  const priceMinor = catalogue.priceIn(entry, period);
  if (priceMinor == null) {
    throw httpError(400, `The ${entry.name} plan is not sold ${period === 'annual' ? 'annually' : 'per event'}.`, 'PERIOD_UNAVAILABLE');
  }
  const claim = educationClaim(education);
  const offer = await discounts.bestOffer({ planId, period, priceMinor, code: discountCode, claim: claim ? claim.type : null, customerId });
  const billing = await billingService.getBilling();
  const taxMinor = billingService.taxFor(offer.amountMinor, billing);
  return {
    planId,
    period,
    plan: entry,
    priceMinor,
    listPriceMinor: catalogue.listPriceIn(entry, period),
    discountMinor: offer.discountMinor,
    amountMinor: offer.amountMinor,
    taxMinor,
    taxRatePercent: billing.vatRegistered ? billing.vatRatePercent : null,
    totalMinor: offer.amountMinor + taxMinor,
    currency: CURRENCY,
    coupon: offer.coupon,
    discountStatus: offer.status,
    claim: offer.coupon && discounts.CLAIMS.includes(offer.coupon.eligibility) ? claim : null,
    code: offer.code,
  };
}

/** A quote as the browser reads it: the figures and the discount, never the coupon row. */
const publicQuote = (q) => ({
  plan: q.planId,
  billingPeriod: q.period,
  priceMinor: q.priceMinor,
  listPriceMinor: q.listPriceMinor,
  discountMinor: q.discountMinor,
  amountMinor: q.amountMinor,
  taxMinor: q.taxMinor,
  totalMinor: q.totalMinor,
  currency: q.currency,
  discount: q.coupon ? {
    kind: q.coupon.kind,
    code: q.coupon.code,
    name: q.coupon.name,
    label: discounts.labelOf(q.coupon),
    discountType: q.coupon.discount_type,
    percentOff: q.coupon.percent_off == null ? null : Number(q.coupon.percent_off),
    amountOffMinor: q.coupon.amount_off_minor == null ? null : Number(q.coupon.amount_off_minor),
    status: q.discountStatus,
    needsReview: q.discountStatus === 'claimed',
  } : null,
  code: q.code,
});

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * The organisations this buyer already belongs to, primary first, with their
 * role in each.
 *
 * Matched on the contact row, by account id or e-mail — never by organisation
 * name. This is the only way an existing customer is ever reused: a returning
 * buyer picks one of these, or types the name of one of these.
 */
async function findExistingCustomer(userId, email) {
  const result = await db.query(
    `SELECT DISTINCT ON (c.id) c.id, c.name, c.seat_limit, c.status, c.vat_id, c.country, c.city, cc.member_role, cc.is_primary
       FROM customers c
       JOIN customer_contacts cc ON cc.customer_id = c.id
      WHERE (cc.user_id = $1 OR ($2 <> '' AND LOWER(cc.email) = LOWER($2)))
        AND c.archived_at IS NULL
      ORDER BY c.id, (cc.member_role = 'owner') DESC`,
    [userId || null, String(email || '').trim()],
  );
  return result.rows.sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.id - b.id);
}

/**
 * Create the customer for a new organisation.
 *
 * `customers.name` is unique on LOWER(name). A collision means somebody else
 * already registered that name, and the buyer is asked what they meant: to
 * join that organisation (its owner invites them) or to name theirs so it can
 * be told apart. The name prints on invoices, so it is never changed for them
 * — an e-mail username in a legal name is worse than a question.
 */
async function createCustomerFor(client, { organisation, email, vatId, country, city }) {
  const name = String(organisation).trim().slice(0, 200);
  /*
   * A savepoint, because Postgres aborts the whole transaction on a failed
   * statement; with it the unique violation can be answered cleanly.
   */
  await client.query('SAVEPOINT try_customer_name');
  try {
    const inserted = await client.query(
      `INSERT INTO customers (name, billing_email, vat_id, country, city, status)
       VALUES ($1, $2, $3, $4, $5, 'pending_review')
       RETURNING id, name`,
      [name, email, vatId || null, country || null, city || null],
    );
    await client.query('RELEASE SAVEPOINT try_customer_name');
    return inserted.rows[0];
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT try_customer_name');
    if (!err || err.code !== '23505') throw err;
    throw httpError(
      409,
      `An organisation called "${name}" already has a HackOS account. If you work there, ask its owner to invite you to the team. If yours is a different organisation, enter its full registered name so the two can be told apart.`,
      'ORGANISATION_NAME_TAKEN',
      { field: 'organisation' },
    );
  }
}

const clip = (v, max) => {
  const t = v == null ? '' : String(v).trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Billing details typed at checkout for an organisation that already exists.
 * They are saved, not dropped: the invoice reads them. Only an owner of the
 * organisation changes them; a colleague sees them read-only.
 */
async function applyDetails(client, target, { vatId, country, city }) {
  const wanted = { vat_id: clip(vatId, 60), country: clip(country, 100), city: clip(city, 120) };
  const changes = Object.entries(wanted).filter(([k, v]) => v && v !== (target[k] || null));
  if (changes.length === 0) return false;
  if (target.member_role !== 'owner') {
    throw httpError(403, 'Only an owner of the organisation can change its billing details.', 'BILLING_OWNER_ONLY');
  }
  const sets = changes.map(([k], i) => `${k} = $${i + 2}`);
  await client.query(
    `UPDATE customers SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
    [target.id, ...changes.map(([, v]) => v)],
  );
  return true;
}

/** The order this buyer already placed with this attempt's key, if any. */
async function orderForAttempt(userId, key) {
  const r = await db.query('SELECT id FROM orders WHERE purchaser_user_id = $1 AND idempotency_key = $2', [userId, key]);
  return r.rows[0] ? orderService.getOrderById(r.rows[0].id) : null;
}

/**
 * Place an order for the signed-in buyer.
 *
 * Returns the order, the customer, whether the customer was created and
 * whether this was a repeat of an attempt already placed (`replayed`).
 */
async function placeOrder({
  user, plan, billingPeriod, organisation, customerId, vatId, country, city, eventName, payment,
  acceptTerms, termsVersion, idempotencyKey, lang, discountCode, education,
}) {
  // Plan, period and price are checked before anything else; the discount
  // is priced again below, once it is known which organisation buys.
  const { planId, period } = await quote({ plan, billingPeriod });

  const chosenId = customerId == null || customerId === '' ? null : Number.parseInt(String(customerId), 10);
  if (customerId != null && customerId !== '' && !(chosenId > 0)) {
    throw httpError(400, 'Choose one of your organisations, or name a new one.', 'VALIDATION_ERROR');
  }
  const org = String(organisation || '').trim();
  if (!chosenId && org.length < 2) {
    throw httpError(400, 'Tell us the organisation this is for', 'VALIDATION_ERROR');
  }

  if (acceptTerms !== true) {
    throw httpError(400, 'Accept the Terms of use and the Refund policy to place the order.', 'TERMS_REQUIRED');
  }
  if (termsVersion != null && termsVersion !== '' && String(termsVersion) !== TERMS_VERSION) {
    throw httpError(409, 'The terms have changed since this page was opened. Reload it to read the current ones.', 'TERMS_CHANGED');
  }

  const key = attemptKey(idempotencyKey);
  const locale = LOCALES.includes(String(lang || '').toLowerCase()) ? String(lang).toLowerCase() : null;
  const pay = paymentChoice(payment);

  // One checkout per buyer at a time: the idempotency check, the organisation
  // and the order happen as one step, so a double click makes one of each.
  const lock = await db.pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1, $2)', [CHECKOUT_LOCK, user.id]);

    if (key) {
      const before = await orderForAttempt(user.id, key);
      if (before) {
        const same = before.plan === planId && before.billing_period === period
          && before.payment_method === pay.method && (!chosenId || before.customer_id === chosenId);
        if (!same) {
          throw httpError(409, 'This checkout attempt already placed a different order. Reload the page to start a new one.', 'IDEMPOTENCY_MISMATCH');
        }
        return { order: before, customerId: before.customer_id, createdCustomer: false, replayed: true };
      }
    }

    const mine = await findExistingCustomer(user.id, user.email);
    let target = null;
    if (chosenId) {
      target = mine.find((m) => m.id === chosenId) || null;
      if (!target) throw httpError(404, 'That organisation is not one of yours.', 'ORGANISATION_NOT_FOUND');
    } else {
      // Their own organisation typed again is that organisation, not a new one.
      target = mine.find((m) => sameName(m.name, org)) || null;
    }

    // The price for this buyer: their organisation's earlier uses of a code
    // count, and a new organisation has none. A code that does not apply is
    // refused here, before an organisation is created for nothing.
    const priced = await quote({ plan: planId, billingPeriod: period, discountCode, education, customerId: target ? target.id : null });
    if (priced.code && !priced.code.ok) {
      throw httpError(400, priced.code.message, priced.code.reason, { field: 'discountCode' });
    }
    const amountMinor = priced.amountMinor;

    let customer;
    let createdCustomer = false;
    try {
      await lock.query('BEGIN');
      if (target) {
        customer = target;
        await applyDetails(lock, target, { vatId, country, city });
        // An organisation closed with a refused order is reviewed again.
        await lock.query(
          `UPDATE customers SET status = 'pending_review', updated_at = now() WHERE id = $1 AND status = 'cancelled'`,
          [target.id],
        );
      } else {
        customer = await createCustomerFor(lock, {
          organisation: org, email: user.email, vatId: clip(vatId, 60), country: clip(country, 100), city: clip(city, 120),
        });
        createdCustomer = true;
        await lock.query(
          `INSERT INTO customer_contacts (customer_id, user_id, full_name, email, is_primary, member_role)
           VALUES ($1, $2, $3, $4, true, 'owner')
           ON CONFLICT (customer_id, LOWER(email)) DO UPDATE SET user_id = EXCLUDED.user_id, member_role = 'owner'`,
          [customer.id, user.id, user.full_name || null, user.email],
        );
        // The buyer's role, the seats and the plan come with approval.
      }
      await lock.query('COMMIT');
    } catch (err) {
      await lock.query('ROLLBACK').catch(() => {});
      throw err;
    }

    const notes = [
      eventName ? `Event: ${String(eventName).trim().slice(0, 200)}` : null,
      pay.method === 'card'
        ? `Placed through the website checkout with a card ending ${pay.cardLast4} (provider: ${cardPayments.cardProvider().name}).`
        : 'Placed through the website checkout, to be paid by bank transfer against the invoice issued on approval.',
    ].filter(Boolean).join('\n');

    const coupon = priced.coupon;
    let draft;
    try {
      draft = await orderService.createOrder({
        customer_id: customer.id,
        plan: planId,
        billing_period: period,
        currency: CURRENCY,
        amount_minor: amountMinor,
        tax_minor: priced.taxMinor,
        tax_rate_percent: priced.taxRatePercent,
        purchaser_user_id: user.id,
        notes,
        idempotency_key: key,
        terms_version: TERMS_VERSION,
        locale,
        list_amount_minor: priced.priceMinor,
        discount_minor: coupon ? priced.discountMinor : null,
        coupon_id: coupon ? coupon.id : null,
        discount_code: coupon ? coupon.code : null,
        discount_label: coupon ? discounts.labelOf(coupon) : null,
        discount_status: coupon ? priced.discountStatus : null,
        discount_claim: coupon ? priced.claim : null,
        plan_terms: catalogue.termsOf(priced.plan),
      }, user.id, {
        within: coupon
          ? (client, orderId) => discounts.redeem(client, {
            couponId: coupon.id, orderId, customerId: customer.id, userId: user.id, planId, period, discountMinor: priced.discountMinor,
          })
          : null,
      });
    } catch (err) {
      // The code was used up between the price and the order (another
      // checkout took the last use): no order, and no empty organisation.
      if (createdCustomer) {
        await db.query(
          `DELETE FROM customers WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM orders WHERE customer_id = $1)`,
          [customer.id],
        ).catch(() => {});
      }
      throw err;
    }

    await db.query(
      'UPDATE orders SET payment_method = $2, card_brand = $3, card_last4 = $4 WHERE id = $1',
      [draft.id, pay.method, pay.cardBrand, pay.cardLast4],
    );

    // Placed, not paid. `pending` stamps `placed_at` and leaves `paid_at` alone.
    // The invoice comes with approval (orderLifecycle.approve).
    const placed = await orderService.setOrderStatus(
      draft.id, 'pending', user.id, 'Placed by the buyer at checkout',
    );

    return { order: placed, customerId: customer.id, createdCustomer, replayed: false };
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1, $2)', [CHECKOUT_LOCK, user.id]).catch(() => {});
    lock.release();
  }
}

module.exports = {
  placeOrder, quote, publicQuote, educationClaim, findExistingCustomer, paymentChoice, attemptKey, BILLING_PERIODS, PAYMENT_CHOICES, LOCALES,
};
