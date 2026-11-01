/**
 * Outgoing webhooks (Phase 8): an organisation's endpoints, signed
 * deliveries of what happens in its events, retries, switching off an
 * endpoint that keeps failing, and who may do what.
 *
 * The receivers run in this process on 127.0.0.1, which the API allows when
 * NODE_ENV is development or test (WEBHOOKS_ALLOW_PRIVATE_TARGETS); the
 * production rules for addresses are in webhookUrl.test.js. Waiting a minute
 * for a retry is skipped by moving the queued job's time forward in the
 * database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { API_URL, Session, RUN_ID, email, DAY, iso, confirmEmail } = require('./helpers');
const { dbQuery, approvedBuyer, ownerSession } = require('./fixtures');

const BASE = '/api/account/webhooks';
const ctx = {};
const receivers = [];

/** An HTTP receiver: keeps what arrives and answers from `replies`, then with `always`. */
async function receiver() {
  const rec = { got: [], replies: [], always: 200, sockets: new Set() };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = JSON.parse(raw); } catch { body = null; }
      rec.got.push({ path: req.url, method: req.method, headers: req.headers, raw, body, at: Date.now() });
      const reply = rec.replies.length ? rec.replies.shift() : rec.always;
      if (reply === 'hang') return;
      if (reply === 302) {
        res.writeHead(302, { Location: `${rec.url}moved` });
        res.end();
        return;
      }
      res.writeHead(reply, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: reply < 300 }));
    });
  });
  server.on('connection', (s) => { rec.sockets.add(s); s.on('close', () => rec.sockets.delete(s)); });
  await new Promise((done) => { server.listen(0, '127.0.0.1', done); });
  rec.url = `http://127.0.0.1:${server.address().port}/hook/`;
  rec.close = () => { for (const s of rec.sockets) s.destroy(); server.close(); };
  rec.of = (type, pick = () => true) => rec.got.filter((h) => h.body && h.body.type === type && pick(h.body));
  receivers.push(rec);
  return rec;
}

test.after(() => { for (const r of receivers) r.close(); });

const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });
async function waitFor(what, fn, ms = 20000) {
  const until = Date.now() + ms;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const out = await fn();
    if (out) return out;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }
}

/** The receiver's own check, as docs/WEBHOOKS.md describes it. */
function signatureOk(secret, hit) {
  const ts = hit.headers['x-hackos-timestamp'];
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(`${ts}.${hit.raw}`).digest('hex')}`;
  const got = String(hit.headers['x-hackos-signature'] || '');
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

function assertEnvelope(hit, { type, customerId, eventId }) {
  const b = hit.body;
  assert.equal(hit.method, 'POST');
  assert.equal(hit.headers['content-type'], 'application/json');
  assert.match(hit.headers['user-agent'], /^HackOS-Webhooks\//);
  assert.equal(hit.headers['x-hackos-event'], type);
  assert.match(hit.headers['x-hackos-delivery'], /^[0-9a-f-]{36}$/);
  assert.ok(Math.abs(Number(hit.headers['x-hackos-timestamp']) - Date.now() / 1000) < 120, 'a fresh timestamp');
  assert.deepEqual(Object.keys(b).sort(), ['created_at', 'data', 'event', 'id', 'organisation_id', 'type']);
  assert.match(b.id, /^[0-9a-f-]{36}$/);
  assert.equal(b.type, type);
  assert.equal(b.organisation_id, customerId);
  assert.ok(!Number.isNaN(Date.parse(b.created_at)));
  if (eventId === null) assert.equal(b.event, null);
  else {
    assert.deepEqual(Object.keys(b.event).sort(), ['id', 'name', 'slug']);
    assert.equal(b.event.id, eventId);
  }
  // Nothing a receiver should never see.
  assert.doesNotMatch(hit.raw, /password|token|join_code|secret|whsec_/i);
}

async function fastForward(deliveryId) {
  const r = await dbQuery(
    `UPDATE jobs SET run_at = now()
      WHERE type = 'webhook.deliver' AND status IN ('queued', 'retry') AND (payload->>'deliveryId')::bigint = $1`,
    [deliveryId],
  );
  assert.equal(r.rowCount, 1, 'one queued attempt');
}

const delivery = async (id) => (await dbQuery('SELECT * FROM webhook_deliveries WHERE id = $1', [id])).rows[0];
const deliveryFor = async (endpointId, payloadId) => (await dbQuery(
  `SELECT * FROM webhook_deliveries WHERE endpoint_id = $1 AND payload->>'id' = $2 AND redelivery_of IS NULL`,
  [endpointId, payloadId],
)).rows[0];

async function createEvent(s, tag, extra = {}) {
  const r = await s.post('/api/events', {
    event_code: `${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    name: `Webhooks ${tag} ${RUN_ID}`,
    registration_start: iso(-DAY), registration_end: iso(3 * DAY), start_date: iso(4 * DAY), end_date: iso(5 * DAY),
    is_published: true, ...extra,
  });
  assert.equal(r.status, 201, r.text);
  const row = (await dbQuery('SELECT id, slug, customer_id, event_code FROM events WHERE id = $1', [r.data.id])).rows[0];
  return row;
}

