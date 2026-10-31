/**
 * @file order.service.js
 * @description Sales: one row per hackathon somebody bought.
 *
 * Two rules shape everything here.
 *
 * Money is integers. `amount_minor` is qəpik, not manat, and it is never
 * converted to a float on the way in or out — a rounding error in a currency
 * column is an invoice that cannot be reconciled. NULL means "not priced yet",
 * which has to stay distinguishable from zero.
 *
 * Status changes are recorded, not just applied. An order row says what state
 * it is in; `order_status_history` says how it got there and who did it, which
 * is the question actually asked three months later.
 */

const db = require('../config/db');
const { revokeForOrder } = require('./entitlement.service');
const billingService = require('./billing.service');
const discounts = require('./discount.service');

/**
 * draft → pending → paid → delivered, with two exits. "delivered" is what the
 * owner console calls active: approved, entitlement granted. An order can be
 * approved before it is paid (pending → delivered) and an active one can be
 * withdrawn (delivered → cancelled); cancelling or refunding an active order
 * revokes what it granted.
 */
const STATUSES = ['draft', 'pending', 'paid', 'delivered', 'cancelled', 'refunded'];
const PLANS = ['community', 'starter', 'professional', 'business', 'enterprise'];
const BILLING_PERIODS = ['per_event', 'annual'];

/**
 * Which moves are allowed from each state.
 *
 * Refusing nonsense transitions in one place beats scattering the same checks
 * through the controllers — and it means "paid → draft" cannot happen by a
 * mistyped request.
 */
const TRANSITIONS = {
  draft:     ['pending', 'cancelled'],
  pending:   ['paid', 'delivered', 'cancelled'],
  paid:      ['delivered', 'refunded'],
  delivered: ['refunded', 'cancelled'],
  cancelled: ['draft'],
  refunded:  [],
};

/** How money is recorded as having arrived. NULL is not one of these. */
const PAYMENT_METHODS = ['bank_transfer', 'card', 'cash', 'other'];

/** Net terms when the caller does not say. Two weeks is the common default. */
const DEFAULT_INVOICE_TERMS_DAYS = 14;

/** The timestamp each state stamps when it is entered. */
const STATUS_TIMESTAMP = {
  pending: 'placed_at',
  paid: 'paid_at',
  delivered: 'delivered_at',
  cancelled: 'cancelled_at',
};

const SELECT = `
  SELECT o.*,
         c.name        AS customer_name,
         c.billing_email AS customer_billing_email,
         e.name        AS event_name,
         e.event_code  AS event_code,
         e.start_date  AS event_start_date,
         e.end_date    AS event_end_date
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN events e ON e.id = o.event_id
`;

/**
 * A short, human-quotable reference. Not a security token — it is printed on
 * invoices and read down the phone, so it is deliberately guessable and the
 * uniqueness comes from the sequence, not from randomness.
 */
const buildOrderCode = (id, createdAt = new Date()) =>
  `HS-${createdAt.getUTCFullYear()}-${String(id).padStart(4, '0')}`;

const listOrders = async ({ status, customerId, eventId } = {}) => {
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`o.status = $${params.length}`); }
  if (customerId) { params.push(customerId); where.push(`o.customer_id = $${params.length}`); }
  if (eventId) { params.push(eventId); where.push(`o.event_id = $${params.length}`); }
  const result = await db.query(
    `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY o.created_at DESC`,
    params,
  );
  return result.rows;
};

const getOrderById = async (id) => {
  const result = await db.query(`${SELECT} WHERE o.id = $1`, [id]);
  return result.rows[0] || null;
};

const getOrderHistory = async (orderId) => {
  const result = await db.query(
    `SELECT h.*, u.full_name AS changed_by_name
       FROM order_status_history h
       LEFT JOIN users u ON u.id = h.changed_by
      WHERE h.order_id = $1
      ORDER BY h.created_at DESC`,
    [orderId],
  );
  return result.rows;
};

/**
 * The orders a signed-in account may see.
 *
 * Scoped through `customer_contacts`, matched by user id or e-mail. An account
 * with no contact row sees nothing — which is the correct answer, not an error.
 */
const listOrdersForUser = async (userId, email) => {
  const result = await db.query(
    `${SELECT}
      WHERE o.customer_id IN (
        SELECT cc.customer_id FROM customer_contacts cc
         WHERE cc.user_id = $1 OR ($2 <> '' AND LOWER(cc.email) = LOWER($2))
      )
      ORDER BY o.created_at DESC`,
    [userId || null, String(email || '').trim()],
  );
  return result.rows;
};

