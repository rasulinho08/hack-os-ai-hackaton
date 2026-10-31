/**
 * @file orderLifecycle.service.js
 * @description The owner's three decisions about an order.
 *
 *   approve        placed (or paid) → active: the organisation goes live, the
 *                  buyer administers it, the plan's entitlement is granted,
 *                  the invoice is issued (due in 14 days) and — for an
 *                  organisation not set up yet — a setup link. One
 *                  transaction: an order is never active without what it
 *                  grants, or the other way round.
 *   reject         placed → cancelled, with a reason the buyer is shown. An
 *                  organisation that existed only for this order closes too.
 *   recordPayment  money arrived: method, reference, date. Moves a placed
 *                  order to paid; on an order already active it only records.
 *
 * Activation and payment are independent on purpose: a customer the owner
 * trusts can start before the transfer lands, and a transfer can arrive for
 * an order that is already running.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { ROLES } = require('../constants/roles');
const entitlementService = require('./entitlement.service');
const discounts = require('./discount.service');
const setupService = require('./setup.service');
const { getOrderById, allocateInvoice, createOrder, setOrderStatus, PAYMENT_METHODS, DEFAULT_INVOICE_TERMS_DAYS } = require('./order.service');
const catalogue = require('./priceCatalogue.service');

async function lockOrder(client, id) {
  const result = await client.query(
    `SELECT o.*, c.status AS customer_status, c.billing_email, c.onboarded_at AS customer_onboarded_at
       FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.id = $1
      FOR UPDATE OF o`,
    [id],
  );
  return result.rows[0] || null;
}

async function history(client, orderId, from, to, actorId, note) {
  await client.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [orderId, from, to, actorId, note || null],
  );
}

/** Who to tell: the account that placed the order, else the billing address. */
async function buyerOf(client, order) {
  if (order.purchaser_user_id) {
    const r = await client.query('SELECT email, full_name FROM users WHERE id = $1', [order.purchaser_user_id]);
    if (r.rows[0]) return { email: r.rows[0].email, fullName: r.rows[0].full_name };
  }
  return order.billing_email ? { email: order.billing_email, fullName: null } : null;
}

