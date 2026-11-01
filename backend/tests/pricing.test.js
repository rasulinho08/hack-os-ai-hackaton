/**
 * Prices & discounts, end to end against a running API: the owner's price
 * catalogue (what checkout charges, what an order and an invoice keep, the
 * annual rule, the history), discount codes and campaigns (every reason a
 * code is refused, the arithmetic in qəpik, counting uses under concurrent
 * checkouts, the discount line on the invoice) and who may change them.
 *
 * The catalogue is shared state: every test that changes a price puts back
 * what was there. Campaigns apply to every order they fit, so the tests that
 * make one limit it to a plan and pause it afterwards.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Session, RUN_ID, email } = require('./helpers');
const { dbQuery, ownerSession, approvedBuyer } = require('./fixtures');
const { discountFor, stateOf } = require('../src/services/discount.service');
const { ruleProblem } = require('../src/services/priceCatalogue.service');

const order = (over = {}) => ({
  plan: 'starter', billingPeriod: 'per_event', payment: { method: 'bank_transfer' }, acceptTerms: true, ...over,
});

let n = 0;
/** A code unique to this run: "E2E" + run + a counter + the label. */
const codeFor = (label) => `E2E${RUN_ID}${(n += 1)}${label}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);

async function buyer(label) {
  const s = new Session(label);
  await s.register({ fullName: `E2E ${label}`, email: email(label) });
  return s;
}

async function pdfText(session, path) {
  const r = await session.download(path);
  assert.equal(r.status, 200, `${path}: ${r.status}`);
  return execFileSync('pdftotext', ['-layout', '-', '-'], { input: r.body }).toString('utf8');
}

const LIMIT_FIELDS = ['perEventMinor', 'annualMinor', 'perEventListMinor', 'annualListMinor', 'active', 'seats', 'participants', 'eventsPerYear', 'storageGb'];

/** The plan as the owner's catalogue has it now. */
async function planNow(owner, id) {
  const r = await owner.get('/api/owner/pricing');
  assert.equal(r.status, 200, r.text);
  return r.data.plans.find((p) => p.id === id);
}

/** Put a plan back the way it was. */
async function restore(owner, before) {
  const body = Object.fromEntries(LIMIT_FIELDS.map((k) => [k, before[k]]));
  const r = await owner.put(`/api/owner/pricing/${before.id}`, body);
  assert.equal(r.status, 200, `restoring ${before.id}: ${r.text}`);
}

async function coupon(owner, body) {
  const r = await owner.post('/api/owner/coupons', body);
  assert.equal(r.status, 201, r.text);
  return r.data;
}

/* ── The rules, without a server ───────────────────────────────────────── */

test('percent and fixed discounts are worked out in qəpik', () => {
  const pct = (p) => ({ discount_type: 'percent', percent_off: p });
  const fixed = (m) => ({ discount_type: 'fixed', amount_off_minor: m });
  assert.equal(discountFor(pct(20), 49000), 9800, '20% of ₼490');
  assert.equal(discountFor(pct(12.5), 49000), 6125, '12.5% of ₼490, no float in between');
  assert.equal(discountFor(pct('33.33'), 149000), 49662, '33.33% of ₼1,490 = 49661.7 → rounded half up');
  assert.equal(discountFor(pct(0.01), 49999), 5, '0.01% of ₼499.99 = 4.9999 → 5');
  assert.equal(discountFor(pct(15), 1), 0, 'a fraction of a qəpik rounds down below half');
  assert.equal(discountFor(pct(100), 715000), 715000, 'all of it');
  assert.equal(discountFor(fixed(10000), 49000), 10000, '₼100 off');
  assert.equal(discountFor(fixed(60000), 49000), 49000, 'never more than the price');
  assert.equal(discountFor(fixed(5000), 0), 0);
});

test('a coupon’s state: paused, scheduled, expired, used up, active', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const base = { active: true, valid_from: null, valid_until: null, max_uses: null, uses_count: 0 };
  assert.equal(stateOf(base, now), 'active');
  assert.equal(stateOf({ ...base, active: false }, now), 'paused');
  assert.equal(stateOf({ ...base, valid_from: '2026-06-02T00:00:00Z' }, now), 'scheduled');
  assert.equal(stateOf({ ...base, valid_until: '2026-06-01T12:00:00Z' }, now), 'expired', 'the end is exclusive');
  assert.equal(stateOf({ ...base, max_uses: 2, uses_count: 2 }, now), 'used_up');
});

test('the annual rule, as the save checks it', () => {
  const plan = { id: 'starter', name: 'Starter', perEventMinor: 49000, annualMinor: 79000, eventsPerYear: 2, active: true };
  assert.equal(ruleProblem(plan), null);
  assert.equal(ruleProblem({ ...plan, annualMinor: 98000 }), null, 'equal to its events one by one is allowed');
  assert.equal(ruleProblem({ ...plan, annualMinor: 98001 }).code, 'ANNUAL_ABOVE_PER_EVENT');
  assert.equal(ruleProblem({ ...plan, eventsPerYear: 1 }).code, 'ANNUAL_ABOVE_PER_EVENT', 'fewer events can break it too');
  assert.equal(ruleProblem({ ...plan, eventsPerYear: null }), null, 'unlimited events: nothing to compare');
  assert.equal(ruleProblem({ ...plan, perEventListMinor: 49000 }).code, 'LIST_PRICE_NOT_ABOVE');
  assert.equal(ruleProblem({ ...plan, perEventMinor: null, annualMinor: null }).code, 'PLAN_NEEDS_PRICE');
  assert.equal(ruleProblem({ ...plan, perEventMinor: null, annualMinor: null, active: false }), null, 'off sale may have none');
});

/* ── Who may change prices ─────────────────────────────────────────────── */

test('only the owner reads or changes prices and discounts', async () => {
  const anon = new Session('anon-pricing');
  const organiser = new Session('organiser-pricing');
  await organiser.login('admin@test.com');
  for (const s of [anon, organiser]) {
    const want = s === anon ? 401 : 403;
    assert.equal((await s.get('/api/owner/pricing')).status, want, 'read the catalogue');
    assert.equal((await s.put('/api/owner/pricing/starter', { perEventMinor: 1 })).status, want, 'change a price');
    assert.equal((await s.get('/api/owner/pricing/history')).status, want, 'read the history');
    assert.equal((await s.get('/api/owner/coupons')).status, want, 'list the codes');
    assert.equal((await s.post('/api/owner/coupons', { code: 'NOPE123', discountType: 'percent', percentOff: 99 })).status, want, 'create a code');
    assert.equal((await s.post('/api/orders/1/discount/remove', {})).status, want, 'remove a discount');
  }
  const owner = await ownerSession();
  assert.equal((await planNow(owner, 'starter')).perEventMinor > 0, true);
  const left = await dbQuery("SELECT COUNT(*)::int AS n FROM coupons WHERE code = 'NOPE123'");
  assert.equal(left.rows[0].n, 0, 'nothing was created');
});

/* ── The catalogue ─────────────────────────────────────────────────────── */

test('a price change reaches the price list and new orders, never old orders or invoices', async () => {
  const owner = await ownerSession();
  const before = await planNow(owner, 'starter');
  const old = await approvedBuyer('pr-old');
  assert.equal(Number(old.order.amount_minor), before.perEventMinor);
  try {
    let r = await owner.put('/api/owner/pricing/starter', {
      perEventMinor: before.perEventMinor - 4000, perEventListMinor: before.perEventMinor, seats: 5, note: 'autumn price',
    });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.data.changes.perEventMinor, [before.perEventMinor, before.perEventMinor - 4000]);

    r = await new Session('anon-list').get('/api/checkout/plans');
    const listed = r.data.plans.find((p) => p.id === 'starter');
    assert.equal(listed.perEventMinor, before.perEventMinor - 4000, 'the public list shows the new price');
    assert.equal(listed.perEventListMinor, before.perEventMinor, 'and the old one to strike through');
    assert.equal(listed.seats, 5);

    const s = await buyer('pr-new');
    r = await s.post('/api/checkout', order({ organisation: `E2E Pr New Org ${RUN_ID}` }));
    assert.equal(r.status, 201, r.text);
    const fresh = r.data.order;
    assert.equal(Number(fresh.amount_minor), before.perEventMinor - 4000, 'a new order is priced from the catalogue');
    assert.equal(Number(fresh.list_amount_minor), before.perEventMinor - 4000, 'the struck-through price is never charged');
    assert.deepEqual(fresh.plan_terms, { seats: 5, participants: before.participants, eventsPerYear: before.eventsPerYear, storageGb: before.storageGb });

    // The limits change again before approval; the order keeps the ones it was sold with.
    r = await owner.put('/api/owner/pricing/starter', { seats: 7 });
    assert.equal(r.status, 200, r.text);
    r = await owner.post(`/api/orders/${fresh.id}/approve`, {});
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.entitlement.seat_limit, 5, 'approval grants what was sold');

    const kept = await dbQuery('SELECT amount_minor FROM orders WHERE id = $1', [old.order.id]);
    assert.equal(Number(kept.rows[0].amount_minor), before.perEventMinor, 'the old order keeps its amount');
    const ent = await dbQuery('SELECT seat_limit FROM entitlements WHERE order_id = $1', [old.order.id]);
    assert.equal(ent.rows[0].seat_limit, before.seats, 'and its entitlement its seats');
    const text = await pdfText(old.session, `/api/me/orders/${old.order.id}/invoice.pdf`);
    assert.match(text, new RegExp((before.perEventMinor / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')), 'the issued invoice keeps the old price');
    assert.doesNotMatch(text, /Discount/);
  } finally {
    await restore(owner, before);
  }
});

test('every save is in the price history and the audit trail: who, when, old → new', async () => {
  const owner = await ownerSession();
  const before = await planNow(owner, 'professional');
  try {
    let r = await owner.put('/api/owner/pricing/professional', { participants: before.participants + 50, note: `history ${RUN_ID}` });
    assert.equal(r.status, 200, r.text);
    r = await owner.get('/api/owner/pricing/history?plan=professional&limit=5');
    assert.equal(r.status, 200, r.text);
    const row = r.data.find((h) => h.note === `history ${RUN_ID}`);
    assert.ok(row, 'the save is in the history');
    assert.deepEqual(row.changes, { participants: [before.participants, before.participants + 50] });
    assert.equal(row.changed_by, owner.user.id);
    assert.equal(row.changed_by_name, 'E2E Owner');
    assert.ok(Date.now() - new Date(row.changed_at).getTime() < 60000, 'and when');

    r = await owner.put('/api/owner/pricing/professional', { participants: before.participants + 50 });
    assert.equal(r.data.changes && Object.keys(r.data.changes).length, 0, 'saving the same values is not a change');

    const a = await dbQuery(
      "SELECT meta FROM audit_log WHERE action = 'owner.price.update' AND actor_user_id = $1 ORDER BY id DESC LIMIT 1",
      [owner.user.id],
    );
    assert.deepEqual(a.rows[0].meta.changes.participants, [before.participants, before.participants + 50]);
  } finally {
    await restore(owner, before);
  }
});

test('a save that breaks a rule is refused with its code, and changes nothing', async () => {
  const owner = await ownerSession();
  const before = await planNow(owner, 'starter');
  const tooDear = before.eventsPerYear * before.perEventMinor + 100;
  let r = await owner.put('/api/owner/pricing/starter', { annualMinor: tooDear });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'ANNUAL_ABOVE_PER_EVENT');
  assert.match(r.json.message, new RegExp(`more than its ${before.eventsPerYear} events bought one by one`));
  assert.equal(r.json.errors[0].field, 'annualMinor', 'the field to fix');

  r = await owner.put('/api/owner/pricing/starter', { eventsPerYear: 1 });
  assert.equal(r.json.code, 'ANNUAL_ABOVE_PER_EVENT', 'fewer events a year breaks it the other way');
  r = await owner.put('/api/owner/pricing/starter', { perEventMinor: Math.floor(before.annualMinor / before.eventsPerYear) - 100 });
  assert.equal(r.json.code, 'ANNUAL_ABOVE_PER_EVENT', 'so does a cheaper event');
  r = await owner.put('/api/owner/pricing/starter', { perEventListMinor: before.perEventMinor - 1 });
  assert.equal(r.json.code, 'LIST_PRICE_NOT_ABOVE');
  r = await owner.put('/api/owner/pricing/starter', { perEventMinor: null, annualMinor: null });
  assert.equal(r.json.code, 'PLAN_NEEDS_PRICE');
  r = await owner.put('/api/owner/pricing/starter', { perEventMinor: 49000.5 });
  assert.equal(r.json.code, 'VALIDATION_ERROR', 'qəpik are whole');
  r = await owner.put('/api/owner/pricing/enterprise', { perEventMinor: 100000 });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'PLAN_QUOTE_ONLY', 'Enterprise stays quoted');
  r = await owner.put('/api/owner/pricing/platinum', { perEventMinor: 100000 });
  assert.equal(r.status, 404);

  assert.deepEqual(await planNow(owner, 'starter'), before, 'nothing changed');
});

test('a plan switched off is listed but not sold', async () => {
  const owner = await ownerSession();
  const before = await planNow(owner, 'business');
  try {
    let r = await owner.put('/api/owner/pricing/business', { active: false });
    assert.equal(r.status, 200, r.text);
    r = await new Session('anon-off').get('/api/checkout/plans');
    assert.equal(r.data.plans.find((p) => p.id === 'business').active, false);
    const s = await buyer('pr-off');
    r = await s.post('/api/checkout', order({ plan: 'business', organisation: `E2E Pr Off Org ${RUN_ID}` }));
    assert.equal(r.status, 409, r.text);
    assert.equal(r.json.code, 'PLAN_NOT_ON_SALE');
  } finally {
    await restore(owner, before);
  }
});

/* ── Codes ─────────────────────────────────────────────────────────────── */

test('a code is priced by the server and the order keeps price, discount and charge', async () => {
  const owner = await ownerSession();
  const plan = await planNow(owner, 'professional');
  const code = codeFor('pct');
  const c = await coupon(owner, { code: code.toLowerCase(), name: 'Autumn', discountType: 'percent', percentOff: 15, note: 'internal only' });
  assert.equal(c.code, code, 'codes are kept in capitals');
  const s = await buyer('pr-code');

  let r = await s.post('/api/checkout/quote', { plan: 'professional', billingPeriod: 'per_event', discountCode: ` ${code.toLowerCase()} ` });
  assert.equal(r.status, 200, r.text);
  const off = Math.floor((plan.perEventMinor * 1500 + 5000) / 10000);
  assert.equal(r.data.priceMinor, plan.perEventMinor);
  assert.equal(r.data.discountMinor, off, '15%, in qəpik');
  assert.equal(r.data.amountMinor, plan.perEventMinor - off);
  assert.deepEqual(r.data.code, { ok: true, code, applied: true });
  assert.equal(r.data.discount.label, `${code} −15%`);
  assert.equal(r.data.discount.note, undefined, 'the owner’s note never reaches the buyer');

  r = await s.post('/api/checkout', order({ plan: 'professional', organisation: `E2E Pr Code Org ${RUN_ID}`, discountCode: code, amountMinor: 1, discountMinor: plan.perEventMinor }));
  assert.equal(r.status, 201, r.text);
  const placed = r.data.order;
  assert.equal(Number(placed.list_amount_minor), plan.perEventMinor, 'the price before the discount');
  assert.equal(Number(placed.discount_minor), off, 'the discount, as the server worked it out');
  assert.equal(Number(placed.amount_minor), plan.perEventMinor - off, 'what is charged; amounts in the request are ignored');
  assert.equal(placed.discount_code, code);
  assert.equal(placed.discount_status, 'applied');

  const used = await owner.get(`/api/owner/coupons/${c.id}`);
  assert.equal(used.data.usesCount, 1);
  assert.equal(used.data.stats.orders, 1);
  assert.equal(used.data.stats.discountMinor, off, 'discount given');
  assert.equal(used.data.stats.revenueMinor, plan.perEventMinor - off, 'revenue after the discount');
  const a = await dbQuery("SELECT meta FROM audit_log WHERE action = 'coupon.redeem' AND target_id = $1", [String(placed.id)]);
  assert.equal(a.rows[0].meta.couponId, c.id, 'the use is in the audit trail');
});

test('a fixed amount off, with VAT on what is left', async () => {
  const owner = await ownerSession();
  const plan = await planNow(owner, 'starter');
  const billing = await owner.get('/api/owner/settings/billing');
  const code = codeFor('fixed');
  await coupon(owner, { code, discountType: 'fixed', amountOffMinor: 9050, plans: ['starter'] });
  try {
    let r = await owner.put('/api/owner/settings/billing', { vatRegistered: true, vatRatePercent: 18 });
    assert.equal(r.status, 200, r.text);
    const s = await buyer('pr-fixed');
    r = await s.post('/api/checkout', order({ organisation: `E2E Pr Fixed Org ${RUN_ID}`, discountCode: code }));
    assert.equal(r.status, 201, r.text);
    const net = plan.perEventMinor - 9050;
    assert.equal(Number(r.data.order.discount_minor), 9050, '₼90.50 off');
    assert.equal(Number(r.data.order.amount_minor), net);
    assert.equal(Number(r.data.order.tax_minor), Math.round(net * 0.18), 'VAT on the discounted price');
    assert.equal(r.data.order.discount_label, `${code} −₼90.50`);
  } finally {
    await owner.put('/api/owner/settings/billing', { vatRegistered: billing.data.vatRegistered, vatRatePercent: billing.data.vatRatePercent });
  }
});

test('each reason a code does not apply is refused with its own code', async () => {
  const owner = await ownerSession();
  const day = 86400000;
  const codes = {
    paused: await coupon(owner, { code: codeFor('paused'), discountType: 'percent', percentOff: 10, active: false }),
    early: await coupon(owner, { code: codeFor('early'), discountType: 'percent', percentOff: 10, validFrom: new Date(Date.now() + day).toISOString() }),
    late: await coupon(owner, { code: codeFor('late'), discountType: 'percent', percentOff: 10, validFrom: new Date(Date.now() - 2 * day).toISOString(), validUntil: new Date(Date.now() - day).toISOString() }),
    once: await coupon(owner, { code: codeFor('once'), discountType: 'percent', percentOff: 10, maxUses: 1 }),
    perOrg: await coupon(owner, { code: codeFor('perorg'), discountType: 'percent', percentOff: 10, maxUsesPerCustomer: 1 }),
    first: await coupon(owner, { code: codeFor('first'), discountType: 'percent', percentOff: 10, firstPurchaseOnly: true }),
    plan: await coupon(owner, { code: codeFor('plan'), discountType: 'percent', percentOff: 10, plans: ['business'] }),
    period: await coupon(owner, { code: codeFor('period'), discountType: 'percent', percentOff: 10, periods: ['annual'] }),
  };

  const returning = await approvedBuyer('pr-reasons');
  const s = returning.session;
  const mine = { customerId: returning.customerId, organisation: 'x' };
  const quote = (code, over = {}) => s.post('/api/checkout/quote', { plan: 'starter', billingPeriod: 'per_event', discountCode: code, ...over });
  /** Why the code does not apply; undefined when it does (and then it discounts). */
  const reason = async (code, over) => {
    const r = await quote(code, over);
    assert.equal(r.status, 200, r.text);
    if (r.data.code.ok) {
      assert.ok(r.data.discountMinor > 0, `${code}: applies, so it discounts`);
      return undefined;
    }
    assert.equal(r.data.discountMinor, 0, `${code}: no discount`);
    assert.ok(r.data.code.message, 'a sentence to show');
    return r.data.code.reason;
  };

  assert.equal(await reason(`E2ENOSUCH${RUN_ID}`.toUpperCase().slice(0, 40)), 'COUPON_NOT_FOUND');
  assert.equal(await reason('x'), 'COUPON_NOT_FOUND', 'not even shaped like a code');
  assert.equal(await reason(codes.paused.code), 'COUPON_PAUSED');
  assert.equal(await reason(codes.early.code), 'COUPON_NOT_STARTED');
  assert.equal(await reason(codes.late.code), 'COUPON_EXPIRED');
  assert.equal(await reason(codes.plan.code), 'COUPON_PLAN');
  assert.equal(await reason(codes.plan.code, { plan: 'business' }), undefined, 'the plan it is for');
  assert.equal(await reason(codes.period.code), 'COUPON_PERIOD');
  assert.equal(await reason(codes.period.code, { billingPeriod: 'annual' }), undefined, 'the period it is for');
  assert.equal(await reason(codes.first.code, { customerId: returning.customerId }), 'COUPON_FIRST_PURCHASE', 'the organisation has bought before');
  assert.equal(await reason(codes.first.code), undefined, 'a new organisation has not');

  // Used once by somebody else: used up for everyone.
  const other = await buyer('pr-reasons-other');
  let r = await other.post('/api/checkout', order({ organisation: `E2E Pr Once Org ${RUN_ID}`, discountCode: codes.once.code }));
  assert.equal(r.status, 201, r.text);
  assert.equal(await reason(codes.once.code), 'COUPON_USED_UP');

  // Once per organisation: this one used it, another may.
  r = await s.post('/api/checkout', order({ ...mine, discountCode: codes.perOrg.code }));
  assert.equal(r.status, 201, r.text);
  assert.equal(await reason(codes.perOrg.code, { customerId: returning.customerId }), 'COUPON_CUSTOMER_LIMIT');
  assert.equal(await reason(codes.perOrg.code), undefined, 'a new organisation has its own use');

  // Placing the order refuses the same way, and places nothing.
  const count = async () => (await dbQuery('SELECT COUNT(*)::int AS n FROM orders WHERE purchaser_user_id = $1', [s.user.id])).rows[0].n;
  const ordersBefore = await count();
  for (const [code, want, over] of [
    [codes.paused.code, 'COUPON_PAUSED', {}],
    [codes.late.code, 'COUPON_EXPIRED', {}],
    [codes.once.code, 'COUPON_USED_UP', {}],
    [codes.plan.code, 'COUPON_PLAN', {}],
    [codes.period.code, 'COUPON_PERIOD', {}],
    [codes.first.code, 'COUPON_FIRST_PURCHASE', mine],
    [codes.perOrg.code, 'COUPON_CUSTOMER_LIMIT', mine],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    r = await s.post('/api/checkout', order({ organisation: `E2E Pr Refused ${RUN_ID}`, ...over, discountCode: code }));
    assert.equal(r.status, 400, `${code}: ${r.text}`);
    assert.equal(r.json.code, want);
  }
  assert.equal(await count(), ordersBefore, 'no order was placed');
  const orgs = await dbQuery('SELECT COUNT(*)::int AS n FROM customers WHERE name = $1', [`E2E Pr Refused ${RUN_ID}`]);
  assert.equal(orgs.rows[0].n, 0, 'and no organisation created for nothing');
});

test('concurrent checkouts cannot use a code more often than it allows', async () => {
  const owner = await ownerSession();
  const c = await coupon(owner, { code: codeFor('race'), discountType: 'percent', percentOff: 25, maxUses: 3 });
  const buyers = [];
  for (let i = 0; i < 7; i += 1) buyers.push(await buyer(`pr-race-${i}`)); // eslint-disable-line no-await-in-loop
  const results = await Promise.all(buyers.map((s, i) => s.post('/api/checkout', order({
    organisation: `E2E Pr Race ${i} Org ${RUN_ID}`, discountCode: c.code,
  }))));
  const placed = results.filter((r) => r.status === 201);
  const refused = results.filter((r) => r.status === 400);
  assert.equal(placed.length, 3, results.map((r) => `${r.status} ${r.json && r.json.code}`).join(', '));
  assert.equal(refused.length, 4);
  assert.ok(refused.every((r) => r.json.code === 'COUPON_USED_UP'));
  const row = await dbQuery('SELECT uses_count FROM coupons WHERE id = $1', [c.id]);
  assert.equal(row.rows[0].uses_count, 3);
  const red = await dbQuery('SELECT COUNT(*)::int AS n FROM coupon_redemptions WHERE coupon_id = $1', [c.id]);
  assert.equal(red.rows[0].n, 3, 'three uses recorded');
  const orphans = await dbQuery(
    'SELECT COUNT(*)::int AS n FROM customers WHERE name LIKE $1 AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = customers.id)',
    [`E2E Pr Race % Org ${RUN_ID}`],
  );
  assert.equal(orphans.rows[0].n, 0, 'the refused checkouts leave no organisation behind');
});

test('a refused order gives its use back', async () => {
  const owner = await ownerSession();
  const c = await coupon(owner, { code: codeFor('back'), discountType: 'percent', percentOff: 10, maxUses: 1 });
  const s = await buyer('pr-back');
  let r = await s.post('/api/checkout', order({ organisation: `E2E Pr Back Org ${RUN_ID}`, discountCode: c.code }));
  assert.equal(r.status, 201, r.text);
  r = await owner.post(`/api/orders/${r.data.order.id}/reject`, { reason: 'Test: not a real organisation' });
  assert.equal(r.status, 200, r.text);
  r = await owner.get(`/api/owner/coupons/${c.id}`);
  assert.equal(r.data.usesCount, 0);
  assert.equal(r.data.state, 'active', 'usable again');
});

test('the discount is a line on the order, the confirmation and the invoice', async () => {
  const owner = await ownerSession();
  const plan = await planNow(owner, 'starter');
  const c = await coupon(owner, { code: codeFor('inv'), discountType: 'percent', percentOff: 20 });
  const s = await buyer('pr-inv');
  let r = await s.post('/api/checkout', order({ organisation: `E2E Pr Inv Org ${RUN_ID}`, discountCode: c.code }));
  assert.equal(r.status, 201, r.text);
  const id = r.data.order.id;
  const off = (plan.perEventMinor * 2) / 10;
  const amount = (m) => (m / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  let text = await pdfText(s, `/api/me/orders/${id}/invoice.pdf`);
  assert.match(text, /ORDER CONFIRMATION/);
  assert.match(text, /Endirim · Discount/);

  r = await owner.get(`/api/owner/orders/${id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.lines.length, 2, 'the plan and the discount');
  assert.equal(r.data.lines[0].amountMinor, plan.perEventMinor);
  assert.equal(r.data.lines[1].amountMinor, -off);
  assert.equal(r.data.totals.netMinor, plan.perEventMinor - off);
  assert.equal(r.data.discount.status, 'applied');
  assert.equal(r.data.discount.removable, false, 'a code is not a claim to review');

  r = await owner.post(`/api/orders/${id}/approve`, {});
  assert.equal(r.status, 200, r.text);
  const snap = (await dbQuery('SELECT invoice_snapshot FROM orders WHERE id = $1', [id])).rows[0].invoice_snapshot;
  assert.equal(snap.amounts.listMinor, plan.perEventMinor, 'the snapshot keeps the price');
  assert.equal(snap.amounts.discountMinor, off, 'the discount');
  assert.equal(snap.amounts.discountLabel, `${c.code} −20%`);
  assert.equal(snap.amounts.amountMinor, plan.perEventMinor - off, 'and the charge');

  text = await pdfText(s, `/api/me/orders/${id}/invoice.pdf`);
  assert.match(text, /HESAB-FAKTURA/);
  assert.match(text, /Endirim · Discount/);
  assert.match(text, new RegExp(`${c.code} −20%`));
  assert.match(text, new RegExp(`−${amount(off)} AZN`), 'the amount taken off');
  assert.match(text, new RegExp(`${amount(plan.perEventMinor - off)} AZN`), 'the total after it');

  // Editing the code afterwards does not rewrite the invoice.
  r = await owner.patch(`/api/owner/coupons/${c.id}`, { percentOff: 50 });
  assert.equal(r.status, 200, r.text);
  text = await pdfText(owner, `/api/orders/${id}/invoice.pdf`);
  assert.match(text, new RegExp(`${c.code} −20%`));
});