/**
 * Does this account have anything paid for?
 *
 * The question the app asks before opening a workspace. Kept here rather than
 * in the gate so there is one definition of "entitled" — an order that is paid
 * or already delivered.
 */
const hasActiveEntitlement = async (userId, email) => {
  const result = await db.query(
    `SELECT 1
       FROM orders o
      WHERE o.status IN ('paid', 'delivered')
        AND o.customer_id IN (
          SELECT cc.customer_id FROM customer_contacts cc
           WHERE cc.user_id = $1 OR ($2 <> '' AND LOWER(cc.email) = LOWER($2))
        )
      LIMIT 1`,
    [userId || null, String(email || '').trim()],
  );
  return result.rows.length > 0;
};

/**
 * Create an order in draft.
 *
 * `within(client, id)`, when given, runs inside the same transaction once the
 * row exists — checkout takes the discount code's use there, so a code that
 * cannot be used leaves no order behind, and an order is never placed without
 * the use it was priced with.
 */
const createOrder = async (data, actorUserId = null, { within = null } = {}) => {
  const {
    customer_id, event_id, plan, billing_period, currency,
    amount_minor, tax_minor, notes, purchaser_user_id,
    // Checkout only: the attempt's key, the terms the buyer accepted, their language.
    idempotency_key, terms_version, locale,
    // Checkout only: the price before the discount, the discount and the
    // limits of the plan as sold (discount.service, priceCatalogue.service).
    list_amount_minor, discount_minor, coupon_id, discount_code, discount_label,
    discount_status, discount_claim, tax_rate_percent, plan_terms,
  } = data;
  const minor = (v) => (v == null ? null : Math.round(Number(v)));

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO orders
         (order_code, customer_id, event_id, purchaser_user_id, plan,
          billing_period, currency, amount_minor, tax_minor, notes,
          idempotency_key, terms_version, terms_accepted_at, locale,
          list_amount_minor, discount_minor, coupon_id, discount_code, discount_label,
          discount_status, discount_claim, tax_rate_percent, plan_terms)
       VALUES ('', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::varchar,
               CASE WHEN $11::varchar IS NULL THEN NULL ELSE now() END, $12,
               $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21::jsonb)
       RETURNING id, created_at`,
      [
        customer_id,
        event_id || null,
        purchaser_user_id || null,
        plan,
        billing_period || 'per_event',
        (currency || 'AZN').toUpperCase(),
        minor(amount_minor),
        minor(tax_minor),
        notes || null,
        idempotency_key || null,
        terms_version || null,
        locale || null,
        minor(list_amount_minor),
        minor(discount_minor),
        coupon_id || null,
        discount_code || null,
        discount_label || null,
        discount_status || null,
        discount_claim ? JSON.stringify(discount_claim) : null,
        tax_rate_percent == null ? null : Number(tax_rate_percent),
        plan_terms ? JSON.stringify(plan_terms) : null,
      ],
    );
    const { id, created_at } = inserted.rows[0];
    // The code embeds the id, so it can only be written once the row exists.
    await client.query('UPDATE orders SET order_code = $1 WHERE id = $2',
      [buildOrderCode(id, new Date(created_at)), id]);
    await client.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
       VALUES ($1, NULL, 'draft', $2, 'Order created')`,
      [id, actorUserId],
    );
    if (within) await within(client, id);
    await client.query('COMMIT');
    return getOrderById(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const updateOrder = async (id, data) => {
  const allowed = [
    'customer_id', 'event_id', 'plan', 'billing_period',
    'currency', 'amount_minor', 'tax_minor', 'notes', 'purchaser_user_id',
  ];
  const sets = [];
  const values = [];
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    let value = data[key];
    if (key === 'amount_minor' || key === 'tax_minor') {
      value = value == null || value === '' ? null : Math.round(Number(value));
    } else if (key === 'currency' && value) {
      value = String(value).toUpperCase();
    } else if (value === '') {
      value = null;
    }
    values.push(value);
    sets.push(`${key} = $${values.length}`);
  }
  if (sets.length === 0) return getOrderById(id);
  values.push(id);
  await db.query(
    `UPDATE orders SET ${sets.join(', ')} WHERE id = $${values.length}`,
    values,
  );
  return getOrderById(id);
};