async function inTransaction(work) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const out = await work(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Approve and activate. Returns the order, the entitlement, the setup link
 * (token + expiry, or null when the organisation is already set up) and the
 * buyer to e-mail; null when no such order.
 *
 * The invoice is issued here, not at checkout: the rule the buyer reads
 * everywhere is "we invoice when we approve; pay within 14 days of the
 * invoice". An order that is refused never takes an invoice number.
 */
async function approve(id, actorId, { note } = {}) {
  const out = await inTransaction(async (client) => {
    const order = await lockOrder(client, id);
    if (!order) return null;
    if (!['pending', 'paid'].includes(order.status)) {
      throw httpError(409, `Only a placed order can be approved; this one is ${order.status}.`, 'ILLEGAL_TRANSITION');
    }

    await client.query(
      `UPDATE orders SET status = 'delivered', delivered_at = COALESCE(delivered_at, now()), status_reason = NULL
        WHERE id = $1`,
      [id],
    );
    await history(client, id, order.status, 'delivered', actorId, note || 'Approved and activated');

    // A suspension is a separate decision; approving an order does not lift it.
    await client.query(
      `UPDATE customers SET status = 'active', updated_at = now()
        WHERE id = $1 AND status IN ('pending_review', 'pending_setup')`,
      [order.customer_id],
    );
    // A discount the buyer claimed (education) is accepted with the order;
    // to refuse it the owner removes it first (removeClaim).
    if (order.discount_status === 'claimed') {
      await client.query("UPDATE orders SET discount_status = 'approved' WHERE id = $1", [id]);
      await history(client, id, 'delivered', 'delivered', actorId, `Discount accepted: ${order.discount_label}`);
    }

    const { seats } = await entitlementService.termsForOrder(client, order);
    if (seats != null) {
      await client.query(
        `UPDATE customers SET seat_limit = GREATEST(COALESCE(seat_limit, 0), $1), updated_at = now()
          WHERE id = $2`,
        [seats, order.customer_id],
      );
    }

    if (order.purchaser_user_id) {
      // The buyer administers what they bought. Upwards only: an admin or
      // the platform owner keeps what they have.
      await client.query(
        `UPDATE users SET role = $1
          WHERE id = $2 AND role NOT IN ('superadmin', 'admin', 'org_admin')`,
        [ROLES.ORG_ADMIN, order.purchaser_user_id],
      );
      await client.query(
        `UPDATE customer_contacts SET member_role = 'owner'
          WHERE customer_id = $1 AND user_id = $2 AND member_role <> 'owner' AND is_primary = true`,
        [order.customer_id, order.purchaser_user_id],
      );
    }

    const entitlement = await entitlementService.grantForOrder(client, order, actorId);
    // A free order (Community) has nothing to pay, so no invoice.
    if (!order.invoice_number && order.amount_minor != null && Number(order.amount_minor) > 0) {
      await allocateInvoice(client, { id, status: 'delivered' }, DEFAULT_INVOICE_TERMS_DAYS, actorId);
    }
    const buyer = await buyerOf(client, order);
    // An organisation that is already set up (a renewal, a second plan) is
    // not sent through setup again: that would re-send the e-mail and offer
    // to overwrite its name and branding.
    const setup = buyer && !order.customer_onboarded_at
      ? await setupService.issue(client, { customerId: order.customer_id, orderId: id, email: buyer.email, actorId })
      : null;
    return { entitlement, buyer, setup };
  });
  if (!out) return null;
  return { order: await getOrderById(id), ...out };
}

/** Refuse a placed order. The reason is shown to the buyer. */
async function reject(id, actorId, { reason } = {}) {
  const text = String(reason || '').trim();
  if (text.length < 3) throw httpError(400, 'Say why the order is refused — the buyer will read it.', 'VALIDATION_ERROR');
  const out = await inTransaction(async (client) => {
    const order = await lockOrder(client, id);
    if (!order) return null;
    if (!['draft', 'pending'].includes(order.status)) {
      throw httpError(409, order.status === 'paid'
        ? 'This order is paid; refund it instead of refusing it.'
        : `A ${order.status} order cannot be refused.`, 'ILLEGAL_TRANSITION');
    }
    await client.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, now()), status_reason = $2
        WHERE id = $1`,
      [id, text.slice(0, 1000)],
    );
    await history(client, id, order.status, 'cancelled', actorId, `Refused: ${text.slice(0, 500)}`);
    // A refused order does not use up a discount code.
    await discounts.release(client, id);
    // An organisation that only existed for this order closes with it.
    await client.query(
      `UPDATE customers SET status = 'cancelled', updated_at = now()
        WHERE id = $1 AND status = 'pending_review'
          AND NOT EXISTS (SELECT 1 FROM orders
                           WHERE customer_id = $1 AND id <> $2
                             AND status IN ('pending', 'paid', 'delivered'))`,
      [order.customer_id, id],
    );
    return { buyer: await buyerOf(client, order) };
  });
  if (!out) return null;
  return { order: await getOrderById(id), ...out };
}

/**
 * Take a claimed discount (education) off an order before it is approved:
 * the order goes back to the plan's price, VAT at the rate it was priced
 * with, and the coupon's use is given back. Refused once the order is
 * invoiced or decided — the buyer has the amount in writing by then.
 */
async function removeClaim(id, actorId, { reason } = {}) {
  const text = String(reason || '').trim().slice(0, 500);
  const out = await inTransaction(async (client) => {
    const order = await lockOrder(client, id);
    if (!order) return null;
    if (order.discount_status !== 'claimed') {
      throw httpError(409, order.discount_status
        ? 'This discount is not waiting for a review; it was applied when the order was placed.'
        : 'This order has no discount to remove.', 'DISCOUNT_NOT_CLAIMED');
    }
    if (!['draft', 'pending'].includes(order.status) || order.invoice_number) {
      throw httpError(409, 'The order is already invoiced or decided, so its amount no longer changes.', 'DISCOUNT_LOCKED');
    }
    const amount = Number(order.list_amount_minor);
    const rate = order.tax_rate_percent == null ? null : Number(order.tax_rate_percent);
    const tax = rate ? Math.round((amount * rate) / 100) : (order.tax_minor == null ? null : 0);
    await client.query(
      `UPDATE orders SET amount_minor = $2, tax_minor = $3, discount_status = 'removed' WHERE id = $1`,
      [id, amount, tax],
    );
    await discounts.release(client, id);
    await history(client, id, order.status, order.status, actorId,
      `Discount removed: ${order.discount_label}${text ? ` — ${text}` : ''}`);
    return { removed: order.discount_label, buyer: await buyerOf(client, order) };
  });
  if (!out) return null;
  return { order: await getOrderById(id), ...out };
}

/**
 * Grant the free Community plan to an organisation (a student club, a
 * non-commercial university event), through the same path as a sale: an
 * order for ₼0 that is approved at once, so the organisation goes live and
 * gets a year's entitlement with Community's limits — and the grant has an
 * order code, a history and an audit row like anything else. A free order
 * takes no invoice. Refused while the organisation still has a live
 * Community entitlement.
 */
async function grantCommunity(customerId, actorId, { note } = {}) {
  const c = await db.query('SELECT id, name, archived_at FROM customers WHERE id = $1', [customerId]);
  if (!c.rows[0]) return null;
  if (c.rows[0].archived_at) throw httpError(409, 'This organisation is archived.', 'CUSTOMER_ARCHIVED');
  const live = await db.query(
    `SELECT 1 FROM entitlements WHERE customer_id = $1 AND plan = 'community' AND revoked_at IS NULL AND ends_at > now()`,
    [customerId],
  );
  if (live.rows[0]) throw httpError(409, 'This organisation already has a live Community plan.', 'COMMUNITY_ACTIVE');
  const plan = await catalogue.getPlan('community');
  const text = String(note || '').trim().slice(0, 500);
  const draft = await createOrder({
    customer_id: customerId,
    plan: 'community',
    billing_period: 'annual',
    amount_minor: 0,
    tax_minor: 0,
    list_amount_minor: 0,
    plan_terms: catalogue.termsOf(plan),
    notes: `Community plan granted by the owner${text ? `: ${text}` : ''}.`,
  }, actorId);
  await setOrderStatus(draft.id, 'pending', actorId, 'Community plan granted');
  return approve(draft.id, actorId, { note: 'Community plan granted' });
}

/** Record that money arrived. */
async function recordPayment(id, actorId, { method, reference, paidAt } = {}) {
  const m = String(method || '').trim().toLowerCase();
  if (!PAYMENT_METHODS.includes(m)) {
    throw httpError(400, `Payment method must be one of: ${PAYMENT_METHODS.join(', ')}`, 'BAD_PAYMENT_METHOD');
  }
  let when = new Date();
  if (paidAt) {
    when = new Date(paidAt);
    if (Number.isNaN(when.getTime()) || when > new Date(Date.now() + 60_000)) {
      throw httpError(400, 'The payment date must be a real date, not in the future.', 'VALIDATION_ERROR');
    }
  }
  const ref = reference == null ? null : String(reference).trim().slice(0, 120) || null;

  const out = await inTransaction(async (client) => {
    const order = await lockOrder(client, id);
    if (!order) return null;
    if (!['pending', 'paid', 'delivered'].includes(order.status)) {
      throw httpError(409, `A ${order.status} order cannot take a payment.`, 'ILLEGAL_TRANSITION');
    }
    const to = order.status === 'pending' ? 'paid' : order.status;
    await client.query(
      `UPDATE orders SET status = $2, paid_at = $3, payment_method = $4,
              payment_reference = COALESCE($5, payment_reference)
        WHERE id = $1`,
      [id, to, when, m, ref],
    );
    await history(client, id, order.status, to, actorId,
      `Payment recorded: ${m}${ref ? ` (${ref})` : ''}, ${when.toISOString().slice(0, 10)}`);
    return { buyer: await buyerOf(client, order) };
  });
  if (!out) return null;
  return { order: await getOrderById(id), ...out };
}

/** A fresh setup link for an approved order (the old one stops working). */
async function reissueSetupLink(id, actorId) {
  return inTransaction(async (client) => {
    const order = await lockOrder(client, id);
    if (!order) return null;
    if (order.status !== 'delivered') {
      throw httpError(409, 'Only an approved order has a setup link.', 'ILLEGAL_TRANSITION');
    }
    const buyer = await buyerOf(client, order);
    if (!buyer) throw httpError(409, 'This order has no buyer address to send the link to.', 'NO_RECIPIENT');
    const setup = await setupService.issue(client, { customerId: order.customer_id, orderId: id, email: buyer.email, actorId });
    await history(client, id, order.status, order.status, actorId, 'Setup link sent again');
    return { order, buyer, setup };
  });
}

/**
 * A fresh setup link for an organisation, from the console's organisation
 * page: sent for its latest approved order, to that order's buyer.
 */
async function reissueForCustomer(customerId, actorId) {
  const r = await db.query(
    `SELECT id FROM orders WHERE customer_id = $1 AND status = 'delivered'
      ORDER BY delivered_at DESC NULLS LAST, id DESC LIMIT 1`,
    [customerId],
  );
  if (!r.rows[0]) {
    const exists = await db.query('SELECT 1 FROM customers WHERE id = $1', [customerId]);
    if (!exists.rows[0]) return null;
    throw httpError(409, 'This organisation has no approved order, so there is no setup to send.', 'ILLEGAL_TRANSITION');
  }
  return reissueSetupLink(r.rows[0].id, actorId);
}

module.exports = { approve, reject, removeClaim, grantCommunity, recordPayment, reissueSetupLink, reissueForCustomer };