/* ── Campaigns ─────────────────────────────────────────────────────────── */

test('an automatic campaign is on the price list and applies without a code; the larger saving wins', async () => {
  const owner = await ownerSession();
  const plan = await planNow(owner, 'business');
  const camp = await coupon(owner, { kind: 'campaign', name: `Launch ${RUN_ID}`, eligibility: 'all', discountType: 'percent', percentOff: 10, plans: ['business'], periods: ['annual'] });
  const small = await coupon(owner, { code: codeFor('small'), discountType: 'percent', percentOff: 5 });
  const big = await coupon(owner, { code: codeFor('big'), discountType: 'percent', percentOff: 30 });
  try {
    let r = await new Session('anon-camp').get('/api/checkout/plans');
    assert.ok(r.data.campaigns.some((x) => x.id === camp.id && x.eligibility === 'all' && x.percentOff === 10), 'listed for the pricing page');
    const s = await buyer('pr-camp');
    const q = (over) => s.post('/api/checkout/quote', { plan: 'business', billingPeriod: 'annual', ...over });
    r = await q({});
    assert.equal(r.data.discountMinor, plan.annualMinor / 10, 'without a code');
    assert.equal(r.data.discount.kind, 'campaign');
    r = await q({ discountCode: small.code });
    assert.equal(r.data.discount.kind, 'campaign', 'the campaign gives more than 5%');
    assert.deepEqual(r.data.code, { ok: true, code: small.code, applied: false });
    r = await q({ discountCode: big.code });
    assert.equal(r.data.discount.code, big.code, '30% beats 10%: not both');
    assert.equal(r.data.discountMinor, (plan.annualMinor * 3) / 10);
    r = await s.post('/api/checkout/quote', { plan: 'business', billingPeriod: 'per_event' });
    assert.equal(r.data.discount, null, 'not on the period it is not for');
  } finally {
    await owner.post(`/api/owner/coupons/${camp.id}/pause`, {});
  }
});

