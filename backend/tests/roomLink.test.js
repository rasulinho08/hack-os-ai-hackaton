/**
 * The online room link is sealed in the database (AES-256-GCM) and opened
 * only where the event's own people see it. Needs DATA_ENCRYPTION_KEY, the
 * same value the API runs with.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, confirmEmail } = require('./helpers');
const { dbQuery } = require('./fixtures');

const skip = !process.env.DATA_ENCRYPTION_KEY && 'run with DATA_ENCRYPTION_KEY (the API\'s key)';
const ROOM = `https://meet.example/room-${RUN_ID}?pwd=secret`;
const admin = new Session('rl-admin');
const ctx = {};

async function participant(tag, approve) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ctx.ev.slug}/register`, {
    account: { fullName: `Person ${tag}`, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  await confirmEmail(email(tag));
  if (approve) {
    const uid = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(tag)])).rows[0].id;
    const pid = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, uid])).rows[0].id;
    assert.equal((await admin.patch(`/api/events/${ctx.ev.id}/participants/${pid}`, { status: 'approved' })).status, 200);
  }
  await s.login(email(tag));
  return s;
}

test('the room link is sealed at rest and opened for the event\'s own people', { skip }, async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  let r = await admin.post('/api/events', {
    event_code: `RL${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Room ${RUN_ID}`,
    registration_start: iso(-DAY), registration_end: iso(DAY), start_date: iso(2 * DAY), end_date: iso(3 * DAY), is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { format: 'online', online_url: ROOM });
  assert.equal(r.status, 200, r.text);

  const raw = (await dbQuery('SELECT online_url FROM events WHERE id = $1', [ctx.ev.id])).rows[0].online_url;
  assert.match(raw, /^enc:v1:/, 'sealed in the database');
  assert.ok(!raw.includes('secret') && !raw.includes('meet.example'));

  r = await admin.get(`/api/events/${ctx.ev.id}/builder`);
  assert.equal(r.data.event.online_url, ROOM, 'the organiser edits the plain link');
  r = await admin.get(`/api/events/${ctx.ev.id}`);
  assert.equal(r.data.online_url, ROOM);

  const inside = await participant('rl-in', true);
  r = await inside.get(`/api/events/${ctx.ev.id}`);
  assert.equal(r.data.online_url, ROOM, 'an admitted participant gets the plain link');
  const waiting = await participant('rl-wait', false);
  r = await waiting.get(`/api/events/${ctx.ev.id}`);
  assert.equal(r.data.online_url, undefined, 'not yet admitted: no link at all');

  const feed = new URL((await inside.get('/api/me/calendar')).data.url).pathname;
  const ics = (await new Session('cal').download(feed)).body.toString('utf8').replace(/\r\n /g, '');
  assert.ok(ics.includes(ROOM.replace(/,/g, '\\,')), 'the calendar shows the plain link');
  assert.ok(!ics.includes('enc:v1:'));

  // Saving the builder again keeps it sealed (with a fresh IV).
  await admin.patch(`/api/events/${ctx.ev.id}/builder`, { online_url: ROOM });
  const again = (await dbQuery('SELECT online_url FROM events WHERE id = $1', [ctx.ev.id])).rows[0].online_url;
  assert.match(again, /^enc:v1:/);
  assert.notEqual(again, raw);
});
