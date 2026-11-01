/**
 * The owner console's lists and detail pages: organisations, people, orders
 * and events answered in one request each, paginated, searched and sorted on
 * the server; the global search; the overview's insights; and the two
 * account actions the owner takes for someone else.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, ownerSession, approvedBuyer } = require('./fixtures');

const ctx = {};
const LISTS = ['customers', 'events', 'users', 'orders', 'judging', 'tickets', 'feedback'];
const READS = [
  ...LISTS.map((l) => `/api/owner/${l}`),
  '/api/owner/search?q=e2e', '/api/owner/insights', '/api/owner/activity', '/api/owner/analytics',
];
/** Keys that must never reach the browser, at any depth. */
const SECRET_KEYS = ['password_hash', 'token_hash', 'token_version', 'calendar_token_version', 'verifyUrl', 'token'];

function assertNoSecrets(value, where) {
  const seen = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (SECRET_KEYS.includes(k)) seen.push(`${path}.${k}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  walk(value, where);
  assert.deepEqual(seen, [], `no secrets in ${where}`);
  assert.ok(!JSON.stringify(value).includes('$2a$') && !JSON.stringify(value).includes('$2b$'), `no bcrypt hash in ${where}`);
}

const assertPage = (data, where) => {
  assert.ok(Array.isArray(data.rows), `${where}: rows`);
  for (const k of ['total', 'page', 'pageSize']) assert.equal(typeof data[k], 'number', `${where}: ${k}`);
  assert.ok(data.rows.length <= data.pageSize, `${where}: at most a page`);
};

test('setup: an organisation with an event, a participant in it, an unconfirmed account', async () => {
  ctx.owner = await ownerSession();
  ctx.buyer = await approvedBuyer('od-buyer');
  const code = `OD${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  const r = await ctx.buyer.session.post('/api/events', {
    event_code: code, name: `Directory Hack ${RUN_ID}`,
    registration_start: iso(-DAY), registration_end: iso(DAY), start_date: iso(2 * DAY), end_date: iso(3 * DAY),
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  ctx.code = code;
  await dbQuery('UPDATE events SET is_published = true WHERE id = $1', [ctx.ev.id]);
  const slug = (await dbQuery('SELECT slug FROM events WHERE id = $1', [ctx.ev.id])).rows[0].slug;
  ctx.part = new Session('od-part');
  const reg = await ctx.part.post(`/api/public/events/${slug}/register`, {
    account: { fullName: `Directory Person ${RUN_ID}`, email: email('od-part'), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(reg.status, 201, reg.text);
  ctx.partId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email('od-part')])).rows[0].id;
  await ctx.part.login(email('od-part'));

  ctx.unconfirmed = new Session('od-unconf');
  await ctx.unconfirmed.register({ fullName: `Unconfirmed ${RUN_ID}`, email: email('od-unconf') }, { verify: false });
  ctx.unconfirmedId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email('od-unconf')])).rows[0].id;
  // The sign-up just sent a link; let the cool-down pass so the owner's resend is the next one.
  await dbQuery(`UPDATE email_verification_tokens SET created_at = now() - interval '5 minutes' WHERE user_id = $1`, [ctx.unconfirmedId]);
});

test('only the platform owner reads the directory or acts on an account', async () => {
  const admin = new Session('od-admin');
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  const anon = new Session('anon');
  const detail = [`/api/owner/customers/${ctx.buyer.customerId}`, `/api/owner/users/${ctx.partId}`, `/api/owner/orders/${ctx.buyer.order.id}`];
  for (const path of [...READS, ...detail]) {
    /* eslint-disable no-await-in-loop */
    assert.equal((await ctx.buyer.session.get(path)).status, 403, `organiser: ${path}`);
    assert.equal((await admin.get(path)).status, 403, `admin: ${path}`);
    assert.equal((await ctx.part.get(path)).status, 403, `participant: ${path}`);
    assert.equal((await anon.get(path)).status, 401, `anonymous: ${path}`);
    /* eslint-enable no-await-in-loop */
  }
  for (const action of ['verification', 'sign-out']) {
    const path = `/api/owner/users/${ctx.unconfirmedId}/${action}`;
    /* eslint-disable no-await-in-loop */
    assert.equal((await ctx.buyer.session.post(path)).status, 403, `organiser: ${path}`);
    assert.equal((await admin.post(path)).status, 403, `admin: ${path}`);
    assert.equal((await anon.post(path)).status, 401, `anonymous: ${path}`);
    /* eslint-enable no-await-in-loop */
  }
});