test('an education discount is claimed, shown to the owner, and removed or accepted before approval', async () => {
  const owner = await ownerSession();
  const plan = await planNow(owner, 'professional');
  const edu = await coupon(owner, { kind: 'campaign', name: `Education ${RUN_ID}`, eligibility: 'education', discountType: 'percent', percentOff: 30, plans: ['professional'] });
  try {
    const s = await buyer('pr-edu');
    let r = await s.post('/api/checkout/quote', { plan: 'professional', billingPeriod: 'per_event' });
    assert.equal(r.data.discount, null, 'not without the claim');
    r = await s.post('/api/checkout/quote', { plan: 'professional', billingPeriod: 'per_event', education: { institution: 'ADA University' } });
    assert.equal(r.data.discountMinor, (plan.perEventMinor * 3) / 10);
    assert.equal(r.data.discount.needsReview, true);

    // Claimed, then removed by the owner.
    r = await s.post('/api/checkout', order({ plan: 'professional', organisation: `E2E Pr Edu Org ${RUN_ID}`, education: { institution: 'ADA University' } }));
    assert.equal(r.status, 201, r.text);
    const first = r.data.order;
    assert.equal(first.discount_status, 'claimed');
    assert.deepEqual(first.discount_claim, { type: 'education', institution: 'ADA University' });
    r = await owner.get(`/api/owner/orders/${first.id}`);
    assert.equal(r.data.discount.removable, true);
    assert.equal(r.data.discount.claim.institution, 'ADA University');
    r = await owner.post(`/api/orders/${first.id}/discount/remove`, { reason: 'Not a university' });
    assert.equal(r.status, 200, r.text);
    assert.equal(Number(r.data.order.amount_minor), plan.perEventMinor, 'back to the price');
    assert.equal(r.data.order.discount_status, 'removed');
    r = await owner.post(`/api/orders/${first.id}/discount/remove`, {});
    assert.equal(r.json.code, 'DISCOUNT_NOT_CLAIMED', 'only once');
    r = await owner.post(`/api/orders/${first.id}/approve`, {});
    assert.equal(r.status, 200, r.text);
    let text = await pdfText(s, `/api/me/orders/${first.id}/invoice.pdf`);
    assert.doesNotMatch(text, /Discount/, 'a removed claim is not on the invoice');
    const audit = await dbQuery("SELECT meta FROM audit_log WHERE action = 'order.discount.remove' AND target_id = $1", [String(first.id)]);
    assert.equal(audit.rows.length, 1);

    // Claimed again on another order, and accepted by approving it.
    r = await s.post('/api/checkout', order({ plan: 'professional', customerId: first.customer_id, organisation: 'x', education: true }));
    assert.equal(r.status, 201, r.text);
    const second = r.data.order;
    r = await owner.post(`/api/orders/${second.id}/approve`, {});
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.order.discount_status, 'approved');
    assert.equal(Number(r.data.order.amount_minor), (plan.perEventMinor * 7) / 10);
    r = await owner.post(`/api/orders/${second.id}/discount/remove`, {});
    assert.equal(r.status, 409, 'after approval the amount is the invoice’s');
    text = await pdfText(s, `/api/me/orders/${second.id}/invoice.pdf`);
    assert.match(text, new RegExp(`Education ${RUN_ID} −30%`));

    r = await owner.get(`/api/owner/coupons/${edu.id}`);
    assert.equal(r.data.usesCount, 1, 'the removed claim gave its use back');
  } finally {
    await owner.post(`/api/owner/coupons/${edu.id}/pause`, {});
  }
});

