/**
 * @file discount.service.js
 * @description Discount codes and automatic campaigns: what they take off,
 * when they apply, and counting their uses.
 *
 * Two kinds live in `coupons` (migration 0039):
 *
 *   - a **code** the buyer types at checkout;
 *   - a **campaign**, with no code: `eligibility: 'all'` applies to every
 *     order it fits (a launch offer the pricing page shows), `'education'`
 *     when the buyer says they are a university or a school, `'nonprofit'`
 *     when they say they are a non-profit. Such a claim is shown on the
 *     order as *claimed*; the owner approves it (approving the order does)
 *     or removes it before approval.
 *
 * A code can belong to one organisation (`customer_id`, a launch partner's
 * code): anyone else is told it is not theirs.
 *
 * The server prices the discount; the browser only names a code. One
 * discount per order, never stacked: when a code and a campaign both fit,
 * the larger saving wins — and no discount takes more than half the price
 * (MAX_PERCENT_OFF): a percentage above 50 is refused when it is saved, and
 * a fixed amount is cut to half the price when it is applied.
 *
 * Arithmetic is in qəpik. A percentage (up to two decimals) is taken off the
 * price and rounded half up to the qəpik; a fixed amount never takes more
 * than the price, so a total cannot go below zero.
 *
 * Uses are counted when the order is placed, inside the order's transaction
 * and under the coupon's row lock (`redeem`), so concurrent checkouts cannot
 * take more uses than `max_uses` or than `max_uses_per_customer`. A refused
 * order and a removed claim give their use back (`release`).
 *
 * Why a code does not apply is a stable reason the checkout shows in the
 * buyer's language:
 *
 *   COUPON_NOT_FOUND       no such code
 *   COUPON_PAUSED          the owner paused it
 *   COUPON_NOT_STARTED     before `valid_from`
 *   COUPON_EXPIRED         after `valid_until`
 *   COUPON_USED_UP         `max_uses` reached
 *   COUPON_CUSTOMER_LIMIT  this organisation has used it `max_uses_per_customer` times
 *   COUPON_FIRST_PURCHASE  first orders only, and the organisation has one
 *   COUPON_PLAN            not for this plan
 *   COUPON_PERIOD          not for this billing period
 *   COUPON_NOT_YOURS       given to another organisation
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { SELF_SERVE_PLAN_IDS, PLANS } = require('../constants/plans');

const KINDS = ['code', 'campaign'];
const ELIGIBILITY = ['all', 'education', 'nonprofit'];
/** The claims a buyer can make at checkout, and the campaigns they unlock. */
const CLAIMS = ['education', 'nonprofit'];
/** No discount takes more than this share of the price. */
const MAX_PERCENT_OFF = 50;
const TYPES = ['percent', 'fixed'];
const PERIODS = ['per_event', 'annual'];
const STATES = ['active', 'scheduled', 'paused', 'expired', 'used_up'];

/** Orders that count as a purchase for "first purchase only" (a refused one does not). */
const PURCHASE_STATUSES = ['pending', 'paid', 'delivered', 'refunded'];

const REASONS = {
  COUPON_NOT_FOUND: 'There is no such discount code. Check the spelling.',
  COUPON_PAUSED: 'This code is not active at the moment.',
  COUPON_NOT_STARTED: 'This code is not valid yet.',
  COUPON_EXPIRED: 'This code has expired.',
  COUPON_USED_UP: 'This code has been used as many times as it can be.',
  COUPON_CUSTOMER_LIMIT: 'Your organisation has already used this code.',
  COUPON_FIRST_PURCHASE: 'This code is for a first order only.',
  COUPON_PLAN: 'This code is not for this plan.',
  COUPON_PERIOD: 'This code is not for this billing period.',
  COUPON_NOT_YOURS: 'This code was given to another organisation. Sign in and choose the organisation it was given to.',
};

/** A refusal with its reason; `status` 400 at checkout. */
const refusal = (code, extra = {}) => httpError(400, REASONS[code], code, extra);

/** "launch-20 " → "LAUNCH-20"; null when it cannot be a code. */
function normaliseCode(raw) {
  const code = String(raw == null ? '' : raw).trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code) ? code : null;
}

