/**
 * What a visitor without an account, a participant, or another organisation
 * can read about an event that is not theirs (Phase 8 security review):
 * an event's sponsor list and its plan modules were answered to anyone who
 * guessed an event id, drafts and other customers' events included.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { approvedBuyer } = require('./fixtures');
const { isDevLike } = require('../src/utils/runtimeEnv');

const ctx = {};

test('setup: an organisation with a draft event and a sponsor, another organisation, a participant', async () => {
  ctx.org = await approvedBuyer('ex-org', { plan: 'business' });
  let r = await ctx.org.session.post('/api/events', {
    event_code: `EX${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    name: `Exposure ${RUN_ID}`,
    registration_start: iso(DAY), registration_end: iso(5 * DAY), start_date: iso(6 * DAY), end_date: iso(7 * DAY),
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await ctx.org.session.post(`/api/events/${ctx.ev.id}/sponsors`, { name: 'Unannounced Sponsor', website: 'https://example.com', tier: 'gold' });
  assert.equal(r.status, 201, r.text);
  ctx.other = await approvedBuyer('ex-other', { plan: 'business' });
  ctx.hacker = new Session('ex-hacker');
  await ctx.hacker.register({ fullName: 'Curious Participant', email: email('ex-hacker') });
  ctx.anon = new Session('ex-anon');
});

test("an event's sponsors: its organisers only", async () => {
  const path = `/api/events/${ctx.ev.id}/sponsors`;
  let r = await ctx.anon.get(path);
  assert.equal(r.status, 401, r.text);
  assert.ok(!r.text.includes('Unannounced Sponsor'));
  r = await ctx.hacker.get(path);
  assert.equal(r.status, 403, r.text);
  r = await ctx.other.session.get(path);
  assert.equal(r.status, 404, r.text);
  assert.ok(!r.text.includes('Unannounced Sponsor'));
  r = await ctx.org.session.get(path);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.map((s) => s.name), ['Unannounced Sponsor']);
});

test("an event's plan and limits: signed-in people only, never another organisation", async () => {
  const path = `/api/events/${ctx.ev.id}/modules`;
  let r = await ctx.anon.get(path);
  assert.equal(r.status, 401, r.text);
  assert.ok(!/"plan"/.test(r.text));
  r = await ctx.other.session.get(path);
  assert.equal(r.status, 404, r.text);
  r = await ctx.org.session.get(path);
  assert.equal(r.status, 200, r.text);
  assert.ok(Array.isArray(r.data.modules));
});

test('debug conveniences need an explicit development or test NODE_ENV', () => {
  const before = process.env.NODE_ENV;
  try {
    for (const [value, expected] of [[undefined, false], ['', false], ['production', false], ['staging', false],
      ['development', true], ['test', true], [' Development ', true]]) {
      if (value === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = value;
      assert.equal(isDevLike(), expected, `NODE_ENV=${JSON.stringify(value)}`);
    }
  } finally {
    if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before;
  }
});