/* ── The owner's coupons ───────────────────────────────────────────────── */

test('the owner creates, edits, pauses and lists codes; each step is audited', async () => {
  const owner = await ownerSession();
  const code = codeFor('crud');
  let r = await owner.post('/api/owner/coupons', { code, discountType: 'percent', percentOff: 101 });
  assert.equal(r.status, 400);
  assert.equal(r.json.errors[0].field, 'percentOff');
  r = await owner.post('/api/owner/coupons', { code: 'a!', discountType: 'percent', percentOff: 10 });
  assert.equal(r.json.errors[0].field, 'code');
  r = await owner.post('/api/owner/coupons', { code, discountType: 'percent', percentOff: 10, validFrom: '2026-02-01', validUntil: '2026-01-01' });
  assert.equal(r.json.errors[0].field, 'validUntil');

  const c = await coupon(owner, { code, name: 'Spring', discountType: 'fixed', amountOffMinor: 5000, plans: ['starter', 'professional'], maxUses: 10, note: 'for the newsletter' });
  assert.equal(c.state, 'active');
  assert.deepEqual(c.plans, ['starter', 'professional']);
  r = await owner.post('/api/owner/coupons', { code: code.toLowerCase(), discountType: 'percent', percentOff: 10 });
  assert.equal(r.status, 409, 'codes are unique whatever their case');
  assert.equal(r.json.code, 'COUPON_CODE_TAKEN');

  r = await owner.patch(`/api/owner/coupons/${c.id}`, { discountType: 'percent', percentOff: 12.5, plans: ['starter', 'professional', 'business'] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.percentOff, 12.5);
  assert.equal(r.data.amountOffMinor, null);
  assert.equal(r.data.plans, null, 'every plan is the same as no restriction');
  r = await owner.post(`/api/owner/coupons/${c.id}/pause`, {});
  assert.equal(r.data.state, 'paused');

  r = await owner.get(`/api/owner/coupons?q=${encodeURIComponent(code.toLowerCase())}&state=paused`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.rows.map((x) => x.id), [c.id], 'search and state filter');
  assert.equal(r.data.counts.paused, 1);
  r = await owner.get(`/api/owner/coupons?q=${encodeURIComponent('for the newsletter')}&state=active`);
  assert.ok(!r.data.rows.some((x) => x.id === c.id), 'not among the active ones');

  r = await owner.post(`/api/owner/coupons/${c.id}/resume`, {});
  assert.equal(r.data.state, 'active');
  const actions = (await dbQuery("SELECT action FROM audit_log WHERE target_type = 'coupon' AND target_id = $1 ORDER BY id", [String(c.id)])).rows.map((x) => x.action);
  assert.deepEqual(actions, ['owner.coupon.create', 'owner.coupon.update', 'owner.coupon.pause', 'owner.coupon.resume']);

  r = await owner.delete(`/api/owner/coupons/${c.id}`);
  assert.equal(r.status, 200, 'never used: it can go');
  const used = await coupon(owner, { code: codeFor('kept'), discountType: 'percent', percentOff: 10 });
  const s = await buyer('pr-kept');
  r = await s.post('/api/checkout', order({ organisation: `E2E Pr Kept Org ${RUN_ID}`, discountCode: used.code }));
  assert.equal(r.status, 201, r.text);
  r = await owner.delete(`/api/owner/coupons/${used.id}`);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'COUPON_IN_USE', 'one with orders is paused instead');
  r = await owner.patch(`/api/owner/coupons/${used.id}`, { maxUses: 1 });
  assert.equal(r.status, 200, 'a limit equal to its uses');
  r = await owner.patch(`/api/owner/coupons/${used.id}`, { maxUses: 0 });
  assert.equal(r.status, 400);
});

