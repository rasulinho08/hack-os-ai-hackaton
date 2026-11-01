/**
 * The buyer funnel, end to end against a running API: what is on sale and at
 * what price, how an order is placed (terms, one order per attempt, the
 * organisation it is for), how it is invoiced and paid, and the setup link.
 *
 * The seller's billing details are a platform setting; the tests that change
 * them put back what was there.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Session, RUN_ID, email, mailsTo } = require('./helpers');
const { dbQuery, ownerSession, approvedBuyer } = require('./fixtures');

const TERMS = { acceptTerms: true };
const order = (over = {}) => ({
  plan: 'starter', billingPeriod: 'per_event', payment: { method: 'bank_transfer' }, ...TERMS, ...over,
});

async function buyer(label) {
  const s = new Session(label);
  await s.register({ fullName: `E2E ${label}`, email: email(label) });
  return s;
}

/** The text of a PDF the API answered with (pdftotext, as the audit read them). */
async function pdfText(session, path) {
  const r = await session.download(path);
  assert.equal(r.status, 200, `${path}: ${r.status}`);
  assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
  return execFileSync('pdftotext', ['-layout', '-', '-'], { input: r.body }).toString('utf8');
}

/** The newest mail to `address` whose text matches, waiting for it to arrive. */
async function mailMatching(address, re, ms = 8000) {
  const until = Date.now() + ms;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const m = (await mailsTo(address)).find((x) => re.test(x.text));
    if (m || Date.now() > until) return m || null;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((done) => { setTimeout(done, 100); });
  }
}

/* ── Prices ────────────────────────────────────────────────────────────── */

test('annual never costs more than buying its events one by one', () => {
  const { PLANS, SELF_SERVE_PLAN_IDS } = require('../src/constants/plans');
  for (const id of SELF_SERVE_PLAN_IDS) {
    const p = PLANS[id];
    assert.ok(p.annual <= p.eventsPerYear * p.per_event, `${id}: ${p.annual} > ${p.eventsPerYear} × ${p.per_event}`);
    // About two thirds of the events one by one, rounded to a clean price.
    const formula = (p.per_event * p.eventsPerYear * 2) / 3;
    assert.ok(Math.abs(p.annual - formula) <= 5000, `${id}: ${p.annual} is not about ${formula}`);
  }
  assert.deepEqual(
    SELF_SERVE_PLAN_IDS.map((id) => [id, PLANS[id].per_event, PLANS[id].annual, PLANS[id].eventsPerYear, PLANS[id].participants]),
    [
      ['starter', 39000, 79000, 3, 200],
      ['professional', 99000, 399000, 6, 500],
      ['business', 249000, 1990000, 12, 2000],
    ],
    'the prices approved in October 2026',
  );
  assert.equal(PLANS.community.grantOnly, true, 'Community is granted, not sold');
});

test('the price list says which payment methods, which VAT and which terms apply', async () => {
  const r = await new Session('anon-plans').get('/api/checkout/plans');
  assert.equal(r.status, 200, r.text);
  const starter = r.data.plans.find((p) => p.id === 'starter');
  assert.equal(starter.annualMinor, 79000);
  assert.deepEqual(r.data.payment.methods, ['bank_transfer'], 'no card provider is configured, so no card');
  assert.equal(typeof r.data.vat.registered, 'boolean');
  assert.match(r.data.termsVersion, /^\d{4}-\d{2}-\d{2}$/);
});

/* ── Card ──────────────────────────────────────────────────────────────── */

test('without a card provider a card order is refused, never stored as "not charged"', async () => {
  const s = await buyer('co-card');
  const r = await s.post('/api/checkout', order({
    organisation: `E2E Card Org ${RUN_ID}`,
    payment: { method: 'card', card: { brand: 'visa', last4: '4242' } },
  }));
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'CARD_UNAVAILABLE');
  const left = await dbQuery('SELECT COUNT(*)::int AS n FROM orders WHERE purchaser_user_id = $1', [s.user.id]);
  assert.equal(left.rows[0].n, 0, 'no order is left behind');
});

