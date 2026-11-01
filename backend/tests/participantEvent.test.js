/**
 * A participant in two events acts in the event they chose, end to end
 * against a running API.
 *
 * The person is approved in one hackathon (with a team they lead) and
 * pending in another that started earlier and ends later (with a team of
 * their own there too). Covers: the workspace they entered (the hh_event
 * cookie) decides their event, team, submission rules, project, help
 * requests and progress; an event they are not registered for is refused
 * when named and ignored when only the cookie says so; their approval status
 * is the one of the event they work in, and without a choice it is the
 * event they were admitted to, never "pending" from the other one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, confirmEmail } = require('./helpers');
const { dbQuery } = require('./fixtures');

const HOUR = 3600e3;
const admin = new Session('pe-admin');
const ctx = {};

async function newEvent(tag) {
  const r = await admin.post('/api/events', {
    event_code: `PE${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    name: `Two events ${tag} ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  return r.data;
}

const solo = { entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true } };
const pidOf = async (eventId, userId) => (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [eventId, userId])).rows[0].id;

/** The same browser, with the workspace picker's choice (or none). */
function inEvent(eventId) {
  if (eventId == null) ctx.h.cookies.delete('hh_event');
  else ctx.h.cookies.set('hh_event', String(eventId));
  return ctx.h;
}

test('setup: approved with a team in one event, pending with a team in another', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  ctx.e1 = await newEvent('A');
  ctx.e2 = await newEvent('B');
  ctx.e3 = await newEvent('C');

  ctx.h = new Session('pe-h');
  let r = await ctx.h.post(`/api/public/events/${ctx.e1.slug}/register`, {
    ...solo, account: { fullName: 'Two Events', email: email('pe-h'), password: 'Test1234!' },
  });
  assert.equal(r.status, 201, r.text);
  await confirmEmail(email('pe-h'));
  await ctx.h.login(email('pe-h'));
  ctx.userId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email('pe-h')])).rows[0].id;
  r = await admin.patch(`/api/events/${ctx.e1.id}/participants/${await pidOf(ctx.e1.id, ctx.userId)}`, { status: 'approved' });
  assert.equal(r.status, 200, r.text);

  // Signed in, they register for the second hackathon from its page: pending there.
  r = await ctx.h.post(`/api/public/events/${ctx.e2.slug}/register`, solo);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.status, 'pending');

  for (const [key, ev] of [['t1', ctx.e1], ['t2', ctx.e2]]) {
    // eslint-disable-next-line no-await-in-loop
    r = await admin.post('/api/teams', { eventId: ev.id, name: `Team ${key} ${RUN_ID}`, memberIds: [ctx.userId], leaderId: ctx.userId });
    assert.equal(r.status, 201, r.text);
    ctx[key] = r.data.id;
  }
  // Both run now; the pending one started earlier and ends later.
  await dbQuery('UPDATE events SET start_date = $2, end_date = $3, submission_deadline = NULL WHERE id = $1', [ctx.e1.id, iso(-HOUR), iso(DAY)]);
  await dbQuery('UPDATE events SET start_date = $2, end_date = $3, submission_deadline = NULL WHERE id = $1', [ctx.e2.id, iso(-3 * HOUR), iso(2 * DAY)]);
});

test('the workspace they entered decides the event, the team and the rules', async () => {
  const h = inEvent(ctx.e1.id);
  let r = await h.get('/api/events/active');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.id, ctx.e1.id);
  r = await h.get('/api/teams/mine');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.id, ctx.t1, 'their team in the chosen event, not the other one');
  r = await h.get('/api/submissions/rules');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.eventId, ctx.e1.id);
  r = await h.get('/api/me/event-progress');
  assert.equal(r.status, 200, r.text);
  assert.equal(Number(r.data.event?.id ?? r.data.eventId), ctx.e1.id);

  r = await inEvent(ctx.e2.id).get('/api/teams/mine');
  assert.equal(r.data.id, ctx.t2, 'and the other team when they enter the other event');
});

test('a project and a help request land in the chosen event', async () => {
  const h = inEvent(ctx.e1.id);
  let r = await h.post('/api/submissions', { projectName: 'Chosen', description: 'x', repoLink: `https://github.com/pe/a${RUN_ID}` });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.event_id, ctx.e1.id);
  assert.equal(r.data.team_id, ctx.t1);
  const inOther = await dbQuery('SELECT 1 FROM submissions WHERE event_id = $1', [ctx.e2.id]);
  assert.equal(inOther.rowCount, 0, 'nothing handed in to the other event');

  r = await h.post('/api/tickets', { topic: 'Wi-Fi', description: 'It drops' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.event_id, ctx.e1.id);
});

test('an event they are not registered for: refused when named, ignored as a stale choice', async () => {
  let r = await inEvent(ctx.e1.id).post('/api/tickets', { eventId: ctx.e3.id, topic: 'Hi', description: 'Not mine' });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'NOT_PARTICIPANT');
  r = await inEvent(ctx.e1.id).post('/api/submissions', { eventId: ctx.e3.id, projectName: 'Elsewhere', description: 'x', repoLink: `https://github.com/pe/c${RUN_ID}` });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'NOT_PARTICIPANT');
  r = await inEvent(ctx.e1.id).get(`/api/teams/mine?eventId=${ctx.e3.id}`);
  assert.equal(r.data, null);

  // A workspace cookie for an event they have no part in: their default event.
  r = await inEvent(ctx.e3.id).get('/api/events/active');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.id, ctx.e1.id, 'the event they were admitted to');
});

test('the approval status is per event: approved here, pending there', async () => {
  let r = await inEvent(ctx.e1.id).get('/api/auth/me');
  assert.equal(r.data.status, 'approved');
  r = await inEvent(ctx.e2.id).get('/api/auth/me');
  assert.equal(r.data.status, 'pending');
  // No workspace chosen (a link from an e-mail, a new browser): not locked out.
  r = await inEvent(null).get('/api/auth/me');
  assert.equal(r.data.status, 'approved', 'the pending registration elsewhere does not lock them out');
  r = await inEvent(null).get('/api/events/active');
  assert.equal(r.data.id, ctx.e1.id, 'the same event their pages fall back to');
  const fresh = new Session('pe-h2');
  r = await fresh.post('/api/auth/login', { email: email('pe-h'), password: 'Test1234!' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'approved');
});