/* ── The October 2026 pricing ──────────────────────────────────────────── */

test('the approved prices are the defaults, and the annual rule holds for each', async () => {
  const r = await new Session('anon-defaults').get('/api/checkout/plans');
  const { PLANS } = require('../src/constants/plans');
  for (const id of ['starter', 'professional', 'business']) {
    const p = r.data.plans.find((x) => x.id === id);
    assert.ok(p.annualMinor <= p.eventsPerYear * p.perEventMinor, `${id}: annual within its events one by one`);
    assert.equal(PLANS[id].per_event, { starter: 39000, professional: 99000, business: 249000 }[id], `${id} default per event`);
  }
  const community = r.data.plans.find((x) => x.id === 'community');
  assert.deepEqual(
    { perEvent: community.perEventMinor, annual: community.annualMinor, grantOnly: community.grantOnly, events: community.eventsPerYear, participants: community.participants },
    { perEvent: null, annual: null, grantOnly: true, events: 2, participants: 100 },
    'Community is free, granted, 2 events a year for 100 participants',
  );
});

test('modules only move down a tier: certificates on Starter, report, branding and analytics on Professional', () => {
  const { modulesForPlan } = require('../src/constants/modules');
  const has = (plan, key) => modulesForPlan(plan).has(key);
  assert.ok(has('starter', 'certificates') && has('community', 'certificates'));
  for (const key of ['reports', 'branding', 'analytics_adv']) {
    assert.ok(has('professional', key), `${key} on Professional`);
    assert.ok(!has('starter', key), `${key} not on Starter`);
  }
  assert.ok(!has('professional', 'webhooks') && has('business', 'webhooks'), 'webhooks stay Business and up');
  assert.deepEqual([...modulesForPlan('community')].sort(), [...modulesForPlan('starter')].sort(), 'Community has what Starter has');
  // Every plan keeps every module it had before the move.
  const before = {
    starter: ['events', 'registration', 'participants', 'teams', 'submissions', 'judging', 'results', 'announcements', 'telegram', 'analytics', 'export'],
    professional: ['mentors', 'volunteers', 'presentations', 'resources', 'certificates', 'elimination', 'forms', 'automations', 'bigscreen', 'reports'],
    business: ['analytics_adv', 'branding', 'calendar', 'chat', 'checkin', 'gallery', 'webhooks'],
  };
  const tiers = ['starter', 'professional', 'business'];
  tiers.forEach((plan, i) => {
    for (const lower of tiers.slice(0, i + 1)) for (const key of before[lower]) assert.ok(has(plan, key), `${plan} keeps ${key}`);
  });
});