/**
 * What this coupon takes off a price, in minor units. Percentages carry two
 * decimals, so the sum is done in hundredths of a per cent: 12.5% of
 * ₼490.00 is 49000 × 1250 / 10000 = 6125 qəpik, with no float in between.
 */
function discountFor(coupon, priceMinor) {
  const price = Math.max(0, Math.round(Number(priceMinor) || 0));
  if (!coupon || price === 0) return 0;
  if (coupon.discount_type === 'percent') {
    const hundredths = Math.round(Number(coupon.percent_off) * 100);
    return Math.min(price, Math.floor((price * hundredths + 5000) / 10000));
  }
  return Math.min(price, Math.round(Number(coupon.amount_off_minor) || 0));
}

/** The discount, never more than half the price. */
const cappedDiscount = (coupon, priceMinor) =>
  Math.min(discountFor(coupon, priceMinor), Math.floor((Math.max(0, Number(priceMinor) || 0) * MAX_PERCENT_OFF) / 100));

/** "−20%" or "−₼100": how the discount reads next to its name. */
function valueText(coupon) {
  if (coupon.discount_type === 'percent') return `−${Number(coupon.percent_off).toString()}%`;
  const minor = Number(coupon.amount_off_minor);
  return `−₼${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: minor % 100 ? 2 : 0 })}`;
}

/** What the order and the invoice call the discount: "LAUNCH20 −20%", "Education −30%". */
const labelOf = (coupon) => `${coupon.kind === 'code' ? coupon.code : coupon.name} ${valueText(coupon)}`.slice(0, 160);

/** Where the coupon stands now, before any buyer is considered. */
function stateOf(coupon, now = new Date()) {
  if (!coupon.active) return 'paused';
  if (coupon.valid_from && new Date(coupon.valid_from) > now) return 'scheduled';
  if (coupon.valid_until && new Date(coupon.valid_until) <= now) return 'expired';
  if (coupon.max_uses != null && Number(coupon.uses_count) >= Number(coupon.max_uses)) return 'used_up';
  return 'active';
}

const STATE_REASON = { paused: 'COUPON_PAUSED', scheduled: 'COUPON_NOT_STARTED', expired: 'COUPON_EXPIRED', used_up: 'COUPON_USED_UP' };

/** Does the coupon fit this plan and period? The reason when it does not. */
function fitReason(coupon, planId, period) {
  if (coupon.plans && coupon.plans.length && !coupon.plans.includes(planId)) return 'COUPON_PLAN';
  if (coupon.periods && coupon.periods.length && !coupon.periods.includes(period)) return 'COUPON_PERIOD';
  return null;
}

/**
 * How many uses this organisation holds, and whether it has bought before.
 * Without a customer (a buyer not signed in, or a new organisation) both are
 * zero: a new organisation has no earlier order by definition.
 */