async function register(ev, tag) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: `Person ${tag}`, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  await confirmEmail(email(tag));
  const row = (await dbQuery(
    `SELECT p.id, p.user_id FROM participants p JOIN users u ON u.id = p.user_id
      WHERE p.event_id = $1 AND LOWER(u.email) = LOWER($2)`,
    [ev.id, email(tag)],
  )).rows[0];
  return { s, mail: email(tag), participantId: row.id, userId: row.user_id };
}

async function member(customerId, tag, role) {
  const s = new Session(tag);
  await s.register({ fullName: `Member ${tag}`, email: email(tag) });
  const userId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(tag)])).rows[0].id;
  await dbQuery(
    `INSERT INTO customer_contacts (customer_id, user_id, full_name, email, member_role) VALUES ($1, $2, $3, $4, $5)`,
    [customerId, userId, `Member ${tag}`, email(tag), role],
  );
  await s.login(email(tag));
  return { s, userId };
}

test('setup: two Business organisations, a Starter one, members of each kind', async () => {
  ctx.biz = await approvedBuyer('wh-biz', { plan: 'business' });
  ctx.other = await approvedBuyer('wh-other', { plan: 'business' });
  ctx.starter = await approvedBuyer('wh-starter');
  const role = (await dbQuery(
    'SELECT member_role FROM customer_contacts WHERE customer_id = $1 AND is_primary', [ctx.biz.customerId],
  )).rows[0].member_role;
  assert.equal(role, 'owner', 'the buyer owns the organisation');
  ctx.admin = await member(ctx.biz.customerId, 'wh-admin', 'admin');
  ctx.organizer = await member(ctx.biz.customerId, 'wh-orgz', 'organizer');
  ctx.outsider = new Session('wh-out');
  await ctx.outsider.register({ fullName: 'Not In It', email: email('wh-out') });
  ctx.A = await receiver();
  ctx.O = await receiver();
});

test('the plan decides: Starter has no webhooks', async () => {
  const s = ctx.starter.session;
  let r = await s.get(BASE);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.enabled, false);
  assert.deepEqual(r.data.endpoints, []);
  assert.equal(r.data.organisation.id, ctx.starter.customerId);
  r = await s.post(BASE, { url: ctx.A.url, events: ['*'] });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'MODULE_DISABLED');
  assert.equal(r.json.module, 'webhooks');
  r = await ctx.biz.session.get(BASE);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.enabled, true);
  assert.equal(r.data.maxEndpoints, 10);
  assert.deepEqual(r.data.eventTypes, [
    'registration.created', 'participant.approved', 'participant.rejected', 'team.created',
    'submission.created', 'results.published', 'certificate.issued', 'event.published',
  ]);
});

test('only the owner and administrators of the organisation manage its webhooks', async () => {
  let r = await new Session('wh-anon').get(BASE);
  assert.equal(r.status, 401);
  r = await ctx.outsider.get(BASE);
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'NOT_ORG_ADMIN');
  r = await ctx.organizer.s.get(BASE);
  assert.equal(r.status, 403, `an organiser runs events, not the integrations: ${r.text}`);
  r = await ctx.organizer.s.post(BASE, { url: ctx.A.url, events: ['*'] });
  assert.equal(r.status, 403);
  r = await ctx.admin.s.get(BASE);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.organisation.id, ctx.biz.customerId);
  assert.deepEqual(r.data.organisations.map((o) => o.id), [ctx.biz.customerId], 'the organisations one may pick');
  r = await ctx.other.session.get(`${BASE}?customerId=${ctx.biz.customerId}`);
  assert.equal(r.status, 403, `another organisation's admin: ${r.text}`);
  r = await ctx.other.session.post(BASE, { customerId: ctx.biz.customerId, url: ctx.A.url, events: ['*'] });
  assert.equal(r.status, 403);
  r = await (await ownerSession()).get(`${BASE}?customerId=${ctx.biz.customerId}`);
  assert.equal(r.status, 200, `the platform owner names the organisation: ${r.text}`);
  assert.equal(r.data.organisation.id, ctx.biz.customerId);
});

test('an endpoint is checked before it is saved: where it points, what it receives', async () => {
  const s = ctx.admin.s;
  const refused = {
    'http://169.254.169.254/latest/meta-data/': 'URL_BLOCKED_ADDRESS', // cloud metadata
    'http://[::ffff:169.254.169.254]/': 'URL_BLOCKED_ADDRESS', // the same, inside IPv6
    'http://0.0.0.0:8080/': 'URL_BLOCKED_ADDRESS',
    'http://[fe80::1]/': 'URL_BLOCKED_ADDRESS',
    'ftp://example.com/hook': 'URL_NOT_HTTPS',
    'http://user:pass@127.0.0.1/hook': 'URL_CREDENTIALS',
  };
  for (const [url, code] of Object.entries(refused)) {
    // eslint-disable-next-line no-await-in-loop
    const r = await s.post(BASE, { url, events: ['*'] });
    assert.equal(r.status, 400, `${url}: ${r.text}`);
    assert.equal(r.json.code, 'VALIDATION_ERROR');
    assert.equal(r.json.errors[0].field, 'url', url);
    assert.equal(r.json.errors[0].code, code, url);
  }
  let r = await s.post(BASE, { url: ctx.A.url, events: ['team.deleted'] });
  assert.equal(r.status, 400);
  assert.equal(r.json.errors[0].field, 'events');
  assert.equal(r.json.errors[0].code, 'EVENTS_UNKNOWN');
  r = await s.post(BASE, { url: ctx.A.url, events: [] });
  assert.equal(r.status, 400);
  assert.equal(r.json.errors[0].code, 'EVENTS_REQUIRED');
  r = await s.post(BASE, { url: ctx.A.url, events: ['*'], description: 'x'.repeat(201) });
  assert.equal(r.status, 400);
  assert.equal(r.json.errors[0].field, 'description');
  assert.equal(r.json.errors[0].code, 'TOO_LONG');
  assert.equal(r.json.errors[0].max, 200);
  assert.equal((await dbQuery('SELECT COUNT(*)::int AS n FROM webhook_endpoints WHERE customer_id = $1', [ctx.biz.customerId])).rows[0].n, 0);
});