test('organisations: one paginated, searchable, sortable list with their figures', async () => {
  let r = await ctx.owner.get('/api/owner/customers?pageSize=5');
  assert.equal(r.status, 200, r.text);
  assertPage(r.data, 'customers');
  assert.equal(r.data.pageSize, 5);
  assert.ok(r.data.total >= 1);
  const firstPage = r.data.rows.map((c) => c.id);
  r = await ctx.owner.get('/api/owner/customers?pageSize=5&page=2');
  assert.ok(r.data.rows.every((c) => !firstPage.includes(c.id)), 'page 2 is not page 1');

  r = await ctx.owner.get('/api/owner/customers?pageSize=500');
  assert.equal(r.data.pageSize, 100, 'the page size is capped');

  r = await ctx.owner.get(`/api/owner/customers?q=${encodeURIComponent(`od-buyer Org ${RUN_ID}`)}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.total, 1, r.text);
  const c = r.data.rows[0];
  assert.equal(c.id, ctx.buyer.customerId);
  assert.equal(c.status, 'active');
  assert.equal(c.plan, 'starter');
  assert.equal(c.events, 1);
  assert.equal(c.participants, 1);
  assert.equal(c.orders, 1);
  assert.equal(c.seats.linked, 1);
  assert.equal(typeof c.seats.over, 'boolean');
  assert.ok(c.last_activity, 'the approval is in the trail');
  assertNoSecrets(r.data, 'customers');

  r = await ctx.owner.get(`/api/owner/customers?q=${ctx.buyer.customerId}`);
  assert.ok(r.data.rows.some((x) => x.id === ctx.buyer.customerId), 'found by id');
  r = await ctx.owner.get('/api/owner/customers?q=%25%25%25');
  assert.equal(r.status, 200, 'a wildcard is matched literally');
  assert.equal(r.data.total, 0);

  r = await ctx.owner.get('/api/owner/customers?status=pending_review&pageSize=100');
  assert.ok(r.data.rows.every((x) => x.status === 'pending_review'));
  r = await ctx.owner.get('/api/owner/customers?sort=participants&dir=desc&pageSize=20');
  const counts = r.data.rows.map((x) => x.participants);
  assert.deepEqual([...counts].sort((a, b) => b - a), counts, 'sorted by participants');
  r = await ctx.owner.get('/api/owner/customers?sort=1;DROP TABLE users&dir=sideways');
  assert.equal(r.status, 200, 'an unknown sort falls back');
  assert.equal(r.data.sort, 'name');
});

test('one organisation: profile, plan, usage, members, orders, revenue and its audit trail', async () => {
  assert.equal((await ctx.owner.get('/api/owner/customers/abc')).status, 400);
  assert.equal((await ctx.owner.get('/api/owner/customers/2000000000')).status, 404);
  const r = await ctx.owner.get(`/api/owner/customers/${ctx.buyer.customerId}`);
  assert.equal(r.status, 200, r.text);
  const d = r.data;
  assert.equal(d.customer.id, ctx.buyer.customerId);
  assert.equal(d.plan.plan, 'starter');
  const used = (await dbQuery('SELECT COALESCE(SUM(events_used), 0)::int AS n FROM entitlements WHERE customer_id = $1', [ctx.buyer.customerId])).rows[0].n;
  assert.equal(d.usage.events.used, used, 'events used, as the entitlements count them');
  assert.equal(d.usage.events.allowed, 1, 'a per-event Starter plan');
  assert.equal(d.usage.participants.total, 1);
  assert.equal(d.usage.seats.used, d.seats.used);
  assert.equal(d.events.total, 1);
  assert.equal(d.events.byPhase.upcoming, 1);
  assert.ok(d.members.some((m) => m.email === email('od-buyer')), 'the buyer is a member');
  assert.equal(d.orders.length, 1);
  assert.equal(d.orders[0].order_code, ctx.buyer.order.order_code);
  assert.equal(typeof d.orders[0].amount_minor, 'number');
  assert.ok(Array.isArray(d.revenue));
  assert.ok(d.audit.some((a) => a.action === 'order.approve'), 'the approval is in its trail');
  assert.ok(d.audit.every((a) => !('ip' in a)), 'no addresses in the trail');
  assertNoSecrets(d, 'customer detail');

  const ev = await ctx.owner.get(`/api/owner/events?customerId=${ctx.buyer.customerId}`);
  assert.equal(ev.status, 200, ev.text);
  assert.deepEqual(ev.data.rows.map((e) => e.id), [ctx.ev.id]);
  assert.equal(ev.data.rows[0].participants, 1);
  assert.equal(ev.data.rows[0].phase, 'upcoming');
});

test('events: filtered by phase, searched by name or code, sorted', async () => {
  let r = await ctx.owner.get(`/api/owner/events?q=${ctx.code}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.rows[0].id, ctx.ev.id);
  assert.equal(r.data.rows[0].customer_name, `E2E od-buyer Org ${RUN_ID}`);
  r = await ctx.owner.get('/api/owner/events?phase=running,upcoming&pageSize=50');
  assert.ok(r.data.rows.every((e) => ['running', 'upcoming'].includes(e.phase)));
  r = await ctx.owner.get('/api/owner/events?sort=participants&dir=desc&pageSize=10');
  const n = r.data.rows.map((e) => e.participants);
  assert.deepEqual([...n].sort((a, b) => b - a), n);
  r = await ctx.owner.get(`/api/owner/events?from=${encodeURIComponent(iso(DAY))}&to=${encodeURIComponent(iso(4 * DAY))}&pageSize=100&q=${ctx.code}`);
  assert.deepEqual(r.data.rows.map((e) => e.id), [ctx.ev.id], 'runs inside the range');
  r = await ctx.owner.get(`/api/owner/events?from=${encodeURIComponent(iso(10 * DAY))}&q=${ctx.code}`);
  assert.equal(r.data.total, 0, 'over before the range starts');
  const all = (await dbQuery('SELECT COUNT(*)::int AS n FROM events')).rows[0].n;
  r = await ctx.owner.get('/api/owner/events?pageSize=1');
  assert.ok(Math.abs(r.data.total - all) <= 5, 'the total counts every event');
});