test('the card path stays behind PAYMENT_CARD_PROVIDER and a registered provider', () => {
  const cards = require('../src/services/cardPayments');
  const { paymentChoice } = require('../src/services/checkout.service');
  const saved = process.env.PAYMENT_CARD_PROVIDER;
  try {
    delete process.env.PAYMENT_CARD_PROVIDER;
    assert.equal(cards.isCardEnabled(), false);
    assert.throws(() => paymentChoice({ method: 'card', card: { last4: '4242' } }), (e) => e.code === 'CARD_UNAVAILABLE');
    process.env.PAYMENT_CARD_PROVIDER = 'nobody-built-this';
    assert.equal(cards.isCardEnabled(), false, 'an unknown provider fails closed');
    cards.registerProvider('test-provider', { name: 'Test provider' });
    process.env.PAYMENT_CARD_PROVIDER = 'test-provider';
    assert.equal(cards.isCardEnabled(), true);
    const pay = paymentChoice({ method: 'card', card: { brand: 'visa', last4: '4242', number: '4242424242424242' } });
    assert.deepEqual(pay, { method: 'card', cardBrand: 'visa', cardLast4: '4242' }, 'brand and last four only');
  } finally {
    if (saved === undefined) delete process.env.PAYMENT_CARD_PROVIDER; else process.env.PAYMENT_CARD_PROVIDER = saved;
  }
});

/* ── Terms ─────────────────────────────────────────────────────────────── */

test('an order needs the terms accepted, and keeps when and which version', async () => {
  const s = await buyer('co-terms');
  let r = await s.post('/api/checkout', { ...order({ organisation: `E2E Terms Org ${RUN_ID}` }), acceptTerms: undefined });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'TERMS_REQUIRED');

  const plans = await s.get('/api/checkout/plans');
  r = await s.post('/api/checkout', order({ organisation: `E2E Terms Org ${RUN_ID}`, termsVersion: '1999-01-01' }));
  assert.equal(r.status, 409, 'terms that changed since the page loaded');
  assert.equal(r.json.code, 'TERMS_CHANGED');

  r = await s.post('/api/checkout', order({ organisation: `E2E Terms Org ${RUN_ID}`, termsVersion: plans.data.termsVersion }));
  assert.equal(r.status, 201, r.text);
  assert.ok(r.data.order.terms_accepted_at, 'the time of acceptance');
  assert.equal(r.data.order.terms_version, plans.data.termsVersion);

  const owner = await ownerSession();
  const d = await owner.get(`/api/owner/orders/${r.data.order.id}`);
  assert.equal(d.data.order.terms_version, plans.data.termsVersion, 'the console order page has it');
  assert.ok(d.data.order.terms_accepted_at);
});

/* ── One order per attempt ─────────────────────────────────────────────── */

test('the same checkout attempt places one order, however often it is sent', async () => {
  const s = await buyer('co-idem');
  const key = `att-${RUN_ID}-idem-0001`;
  const body = order({ organisation: `E2E Idem Org ${RUN_ID}`, idempotencyKey: key });
  const [a, b] = await Promise.all([s.post('/api/checkout', body), s.post('/api/checkout', body)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201], `${a.text} ${b.text}`);
  assert.equal(a.data.order.id, b.data.order.id, 'both answers are the one order');
  const replay = await s.post('/api/checkout', body);
  assert.equal(replay.status, 200);
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.order.id, a.data.order.id);
  const n = await dbQuery('SELECT COUNT(*)::int AS n FROM orders WHERE purchaser_user_id = $1', [s.user.id]);
  assert.equal(n.rows[0].n, 1, 'one order row');
  const c = await dbQuery('SELECT COUNT(*)::int AS n FROM customer_contacts WHERE user_id = $1', [s.user.id]);
  assert.equal(c.rows[0].n, 1, 'one organisation');

  const changed = await s.post('/api/checkout', { ...body, plan: 'professional' });
  assert.equal(changed.status, 409, 'a key is one attempt, not a different order');
  assert.equal(changed.json.code, 'IDEMPOTENCY_MISMATCH');
});

/* ── The organisation an order is for ──────────────────────────────────── */