test('Community is not sold at checkout; the owner grants it, for free, with its limits', async () => {
  const s = await buyer('pr-community');
  let r = await s.post('/api/checkout', order({ plan: 'community', organisation: `E2E Pr Community Org ${RUN_ID}` }));
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'PLAN_NOT_SELF_SERVE');
  assert.match(r.json.message, /contact form/);

  const owner = await ownerSession();
  const org = await approvedBuyer('pr-community-org');
  const organiser = new Session('organiser-community');
  await organiser.login('admin@test.com');
  assert.equal((await organiser.post(`/api/customers/${org.customerId}/community`, {})).status, 403, 'owner only');
  r = await owner.post(`/api/customers/${org.customerId}/community`, { note: 'Student club' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.order.plan, 'community');
  assert.equal(Number(r.data.order.amount_minor), 0);
  assert.equal(r.data.order.invoice_number, null, 'nothing to pay, no invoice');
  assert.equal(r.data.order.status, 'delivered');
  assert.equal(r.data.entitlement.events_allowed, 2);
  assert.equal(r.data.entitlement.participant_limit, 100);
  r = await owner.post(`/api/customers/${org.customerId}/community`, {});
  assert.equal(r.status, 409, 'not twice while it is live');
  assert.equal(r.json.code, 'COMMUNITY_ACTIVE');
  const a = await dbQuery("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'customer.community.grant' AND customer_id = $1", [org.customerId]);
  assert.equal(a.rows[0].n, 1, 'the grant is audited');
});