test('one event: organisation, plan, counts, judging and its audit trail', async () => {
  const r = await ctx.owner.get(`/api/owner/events/${ctx.ev.id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.id, ctx.ev.id);
  assert.equal(r.data.event.customer_id, ctx.buyer.customerId);
  assert.equal(r.data.event.phase, 'upcoming');
  assert.equal(Object.values(r.data.participants).reduce((a, b) => a + b, 0), 1);
  for (const k of ['teams', 'submissions', 'judges', 'mentors', 'volunteers', 'criteria', 'scores', 'open_reports']) {
    assert.equal(typeof r.data.counts[k], 'number', k);
  }
  assert.equal(r.data.coverage, null, 'no panel, no coverage');
  assert.ok(Array.isArray(r.data.audit));
  assertNoSecrets(r.data, 'event detail');
  assert.equal((await ctx.owner.get('/api/owner/events/2000000000')).status, 404);
  assert.equal((await ctx.buyer.session.get(`/api/owner/events/${ctx.ev.id}`)).status, 403);
});

test('people: by name or e-mail, with the role filter, never a hash', async () => {
  let r = await ctx.owner.get(`/api/owner/users?q=${encodeURIComponent(email('od-part'))}`);
  assert.equal(r.status, 200, r.text);
  assertPage(r.data, 'users');
  assert.equal(r.data.total, 1);
  assert.equal(r.data.rows[0].id, ctx.partId);
  assert.equal(r.data.rows[0].participations, 1);
  assertNoSecrets(r.data, 'users');
  r = await ctx.owner.get(`/api/owner/users?q=${encodeURIComponent(`Directory Person ${RUN_ID}`)}`);
  assert.equal(r.data.rows[0]?.id, ctx.partId, 'by name');
  r = await ctx.owner.get('/api/owner/users?role=judge&pageSize=30');
  assert.ok(r.data.rows.every((u) => u.role === 'judge'));
  r = await ctx.owner.get('/api/owner/users?verified=false&pageSize=30');
  assert.ok(r.data.rows.every((u) => u.email_verified === false));
});

test('one person: account, memberships, event roles, orders, and the audit by and about them', async () => {
  let r = await ctx.owner.get(`/api/owner/users/${ctx.partId}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.user.id, ctx.partId);
  assert.equal(r.data.user.email, email('od-part'));
  assert.equal(typeof r.data.user.email_verified, 'boolean');
  const role = r.data.roles.find((x) => x.event_id === ctx.ev.id);
  assert.equal(role.role, 'participant');
  assert.ok(role.status);
  assert.equal(role.customer_name, `E2E od-buyer Org ${RUN_ID}`);
  assertNoSecrets(r.data, 'user detail');

  const buyerId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email('od-buyer')])).rows[0].id;
  r = await ctx.owner.get(`/api/owner/users/${buyerId}`);
  assert.ok(r.data.memberships.some((m) => m.customer_id === ctx.buyer.customerId), 'a member of the organisation');
  assert.ok(r.data.orders.some((o) => o.id === ctx.buyer.order.id), 'the order they placed');
  assert.ok(r.data.roles.some((x) => x.role === 'creator' && x.event_id === ctx.ev.id), 'the event they created');
  const did = (await dbQuery('SELECT COUNT(*)::int AS n FROM audit_log WHERE actor_user_id = $1', [buyerId])).rows[0].n;
  assert.equal(r.data.auditBy.length, Math.min(did, 30), 'what they did');
  assert.ok(r.data.auditBy.every((a) => a.actor_user_id === buyerId));
  assertNoSecrets(r.data, 'buyer detail');
  assert.equal((await ctx.owner.get('/api/owner/users/2000000000')).status, 404);
});

