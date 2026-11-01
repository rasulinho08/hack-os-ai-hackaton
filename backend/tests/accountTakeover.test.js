/**
 * Regression: an organiser could take over any account on the platform.
 *
 * Adding an existing account to an event as a judge needs only its e-mail
 * and no consent; the account then counted as "in the organiser's event",
 * and that was enough to set its password, change its role, edit or delete
 * it — even for another organisation's administrator. Appearing in an event
 * is no longer authority over an account, and the organiser sees only the
 * account's name and contact, not the profile it filled in elsewhere.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, PASSWORD } = require('./helpers');
const { dbQuery, approvedBuyer, ownerSession } = require('./fixtures');

const ctx = {};

test('setup: two organisations, one event, the other\'s admin added as a judge', async () => {
  ctx.a = await approvedBuyer('at-orga');
  ctx.b = await approvedBuyer('at-orgb');
  ctx.bId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email('at-orgb')])).rows[0].id;
  await dbQuery("UPDATE users SET phone = '+994501112233', age = 31 WHERE id = $1", [ctx.bId]);
  const r = await ctx.a.session.post('/api/events/drafts', { template: 'blank', name: `Takeover ${RUN_ID}` });
  assert.ok([200, 201].includes(r.status), r.text);
  ctx.eventId = r.data.id || r.data.event?.id;
  assert.ok(ctx.eventId, r.text);
  await ctx.a.session.patch(`/api/events/${ctx.eventId}/builder`, {
    start_date: iso(3 * DAY), end_date: iso(4 * DAY),
  });
  const add = await ctx.a.session.post(`/api/events/${ctx.eventId}/judging/judges`, { email: email('at-orgb') });
  assert.ok([200, 201].includes(add.status), add.text);
});

test('the organiser cannot set the password, role, profile or delete the account', async () => {
  const { a, bId } = ctx;
  let r = await a.session.patch(`/api/users/${bId}/password`, { password: 'Pwned12345' });
  assert.equal(r.status, 404, r.text);
  r = await a.session.patch(`/api/users/${bId}/role`, { role: 'hacker' });
  assert.equal(r.status, 404, r.text);
  r = await a.session.patch(`/api/users/${bId}`, { full_name: 'Taken Over' });
  assert.equal(r.status, 404, r.text);
  r = await a.session.delete(`/api/users/${bId}`);
  assert.equal(r.status, 404, r.text);

  const row = (await dbQuery('SELECT full_name, role FROM users WHERE id = $1', [bId])).rows[0];
  assert.notEqual(row.full_name, 'Taken Over');
  assert.notEqual(row.role, 'hacker');
  // The real owner of the account still signs in with their own password.
  const again = new Session('at-orgb-again');
  await again.login(email('at-orgb'), PASSWORD);
  assert.ok(again.cookies.size > 0);
});

test('the organiser sees the judge\'s name and contact, not their profile', async () => {
  const r = await ctx.a.session.get(`/api/users/${ctx.bId}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.email.toLowerCase(), email('at-orgb').toLowerCase());
  assert.equal(r.data.phone, undefined);
  assert.equal(r.data.age, undefined);
});

test('the platform owner and the person themselves still can', async () => {
  const owner = await ownerSession();
  let r = await owner.get(`/api/users/${ctx.bId}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.phone, '+994501112233', 'the owner sees the whole profile');
  r = await ctx.b.session.patch(`/api/users/${ctx.bId}`, { full_name: `Org B Admin ${RUN_ID}` });
  assert.equal(r.status, 200, r.text);
  r = await ctx.b.session.get(`/api/users/${ctx.bId}`);
  assert.equal(r.data.phone, '+994501112233', 'a person sees their own profile');
});
