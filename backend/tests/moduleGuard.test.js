/**
 * The plan guard on routes not keyed by :eventId (POST /api/tickets,
 * POST /api/announcements): it must check the event the action lands on.
 * It used to read ?eventId= first while the controllers read the body, so
 * naming any event with the feature in the query opened it for an event
 * whose plan lacks it; and a help request naming no event went to the
 * participant's own event without any plan check.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { approvedBuyer, dbQuery } = require('./fixtures');

const ctx = {};
const code = (tag) => `${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
const ticket = (extra = {}) => ({ topic: 'Stuck on auth', description: 'Login loops back', ...extra });

test('setup: a Starter event (no mentors) with a participant, a Business event (mentors)', async () => {
  ctx.starter = await approvedBuyer('mg-starter', { plan: 'starter' });
  let r = await ctx.starter.session.post('/api/events', {
    event_code: code('MGS'), name: `Guard Starter ${RUN_ID}`, is_published: true,
    registration_start: iso(-1 * DAY), registration_end: iso(3 * DAY), start_date: iso(4 * DAY), end_date: iso(5 * DAY),
  });
  assert.equal(r.status, 201, r.text);
  ctx.s = r.data;
  ctx.business = await approvedBuyer('mg-business', { plan: 'business' });
  r = await ctx.business.session.post('/api/events', {
    event_code: code('MGB'), name: `Guard Business ${RUN_ID}`,
    registration_start: iso(DAY), registration_end: iso(3 * DAY), start_date: iso(4 * DAY), end_date: iso(5 * DAY),
  });
  assert.equal(r.status, 201, r.text);
  ctx.b = r.data;
  ctx.hacker = new Session('mg-hacker');
  await ctx.hacker.register({ fullName: 'Guard Participant', email: email('mg-hacker'), eventCode: ctx.s.event_code });
});

test('a help request in the Starter event is refused by its plan', async () => {
  const r = await ctx.hacker.post('/api/tickets', ticket({ eventId: ctx.s.id }));
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'MODULE_DISABLED');
});

test('naming a Business event in the query does not open it for the Starter event', async () => {
  const r = await ctx.hacker.post(`/api/tickets?eventId=${ctx.b.id}`, ticket({ eventId: ctx.s.id }));
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'EVENT_MISMATCH');
});

test('a help request naming no event is checked against the event it lands on', async () => {
  let r = await ctx.hacker.post('/api/tickets', ticket());
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'MODULE_DISABLED');
  r = await dbQuery('SELECT COUNT(*)::int AS n FROM help_tickets WHERE event_id = $1', [ctx.s.id]);
  assert.equal(r.rows[0].n, 0, 'no request was saved in the Starter event');
});

test('an announcement naming two different events is refused', async () => {
  const r = await ctx.starter.session.post(`/api/announcements?eventId=${ctx.b.id}`, {
    eventId: ctx.s.id, title: 'Doors open', content: 'Welcome', channels: ['platform'],
  });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'EVENT_MISMATCH');
});