test('the signing secret is shown once, when the endpoint is created', async () => {
  const r = await ctx.biz.session.post(BASE, { url: ctx.A.url, events: ['*'], description: 'Our CRM' });
  assert.equal(r.status, 201, r.text);
  assert.match(r.data.secret, /^whsec_[A-Za-z0-9_-]{32}$/);
  assert.equal(r.data.endpoint.secret, undefined);
  assert.equal(r.data.endpoint.url, ctx.A.url);
  assert.equal(r.data.endpoint.urlHost, new URL(ctx.A.url).host);
  assert.deepEqual(r.data.endpoint.events, ['*']);
  assert.equal(r.data.endpoint.active, true);
  ctx.a = r.data.endpoint;
  ctx.secretA = r.data.secret;

  const raw = await fetch(`${API_URL}${BASE}`, {
    headers: { Cookie: [...ctx.biz.session.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
  });
  assert.equal(raw.headers.get('cache-control'), 'no-store', 'never kept by a cache');
  const list = await ctx.biz.session.get(BASE);
  assert.equal(list.data.endpoints.length, 1);
  assert.ok(!list.text.includes(ctx.secretA), 'never in the list');
  assert.equal(list.data.endpoints[0].secret, undefined);
  const saved = await ctx.biz.session.patch(`${BASE}/${ctx.a.id}`, { description: 'Our CRM (live)' });
  assert.equal(saved.status, 200, saved.text);
  assert.ok(!saved.text.includes(ctx.secretA), 'never after an edit');

  const row = (await dbQuery('SELECT url, secret FROM webhook_endpoints WHERE id = $1', [ctx.a.id])).rows[0];
  if (process.env.DATA_ENCRYPTION_KEY) {
    assert.match(row.secret, /^enc:v1:/, 'sealed at rest');
    assert.match(row.url, /^enc:v1:/, 'sealed at rest');
    assert.ok(!row.secret.includes(ctx.secretA.slice(6)));
  }
});

test('a test ping arrives signed, and the delivery log says so', async () => {
  const r = await ctx.biz.session.post(`${BASE}/${ctx.a.id}/test`, {});
  assert.equal(r.status, 202, r.text);
  assert.equal(r.data.delivery.type, 'ping');
  assert.equal(r.data.delivery.status, 'pending');
  const hit = await waitFor('the ping', () => ctx.A.of('ping')[0]);
  assertEnvelope(hit, { type: 'ping', customerId: ctx.biz.customerId, eventId: null });
  assert.ok(signatureOk(ctx.secretA, hit), 'the signature verifies with the secret');
  assert.ok(!signatureOk('whsec_wrong', hit));
  assert.equal(hit.headers['x-hackos-delivery'], r.data.delivery.deliveryId);
  assert.equal(hit.body.data.endpoint_id, ctx.a.id);
  const done = await waitFor('the delivered state', async () => {
    const d = await delivery(r.data.delivery.id);
    return d.status === 'delivered' ? d : null;
  });
  assert.equal(done.attempts, 1);
  assert.equal(done.last_status_code, 200);
  const log = await ctx.biz.session.get(`${BASE}/${ctx.a.id}/deliveries`);
  assert.equal(log.status, 200, log.text);
  assert.equal(log.data.items[0].id, r.data.delivery.id);
  assert.equal(log.data.items[0].status, 'delivered');
  assert.equal(log.data.items[0].lastStatusCode, 200);
  assert.match(log.data.items[0].lastResponse, /received/);
  assert.ok(!log.text.includes(ctx.secretA));
  const ep = (await ctx.biz.session.get(BASE)).data.endpoints[0];
  assert.equal(ep.lastDeliveryStatus, 'delivered');
  assert.equal(ep.consecutiveFailures, 0);
});

test('what happens in an event is delivered: published, registered, approved, turned down', async () => {
  ctx.ev = await createEvent(ctx.biz.session, 'WH');
  assert.equal(ctx.ev.customer_id, ctx.biz.customerId);
  const ids = { customerId: ctx.biz.customerId, eventId: ctx.ev.id };

  let hit = await waitFor('event.published', () => ctx.A.of('event.published', (b) => b.event.id === ctx.ev.id)[0]);
  assertEnvelope(hit, { type: 'event.published', ...ids });
  assert.ok(signatureOk(ctx.secretA, hit));
  assert.equal(hit.body.event.slug, ctx.ev.slug);
  assert.equal(hit.body.data.event.id, ctx.ev.id);
  assert.match(hit.body.data.event.public_url, new RegExp(`/e/${ctx.ev.slug}$`));

  ctx.p1 = await register(ctx.ev, 'wh-p1');
  hit = await waitFor('registration.created', () => ctx.A.of('registration.created', (b) => b.data.participant.id === ctx.p1.participantId)[0]);
  assertEnvelope(hit, { type: 'registration.created', ...ids });
  assert.ok(signatureOk(ctx.secretA, hit));
  const { participant } = hit.body.data;
  assert.equal(participant.status, 'pending');
  assert.equal(participant.user.id, ctx.p1.userId);
  assert.equal(participant.user.email.toLowerCase(), ctx.p1.mail.toLowerCase());
  assert.equal(participant.user.name, 'Person wh-p1');
  assert.ok(Date.parse(participant.registered_at));

  let r = await ctx.biz.session.patch(`/api/events/${ctx.ev.id}/participants/${ctx.p1.participantId}`, { status: 'approved' });
  assert.equal(r.status, 200, r.text);
  hit = await waitFor('participant.approved', () => ctx.A.of('participant.approved', (b) => b.data.participant.id === ctx.p1.participantId)[0]);
  assertEnvelope(hit, { type: 'participant.approved', ...ids });
  assert.equal(hit.body.data.participant.status, 'approved');
  assert.equal(hit.body.data.previous_status, 'pending');
  ctx.approvedHit = hit;

  ctx.p2 = await register(ctx.ev, 'wh-p2');
  r = await ctx.biz.session.patch(`/api/events/${ctx.ev.id}/participants/${ctx.p2.participantId}`, { status: 'rejected' });
  assert.equal(r.status, 200, r.text);
  hit = await waitFor('participant.rejected', () => ctx.A.of('participant.rejected', (b) => b.data.participant.id === ctx.p2.participantId)[0]);
  assertEnvelope(hit, { type: 'participant.rejected', ...ids });
  assert.equal(hit.body.data.participant.status, 'rejected');
  assert.ok(signatureOk(ctx.secretA, hit));
});

test('teams, submissions, results and certificates are delivered too', async () => {
  const ids = { customerId: ctx.biz.customerId, eventId: ctx.ev.id };
  let r = await ctx.biz.session.post('/api/teams', {
    eventId: ctx.ev.id, name: `Hook Team ${RUN_ID}`, memberIds: [ctx.p1.userId], leaderId: ctx.p1.userId,
  });
  assert.equal(r.status, 201, r.text);
  ctx.team = r.data;
  let hit = await waitFor('team.created', () => ctx.A.of('team.created', (b) => b.data.team.id === ctx.team.id)[0]);
  assertEnvelope(hit, { type: 'team.created', ...ids });
  assert.equal(hit.body.data.team.name, `Hook Team ${RUN_ID}`);
  assert.equal(hit.body.data.team.leader.id, ctx.p1.userId);

  await dbQuery("UPDATE events SET start_date = now() - interval '1 hour', end_date = now() + interval '1 day' WHERE id = $1", [ctx.ev.id]);
  r = await ctx.p1.s.post('/api/submissions', {
    eventId: ctx.ev.id, projectName: 'Qarmaq', description: 'Hooks for everyone', repoLink: 'https://github.com/wh/qarmaq',
  });
  assert.equal(r.status, 201, r.text);
  hit = await waitFor('submission.created', () => ctx.A.of('submission.created', (b) => b.data.submission.id === r.data.id)[0]);
  assertEnvelope(hit, { type: 'submission.created', ...ids });
  assert.equal(hit.body.data.submission.project_name, 'Qarmaq');
  assert.equal(hit.body.data.submission.repo_url, 'https://github.com/wh/qarmaq');
  assert.equal(hit.body.data.team.id, ctx.team.id);

  // Results and certificates the way their services store them (any path into these tables is covered).
  await dbQuery('INSERT INTO event_results (event_id, team_id, place, score, judges_count) VALUES ($1, $2, 1, 87.5, 3)', [ctx.ev.id, ctx.team.id]);
  await dbQuery('UPDATE events SET results_published_at = now() WHERE id = $1', [ctx.ev.id]);
  hit = await waitFor('results.published', () => ctx.A.of('results.published', (b) => b.event.id === ctx.ev.id)[0]);
  assertEnvelope(hit, { type: 'results.published', ...ids });
  assert.equal(hit.body.data.first, true);
  assert.equal(hit.body.data.results.length, 1);
  assert.equal(hit.body.data.results[0].place, 1);
  assert.equal(hit.body.data.results[0].team.name, `Hook Team ${RUN_ID}`);
  assert.equal(hit.body.data.show_scores, false);
  assert.equal(hit.body.data.results[0].score, undefined, 'scores only when the organiser shows them');

  const certs = (await dbQuery(
    `INSERT INTO certificates (event_id, user_id, type, kind, code, team_id, place, title, recipient_name)
     VALUES ($1, $2, 'winners', 'winner', $3, $4, 1, 'First place', 'Person wh-p1'),
            ($1, $5, 'participation', 'participation', $6, NULL, NULL, NULL, 'Person wh-p2')
     RETURNING id`,
    [ctx.ev.id, ctx.p1.userId, `WH1-${RUN_ID}`.slice(0, 14), ctx.team.id, ctx.p2.userId, `WH2-${RUN_ID}`.slice(0, 14)],
  )).rows.map((x) => x.id);
  hit = await waitFor('certificate.issued', () => ctx.A.of('certificate.issued', (b) => b.event.id === ctx.ev.id)[0]);
  assertEnvelope(hit, { type: 'certificate.issued', ...ids });
  assert.deepEqual(hit.body.data.certificates.map((c) => c.id), certs, 'issued together, delivered together');
  assert.equal(hit.body.data.certificates[0].kind, 'winner');
  assert.equal(hit.body.data.certificates[0].recipient.name, 'Person wh-p1');
  assert.match(hit.body.data.certificates[0].verify_url, /\/verify\/WH1-/);
  await sleep(2500);
  assert.equal(ctx.A.of('certificate.issued', (b) => b.event.id === ctx.ev.id).length, 1, 'one delivery, not one per certificate');
});

test("another organisation's events never reach this organisation's endpoints", async () => {
  let r = await ctx.other.session.post(BASE, { url: ctx.O.url, events: ['registration.created'] });
  assert.equal(r.status, 201, r.text);
  ctx.o = r.data.endpoint;
  ctx.secretO = r.data.secret;
  ctx.otherEv = await createEvent(ctx.other.session, 'WO');
  const p = await register(ctx.otherEv, 'wh-op');
  const hit = await waitFor('the other organisation\'s registration', () => ctx.O.of('registration.created', (b) => b.data.participant.id === p.participantId)[0]);
  assertEnvelope(hit, { type: 'registration.created', customerId: ctx.other.customerId, eventId: ctx.otherEv.id });
  assert.ok(signatureOk(ctx.secretO, hit));
  assert.ok(!signatureOk(ctx.secretA, hit), 'each endpoint signs with its own secret');
  await sleep(2500);
  assert.equal(ctx.A.got.filter((h) => h.body?.event?.id === ctx.otherEv.id).length, 0);
  assert.equal(ctx.O.got.filter((h) => h.body?.event?.id === ctx.ev.id).length, 0);
  assert.equal(ctx.O.of('event.published').length, 0, 'only what the endpoint asked for');

  // Their admin cannot reach ours, by id or by naming our organisation.
  const s = ctx.other.session;
  const tries = [
    s.patch(`${BASE}/${ctx.a.id}`, { active: false }),
    s.delete(`${BASE}/${ctx.a.id}`),
    s.post(`${BASE}/${ctx.a.id}/test`, {}),
    s.post(`${BASE}/${ctx.a.id}/rotate`, {}),
    s.get(`${BASE}/${ctx.a.id}/deliveries`),
  ];
  for (const t of await Promise.all(tries)) assert.equal(t.status, 404, t.text);
  const ours = (await dbQuery('SELECT id FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY id LIMIT 1', [ctx.a.id])).rows[0].id;
  r = await s.post(`${BASE}/${ctx.o.id}/deliveries/${ours}/redeliver`, {});
  assert.equal(r.status, 404, 'a delivery of another endpoint');
  r = await s.get(`${BASE}/${ctx.a.id}/deliveries?customerId=${ctx.biz.customerId}`);
  assert.equal(r.status, 403);
  assert.equal((await dbQuery('SELECT active FROM webhook_endpoints WHERE id = $1', [ctx.a.id])).rows[0].active, true);
});

test('a failed delivery is tried again a minute later, and then delivered', async () => {
  ctx.R = await receiver();
  let r = await ctx.biz.session.post(BASE, { url: ctx.R.url, events: ['registration.created'] });
  assert.equal(r.status, 201, r.text);
  const ep = r.data.endpoint;
  const secret = r.data.secret;
  ctx.R.replies.push(500);
  const p = await register(ctx.ev, 'wh-p3');
  const first = await waitFor('the first attempt', () => ctx.R.of('registration.created', (b) => b.data.participant.id === p.participantId)[0]);
  const d1 = await waitFor('the retry to be planned', async () => {
    const d = await deliveryFor(ep.id, first.body.id);
    return d && d.attempts === 1 ? d : null;
  });
  assert.equal(d1.status, 'pending');
  assert.equal(d1.last_status_code, 500);
  assert.equal(d1.last_error, 'HTTP 500');
  const wait = (new Date(d1.next_attempt_at).getTime() - first.at) / 1000;
  assert.ok(wait > 45 && wait < 75, `the next attempt about a minute later (${wait} s)`);
  r = await ctx.biz.session.get(`${BASE}/${ep.id}/deliveries`);
  assert.equal(r.data.items[0].status, 'pending');
  assert.ok(r.data.items[0].nextAttemptAt);
  assert.equal((await ctx.biz.session.get(BASE)).data.endpoints.find((e) => e.id === ep.id).lastDeliveryStatus, 'retrying');

  await fastForward(d1.id);
  const second = await waitFor('the second attempt', () => ctx.R.of('registration.created', (b) => b.data.participant.id === p.participantId)[1]);
  assert.equal(second.headers['x-hackos-delivery'], first.headers['x-hackos-delivery'], 'the same delivery');
  assert.equal(second.body.id, first.body.id);
  assert.equal(second.raw, first.raw, 'the same payload');
  assert.ok(signatureOk(secret, first) && signatureOk(secret, second));
  const d2 = await waitFor('delivered', async () => {
    const d = await delivery(d1.id);
    return d.status === 'delivered' ? d : null;
  });
  assert.equal(d2.attempts, 2);
  assert.equal(d2.last_status_code, 200);
  assert.equal(d2.next_attempt_at, null);
  ctx.r = ep;
});

test('an endpoint that keeps failing is switched off, and the owner and admins are told', async () => {
  ctx.F = await receiver();
  ctx.F.always = 500;
  let r = await ctx.biz.session.post(BASE, { url: ctx.F.url, events: ['registration.created'], description: 'Flaky' });
  assert.equal(r.status, 201, r.text);
  const ep = r.data.endpoint;
  // Four deliveries in a row have already used up their attempts.
  await dbQuery('UPDATE webhook_endpoints SET consecutive_failures = 4 WHERE id = $1', [ep.id]);
  const p = await register(ctx.ev, 'wh-p4');
  const first = await waitFor('the first attempt', () => ctx.F.of('registration.created', (b) => b.data.participant.id === p.participantId)[0]);
  const d = await waitFor('the retry to be planned', async () => {
    const x = await deliveryFor(ep.id, first.body.id);
    return x && x.attempts === 1 ? x : null;
  });
  // Skip to the last attempt.
  await dbQuery('UPDATE webhook_deliveries SET max_attempts = 2 WHERE id = $1', [d.id]);
  await fastForward(d.id);
  const failed = await waitFor('the delivery to fail', async () => {
    const x = await delivery(d.id);
    return x.status === 'failed' ? x : null;
  });
  assert.equal(failed.attempts, 2);
  const off = await waitFor('the endpoint to be switched off', async () => {
    const list = await ctx.biz.session.get(BASE);
    const e = list.data.endpoints.find((x) => x.id === ep.id);
    return e && !e.active ? e : null;
  });
  assert.equal(off.disabledReason, 'failing');
  assert.equal(off.consecutiveFailures, 5);
  assert.ok(off.disabledAt);

  for (const s of [ctx.biz.session, ctx.admin.s]) {
    // eslint-disable-next-line no-await-in-loop
    const n = await s.get('/api/me/notifications');
    const notice = n.data.items.find((x) => x.kind === 'webhook.disabled' && x.data.endpointId === ep.id);
    assert.ok(notice, 'told in the notification centre');
    assert.equal(notice.target, 'webhooks');
    assert.equal(notice.data.host, new URL(ctx.F.url).host);
    assert.ok(!JSON.stringify(notice).includes('/hook/'), 'the host, not the URL');
  }
  const organiserNotices = await ctx.organizer.s.get('/api/me/notifications');
  assert.ok(!organiserNotices.data.items.some((x) => x.kind === 'webhook.disabled'), 'organisers are not told');

  // Switched off: nothing more is sent to it.
  const hits = ctx.F.got.length;
  const p5 = await register(ctx.ev, 'wh-p5');
  await waitFor('the registration at the other endpoint', () => ctx.A.of('registration.created', (b) => b.data.participant.id === p5.participantId)[0]);
  await sleep(2500);
  assert.equal(ctx.F.got.length, hits);

  // Switched back on: a fresh start.
  r = await ctx.biz.session.patch(`${BASE}/${ep.id}`, { active: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.endpoint.active, true);
  assert.equal(r.data.endpoint.consecutiveFailures, 0);
  assert.equal(r.data.endpoint.disabledReason, null);
  ctx.f = ep;
});

test('a test or a redelivery is tried once and never counts toward switching off', async () => {
  const r = await ctx.biz.session.post(`${BASE}/${ctx.f.id}/test`, {});
  assert.equal(r.status, 202, r.text);
  const d = await waitFor('the failed ping', async () => {
    const x = await delivery(r.data.delivery.id);
    return x.status === 'failed' ? x : null;
  });
  assert.equal(d.attempts, 1);
  assert.equal(d.last_status_code, 500);
  const e = (await dbQuery('SELECT consecutive_failures, active FROM webhook_endpoints WHERE id = $1', [ctx.f.id])).rows[0];
  assert.equal(e.consecutive_failures, 0);
  assert.equal(e.active, true);
});

test('a delivery can be sent again: same payload, a new delivery id', async () => {
  const original = await deliveryFor(ctx.a.id, ctx.approvedHit.body.id);
  assert.equal(original.status, 'delivered');
  let r = await ctx.biz.session.post(`${BASE}/${ctx.a.id}/deliveries/${original.id}/redeliver`, {});
  assert.equal(r.status, 202, r.text);
  assert.equal(r.data.delivery.redeliveryOf, Number(original.id));
  assert.equal(r.data.delivery.maxAttempts, 1);
  const again = await waitFor('the redelivery', () => ctx.A.got.find((h) => h.headers['x-hackos-delivery'] === r.data.delivery.deliveryId));
  assert.equal(again.body.id, ctx.approvedHit.body.id, 'receivers can tell it is the same event');
  assert.notEqual(again.headers['x-hackos-delivery'], ctx.approvedHit.headers['x-hackos-delivery']);
  assert.equal(JSON.stringify(again.body), JSON.stringify(ctx.approvedHit.body));
  assert.ok(signatureOk(ctx.secretA, again));

  await dbQuery("UPDATE webhook_deliveries SET status = 'pending' WHERE id = $1", [original.id]);
  try {
    r = await ctx.biz.session.post(`${BASE}/${ctx.a.id}/deliveries/${original.id}/redeliver`, {});
    assert.equal(r.status, 409, r.text);
    assert.equal(r.json.code, 'DELIVERY_PENDING');
  } finally {
    await dbQuery("UPDATE webhook_deliveries SET status = 'delivered' WHERE id = $1", [original.id]);
  }
  r = await ctx.biz.session.post(`${BASE}/${ctx.a.id}/deliveries/999999999/redeliver`, {});
  assert.equal(r.status, 404);
});

test('redirects are not followed and a receiver that does not answer times out', async () => {
  ctx.X = await receiver();
  let r = await ctx.biz.session.post(BASE, { url: ctx.X.url, events: ['team.created'] });
  assert.equal(r.status, 201, r.text);
  ctx.x = r.data.endpoint;
  ctx.X.replies.push(302);
  r = await ctx.biz.session.post(`${BASE}/${ctx.x.id}/test`, {});
  let d = await waitFor('the redirected ping', async () => {
    const x = await delivery(r.data.delivery.id);
    return x.status === 'failed' ? x : null;
  });
  assert.equal(d.last_status_code, 302);
  assert.match(d.last_error, /redirects are not followed/);
  await sleep(500);
  assert.deepEqual(ctx.X.got.map((h) => h.path), ['/hook/'], 'the Location was not visited');

  ctx.X.replies.push('hang');
  r = await ctx.biz.session.post(`${BASE}/${ctx.x.id}/test`, {});
  d = await waitFor('the timeout', async () => {
    const x = await delivery(r.data.delivery.id);
    return x.status === 'failed' ? x : null;
  }, 30000);
  assert.match(d.last_error, /No answer within 10 s/);
  assert.ok(d.last_duration_ms >= 9500 && d.last_duration_ms < 15000, `${d.last_duration_ms} ms`);
});

test('where an endpoint points is checked again when each delivery is sent', async () => {
  // As if its host had started pointing at the metadata service since it was saved.
  await dbQuery("UPDATE webhook_endpoints SET url = 'http://169.254.169.254/latest/meta-data/' WHERE id = $1", [ctx.x.id]);
  const before = ctx.X.got.length;
  const r = await ctx.biz.session.post(`${BASE}/${ctx.x.id}/test`, {});
  assert.equal(r.status, 202, r.text);
  const d = await waitFor('the refused ping', async () => {
    const x = await delivery(r.data.delivery.id);
    return x.status === 'failed' ? x : null;
  });
  assert.match(d.last_error, /link-local/);
  assert.equal(d.last_status_code, null, 'no request was made');
  assert.equal(ctx.X.got.length, before);
});

test('rotating the secret: the new one signs from then on, the old one no longer does', async () => {
  const r = await ctx.biz.session.post(`${BASE}/${ctx.a.id}/rotate`, {});
  assert.equal(r.status, 200, r.text);
  assert.match(r.data.secret, /^whsec_/);
  assert.notEqual(r.data.secret, ctx.secretA);
  assert.ok(r.data.endpoint.secretRotatedAt);
  const old = ctx.secretA;
  ctx.secretA = r.data.secret;
  const t = await ctx.biz.session.post(`${BASE}/${ctx.a.id}/test`, {});
  const hit = await waitFor('the ping', () => ctx.A.got.find((h) => h.headers['x-hackos-delivery'] === t.data.delivery.deliveryId));
  assert.ok(signatureOk(ctx.secretA, hit));
  assert.ok(!signatureOk(old, hit));
  assert.ok(!(await ctx.biz.session.get(BASE)).text.includes(ctx.secretA));
});

test('editing, switching off and deleting an endpoint', async () => {
  let r = await ctx.biz.session.patch(`${BASE}/${ctx.a.id}`, { events: ['participant.approved', 'registration.created', 'registration.created'] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.endpoint.events, ['registration.created', 'participant.approved'], 'in the documented order, once each');
  assert.deepEqual(r.data.changed, ['events']);
  // Saving what is already there changes nothing, and the audit log says nothing.
  const audits = async () => (await dbQuery(
    "SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'webhook.update' AND target_id = $1", [String(ctx.a.id)],
  )).rows[0].n;
  const before = await audits();
  r = await ctx.biz.session.patch(`${BASE}/${ctx.a.id}`, {
    url: ctx.A.url, events: ['registration.created', 'participant.approved'], description: r.data.endpoint.description, active: true,
  });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.changed, []);
  await sleep(300);
  assert.equal(await audits(), before);
  r = await ctx.biz.session.patch(`${BASE}/${ctx.a.id}`, { url: 'http://169.254.169.254/' });
  assert.equal(r.status, 400, 'the same checks as when it was created');
  r = await ctx.biz.session.patch(`${BASE}/${ctx.a.id}`, { active: 'no' });
  assert.equal(r.status, 400);
  r = await ctx.biz.session.patch(`${BASE}/${ctx.a.id}`, { active: false });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.endpoint.active, false);
  assert.equal(r.data.endpoint.disabledReason, 'manual');

  const hits = ctx.A.got.length;
  const p = await register(ctx.ev, 'wh-p6');
  await waitFor('the registration at the endpoint still on', () => ctx.R.of('registration.created', (b) => b.data.participant.id === p.participantId)[0]);
  await sleep(2500);
  assert.equal(ctx.A.got.length, hits, 'nothing for an endpoint that is off');
  r = await ctx.biz.session.patch(`${BASE}/${ctx.a.id}`, { active: true });
  assert.equal(r.data.endpoint.active, true);

  r = await ctx.organizer.s.delete(`${BASE}/${ctx.x.id}`);
  assert.equal(r.status, 403);
  r = await ctx.admin.s.delete(`${BASE}/${ctx.x.id}`);
  assert.equal(r.status, 200, r.text);
  r = await ctx.biz.session.get(BASE);
  assert.ok(!r.data.endpoints.some((e) => e.id === ctx.x.id));
  r = await ctx.biz.session.get(`${BASE}/${ctx.x.id}/deliveries`);
  assert.equal(r.status, 404);
  assert.equal((await dbQuery('SELECT COUNT(*)::int AS n FROM webhook_deliveries WHERE endpoint_id = $1', [ctx.x.id])).rows[0].n, 0);
});

test('at most ten endpoints per organisation', async () => {
  const have = (await dbQuery('SELECT COUNT(*)::int AS n FROM webhook_endpoints WHERE customer_id = $1', [ctx.other.customerId])).rows[0].n;
  for (let i = have; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await dbQuery(
      "INSERT INTO webhook_endpoints (customer_id, url, url_host, events, secret, active) VALUES ($1, $2, '127.0.0.1', '{ping}', 'x', false)",
      [ctx.other.customerId, `${ctx.O.url}${i}`],
    );
  }
  const r = await ctx.other.session.post(BASE, { url: ctx.O.url, events: ['*'] });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'TOO_MANY_ENDPOINTS');
});

test('the delivery log pages back from the newest', async () => {
  const all = (await dbQuery('SELECT id FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY id DESC', [ctx.a.id])).rows.map((x) => Number(x.id));
  assert.ok(all.length >= 8, `${all.length} deliveries`);
  const seen = [];
  let before = null;
  for (let page = 0; page < 20; page += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await ctx.biz.session.get(`${BASE}/${ctx.a.id}/deliveries?limit=3${before ? `&before=${before}` : ''}`);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.data.items.length <= 3);
    seen.push(...r.data.items.map((x) => x.id));
    before = r.data.nextBefore;
    if (!before) break;
  }
  assert.deepEqual(seen, all, 'every delivery once, newest first');
  const one = (await ctx.biz.session.get(`${BASE}/${ctx.a.id}/deliveries?limit=1`)).data.items[0];
  assert.deepEqual(Object.keys(one.payload).sort(), ['created_at', 'data', 'event', 'id', 'organisation_id', 'type']);
});