test('a returning buyer chooses their organisation, and its billing details are kept', async () => {
  const first = await approvedBuyer('co-return');
  const s = first.session;
  let r = await s.get('/api/me/orders');
  const mine = r.data.customers.find((c) => c.id === first.customerId);
  assert.equal(mine.my_role, 'owner', 'the portal knows the buyer owns it');

  r = await s.post('/api/checkout', order({
    customerId: first.customerId, organisation: 'ignored for an existing organisation',
    vatId: '1234567891', city: 'Gəncə', country: 'Azerbaijan',
  }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.order.customer_id, first.customerId);
  assert.equal(r.data.createdCustomer, false);
  const c = await dbQuery('SELECT name, vat_id, city, country FROM customers WHERE id = $1', [first.customerId]);
  assert.deepEqual(
    { vat: c.rows[0].vat_id, city: c.rows[0].city, country: c.rows[0].country },
    { vat: '1234567891', city: 'Gəncə', country: 'Azerbaijan' },
    'VÖEN, city and country are saved, not dropped',
  );
  assert.match(c.rows[0].name, /E2E co-return Org/, 'the name stays');

  // The same name typed again is their own organisation, not a new one.
  r = await s.post('/api/checkout', order({ organisation: `e2e CO-RETURN org ${RUN_ID}` }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.order.customer_id, first.customerId);

  // A different organisation is a new one.
  r = await s.post('/api/checkout', order({ organisation: `E2E Return Faculty ${RUN_ID}` }));
  assert.equal(r.status, 201, r.text);
  assert.notEqual(r.data.order.customer_id, first.customerId);
  assert.equal(r.data.createdCustomer, true);

  // Somebody else's organisation cannot be named by id.
  const other = await buyer('co-return-other');
  r = await other.post('/api/checkout', order({ customerId: first.customerId, organisation: 'x' }));
  assert.equal(r.status, 404, r.text);
});

test('a taken organisation name is a question for the buyer, never a suffix', async () => {
  const first = await approvedBuyer('co-taken');
  const name = (await dbQuery('SELECT name FROM customers WHERE id = $1', [first.customerId])).rows[0].name;
  const s = await buyer('co-taken-two');
  const r = await s.post('/api/checkout', order({ organisation: name.toUpperCase() }));
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'ORGANISATION_NAME_TAKEN');
  assert.match(r.json.message, /invite/i, 'it says what to do');
  const made = await dbQuery('SELECT COUNT(*)::int AS n FROM customers WHERE name ILIKE $1', [`${name}%`]);
  assert.equal(made.rows[0].n, 1, 'no "(username)" organisation is created');
});

/* ── Invoice, payment and status ───────────────────────────────────────── */

test('an order is received, reviewed, then invoiced on approval: one payment rule', async () => {
  const s = await buyer('co-flow');
  let r = await s.post('/api/checkout', order({ plan: 'professional', billingPeriod: 'annual', organisation: `E2E Flow Org ${RUN_ID}` }));
  assert.equal(r.status, 201, r.text);
  const placed = r.data.order;
  assert.equal(placed.status, 'pending');
  assert.equal(placed.invoice_number, null, 'no invoice number before the order is approved');
  assert.equal(Number(placed.amount_minor), 399000, 'the server prices it');

  const placedMail = await mailMatching(email('co-flow'), /under review/i);
  assert.ok(placedMail, 'the receipt');
  assert.match(placedMail.text, /under review/i);
  assert.match(placedMail.text, /14 days of the invoice/i);
  assert.doesNotMatch(placedMail.text, /we confirm the order first/i);

  let text = await pdfText(s, `/api/me/orders/${placed.id}/invoice.pdf`);
  assert.doesNotMatch(text, /HESAB-FAKTURA/, 'before approval it is not an invoice');
  assert.match(text, /ORDER CONFIRMATION/);

  const owner = await ownerSession();
  r = await owner.post(`/api/orders/${placed.id}/approve`, {});
  assert.equal(r.status, 200, r.text);
  const inv = r.data.order.invoice_number;
  assert.match(inv, /^INV-\d{4}-\d{4,}$/, 'approval issues the invoice');
  const days = (new Date(r.data.order.invoice_due_at) - new Date(r.data.order.invoice_issued_at)) / 86400000;
  assert.equal(Math.round(days), 14, 'due 14 days after it is issued');
  const approvedMail = await mailMatching(email('co-flow'), new RegExp(inv));
  assert.ok(approvedMail, 'the approval mail names the invoice');
  assert.match(approvedMail.text, /14 days/);

  text = await pdfText(s, `/api/me/orders/${placed.id}/invoice.pdf`);
  assert.match(text, /HESAB-FAKTURA/);
  assert.match(text, new RegExp(inv));
});

test('the seller billing details: owner only, checked, and printed where the buyer pays', async () => {
  const owner = await ownerSession();
  const before = await owner.get('/api/owner/settings/billing');
  assert.equal(before.status, 200, before.text);
  assert.equal(typeof before.data.ready, 'boolean');
  const s = await buyer('co-seller');
  assert.equal((await s.get('/api/owner/settings/billing')).status, 403, 'not for a buyer');

  let r = await owner.put('/api/owner/settings/billing', { iban: 'AZ00 NOPE' });
  assert.equal(r.status, 400, 'an IBAN that does not check out');
  const details = {
    legalName: `HackOS Test MMC ${RUN_ID}`, taxId: '1403891231', address: 'Nizami küç. 1\nBakı AZ1000',
    email: 'billing@hackos.test', bankName: 'Test Bank ASC', accountHolder: `HackOS Test MMC ${RUN_ID}`,
    iban: 'AZ21 NABZ 0000 0000 1370 1000 1944', swift: 'NABZAZ2X', vatRegistered: false,
  };
  try {
    r = await owner.put('/api/owner/settings/billing', details);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.ready, true);
    assert.equal(r.data.iban, 'AZ21NABZ00000000137010001944', 'kept without spaces');

    r = await s.post('/api/checkout', order({ organisation: `E2E Seller Org ${RUN_ID}` }));
    assert.equal(r.status, 201, r.text);
    const id = r.data.order.id;
    const mine = await s.get('/api/me/orders');
    assert.equal(mine.data.seller.iban, 'AZ21NABZ00000000137010001944', 'the portal shows where to pay');
    r = await owner.post(`/api/orders/${id}/approve`, {});
    assert.equal(r.status, 200, r.text);
    const text = await pdfText(s, `/api/me/orders/${id}/invoice.pdf`);
    assert.match(text, new RegExp(`HackOS Test MMC ${RUN_ID}`), 'the legal name');
    assert.match(text, /1403891231/, 'the VÖEN');
    assert.match(text, /AZ21 ?NABZ/, 'the IBAN');
    assert.match(text, /NABZAZ2X/, 'the SWIFT');
    assert.doesNotMatch(text, /sent to you by e-mail/i, 'no "details follow" once they exist');
    assert.match(text, /not VAT-registered/i, 'one VAT line from the setting');
    const mail = await mailMatching(email('co-seller'), /AZ21/);
    assert.ok(mail, 'the approval mail carries the bank details');
  } finally {
    const blank = { legalName: '', taxId: '', address: '', email: '', bankName: '', accountHolder: '', iban: '', swift: '' };
    await owner.put('/api/owner/settings/billing', { ...blank, ...((before.data && before.data.stored) || {}) });
  }
});