test('a new confirmation link: e-mailed, never returned, recorded, and not for a confirmed address', async () => {
  let r = await ctx.owner.post(`/api/owner/users/${ctx.unconfirmedId}/verification`);
  assert.equal(r.status, 200, r.text);
  assert.equal(typeof r.data.sent, 'boolean');
  assert.ok(!/token|verify-email/i.test(r.text), 'the link stays out of the response');
  const trail = await dbQuery(
    `SELECT actor_user_id FROM audit_log WHERE action = 'owner.user.verification_sent' AND target_id = $1`,
    [String(ctx.unconfirmedId)],
  );
  assert.equal(trail.rows.length, 1, 'recorded');
  r = await ctx.owner.post(`/api/owner/users/${ctx.unconfirmedId}/verification`);
  assert.equal(r.status, 429, 'a cool-down between links');
  const buyerId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email('od-buyer')])).rows[0].id;
  r = await ctx.owner.post(`/api/owner/users/${buyerId}/verification`);
  assert.equal(r.status, 409, 'already confirmed');
  assert.equal((await ctx.owner.post('/api/owner/users/2000000000/verification')).status, 404);
});

test('sign out everywhere: every session of that account ends, it is recorded, and never your own', async () => {
  const victim = new Session('od-signout');
  await victim.register({ fullName: 'Sign Out Me', email: email('od-signout') });
  assert.equal((await victim.get('/api/auth/me')).status, 200);
  const id = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email('od-signout')])).rows[0].id;
  let r = await ctx.owner.post(`/api/owner/users/${id}/sign-out`);
  assert.equal(r.status, 200, r.text);
  assert.equal((await victim.get('/api/auth/me')).status, 401, 'the old session is gone');
  const trail = await dbQuery(`SELECT meta FROM audit_log WHERE action = 'session.revoke_all' AND target_id = $1`, [String(id)]);
  assert.equal(trail.rows[0].meta.by, 'owner');
  await victim.login(email('od-signout'));
  assert.equal((await victim.get('/api/auth/me')).status, 200, 'they can sign in again');

  const ownerId = (await ctx.owner.get('/api/auth/me')).data.id;
  r = await ctx.owner.post(`/api/owner/users/${ownerId}/sign-out`);
  assert.equal(r.status, 409, 'not the account that is asking');
  assert.equal((await ctx.owner.get('/api/auth/me')).status, 200);
});

test('orders: list with totals, search by number, and one order in full', async () => {
  let r = await ctx.owner.get(`/api/owner/orders?q=${ctx.buyer.order.order_code}`);
  assert.equal(r.status, 200, r.text);
  assertPage(r.data, 'orders');
  assert.equal(r.data.rows[0].id, ctx.buyer.order.id);
  assert.equal(r.data.rows[0].customer_id, ctx.buyer.customerId);
  assert.ok(r.data.totals.some((t) => t.status === 'delivered'));
  r = await ctx.owner.get('/api/owner/orders?status=pending&pageSize=100');
  assert.ok(r.data.rows.every((o) => o.status === 'pending'));
  assert.ok(r.data.totals.length >= 1, 'totals cover every status, not only the filtered one');
  r = await ctx.owner.get(`/api/owner/orders?customerId=${ctx.buyer.customerId}`);
  assert.deepEqual(r.data.rows.map((o) => o.id), [ctx.buyer.order.id]);

  r = await ctx.owner.get(`/api/owner/orders/${ctx.buyer.order.id}`);
  assert.equal(r.status, 200, r.text);
  const d = r.data;
  assert.equal(d.order.id, ctx.buyer.order.id);
  assert.equal(d.lines.length, 1);
  assert.match(d.lines[0].label, /Starter plan/);
  assert.equal(d.totals.currency, 'AZN');
  assert.equal(d.totals.grossMinor, d.totals.netMinor + (d.totals.taxMinor || 0));
  assert.ok(d.totals.vatNote, 'the VAT note when no VAT is charged');
  assert.ok(d.history.length >= 1, 'status history');
  assert.ok(d.audit.some((a) => a.action === 'order.approve'), 'its audit trail');
  assert.equal(d.entitlement.plan, 'starter');
  assert.equal(d.customer.id, ctx.buyer.customerId);
  assert.equal(d.invoicePdf, `/api/orders/${ctx.buyer.order.id}/invoice.pdf`);
  assertNoSecrets(d, 'order detail');
  assert.equal((await ctx.owner.get('/api/owner/orders/2000000000')).status, 404);
});