async function customerUsage(client, couponId, customerId, exceptOrderId = null) {
  if (!customerId) return { uses: 0, purchases: 0 };
  const r = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM coupon_redemptions
         WHERE coupon_id = $1 AND customer_id = $2 AND released_at IS NULL AND order_id IS DISTINCT FROM $3) AS uses,
       (SELECT COUNT(*)::int FROM orders
         WHERE customer_id = $2 AND status = ANY($4::text[]) AND id IS DISTINCT FROM $3) AS purchases`,
    [couponId, customerId, exceptOrderId, PURCHASE_STATUSES],
  );
  return r.rows[0];
}

/** Why this coupon does not apply to this order, or null when it does. */
async function reasonFor(client, coupon, { planId, period, customerId = null, now = new Date(), exceptOrderId = null }) {
  // A code given to one organisation is not anyone else's, whatever its state.
  if (coupon.customer_id && Number(coupon.customer_id) !== Number(customerId)) return 'COUPON_NOT_YOURS';
  const state = stateOf(coupon, now);
  if (state !== 'active') return STATE_REASON[state];
  const fit = fitReason(coupon, planId, period);
  if (fit) return fit;
  if (customerId && (coupon.max_uses_per_customer != null || coupon.first_purchase_only)) {
    const usage = await customerUsage(client, coupon.id, customerId, exceptOrderId);
    if (coupon.max_uses_per_customer != null && usage.uses >= coupon.max_uses_per_customer) return 'COUPON_CUSTOMER_LIMIT';
    if (coupon.first_purchase_only && usage.purchases > 0) return 'COUPON_FIRST_PURCHASE';
  }
  return null;
}

async function findByCode(code, client = db) {
  const r = await client.query("SELECT * FROM coupons WHERE kind = 'code' AND UPPER(code) = $1", [code]);
  return r.rows[0] || null;
}

/** Campaigns that are switched on and inside their dates, for the price list and checkout. */
async function liveCampaigns(client = db, now = new Date()) {
  const r = await client.query(
    `SELECT * FROM coupons
      WHERE kind = 'campaign' AND active
        AND (valid_from IS NULL OR valid_from <= $1)
        AND (valid_until IS NULL OR valid_until > $1)
        AND (max_uses IS NULL OR uses_count < max_uses)
      ORDER BY id`,
    [now],
  );
  return r.rows;
}

/**
 * The best discount for an order, priced by the server.
 *
 * `code` is what the buyer typed (may be empty), `claim` what they said
 * they are: 'education' (a university or a school), 'nonprofit' or null. Returns the price, the
 * discount and the coupon that gives it, plus, when a code was typed, how it
 * went: `code.ok` false with the reason, or true with `applied` false when a
 * campaign gave more.
 */
async function bestOffer({ planId, period, priceMinor, code = null, claim = null, customerId = null, client = db, now = new Date() }) {
  const price = priceMinor == null ? null : Number(priceMinor);
  const out = { priceMinor: price, discountMinor: 0, amountMinor: price, coupon: null, status: null, code: null };
  if (price == null) return out;

  const candidates = [];
  const typed = code == null || String(code).trim() === '' ? null : String(code);
  if (typed) {
    const normal = normaliseCode(typed);
    const coupon = normal ? await findByCode(normal, client) : null;
    const reason = coupon ? await reasonFor(client, coupon, { planId, period, customerId, now }) : 'COUPON_NOT_FOUND';
    if (reason) out.code = { ok: false, code: normal || typed.trim().toUpperCase().slice(0, 40), reason, message: REASONS[reason] };
    else {
      out.code = { ok: true, code: coupon.code, applied: false };
      candidates.push({ coupon, discount: cappedDiscount(coupon, price), status: 'applied' });
    }
  }
  for (const c of await liveCampaigns(client, now)) {
    if (CLAIMS.includes(c.eligibility) && c.eligibility !== claim) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await reasonFor(client, c, { planId, period, customerId, now })) continue;
    candidates.push({ coupon: c, discount: cappedDiscount(c, price), status: CLAIMS.includes(c.eligibility) ? 'claimed' : 'applied' });
  }
  // The larger saving; on a tie the code the buyer typed.
  candidates.sort((a, b) => b.discount - a.discount || (a.coupon.kind === 'code' ? -1 : 1));
  const best = candidates.find((c) => c.discount > 0);
  if (best) {
    out.coupon = best.coupon;
    out.discountMinor = best.discount;
    out.amountMinor = price - best.discount;
    out.status = best.status;
    if (out.code && out.code.ok) out.code.applied = best.coupon.kind === 'code';
  }
  return out;
}

/**
 * Take one use of the coupon for this order, inside the transaction that
 * places it. The row lock serialises every checkout using this coupon, and
 * the limits are checked again under it: whoever comes second to the last
 * use is refused (COUPON_USED_UP) and their order is not placed.
 */
async function redeem(client, { couponId, orderId, customerId, userId, planId, period, discountMinor }) {
  const locked = await client.query('SELECT * FROM coupons WHERE id = $1 FOR UPDATE', [couponId]);
  const coupon = locked.rows[0];
  if (!coupon) throw refusal('COUPON_NOT_FOUND');
  const reason = await reasonFor(client, coupon, { planId, period, customerId, exceptOrderId: orderId });
  if (reason) throw refusal(reason, { field: 'discountCode' });
  await client.query('UPDATE coupons SET uses_count = uses_count + 1 WHERE id = $1', [couponId]);
  await client.query(
    `INSERT INTO coupon_redemptions (coupon_id, order_id, customer_id, user_id, discount_minor)
     VALUES ($1, $2, $3, $4, $5)`,
    [couponId, orderId, customerId || null, userId || null, discountMinor],
  );
  return coupon;
}

/** Give back the use an order holds (refused, or its claim removed). */
async function release(client, orderId) {
  const r = await client.query(
    'UPDATE coupon_redemptions SET released_at = now() WHERE order_id = $1 AND released_at IS NULL RETURNING coupon_id',
    [orderId],
  );
  for (const row of r.rows) {
    // eslint-disable-next-line no-await-in-loop
    await client.query('UPDATE coupons SET uses_count = GREATEST(uses_count - 1, 0) WHERE id = $1', [row.coupon_id]);
  }
  return r.rows.length > 0;
}

/* ── The owner's coupons ───────────────────────────────────────────────── */

const toIso = (v) => (v ? new Date(v).toISOString() : null);

/** A row as the console reads it, with its state and figures. */
function view(row, now = new Date()) {
  return {
    id: row.id,
    kind: row.kind,
    code: row.code,
    name: row.name,
    eligibility: row.eligibility,
    discountType: row.discount_type,
    percentOff: row.percent_off == null ? null : Number(row.percent_off),
    amountOffMinor: row.amount_off_minor == null ? null : Number(row.amount_off_minor),
    plans: row.plans && row.plans.length ? row.plans : null,
    periods: row.periods && row.periods.length ? row.periods : null,
    validFrom: toIso(row.valid_from),
    validUntil: toIso(row.valid_until),
    maxUses: row.max_uses,
    maxUsesPerCustomer: row.max_uses_per_customer,
    firstPurchaseOnly: row.first_purchase_only,
    active: row.active,
    note: row.note,
    usesCount: Number(row.uses_count),
    customerId: row.customer_id || null,
    customerName: row.customer_name || null,
    state: stateOf(row, now),
    label: labelOf(row),
    createdAt: toIso(row.created_at),
    createdByName: row.created_by_name || null,
    updatedAt: toIso(row.updated_at),
    stats: {
      orders: Number(row.orders_n || 0),
      revenueMinor: Number(row.revenue_minor || 0),
      discountMinor: Number(row.discount_given_minor || 0),
      claimed: Number(row.claimed_n || 0),
    },
  };
}

/*
 * Figures per coupon, from the orders that hold a use (a removed claim or a
 * refused order no longer does): how many, what they come to after the
 * discount, and how much the discount gave away.
 */
const STATS_SQL = `
  SELECT o.coupon_id,
         COUNT(*)::int AS orders_n,
         COALESCE(SUM(o.amount_minor), 0)::bigint AS revenue_minor,
         COALESCE(SUM(o.discount_minor), 0)::bigint AS discount_given_minor,
         COUNT(*) FILTER (WHERE o.discount_status = 'claimed')::int AS claimed_n
    FROM orders o
    JOIN coupon_redemptions r ON r.order_id = o.id AND r.released_at IS NULL
   WHERE o.coupon_id IS NOT NULL
   GROUP BY o.coupon_id`;

/**
 * GET /api/owner/coupons?q=&state=&kind= — newest first. `state` is one or
 * more of active, scheduled, paused, expired, used_up (comma-separated).
 * The counts by state are over everything the search matches.
 */
async function list({ q = '', state = '', kind = '' } = {}) {
  const params = [];
  const where = [];
  const text = String(q || '').trim();
  if (text) {
    params.push(`%${text.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(`(c.code ILIKE $${params.length} OR c.name ILIKE $${params.length} OR c.note ILIKE $${params.length} OR cu.name ILIKE $${params.length})`);
  }
  if (KINDS.includes(kind)) { params.push(kind); where.push(`c.kind = $${params.length}`); }
  const r = await db.query(
    `WITH stats AS (${STATS_SQL})
     SELECT c.*, u.full_name AS created_by_name, cu.name AS customer_name,
            s.orders_n, s.revenue_minor, s.discount_given_minor, s.claimed_n
       FROM coupons c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN stats s ON s.coupon_id = c.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.created_at DESC, c.id DESC`,
    params,
  );
  const now = new Date();
  const all = r.rows.map((row) => view(row, now));
  const counts = Object.fromEntries(STATES.map((s) => [s, all.filter((c) => c.state === s).length]));
  const wanted = String(state || '').split(',').map((s) => s.trim()).filter((s) => STATES.includes(s));
  const rows = wanted.length ? all.filter((c) => wanted.includes(c.state)) : all;
  const totals = rows.reduce((t, c) => ({
    orders: t.orders + c.stats.orders,
    revenueMinor: t.revenueMinor + c.stats.revenueMinor,
    discountMinor: t.discountMinor + c.stats.discountMinor,
  }), { orders: 0, revenueMinor: 0, discountMinor: 0 });
  return { rows, counts, totals, total: rows.length };
}

