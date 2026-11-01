/**
 * Check-in at the door (Phase 8): accepted participants have a ticket code
 * (shown as a QR code); the organisers and the event's volunteers scan it,
 * the organisers check people in by hand, undo it, and download the list.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, confirmEmail } = require('./helpers');
const { dbQuery, approvedBuyer } = require('./fixtures');
const { parseScan, generateCode, ALPHABET } = require('../src/services/checkin.service');

const admin = new Session('ci-admin');
const ctx = {};
const base = (id = ctx.ev.id) => `/api/events/${id}/checkin`;

async function createEvent(s, tag, extra = {}) {
  const r = await s.post('/api/events', {
    event_code: `${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Check-in ${tag} ${RUN_ID}`,
    registration_start: iso(-DAY), registration_end: iso(2 * DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    is_published: true, ...extra,
  });
  assert.equal(r.status, 201, r.text);
  const slug = (await dbQuery('SELECT slug FROM events WHERE id = $1', [r.data.id])).rows[0].slug;
  return { ...r.data, slug };
}

async function participant(ev, tag, { approve = true, by = admin } = {}) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: `Person ${tag}`, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  await confirmEmail(email(tag));
  const userId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(tag)])).rows[0].id;
  const pid = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ev.id, userId])).rows[0].id;
  if (approve) {
    const a = await by.patch(`/api/events/${ev.id}/participants/${pid}`, { status: 'approved' });
    assert.equal(a.status, 200, a.text);
  }
  await s.login(email(tag));
  return { s, userId, pid, mail: email(tag) };
}

async function staff(ev, tag, role) {
  const r = await admin.post(`/api/events/${ev.id}/invites`, { email: email(tag), role });
  assert.ok([200, 201].includes(r.status), r.text);
  const s = new Session(tag);
  await s.register({ fullName: `Staff ${tag}`, email: email(tag), eventCode: ev.event_code });
  return s;
}

test('ticket codes: unambiguous alphabet; scans read typed codes and QR addresses', () => {
  assert.equal(/[01IO]/.test(ALPHABET), false);
  for (let i = 0; i < 200; i += 1) assert.match(generateCode(), /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
  assert.deepEqual(parseScan('abcd-efgh'), { code: 'ABCDEFGH', eventId: null });
  assert.deepEqual(parseScan(' ABCD EFGH '), { code: 'ABCDEFGH', eventId: null });
  assert.deepEqual(parseScan('https://app.hack-os.app/checkin/scan?e=42&c=ABCD-EFGH'), { code: 'ABCDEFGH', eventId: 42 });
  assert.deepEqual(parseScan('e=7&c=abcdefgh'), { code: 'ABCDEFGH', eventId: 7 });
  assert.equal(parseScan('ABC').code, null, 'too short');
  assert.equal(parseScan('ABCDEFG0').code, null, 'a zero is never in a code');
  assert.equal(parseScan('').code, null);
});

test('setup: an event, its people and staff, another organisation, a Starter event', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  ctx.ev = await createEvent(admin, 'CI');
  ctx.p1 = await participant(ctx.ev, 'ci-p1');
  ctx.p2 = await participant(ctx.ev, 'ci-p2');
  // p1 is in a team (membership is kept in team_members); p2 is on their own.
  ctx.teamName = `CI Crew ${RUN_ID}`;
  const team = await admin.post('/api/teams', { eventId: ctx.ev.id, name: ctx.teamName, memberIds: [ctx.p1.userId], leaderId: ctx.p1.userId });
  assert.equal(team.status, 201, team.text);
  ctx.pending = await participant(ctx.ev, 'ci-pend', { approve: false });
  ctx.vol = await staff(ctx.ev, 'ci-vol', 'volunteer');
  ctx.judge = await staff(ctx.ev, 'ci-judge', 'judge');
  ctx.mentor = await staff(ctx.ev, 'ci-mentor', 'mentor');
  ctx.other = await approvedBuyer('ci-other', { plan: 'business' });
  ctx.otherEv = await createEvent(ctx.other.session, 'CO');
  ctx.starter = await approvedBuyer('ci-starter');
  ctx.starterEv = await createEvent(ctx.starter.session, 'CS');
});

test('an accepted participant has a ticket; others do not', async () => {
  let r = await ctx.p1.s.get(`${base()}/me`);
  assert.equal(r.status, 200, r.text);
  assert.match(r.data.code, /^[23456789A-HJ-NP-Z]{8}$/);
  assert.equal(r.data.eventId, ctx.ev.id);
  assert.equal(r.data.name, 'Person ci-p1');
  assert.equal(r.data.team, ctx.teamName);
  assert.equal(r.data.checkedIn, false);
  ctx.code1 = r.data.code;
  r = await ctx.p1.s.get(`${base()}/me`);
  assert.equal(r.data.code, ctx.code1, 'the same code every time');
  ctx.code2 = (await ctx.p2.s.get(`${base()}/me`)).data.code;
  assert.notEqual(ctx.code2, ctx.code1);

  r = await ctx.pending.s.get(`${base()}/me`);
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'NOT_APPROVED');
  r = await ctx.judge.get(`${base()}/me`);
  assert.equal(r.status, 404, 'a judge is not registered as a participant');
  assert.equal(r.json.code, 'NOT_REGISTERED');
  assert.equal((await new Session('anon').get(`${base()}/me`)).status, 401);
});

test('only organisers and the event\'s volunteers scan', async () => {
  for (const [who, s] of [['participant', ctx.p2.s], ['judge', ctx.judge], ['mentor', ctx.mentor]]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await s.post(`${base()}/scan`, { code: ctx.code1 });
    assert.equal(r.status, 403, `${who}: ${r.text}`);
  }
  let r = await ctx.other.session.post(`${base()}/scan`, { code: ctx.code1 });
  assert.equal(r.status, 404, `another organisation: ${r.text}`);
  r = await new Session('anon').post(`${base()}/scan`, { code: ctx.code1 });
  assert.equal(r.status, 401);
  const still = await ctx.p1.s.get(`${base()}/me`);
  assert.equal(still.data.checkedIn, false, 'nobody got in by trying');
});

test('a volunteer scans a ticket; a second scan says when and by whom', async () => {
  let r = await ctx.vol.post(`${base()}/scan`, { code: `https://app.example/checkin/scan?e=${ctx.ev.id}&c=${ctx.code1.toLowerCase()}` });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.result, 'checked_in');
  assert.equal(r.data.participant.name, 'Person ci-p1');
  assert.equal(r.data.participant.team, ctx.teamName, 'the scanner shows the team');
  assert.equal(r.data.participant.checkedIn, true);
  assert.equal(r.data.participant.method, 'qr');
  assert.equal(r.data.participant.email, undefined, 'volunteers do not get e-mail addresses');

  r = await admin.post(`${base()}/scan`, { code: `${ctx.code1.slice(0, 4)}-${ctx.code1.slice(4)}` });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.result, 'already');
  assert.equal(r.data.participant.checkedInBy.name, 'Staff ci-vol');
  assert.ok(r.data.participant.checkedInAt);

  const mine = await ctx.p1.s.get(`${base()}/me`);
  assert.equal(mine.data.checkedIn, true, 'the participant sees it too');

  const log = await dbQuery("SELECT meta FROM audit_log WHERE action = 'event.checkin' AND event_id = $1 AND target_id = $2", [ctx.ev.id, String(ctx.p1.pid)]);
  assert.equal(log.rows.length, 1, 'one audit entry, for the first scan only');
  assert.equal(log.rows[0].meta.method, 'qr');
});

test('wrong codes: unknown, another event\'s, malformed, not accepted', async () => {
  let r = await ctx.vol.post(`${base()}/scan`, { code: 'ZZZZZZZZ' });
  assert.equal(r.status, 404, r.text);
  assert.equal(r.json.code, 'TICKET_NOT_FOUND');
  r = await ctx.vol.post(`${base()}/scan`, { code: `https://app.example/checkin/scan?e=${ctx.otherEv.id}&c=${ctx.code2}` });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'WRONG_EVENT');
  r = await ctx.vol.post(`${base()}/scan`, { code: ctx.code2, eventId: ctx.otherEv.id });
  assert.equal(r.json.code, 'WRONG_EVENT');
  r = await ctx.vol.post(`${base()}/scan`, { code: 'hello' });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'VALIDATION_ERROR');

  // Another organisation's ticket, typed without its event: unknown here.
  const there = await participant(ctx.otherEv, 'ci-other-p', { by: ctx.other.session });
  const theirs = await there.s.get(`${base(ctx.otherEv.id)}/me`);
  assert.equal(theirs.status, 200, theirs.text);
  r = await ctx.vol.post(`${base()}/scan`, { code: theirs.data.code });
  assert.equal(r.status, 404, r.text);
  assert.equal(r.json.code, 'TICKET_NOT_FOUND');
  r = await there.s.get(`${base()}/me`);
  assert.equal(r.status, 404, 'not one of this event\'s people');

  await dbQuery("UPDATE participants SET ticket_code = 'QQQQQQQQ' WHERE id = $1", [ctx.pending.pid]);
  r = await ctx.vol.post(`${base()}/scan`, { code: 'QQQQQQQQ' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.result, 'not_approved', 'shown, not let in');
  assert.equal(r.data.participant.status, 'pending');
  assert.equal(r.data.participant.checkedIn, false);
});

test('organisers: the list, counts, search, by hand, undo', async () => {
  let r = await ctx.vol.get(base());
  assert.equal(r.status, 403, 'the list is for organisers');
  r = await ctx.vol.get(`${base()}/stats`);
  assert.equal(r.status, 200, 'volunteers see the counts');
  assert.deepEqual({ ...r.data }, { admitted: 2, checkedIn: 1, remaining: 1, canManage: false });
  r = await ctx.judge.get(`${base()}/stats`);
  assert.equal(r.status, 403);

  r = await admin.get(base());
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.stats, { admitted: 2, checkedIn: 1, remaining: 1 });
  assert.equal(r.data.total, 2, 'accepted participants only');
  assert.equal(r.data.items[0].name, 'Person ci-p1', 'the latest check-ins first');
  assert.equal(r.data.items[0].email, ctx.p1.mail);
  assert.match(r.data.items[1].code, /^[23456789A-HJ-NP-Z]{8}$/);

  r = await admin.get(`${base()}?filter=out`);
  assert.deepEqual(r.data.items.map((i) => i.name), ['Person ci-p2']);
  r = await admin.get(`${base()}?filter=in&q=${encodeURIComponent('ci-p1')}`);
  assert.equal(r.data.total, 1);
  r = await admin.get(`${base()}?q=${encodeURIComponent('%')}`);
  assert.equal(r.data.total, 0, 'a % is searched as a character');
  r = await admin.get(`${base()}?q=${encodeURIComponent(ctx.teamName.toLowerCase())}`);
  assert.deepEqual(r.data.items.map((i) => [i.name, i.team]), [['Person ci-p1', ctx.teamName]], 'search by team');
  assert.equal(r.data.total, 1);
  r = await admin.get(`${base()}?q=${encodeURIComponent(ctx.code2.slice(0, 5).toLowerCase())}`);
  assert.ok(r.data.items.some((i) => i.name === 'Person ci-p2' && i.team === null), 'search by ticket code');

  r = await ctx.vol.post(`${base()}/participants/${ctx.p2.pid}`, {});
  assert.equal(r.status, 403, 'by hand is for organisers');
  r = await admin.post(`${base()}/participants/${ctx.p2.pid}`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.result, 'checked_in');
  assert.equal(r.data.participant.method, 'manual');
  r = await admin.post(`${base()}/participants/${ctx.p2.pid}`, {});
  assert.equal(r.data.result, 'already');
  r = await admin.post(`${base()}/participants/${ctx.pending.pid}`, {});
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'NOT_APPROVED');
  r = await admin.post(`${base()}/participants/999999999`, {});
  assert.equal(r.status, 404);

  r = await ctx.vol.delete(`${base()}/participants/${ctx.p2.pid}`);
  assert.equal(r.status, 403);
  r = await admin.delete(`${base()}/participants/${ctx.p2.pid}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.result, 'undone');
  assert.equal(r.data.participant.checkedIn, false);
  r = await admin.delete(`${base()}/participants/${ctx.p2.pid}`);
  assert.equal(r.status, 404);
  assert.equal(r.json.code, 'NOT_CHECKED_IN');
  const undo = await dbQuery("SELECT 1 FROM audit_log WHERE action = 'event.checkin.undo' AND event_id = $1", [ctx.ev.id]);
  assert.equal(undo.rows.length, 1);

  // A participant of this event cannot be checked in through another event's address.
  r = await ctx.other.session.post(`${base(ctx.otherEv.id)}/participants/${ctx.p2.pid}`, {});
  assert.equal(r.status, 404, r.text);
  r = await ctx.other.session.get(base());
  assert.equal(r.status, 404, 'another organisation does not see the list');
});

test('the CSV: every accepted participant, codes, safe for spreadsheets', async () => {
  // A name that a spreadsheet would run as a formula.
  await dbQuery("UPDATE users SET full_name = '=HYPERLINK(\"http://x\")' WHERE id = $1", [ctx.p2.userId]);
  const r = await admin.download(`${base()}/export.csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  const text = r.body.toString('utf8');
  const lines = text.trim().split('\r\n');
  assert.equal(lines.length, 3, 'header + two accepted participants');
  assert.ok(lines[0].includes('Ticket code') && lines[0].includes('Checked in by'));
  assert.ok(text.includes(ctx.code1));
  assert.ok(text.includes(ctx.teamName), 'with the team');
  assert.ok(text.includes('Staff ci-vol'));
  assert.ok(text.includes(`"'=HYPERLINK(""http://x"")"`), 'the formula is defused');
  assert.equal((await ctx.vol.download(`${base()}/export.csv`)).status, 403);
  const log = await dbQuery("SELECT 1 FROM audit_log WHERE action = 'event.checkin.exported' AND event_id = $1", [ctx.ev.id]);
  assert.equal(log.rows.length, 1);
});

test('the plan decides: no check-in on Starter', async () => {
  let r = await ctx.starter.session.get(base(ctx.starterEv.id));
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'MODULE_DISABLED');
  r = await ctx.starter.session.post(`${base(ctx.starterEv.id)}/scan`, { code: 'ABCDEFGH' });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'MODULE_DISABLED');
});

test('an archived event: the list still reads, nothing changes', async () => {
  await dbQuery("UPDATE events SET status = 'archived', archived_at = now() WHERE id = $1", [ctx.ev.id]);
  let r = await admin.get(base());
  assert.equal(r.status, 200, 'still readable');
  r = await ctx.p1.s.get(`${base()}/me`);
  assert.equal(r.status, 200, 'the ticket still shows');
  r = await ctx.vol.post(`${base()}/scan`, { code: ctx.code2 });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'EVENT_ARCHIVED');
  r = await admin.delete(`${base()}/participants/${ctx.p1.pid}`);
  assert.equal(r.json.code, 'EVENT_ARCHIVED');
});