test('no discount takes more than half the price', async () => {
  const owner = await ownerSession();
  const plan = await planNow(owner, 'starter');
  let r = await owner.post('/api/owner/coupons', { code: codeFor('sixty'), discountType: 'percent', percentOff: 60 });
  assert.equal(r.status, 400, 'a percentage above 50 is refused');
  assert.equal(r.json.errors[0].field, 'percentOff');
  const c = await coupon(owner, { code: codeFor('huge'), discountType: 'fixed', amountOffMinor: plan.perEventMinor, plans: ['starter'] });
  const s = await buyer('pr-cap');
  r = await s.post('/api/checkout/quote', { plan: 'starter', billingPeriod: 'per_event', discountCode: c.code });
  assert.equal(r.data.discountMinor, Math.floor(plan.perEventMinor / 2), 'a fixed amount is cut to half the price');
  r = await s.post('/api/checkout', order({ organisation: `E2E Pr Cap Org ${RUN_ID}`, discountCode: c.code }));
  assert.equal(r.status, 201, r.text);
  assert.equal(Number(r.data.order.amount_minor), plan.perEventMinor - Math.floor(plan.perEventMinor / 2));
});

test('a code given to one organisation works for it alone', async () => {
  const owner = await ownerSession();
  const partner = await approvedBuyer('pr-partner');
  const c = await coupon(owner, {
    code: codeFor('partner'), name: 'Launch partner', discountType: 'percent', percentOff: 50,
    customerId: partner.customerId, note: 'Launch partner: price locked for 24 months',
  });
  assert.equal(c.customerId, partner.customerId);
  assert.ok(c.customerName);
  const other = await buyer('pr-partner-other');
  let r = await other.post('/api/checkout/quote', { plan: 'starter', billingPeriod: 'per_event', discountCode: c.code });
  assert.equal(r.data.code.reason, 'COUPON_NOT_YOURS');
  r = await other.post('/api/checkout', order({ organisation: `E2E Pr Not Partner ${RUN_ID}`, discountCode: c.code }));
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'COUPON_NOT_YOURS');
  r = await partner.session.post('/api/checkout', order({ customerId: partner.customerId, organisation: 'x', discountCode: c.code }));
  assert.equal(r.status, 201, r.text);
  assert.equal(Number(r.data.order.discount_minor), Number(r.data.order.list_amount_minor) / 2);
  r = await owner.post('/api/owner/coupons', { kind: 'campaign', name: 'x', eligibility: 'all', discountType: 'percent', percentOff: 10, customerId: partner.customerId });
  assert.equal(r.status, 400, 'only a code is given to one organisation');
});