test('the audit log records each change with the host, never the URL or the secret', async () => {
  const rows = (await dbQuery(
    `SELECT action, target_type, target_id, meta::text AS meta FROM audit_log
      WHERE customer_id = $1 AND action LIKE 'webhook.%' ORDER BY id`,
    [ctx.biz.customerId],
  )).rows;
  const actions = new Set(rows.map((x) => x.action));
  for (const a of ['webhook.create', 'webhook.update', 'webhook.delete', 'webhook.rotate_secret']) {
    assert.ok(actions.has(a), `${a} is recorded`);
  }
  for (const row of rows) {
    assert.equal(row.target_type, 'webhook_endpoint');
    assert.doesNotMatch(row.meta, /whsec_|\/hook\//, 'no secret, no URL');
  }
  const created = rows.find((x) => x.action === 'webhook.create' && Number(x.target_id) === ctx.a.id);
  assert.match(created.meta, /127\.0\.0\.1/);
});

test('housekeeping: the worker is still healthy after all of it', async () => {
  const stuck = (await dbQuery(
    "SELECT COUNT(*)::int AS n FROM webhook_deliveries WHERE customer_id = $1 AND status = 'pending' AND locked_at IS NOT NULL AND locked_at < now() - interval '1 minute'",
    [ctx.biz.customerId],
  )).rows[0].n;
  assert.equal(stuck, 0);
  const left = (await dbQuery(
    "SELECT COUNT(*)::int AS n FROM webhook_outbox WHERE customer_id = $1 AND processed_at IS NULL AND created_at < now() - interval '30 seconds'",
    [ctx.biz.customerId],
  )).rows[0].n;
  assert.equal(left, 0, 'the outbox drains');
});