/** One coupon with its figures and the orders that used it. */
async function get(id) {
  const r = await db.query(
    `WITH stats AS (${STATS_SQL})
     SELECT c.*, u.full_name AS created_by_name, cu.name AS customer_name,
            s.orders_n, s.revenue_minor, s.discount_given_minor, s.claimed_n
       FROM coupons c
       LEFT JOIN users u ON u.id = c.created_by
       LEFT JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN stats s ON s.coupon_id = c.id
      WHERE c.id = $1`,
    [id],
  );
  if (!r.rows[0]) return null;
  const orders = await db.query(
    `SELECT o.id, o.order_code, o.plan, o.billing_period, o.status, o.amount_minor, o.list_amount_minor,
            o.discount_minor, o.discount_status, o.currency, o.created_at, o.customer_id, c.name AS customer_name,
            (r.released_at IS NOT NULL) AS released
       FROM coupon_redemptions r
       JOIN orders o ON o.id = r.order_id
       JOIN customers c ON c.id = o.customer_id
      WHERE r.coupon_id = $1
      ORDER BY r.created_at DESC
      LIMIT 50`,
    [id],
  );
  return { ...view(r.rows[0]), orders: orders.rows };
}

/** Read and check the fields of a create or an edit. `current` is the row being edited. */
function readCoupon(body = {}, current = null) {
  const errors = [];
  const out = {};
  const has = (k) => body[k] !== undefined;
  const isNew = !current;

  const kind = isNew ? (has('kind') ? body.kind : 'code') : current.kind;
  if (!KINDS.includes(kind)) errors.push({ field: 'kind', message: 'A code or a campaign.' });
  if (isNew) out.kind = kind;

  if (kind === 'code' && (isNew || has('code'))) {
    const code = normaliseCode(body.code);
    if (!code) errors.push({ field: 'code', message: '3–40 letters, digits, "-" or "_", starting with a letter or digit.' });
    else out.code = code;
  }
  if (kind === 'campaign' && (isNew || has('eligibility'))) {
    if (!ELIGIBILITY.includes(body.eligibility)) errors.push({ field: 'eligibility', message: 'Everyone, universities and schools, or non-profits.' });
    else out.eligibility = body.eligibility;
  }

  if (isNew || has('name')) {
    const name = String(body.name == null ? '' : body.name).trim();
    if (!name && kind === 'code' && out.code) out.name = out.code;
    else if (name.length < 2 || name.length > 120) errors.push({ field: 'name', message: 'A name of 2–120 characters.' });
    else out.name = name;
  }

  const type = has('discountType') ? body.discountType : current ? current.discount_type : 'percent';
  if (!TYPES.includes(type)) errors.push({ field: 'discountType', message: 'A percentage or a fixed amount.' });
  if (isNew || has('discountType') || has('percentOff') || has('amountOffMinor')) {
    out.discount_type = type;
    if (type === 'percent') {
      const pct = Number(has('percentOff') ? body.percentOff : current && current.percent_off);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100 || Math.abs(Math.round(pct * 100) - pct * 100) > 1e-6) {
        errors.push({ field: 'percentOff', message: `More than 0 and at most ${MAX_PERCENT_OFF} per cent, to two decimals.` });
      } else if (pct > MAX_PERCENT_OFF) {
        errors.push({ field: 'percentOff', message: `At most ${MAX_PERCENT_OFF}%: no discount takes more than half the price.`, code: 'DISCOUNT_CAP' });
      } else { out.percent_off = pct; out.amount_off_minor = null; }
    } else if (type === 'fixed') {
      const minor = Number(has('amountOffMinor') ? body.amountOffMinor : current && current.amount_off_minor);
      if (!Number.isInteger(minor) || minor <= 0 || minor > 100000000) {
        errors.push({ field: 'amountOffMinor', message: 'An amount in qəpik, more than 0.' });
      } else { out.amount_off_minor = minor; out.percent_off = null; }
    }
  }

  const listField = (key, allowed, column, label) => {
    if (!(isNew || has(key))) return;
    const raw = body[key];
    if (raw == null || (Array.isArray(raw) && raw.length === 0)) { out[column] = null; return; }
    const arr = Array.isArray(raw) ? [...new Set(raw.map(String))] : null;
    if (!arr || arr.some((v) => !allowed.includes(v))) errors.push({ field: key, message: `Choose one or more ${label}s: ${allowed.join(', ')}.` });
    // Every one of them is the same as no restriction.
    else out[column] = arr.length === allowed.length ? null : arr;
  };
  listField('plans', SELF_SERVE_PLAN_IDS, 'plans', 'plan');
  listField('periods', PERIODS, 'periods', 'period');

  const dateField = (key, column) => {
    if (!(isNew || has(key))) return;
    const raw = body[key];
    if (raw == null || raw === '') { out[column] = null; return; }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) errors.push({ field: key, message: 'A date and time.' });
    else out[column] = d;
  };
  dateField('validFrom', 'valid_from');
  dateField('validUntil', 'valid_until');
  const from = out.valid_from !== undefined ? out.valid_from : current && current.valid_from;
  const until = out.valid_until !== undefined ? out.valid_until : current && current.valid_until;
  if (from && until && new Date(until) <= new Date(from)) errors.push({ field: 'validUntil', message: 'The end comes after the start.' });

  const countField = (key, column) => {
    if (!(isNew || has(key))) return;
    const raw = body[key];
    if (raw == null || raw === '') { out[column] = null; return; }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 1000000) errors.push({ field: key, message: 'A whole number, 1 or more — or empty for no limit.' });
    else out[column] = n;
  };
  countField('maxUses', 'max_uses');
  countField('maxUsesPerCustomer', 'max_uses_per_customer');
  if (current && out.max_uses != null && out.max_uses < Number(current.uses_count)) {
    errors.push({ field: 'maxUses', message: `It has been used ${current.uses_count} times already; the limit cannot be lower.` });
  }

  // A code can be given to one organisation; a campaign is for whoever it fits.
  if (isNew || has('customerId')) {
    const raw = body.customerId;
    if (raw == null || raw === '') out.customer_id = null;
    else if (kind !== 'code') errors.push({ field: 'customerId', message: 'Only a code can be given to one organisation.' });
    else if (!(Number.parseInt(String(raw), 10) > 0)) errors.push({ field: 'customerId', message: 'Choose an organisation.' });
    else out.customer_id = Number.parseInt(String(raw), 10);
  }

  for (const [key, column] of [['firstPurchaseOnly', 'first_purchase_only'], ['active', 'active']]) {
    if (!has(key)) { if (isNew) out[column] = key === 'active'; continue; }
    if (typeof body[key] !== 'boolean') errors.push({ field: key, message: 'true or false.' });
    else out[column] = body[key];
  }
  if (isNew || has('note')) {
    const note = body.note == null ? '' : String(body.note).trim();
    if (note.length > 2000) errors.push({ field: 'note', message: 'At most 2000 characters.' });
    else out.note = note || null;
  }

  if (errors.length) throw httpError(400, 'Some fields need attention.', 'VALIDATION_ERROR', { errors });
  return out;
}