test('a VAT-registered seller charges VAT on the order, priced by the server', async () => {
  const owner = await ownerSession();
  const before = await owner.get('/api/owner/settings/billing');
  const s = await buyer('co-vat');
  try {
    let r = await owner.put('/api/owner/settings/billing', { vatRegistered: true, vatRatePercent: 18 });
    assert.equal(r.status, 200, r.text);
    r = await s.get('/api/checkout/plans');
    assert.deepEqual(r.data.vat, { registered: true, ratePercent: 18 });
    r = await s.post('/api/checkout', order({ organisation: `E2E VAT Org ${RUN_ID}`, taxMinor: 0 }));
    assert.equal(r.status, 201, r.text);
    assert.equal(Number(r.data.order.amount_minor), 39000);
    assert.equal(Number(r.data.order.tax_minor), 7020, '18% of ₼390');
  } finally {
    await owner.put('/api/owner/settings/billing', { vatRegistered: before.data.vatRegistered, vatRatePercent: before.data.vatRatePercent });
  }
});

/* ── Setup link ────────────────────────────────────────────────────────── */

test('re-approving an organisation that is already set up sends no setup link', async () => {
  const first = await approvedBuyer('co-setup');
  const token = first.approval.setupUrl.split('/setup/')[1];
  let r = await first.session.post(`/api/setup/${token}`, { timezone: 'Asia/Baku' });
  assert.equal(r.status, 200, r.text);

  r = await first.session.post('/api/checkout', order({ customerId: first.customerId, organisation: 'x' }));
  assert.equal(r.status, 201, r.text);
  const owner = await ownerSession();
  r = await owner.post(`/api/orders/${r.data.order.id}/approve`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.setupUrl, null, 'no new link for a set-up organisation');
  const tokens = await dbQuery('SELECT COUNT(*)::int AS n FROM setup_tokens WHERE customer_id = $1', [first.customerId]);
  assert.equal(tokens.rows[0].n, 1, 'and none issued');
  const used = await dbQuery('SELECT used_at FROM setup_tokens WHERE customer_id = $1', [first.customerId]);
  assert.ok(used.rows[0].used_at, 'the used link is not revoked either');
});

test('an expired setup link can be renewed, to the address it was sent to', async () => {
  const first = await approvedBuyer('co-renew');
  const token = first.approval.setupUrl.split('/setup/')[1];
  await dbQuery("UPDATE setup_tokens SET expires_at = now() - interval '1 hour', created_at = now() - interval '4 days' WHERE customer_id = $1", [first.customerId]);
  const anon = new Session('anon-renew');
  let r = await anon.get(`/api/setup/${token}`);
  assert.equal(r.data.state, 'expired');

  r = await anon.post(`/api/setup/${token}/renew`, {});
  assert.equal(r.status, 200, r.text);
  assert.ok(!r.data.email.includes(email('co-renew')), 'the address is masked');
  const mail = await mailMatching(email('co-renew'), /\/setup\/[A-Za-z0-9_-]{20,}/);
  assert.ok(mail, 'the new link went to the buyer');
  r = await anon.get(`/api/setup/${token}`);
  assert.equal(r.data.state, 'revoked', 'the old one says a newer link was sent');

  r = await anon.post(`/api/setup/${token}/renew`, {});
  assert.equal(r.status, 429, 'not again straight away');
  assert.equal(r.json.code, 'SETUP_RECENT');
});

