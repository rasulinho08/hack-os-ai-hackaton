/**
 * The owner console's server side (Phase 6): one overview for the whole
 * platform, the health of this instance, a searchable audit trail and the
 * notice shown on every page.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, ownerSession, approvedBuyer } = require('./fixtures');

const ctx = {};
const PATHS = ['/api/owner/overview', '/api/owner/health', '/api/owner/audit', '/api/owner/audit/actions', '/api/owner/settings/notice'];

test('setup: an owner, a buyer with an event, a participant', async () => {
  ctx.owner = await ownerSession();
  ctx.buyer = await approvedBuyer('oc-buyer');
  const r = await ctx.buyer.session.post('/api/events', {
    event_code: `OC${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `=HYPERLINK("x") Console ${RUN_ID}`,
    registration_start: iso(-DAY), registration_end: iso(DAY), start_date: iso(2 * DAY), end_date: iso(3 * DAY),
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  await dbQuery('UPDATE events SET is_published = true WHERE id = $1', [ctx.ev.id]);
  const slug = (await dbQuery('SELECT slug FROM events WHERE id = $1', [ctx.ev.id])).rows[0].slug;
  const p = new Session('oc-part');
  const reg = await p.post(`/api/public/events/${slug}/register`, {
    account: { fullName: 'Console Person', email: email('oc-part'), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(reg.status, 201, reg.text);
});

test('only the platform owner opens the console', async () => {
  const admin = new Session('oc-admin');
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  for (const path of PATHS) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await ctx.buyer.session.get(path)).status, 403, `organiser: ${path}`);
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await admin.get(path)).status, 403, `admin: ${path}`);
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await new Session('anon').get(path)).status, 401, `anonymous: ${path}`);
  }
  assert.equal((await ctx.buyer.session.put('/api/owner/settings/notice', { active: false })).status, 403);
});

test('the overview counts every organisation and event on the server', async () => {
  const mine = await ctx.owner.get(`/api/owner/overview?customerId=${ctx.buyer.customerId}`);
  assert.equal(mine.status, 200, mine.text);
  assert.deepEqual(mine.data.events.list.map((e) => e.id), [ctx.ev.id], 'one organisation\'s events');
  assert.equal(mine.data.events.total, 1);
  assert.equal(mine.data.totals.participants, 1);
  assert.deepEqual(Object.keys(mine.data.customers), ['active'], 'just this organisation');
  assert.equal(Object.values(mine.data.orders).reduce((a, b) => a + b, 0), 1, 'its one order');
  assert.equal(mine.data.users.total, 2, 'the buyer and the participant');
  assert.equal(mine.data.signups.reduce((n, d) => n + d.registrations, 0), 1);
  const r = await ctx.owner.get('/api/owner/overview');
  assert.equal(r.status, 200, r.text);
  const ev = mine.data.events.list[0];
  assert.equal(ev.phase, 'upcoming');
  assert.equal(ev.customerId, ctx.buyer.customerId);
  assert.equal(ev.participants.total, 1);
  assert.equal(ev.participants.pending + ev.participants.approved + ev.participants.waitlisted, 1);
  assert.ok(r.data.customers.active >= 1);
  assert.ok(r.data.users.total >= 2);
  assert.equal(typeof r.data.users.unverified, 'number');
  assert.equal(r.data.signups.length, 30, 'thirty days');
  assert.ok(r.data.signups.at(-1).users >= 1, 'today\'s sign-ups');
  const all = (await dbQuery('SELECT COUNT(*)::int AS n FROM participants')).rows[0].n;
  assert.ok(Math.abs(r.data.totals.participants - all) <= 5, 'totals cover every event, not only the listed ones');
  // Other test files run at the same time and add events of their own.
  const events = (await dbQuery('SELECT COUNT(*)::int AS n FROM events')).rows[0].n;
  assert.ok(Math.abs(r.data.events.total - events) <= 5, `events: ${r.data.events.total} vs ${events} in the database`);
  assert.ok(r.data.events.list.length <= 300);
  const phases = r.data.events.list.map((e) => e.phase);
  const rank = { running: 0, upcoming: 1, draft: 2, finished: 3, archived: 4 };
  assert.deepEqual([...phases].sort((a, b) => rank[a] - rank[b]), phases, 'running first, archived last');
});

test('health: database, jobs, requests and integrations', async () => {
  const r = await ctx.owner.get('/api/owner/health');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.database.ok, true);
  assert.equal(typeof r.data.database.latencyMs, 'number');
  assert.match(String(r.data.database.migration.version), /^\d{4}$/);
  assert.ok(r.data.requests.requests > 0, 'this instance counted requests');
  assert.equal(r.data.requests.series.length, 60);
  assert.equal(typeof r.data.jobs.lagSeconds, 'number');
  assert.equal(typeof r.data.integrations.mail.configured, 'boolean');
  assert.equal(typeof r.data.integrations.chat.waiting, 'number');
  assert.ok(r.data.process.uptimeS >= 0);
  assert.ok(!JSON.stringify(r.data).includes(process.env.JWT_SECRET || 'never-there'), 'no secrets');
});

test('the notice: checked, shown in its window, hidden when off', async () => {
  let r = await ctx.owner.put('/api/owner/settings/notice', { active: true, level: 'warning', message: {} });
  assert.equal(r.status, 400);
  r = await ctx.owner.put('/api/owner/settings/notice', { active: true, level: 'loud', message: { en: 'x' } });
  assert.equal(r.status, 400);
  r = await ctx.owner.put('/api/owner/settings/notice', {
    active: true, level: 'warning', message: { az: 'Bu gecə 02:00-da qısa texniki iş.', en: 'Short maintenance tonight at 02:00.', ru: 'Короткие работы сегодня в 02:00.' },
    endsAt: iso(DAY),
  });
  assert.equal(r.status, 200, r.text);
  let pub = await new Session('anon').get('/api/public/notice');
  assert.equal(pub.status, 200);
  assert.equal(pub.data.level, 'warning');
  assert.equal(pub.data.message.en, 'Short maintenance tonight at 02:00.');
  r = await ctx.owner.put('/api/owner/settings/notice', { active: true, message: { en: 'Later' }, startsAt: iso(DAY) });
  assert.equal(r.status, 200);
  pub = await new Session('anon').get('/api/public/notice');
  assert.equal(pub.data, null, 'not before its start');
  r = await ctx.owner.put('/api/owner/settings/notice', { active: false, message: { en: 'Off' } });
  pub = await new Session('anon').get('/api/public/notice');
  assert.equal(pub.data, null, 'switched off');
});

test('the audit trail is searched by action and event and exported safely', async () => {
  let r = await ctx.owner.get('/api/owner/audit?action=owner.notice');
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.length >= 3, 'every notice change');
  assert.ok(r.data.every((x) => x.action.startsWith('owner.notice')));
  r = await ctx.owner.get('/api/owner/audit/actions');
  assert.ok(r.data.some((x) => x.action === 'owner.notice.update'));
  await dbQuery(
    `INSERT INTO audit_log (actor_user_id, event_id, action, target_type, target_id, meta)
     VALUES (NULL, $1, 'test.marker', 'event', $2, '{"n": 1}'::jsonb)`,
    [ctx.ev.id, String(ctx.ev.id)],
  );
  r = await ctx.owner.get(`/api/owner/audit?eventId=${ctx.ev.id}`);
  assert.ok(r.data.length >= 1);
  assert.ok(r.data.every((x) => x.event_id === ctx.ev.id));
  r = await ctx.owner.get('/api/owner/audit?action=bad;drop');
  assert.equal(r.status, 200, 'an unusable filter is ignored, not run');
  const csv = await ctx.owner.download(`/api/owner/audit?eventId=${ctx.ev.id}&format=csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const text = csv.body.toString('utf8');
  assert.ok(text.includes('test.marker'));
  assert.ok(text.includes(`"'=HYPERLINK(""x"") Console ${RUN_ID}"`) || text.includes(`'=HYPERLINK("x") Console ${RUN_ID}`), 'a formula-looking name is neutralised');
});