/** Postgres refused a duplicate code, or an organisation that does not exist: say which. */
function codeTaken(err, code) {
  if (err && err.code === '23503') {
    return httpError(400, 'There is no such organisation.', 'VALIDATION_ERROR', { errors: [{ field: 'customerId', message: 'No such organisation.' }] });
  }
  if (err && err.code === '23505') {
    return httpError(409, `The code ${code} already exists. Codes are unique, whatever their case.`, 'COUPON_CODE_TAKEN', { errors: [{ field: 'code', message: 'Already in use.' }] });
  }
  return err;
}

/** POST /api/owner/coupons */
async function create(body, actorId) {
  const v = readCoupon(body);
  const cols = Object.keys(v);
  try {
    const r = await db.query(
      `INSERT INTO coupons (${cols.join(', ')}, created_by, updated_by)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}, $${cols.length + 1})
       RETURNING id`,
      [...cols.map((c) => v[c]), actorId],
    );
    return get(r.rows[0].id);
  } catch (err) { throw codeTaken(err, v.code); }
}

/** PATCH /api/owner/coupons/:id — returns the coupon and what changed. */
async function update(id, body, actorId) {
  const current = (await db.query('SELECT * FROM coupons WHERE id = $1', [id])).rows[0];
  if (!current) return null;
  const v = readCoupon(body, current);
  const changed = Object.keys(v).filter((c) => JSON.stringify(v[c] instanceof Date ? v[c].toISOString() : v[c])
    !== JSON.stringify(current[c] instanceof Date ? current[c].toISOString() : (c === 'percent_off' && current[c] != null ? Number(current[c]) : current[c])));
  if (changed.length) {
    try {
      await db.query(
        `UPDATE coupons SET ${changed.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now(), updated_by = $${changed.length + 2}
          WHERE id = $1`,
        [id, ...changed.map((c) => v[c]), actorId],
      );
    } catch (err) { throw codeTaken(err, v.code); }
  }
  return { coupon: await get(id), changed };
}