test('the owner re-sends a setup link from the organisation; the buyer asks from the portal', async () => {
  const first = await approvedBuyer('co-resend');
  const owner = await ownerSession();
  let r = await owner.post(`/api/customers/${first.customerId}/setup-link`, {});
  assert.equal(r.status, 200, r.text);
  assert.match(r.data.setupUrl, /\/setup\/[A-Za-z0-9_-]{20,}$/);
  assert.equal((await first.session.post(`/api/customers/${first.customerId}/setup-link`, {})).status, 403);

  await dbQuery("UPDATE setup_tokens SET created_at = now() - interval '1 hour' WHERE customer_id = $1", [first.customerId]);
  r = await first.session.post(`/api/me/organisations/${first.customerId}/setup-link`, {});
  assert.equal(r.status, 200, r.text);
  const stranger = await buyer('co-resend-x');
  r = await stranger.post(`/api/me/organisations/${first.customerId}/setup-link`, {});
  assert.equal(r.status, 404, 'only its own owner');
});

/* ── Language ──────────────────────────────────────────────────────────── */

test('the order e-mails are in the language the buyer ordered in', async () => {
  const s = await buyer('co-az');
  const r = await s.post('/api/checkout', order({ organisation: `E2E AZ Org ${RUN_ID}`, lang: 'az' }));
  assert.equal(r.status, 201, r.text);
  const mail = await mailMatching(email('co-az'), /lang="az"/);
  assert.ok(mail, 'an Azerbaijani receipt');
});

/* ── An issued invoice does not change ─────────────────────────────────── */

test('an issued invoice keeps the buyer, seller and amounts it was issued with', async () => {
  const owner = await ownerSession();
  const before = await owner.get('/api/owner/settings/billing');
  const s = await buyer('co-frozen');
  const blank = { legalName: '', taxId: '', address: '', email: '', bankName: '', accountHolder: '', iban: '', swift: '' };
  try {
    let r = await owner.put('/api/owner/settings/billing', {
      legalName: `Frozen Seller MMC ${RUN_ID}`, taxId: '1403891231', address: 'Nizami küç. 1\nBakı AZ1000',
      bankName: 'Old Bank ASC', iban: 'AZ21NABZ00000000137010001944', swift: 'NABZAZ2X', vatRegistered: false,
    });
    assert.equal(r.status, 200, r.text);
    r = await s.post('/api/checkout', order({ organisation: `E2E Frozen Org ${RUN_ID}`, vatId: '1111111111', city: 'Bakı' }));
    assert.equal(r.status, 201, r.text);
    const { id, customer_id: customerId } = r.data.order;
    r = await owner.post(`/api/orders/${id}/approve`, {});
    assert.equal(r.status, 200, r.text);

    // Afterwards the organisation's VÖEN and the seller's bank account change.
    await dbQuery('UPDATE customers SET vat_id = $2, city = $3 WHERE id = $1', [customerId, '2222222222', 'Gəncə']);
    r = await owner.put('/api/owner/settings/billing', {
      legalName: `New Seller MMC ${RUN_ID}`, bankName: 'New Bank ASC', iban: 'GB82WEST12345698765432', swift: 'WESTGB22',
    });
    assert.equal(r.status, 200, r.text);

    const text = await pdfText(s, `/api/me/orders/${id}/invoice.pdf`);
    assert.match(text, /1111111111/, "the buyer's VÖEN as issued");
    assert.doesNotMatch(text, /2222222222/);
    assert.match(text, /Bakı/);
    assert.match(text, new RegExp(`Frozen Seller MMC ${RUN_ID}`), 'the seller as issued');
    assert.match(text, /AZ21 ?NABZ/, 'the IBAN as issued');
    assert.doesNotMatch(text, /GB82|New Bank|New Seller/);
    const owners = await pdfText(owner, `/api/orders/${id}/invoice.pdf`);
    assert.match(owners, /AZ21 ?NABZ/, "the owner's copy is the same document");
  } finally {
    await owner.put('/api/owner/settings/billing', { ...blank, ...((before.data && before.data.stored) || {}) });
  }
});