test('a non-profit claims the non-profit discount, a university the education one', async () => {
  const owner = await ownerSession();
  const edu = await coupon(owner, { kind: 'campaign', name: `Edu ${RUN_ID}`, eligibility: 'education', discountType: 'percent', percentOff: 40, plans: ['business'] });
  const npo = await coupon(owner, { kind: 'campaign', name: `NPO ${RUN_ID}`, eligibility: 'nonprofit', discountType: 'percent', percentOff: 30, plans: ['business'] });
  try {
    const s = await buyer('pr-npo');
    const q = (education) => s.post('/api/checkout/quote', { plan: 'business', billingPeriod: 'per_event', education });
    let r = await q({ type: 'nonprofit', institution: 'Green Baku' });
    assert.equal(r.data.discount.name, `NPO ${RUN_ID}`);
    assert.equal(r.data.discount.needsReview, true);
    r = await q({ type: 'education', institution: 'BHOS' });
    assert.equal(r.data.discount.name, `Edu ${RUN_ID}`);
    r = await q(undefined);
    assert.equal(r.data.discount, null, 'no claim, no claimed discount');
    r = await s.post('/api/checkout', order({ plan: 'business', organisation: `E2E Pr NPO Org ${RUN_ID}`, education: { type: 'nonprofit', institution: 'Green Baku' } }));
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.data.order.discount_claim, { type: 'nonprofit', institution: 'Green Baku' });
    assert.equal(r.data.order.discount_status, 'claimed');
  } finally {
    await owner.post(`/api/owner/coupons/${edu.id}/pause`, {});
    await owner.post(`/api/owner/coupons/${npo.id}/pause`, {});
  }
});

test('nothing applies by itself after deploy: no discount is created or active until the owner makes one', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const f of ['0038_price_catalogue.sql', '0039_discounts.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', f), 'utf8');
    assert.doesNotMatch(sql, /INSERT INTO coupons/i, `${f} seeds no discount`);
  }
});