/**
 * Move an order to a new state, refusing moves the flow does not allow and
 * recording the ones it does.
 *
 * `payment` — `{ method, reference }` — is written only on the move to `paid`.
 * It is deliberately not accepted on any other transition: recording how money
 * arrived against an order that has not been paid is how a ledger stops
 * meaning anything.
 *
 * @throws {Error & {status:number, code:string}} on an illegal transition
 */
const setOrderStatus = async (id, toStatus, actorUserId = null, note = null, payment = null) => {
  if (!STATUSES.includes(toStatus)) {
    const err = new Error(`Unknown order status: ${toStatus}`);
    err.status = 400;
    err.code = 'BAD_STATUS';
    throw err;
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Locked for the transaction so two admins cannot both advance it.
    const current = await client.query(
      'SELECT id, status FROM orders WHERE id = $1 FOR UPDATE', [id],
    );
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const from = current.rows[0].status;
    if (from === toStatus) {
      await client.query('ROLLBACK');
      return getOrderById(id);
    }
    if (!TRANSITIONS[from] || !TRANSITIONS[from].includes(toStatus)) {
      await client.query('ROLLBACK');
      const err = new Error(`An order cannot go from ${from} to ${toStatus}`);
      err.status = 409;
      err.code = 'ILLEGAL_TRANSITION';
      throw err;
    }

    const stamp = STATUS_TIMESTAMP[toStatus];
    const sets = [`status = $1`];
    const values = [toStatus];
    if (stamp) sets.push(`${stamp} = COALESCE(${stamp}, now())`);

    if (toStatus === 'paid' && payment && typeof payment === 'object') {
      const method = payment.method == null ? null : String(payment.method).trim().toLowerCase();
      if (method && !PAYMENT_METHODS.includes(method)) {
        await client.query('ROLLBACK');
        const err = new Error(`Payment method must be one of: ${PAYMENT_METHODS.join(', ')}`);
        err.status = 400;
        err.code = 'BAD_PAYMENT_METHOD';
        throw err;
      }
      if (method) { values.push(method); sets.push(`payment_method = $${values.length}`); }
      if (payment.reference != null && String(payment.reference).trim() !== '') {
        values.push(String(payment.reference).trim().slice(0, 120));
        sets.push(`payment_reference = $${values.length}`);
      }
    }

    if (toStatus === 'cancelled' || toStatus === 'refunded') {
      values.push(note ? String(note).slice(0, 1000) : null);
      sets.push(`status_reason = $${values.length}`);
    }

    values.push(id);
    await client.query(
      `UPDATE orders SET ${sets.join(', ')} WHERE id = $${values.length}`,
      values,
    );
    await client.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, from, toStatus, actorUserId, note || null],
    );
    if (toStatus === 'cancelled' || toStatus === 'refunded') {
      // Whatever the order granted stops with it.
      await revokeForOrder(client, id);
    }
    // An order withdrawn before it was ever active gives its discount use back.
    if (toStatus === 'cancelled' && (from === 'draft' || from === 'pending')) {
      await discounts.release(client, id);
    }
    await client.query('COMMIT');
    return getOrderById(id);
  } catch (err) {
    if (!err.status) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/**
 * What an invoice says, frozen when its number is issued: the buyer's billing
 * details, the seller block and the amounts with their VAT line. The PDF of
 * an invoiced order draws from this, so changing the organisation or the
 * billing settings later never rewrites an invoice already sent.
 */
async function invoiceSnapshot(client, orderId) {
  const r = await client.query(
    `SELECT o.amount_minor, o.tax_minor, o.currency, o.list_amount_minor, o.discount_minor, o.discount_label,
            o.discount_code, o.discount_status,
            c.name, c.legal_name, c.vat_id, c.city, c.country, c.billing_email
       FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE o.id = $1`,
    [orderId],
  );
  const row = r.rows[0];
  const billing = await billingService.getBilling();
  const amount = row.amount_minor == null ? null : Number(row.amount_minor);
  const tax = row.tax_minor == null ? null : Number(row.tax_minor);
  // A discount the owner removed is not on the invoice; one still claimed
  // when the invoice is issued (issued early) is on it, as the order is.
  const discount = row.discount_minor > 0 && row.discount_status !== 'removed' ? Number(row.discount_minor) : 0;
  return {
    version: 2,
    takenAt: new Date().toISOString(),
    buyer: {
      name: row.name,
      legal_name: row.legal_name,
      vat_id: row.vat_id,
      city: row.city,
      country: row.country,
      billing_email: row.billing_email,
    },
    seller: {
      legalName: billing.legalName,
      taxId: billing.taxId,
      addressLines: billing.addressLines,
      email: billing.email,
      bankName: billing.bankName,
      accountHolder: billing.accountHolder,
      iban: billing.iban,
      ibanGrouped: billing.ibanGrouped,
      swift: billing.swift,
      vatRegistered: billing.vatRegistered,
      vatRatePercent: billing.vatRatePercent,
      ready: billing.ready,
    },
    amounts: {
      amountMinor: amount,
      taxMinor: tax,
      totalMinor: amount == null ? null : amount + (tax || 0),
      // The plan's price before the discount, and the discount line.
      listMinor: discount ? Number(row.list_amount_minor) : amount,
      discountMinor: discount,
      discountLabel: discount ? row.discount_label : null,
      discountCode: discount ? row.discount_code : null,
      currency: row.currency,
      vatLine: tax ? null : billingService.vatLine(billing),
    },
  };
}

/**
 * Give an order its invoice number, inside the caller's transaction (the
 * order row already locked), and freeze what the invoice says. Used by
 * `issueInvoice` and by approval, which invoices the order it activates.
 */
async function allocateInvoice(client, order, terms = DEFAULT_INVOICE_TERMS_DAYS, actorId = null) {
  const year = new Date().getUTCFullYear();
  // RETURNING gives the row after the update, so `next_number - 1` is the
  // number just allocated — in both the INSERT and the DO UPDATE branch.
  const counter = await client.query(
    `INSERT INTO invoice_counters (year, next_number) VALUES ($1, 2)
     ON CONFLICT (year) DO UPDATE SET next_number = invoice_counters.next_number + 1
     RETURNING next_number - 1 AS number`,
    [year],
  );
  const number = Number(counter.rows[0].number);
  const invoiceNumber = `INV-${year}-${String(number).padStart(4, '0')}`;

  await client.query(
    `UPDATE orders
        SET invoice_number = $1,
            invoice_issued_at = now(),
            invoice_due_at = now() + ($2 || ' days')::interval,
            invoice_snapshot = $4::jsonb
      WHERE id = $3`,
    [invoiceNumber, String(terms), order.id, JSON.stringify(await invoiceSnapshot(client, order.id))],
  );

  // Invoicing is not a status change, so it does not move the order — but it
  // belongs in the history, which is the only place anyone looks afterwards.
  await client.query(
    `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, note)
     VALUES ($1, $2, $2, $3, $4)`,
    [order.id, order.status, actorId, `Invoice ${invoiceNumber} issued, due in ${terms} days`],
  );
  return invoiceNumber;
}

/**
 * Issue an invoice against an order.
 *
 * Two refusals, both deliberate:
 *
 *   - An order that is already invoiced keeps the number it has. Regenerating
 *     one is how the same work ends up billed twice under two numbers.
 *   - An order with no `amount_minor` cannot be invoiced. NULL there means the
 *     work has not been priced, which is not the same as free, and an invoice
 *     for an unpriced order would have to invent a figure.
 *
 * The number is allocated under the row lock the UPSERT takes, so two invoices
 * issued at the same instant cannot collide.
 */
const issueInvoice = async (id, { dueInDays } = {}, actorUserId = null) => {
  const terms = Number.isFinite(Number(dueInDays)) && Number(dueInDays) >= 0
    ? Math.round(Number(dueInDays))
    : DEFAULT_INVOICE_TERMS_DAYS;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const current = await client.query(
      'SELECT id, status, amount_minor, invoice_number FROM orders WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const order = current.rows[0];

    if (order.invoice_number) {
      await client.query('ROLLBACK');
      const err = new Error(`This order is already invoiced as ${order.invoice_number}`);
      err.status = 409;
      err.code = 'ALREADY_INVOICED';
      throw err;
    }
    if (order.amount_minor == null) {
      await client.query('ROLLBACK');
      const err = new Error('This order has no price, so there is nothing to invoice. Set an amount first.');
      err.status = 409;
      err.code = 'ORDER_NOT_PRICED';
      throw err;
    }

    await allocateInvoice(client, order, terms, actorUserId);

    await client.query('COMMIT');
    return getOrderById(id);
  } catch (err) {
    if (!err.status) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  STATUSES,
  PAYMENT_METHODS,
  DEFAULT_INVOICE_TERMS_DAYS,
  issueInvoice,
  allocateInvoice,
  PLANS,
  BILLING_PERIODS,
  TRANSITIONS,
  listOrders,
  getOrderById,
  getOrderHistory,
  listOrdersForUser,
  hasActiveEntitlement,
  createOrder,
  updateOrder,
  setOrderStatus,
};