/** Pause or resume. */
async function setActive(id, active, actorId) {
  const r = await db.query('UPDATE coupons SET active = $2, updated_at = now(), updated_by = $3 WHERE id = $1 RETURNING id', [id, active, actorId]);
  return r.rows[0] ? get(id) : null;
}

/** Delete a coupon nobody has used; one with orders is paused instead. */
async function remove(id) {
  const c = (await db.query('SELECT id, code, name, uses_count FROM coupons WHERE id = $1', [id])).rows[0];
  if (!c) return null;
  const used = await db.query('SELECT 1 FROM coupon_redemptions WHERE coupon_id = $1 LIMIT 1', [id]);
  if (used.rows[0]) {
    throw httpError(409, 'Orders have used this discount, and they keep pointing at it. Pause it instead.', 'COUPON_IN_USE');
  }
  await db.query('DELETE FROM coupons WHERE id = $1', [id]);
  return c;
}

/** What the public price list says about campaigns running now. */
async function publicCampaigns() {
  return (await liveCampaigns()).map((c) => ({
    id: c.id,
    name: c.name,
    eligibility: c.eligibility,
    discountType: c.discount_type,
    percentOff: c.percent_off == null ? null : Number(c.percent_off),
    amountOffMinor: c.amount_off_minor == null ? null : Number(c.amount_off_minor),
    plans: c.plans && c.plans.length ? c.plans : null,
    periods: c.periods && c.periods.length ? c.periods : null,
    validUntil: toIso(c.valid_until),
    firstPurchaseOnly: c.first_purchase_only,
  }));
}

/** The plan names a coupon applies to, for messages. */
const planNames = (plans) => (plans && plans.length ? plans.map((p) => (PLANS[p] ? PLANS[p].name : p)).join(', ') : 'every plan');

module.exports = {
  KINDS, ELIGIBILITY, CLAIMS, TYPES, STATES, REASONS, MAX_PERCENT_OFF,
  normaliseCode, discountFor, cappedDiscount, labelOf, valueText, stateOf, fitReason, reasonFor, bestOffer, redeem, release,
  findByCode, liveCampaigns, publicCampaigns, list, get, create, update, setActive, remove, readCoupon, planNames,
};