test('global search: organisations, people, orders and events, a handful each', async () => {
  let r = await ctx.owner.get('/api/owner/search?q=a');
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.organisations, r.data.people, r.data.orders, r.data.events].map((x) => x.length), [0, 0, 0, 0], 'two letters at least');
  r = await ctx.owner.get(`/api/owner/search?q=${encodeURIComponent(RUN_ID)}`);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.organisations.some((o) => o.id === ctx.buyer.customerId), 'the organisation');
  assert.ok(r.data.people.some((p) => p.id === ctx.partId), 'the person, by e-mail');
  assert.ok(r.data.events.some((e) => e.id === ctx.ev.id), 'the event');
  for (const k of ['organisations', 'people', 'orders', 'events']) assert.ok(r.data[k].length <= 5, `${k}: a handful`);
  r = await ctx.owner.get(`/api/owner/search?q=${ctx.buyer.order.order_code}`);
  assert.ok(r.data.orders.some((o) => o.id === ctx.buyer.order.id), 'the order, by number');
  r = await ctx.owner.get(`/api/owner/search?q=${ctx.code}`);
  assert.ok(r.data.events.some((e) => e.id === ctx.ev.id), 'the event, by code');
  assertNoSecrets(r.data, 'search');
});

test('overview insights, the live feed and analytics', async () => {
  let r = await ctx.owner.get('/api/owner/insights');
  assert.equal(r.status, 200, r.text);
  const d = r.data;
  const azn = d.revenueByMonth.find((x) => x.currency === 'AZN');
  assert.equal(azn.months.length, 12, 'twelve months');
  assert.ok(azn.months.every((m) => /^\d{4}-\d{2}$/.test(m.month) && typeof m.paidMinor === 'number' && typeof m.pendingMinor === 'number'));
  assert.deepEqual(d.funnel.map((s) => s.key), ['accounts', 'buyers', 'ordering', 'approved', 'active']);
  assert.ok(d.funnel[0].value >= d.funnel[1].value, 'a funnel narrows');
  for (const k of ['ordersToReview', 'orgsAwaitingApproval', 'reportedMessages', 'failedJobs', 'escalatedTickets']) {
    assert.equal(typeof d.waiting[k], 'number', k);
  }
  assert.ok(d.topByParticipants.length <= 5);

  r = await ctx.owner.get('/api/owner/activity?limit=5');
  assert.equal(r.status, 200);
  assert.ok(r.data.length <= 5 && r.data.length > 0);
  const newest = r.data[0].id;
  r = await ctx.owner.get(`/api/owner/activity?after=${newest}`);
  assert.ok(r.data.every((a) => Number(a.id) > Number(newest)), 'only what is newer');
  assert.ok(r.data.every((a) => !('ip' in a) && !('meta' in a)));

  r = await ctx.owner.get('/api/owner/overview?list=false');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.events.list, [], 'totals only');
  assert.ok(r.data.events.total > 0);

  r = await ctx.owner.get('/api/owner/analytics');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.monthly.length, 12);
  assert.ok(r.data.topEvents.length <= 12);
  assert.equal(typeof r.data.totals.participants, 'number');
});

test('judging, support and feedback across every event, one request each', async () => {
  let r = await ctx.owner.get('/api/owner/judging?pageSize=10&panel=true');
  assert.equal(r.status, 200, r.text);
  assertPage(r.data, 'judging');
  for (const e of r.data.rows) {
    assert.ok(e.judges > 0 || e.criteria > 0, 'a panel or criteria');
    assert.ok(e.coverage === null || (e.coverage >= 0 && e.coverage <= 1));
  }
  r = await ctx.owner.get('/api/owner/tickets?pageSize=10&status=open');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.rows.every((t) => t.status.toLowerCase() === 'open'));
  assert.equal(typeof r.data.escalated, 'number');
  r = await ctx.owner.get('/api/owner/feedback?pageSize=10');
  assert.equal(r.status, 200, r.text);
  assert.equal(typeof r.data.summary.responses, 'number');
  assert.deepEqual(Object.keys(r.data.summary.distribution), ['1', '2', '3', '4', '5']);
  assert.ok(r.data.rows.every((f) => !('user_id' in f)), 'feedback is the event\'s, not the person\'s');
});
