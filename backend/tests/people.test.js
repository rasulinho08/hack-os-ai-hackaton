/**
 * People and teams while an event runs, end to end against a running API
 * (see announcements.test.js for the fake Telegram and mail servers; this
 * suite works without them too).
 *
 * Covers: capacity and the waiting list (a full event, "approve anyway",
 * the list moving up when a seat frees, the status e-mail); bulk changes and
 * whole-team approval; removing a participant takes them off their team;
 * the participant export (answers included, formulas defused); organisers
 * making teams and moving people; matchmaking by skills; join requests
 * (send, accept, decline, withdraw, the checks); and who may do which.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, mailsTo } = require('./helpers');
const { dbQuery, approvedBuyer } = require('./fixtures');

const admin = new Session('pp-admin');
const ctx = {};

async function makeEvent(tag, extra = {}) {
  const r = await admin.post('/api/events', {
    event_code: `PP${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    name: `People ${tag} ${RUN_ID}`,
    registration_start: iso(-1 * DAY),
    registration_end: iso(3 * DAY),
    start_date: iso(4 * DAY),
    end_date: iso(5 * DAY),
    team_size_limit: 3,
    min_team_size: 1,
    is_published: true,
    ...extra,
  });
  assert.equal(r.status, 201, r.text);
  return r.data;
}

async function register(ev, tag, { name, skills } = {}) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: name || `Person ${tag}`, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' },
    answers: {},
    accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  const u = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(tag)])).rows[0];
  if (skills) await dbQuery('UPDATE users SET skills = $2::jsonb WHERE id = $1', [u.id, JSON.stringify(skills)]);
  const p = (await dbQuery('SELECT id, status FROM participants WHERE event_id = $1 AND user_id = $2', [ev.id, u.id])).rows[0];
  return { s, userId: u.id, pid: p.id, status: p.status };
}

const statusOf = async (pid) => (await dbQuery('SELECT status FROM participants WHERE id = $1', [pid])).rows[0]?.status;

test('setup: the organiser', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
});

// ── Capacity and the waiting list ───────────────────────────────────────────

test('a full event puts newcomers on the waiting list and shows it in the summary', async () => {
  const ev = await makeEvent('cap');
  await admin.patch(`/api/events/${ev.id}/builder`, { max_participants: 2, waitlist_enabled: true, approval_mode: 'manual' });
  ctx.cap = { ev };
  ctx.cap.a = await register(ev, 'cap-a');
  ctx.cap.b = await register(ev, 'cap-b');
  ctx.cap.c = await register(ev, 'cap-c');
  assert.equal(ctx.cap.c.status, 'waitlisted', 'the third person is waitlisted');
  const r = await admin.get(`/api/events/${ev.id}/participants/summary`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.capacity.limit, 2);
  assert.equal(r.data.capacity.taken, 2);
  assert.equal(r.data.capacity.full, true);
  assert.equal(r.data.byStatus.waitlisted, 1);
  assert.equal(r.data.byStatus.pending, 2);
});

test('approving from the waiting list needs a free seat, unless the organiser says anyway', async () => {
  const { ev, c } = ctx.cap;
  let r = await admin.patch(`/api/events/${ev.id}/participants/${c.pid}`, { status: 'approved' });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'CAPACITY_FULL');
  assert.equal(await statusOf(c.pid), 'waitlisted');
  r = await admin.patch(`/api/events/${ev.id}/participants/${c.pid}`, { status: 'approved', force: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(await statusOf(c.pid), 'approved');
  // Back to the waiting list for the next test.
  r = await admin.patch(`/api/events/${ev.id}/participants/${c.pid}`, { status: 'waitlisted' });
  assert.equal(r.status, 200, r.text);
});

test('when a seat frees up, the waiting list moves up and the person hears about it', async () => {
  const { ev, a, c } = ctx.cap;
  const r = await admin.patch(`/api/events/${ev.id}/participants/${a.pid}`, { status: 'rejected' });
  assert.equal(r.status, 200, r.text);
  assert.equal(await statusOf(c.pid), 'pending', 'manual approval: moved up to pending for review');
  // The status message is queued; with the fake mail server it arrives.
  const job = await dbQuery(
    "SELECT payload FROM jobs WHERE type = 'participant.status_message' AND payload->>'participantId' = $1",
    [String(c.pid)],
  );
  assert.ok(job.rows.some((j) => j.payload.status === 'promoted'), 'a "place opened up" message is queued');
  const mails = await mailsTo(email('cap-c'));
  if (process.env.FAKE_SMTP_LOG !== 'off' && mails.length) {
    let found = false;
    for (let i = 0; i < 30 && !found; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      found = (await mailsTo(email('cap-c'))).some((m) => /Yer a|place opened/i.test(m.text) || /=?UTF-8/.test(m.subject));
      // eslint-disable-next-line no-await-in-loop
      if (!found) await new Promise((res) => { setTimeout(res, 500); });
    }
    assert.ok(found, 'the e-mail reached the mail server');
  }
});

// ── Bulk and whole teams ────────────────────────────────────────────────────

test('bulk changes apply within the capacity and say what was skipped', async () => {
  const ev = await makeEvent('bulk');
  await admin.patch(`/api/events/${ev.id}/builder`, { max_participants: 10, waitlist_enabled: true });
  const people = [];
  for (const t of ['bk-a', 'bk-b', 'bk-c']) people.push(await register(ev, t)); // eslint-disable-line no-await-in-loop
  let r = await admin.post(`/api/events/${ev.id}/participants/bulk`, { ids: [...people.map((p) => p.pid), 999999999], status: 'approved' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.changed.length, 3);
  assert.deepEqual(r.data.skipped, [{ id: 999999999, reason: 'NOT_FOUND' }]);
  r = await admin.post(`/api/events/${ev.id}/participants/bulk`, { ids: [people[0].pid], status: 'approved' });
  assert.deepEqual(r.data.skipped, [{ id: people[0].pid, reason: 'UNCHANGED' }]);
  r = await admin.post(`/api/events/${ev.id}/participants/bulk`, { ids: [], status: 'approved' });
  assert.equal(r.status, 400);
  r = await admin.post(`/api/events/${ev.id}/participants/bulk`, { ids: [people[0].pid], status: 'vip' });
  assert.equal(r.status, 400);
  ctx.bulk = { ev, people };
});

test('organisers make teams for participants (without joining) and approve a team at once', async () => {
  const ev = await makeEvent('team');
  const x = await register(ev, 'tm-x', { skills: ['Python'] });
  const y = await register(ev, 'tm-y', { skills: ['React'] });
  const z = await register(ev, 'tm-z');
  let r = await admin.post('/api/teams', { eventId: ev.id, name: `Organiser Team ${RUN_ID}`, memberIds: [x.userId, y.userId], leaderId: y.userId });
  assert.equal(r.status, 201, r.text);
  const team = r.data;
  assert.equal(team.leader_id, y.userId);
  const adminIn = await dbQuery('SELECT 1 FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = $1 AND u.email = $2', [team.id, 'admin@test.com']);
  assert.equal(adminIn.rows.length, 0, 'the organiser is not put on the team');

  r = await admin.post(`/api/events/${ev.id}/participants/team/${team.id}/status`, { status: 'approved' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.changed.length, 2);
  assert.equal(await statusOf(x.pid), 'approved');
  assert.equal(await statusOf(y.pid), 'approved');

  // A team is made of the event's participants: no back door past registration.
  const adminUser = (await dbQuery('SELECT id FROM users WHERE email = $1', ['admin@test.com'])).rows[0];
  r = await admin.post(`/api/teams/${team.id}/members`, { userId: adminUser.id });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'NOT_A_PARTICIPANT');
  r = await admin.post(`/api/teams/${team.id}/members`, { email: `nobody-${RUN_ID}@e2e.test` });
  assert.equal(r.status, 404, r.text);
  assert.equal(r.json.code, 'USER_NOT_FOUND');
  const ghost = await dbQuery('SELECT 1 FROM users WHERE email = $1', [`nobody-${RUN_ID}@e2e.test`]);
  assert.equal(ghost.rows.length, 0, 'no placeholder account is made');

  // Move z in from nowhere, then move x to a second team.
  r = await admin.post(`/api/teams/${team.id}/members`, { userId: z.userId });
  assert.equal(r.status, 201, r.text);
  r = await admin.post('/api/teams', { eventId: ev.id, name: `Second Team ${RUN_ID}`, memberIds: [] });
  assert.equal(r.status, 201, r.text);
  const second = r.data;
  r = await admin.post(`/api/teams/${second.id}/members`, { userId: x.userId });
  assert.equal(r.status, 409, 'without "move" the one-team rule holds');
  r = await admin.post(`/api/teams/${second.id}/members`, { userId: x.userId, move: true });
  assert.equal(r.status, 201, r.text);
  const where = await dbQuery('SELECT team_id FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE t.event_id = $1 AND tm.user_id = $2', [ev.id, x.userId]);
  assert.deepEqual(where.rows.map((w) => w.team_id), [second.id]);

  // The organiser's list shows each person's team in this event and who leads it.
  r = await admin.get(`/api/events/${ev.id}/participants`);
  assert.equal(r.status, 200, r.text);
  const byUser = Object.fromEntries(r.data.map((p) => [p.user_id, p]));
  assert.equal(byUser[x.userId].current_team_id, second.id);
  assert.equal(byUser[y.userId].current_team_id, team.id);
  assert.equal(byUser[y.userId].team_leader, true);
  assert.equal(byUser[z.userId].team_leader, false);
  ctx.team = { ev, team, second, x, y, z };
});

test('removing a participant takes them off their team and hands the lead on', async () => {
  const { ev, team, y, z } = ctx.team;
  const r = await admin.delete(`/api/events/${ev.id}/participants/${y.pid}`);
  assert.equal(r.status, 200, r.text);
  const members = await dbQuery('SELECT user_id, is_leader FROM team_members WHERE team_id = $1', [team.id]);
  assert.deepEqual(members.rows.map((m) => m.user_id), [z.userId], 'the removed lead is off the team');
  assert.equal(members.rows[0].is_leader, true, 'the remaining member leads');
});

// ── Export ──────────────────────────────────────────────────────────────────

test('the participant export carries answers and defuses spreadsheet formulas', async () => {
  const ev = await makeEvent('csv');
  const s = new Session('csv-evil');
  let r = await s.post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: 'Evil Person', email: email('csv-evil'), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  // A name starting with "=" would run as a formula in Excel.
  await dbQuery("UPDATE users SET full_name = '=HYPERLINK(\"http://evil\",\"x\")' WHERE LOWER(email) = LOWER($1)", [email('csv-evil')]);
  const res = await admin.download(`/api/events/${ev.id}/participants/export.csv`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="participants-\d+\.csv"/);
  const text = res.body.toString('utf8');
  assert.equal(text.charCodeAt(0), 0xfeff, 'starts with a byte-order mark for Excel');
  assert.match(text, /^﻿Name,E-mail,Status,Team/);
  assert.ok(text.includes(`"'=HYPERLINK(""http://evil"",""x"")"`), 'the formula is prefixed with an apostrophe');
  assert.ok(!/\n=HYPERLINK/.test(text));
  // Participants cannot export.
  const p = await s.download(`/api/events/${ev.id}/participants/export.csv`);
  assert.equal(p.status, 403);
});

test('an imported participant chooses their own password from an e-mail; nobody sees one', async () => {
  const ev = await makeEvent('imp');
  const mail = email('imported');
  let r = await admin.post('/api/users/bulk-import', { eventId: ev.id, users: [{ email: mail, full_name: 'Imported Person' }] });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.created, 1);
  assert.equal(r.data.welcomed, 1);
  assert.equal(r.data.credentials, undefined, 'no passwords come back to the organiser');
  assert.ok(!JSON.stringify(r.json).match(/password/i), 'nothing password-like in the response');
  const job = await dbQuery("SELECT 1 FROM jobs WHERE type = 'account.welcome' AND dedupe_key LIKE $1", [`welcome:%:${ev.id}`]);
  assert.equal(job.rows.length, 1, 'a welcome e-mail is queued');
  // With the fake mail server: follow the link and sign in.
  const link = /https?:\/\/[^\s"<>]+reset-password\?token=([A-Za-z0-9_%-]+)/;
  let token = null;
  for (let i = 0; i < 40 && !token; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const m = (await mailsTo(mail)).find((x) => link.test(x.text));
    token = m ? decodeURIComponent(m.text.match(link)[1]) : null;
    // eslint-disable-next-line no-await-in-loop
    if (!token) await new Promise((res) => { setTimeout(res, 500); });
  }
  if (token) {
    r = await new Session('imp-anon').post('/api/auth/reset-password', { token, password: 'MyOwnPass2026' });
    assert.equal(r.status, 200, r.text);
    await new Session('imp-in').login(mail, 'MyOwnPass2026');
  }
});

// ── Matchmaking and join requests ───────────────────────────────────────────

test('matchmaking ranks teams and people by the skills each side brings', async () => {
  const ev = await makeEvent('mm');
  const lead = await register(ev, 'mm-lead', { skills: ['Python', 'SQL'] });
  const react = await register(ev, 'mm-react', { skills: ['React', 'Figma'] });
  const go = await register(ev, 'mm-go', { skills: ['Go'] });
  const pending = await register(ev, 'mm-pending', { skills: ['React'] });
  for (const p of [lead, react, go]) {
    // eslint-disable-next-line no-await-in-loop
    await admin.patch(`/api/events/${ev.id}/participants/${p.pid}`, { status: 'approved' });
  }
  let r = await lead.s.post('/api/teams', { eventId: ev.id, name: `Data Crew ${RUN_ID}` });
  assert.equal(r.status, 201, r.text);
  const team = r.data;
  r = await lead.s.patch(`/api/teams/${team.id}/recruiting`, { recruiting: true, note: 'Need a frontend dev', wantedSkills: ['React'] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.wantedSkills, ['React']);

  r = await react.s.patch(`/api/events/${ev.id}/matchmaking/me`, { looking: true, note: 'Frontend, some design' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.looking, true);

  r = await react.s.get(`/api/events/${ev.id}/matchmaking`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.mode, 'solo');
  assert.equal(r.data.formation.open, true, 'teams can still change before the start');
  assert.ok(r.data.formation.closesAt, 'and the page can say until when');
  assert.equal(r.data.teamSize, 3);
  assert.equal(r.data.teams[0].id, team.id, 'the team that wants React comes first');
  assert.deepEqual(r.data.teams[0].matched, ['React']);
  assert.equal(r.data.teams[0].openSpots, 2);

  r = await lead.s.get(`/api/events/${ev.id}/matchmaking`);
  assert.equal(r.data.mode, 'team');
  assert.equal(r.data.team.isLead, true);
  assert.equal(r.data.people[0].userId, react.userId, 'the React developer is suggested first');
  assert.deepEqual(r.data.people[0].matched, ['React']);
  assert.ok(!r.data.people.some((p) => p.userId === pending.userId), 'pending participants are not in the pool');

  r = await pending.s.get(`/api/events/${ev.id}/matchmaking`);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'HACKER_NOT_APPROVED');

  const sum = await admin.get(`/api/events/${ev.id}/participants/summary`);
  assert.equal(sum.data.lookingForTeam, 1);
  ctx.mm = { ev, lead, react, go, pending, team };
});

test('join requests: send, the checks, accept (others withdrawn), decline, withdraw', async () => {
  const { ev, lead, react, go, pending, team } = ctx.mm;
  // A second team for the "others withdrawn" check.
  let r = await go.s.post('/api/teams', { eventId: ev.id, name: `Go Team ${RUN_ID}` });
  assert.equal(r.status, 201, r.text);
  const goTeam = r.data;

  r = await react.s.post(`/api/teams/${team.id}/requests`, { message: 'I do React and Figma' });
  assert.equal(r.status, 201, r.text);
  const req1 = r.data;
  r = await react.s.post(`/api/teams/${team.id}/requests`, {});
  assert.equal(r.status, 409, 'one open request per team');
  assert.equal(r.json.code, 'REQUEST_EXISTS');
  r = await react.s.post(`/api/teams/${goTeam.id}/requests`, {});
  assert.equal(r.status, 201, r.text);
  r = await pending.s.post(`/api/teams/${team.id}/requests`, {});
  assert.equal(r.status, 403, 'pending participants cannot ask');

  // The lead hears about it (queued for Telegram).
  const notice = await dbQuery("SELECT payload FROM jobs WHERE type = 'people.notify' AND (payload->>'userId')::int = $1", [lead.userId]);
  assert.ok(notice.rows.some((n) => n.payload.kind === 'request_new'));

  r = await go.s.get(`/api/teams/${team.id}/requests`);
  assert.equal(r.status, 403, 'only the team sees its requests');
  r = await lead.s.get(`/api/teams/${team.id}/requests`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data[0].full_name, `Person mm-react`);
  assert.deepEqual(r.data[0].skills, ['React', 'Figma']);

  r = await go.s.post(`/api/teams/requests/${req1.id}/accept`);
  assert.equal(r.status, 403, 'only the lead answers');
  r = await lead.s.post(`/api/teams/requests/${req1.id}/accept`);
  assert.equal(r.status, 200, r.text);
  const inTeam = await dbQuery('SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2', [team.id, react.userId]);
  assert.equal(inTeam.rows.length, 1, 'the person joined');
  const mine = await react.s.get(`/api/teams/requests/mine?eventId=${ev.id}`);
  const byTeam = Object.fromEntries(mine.data.map((m) => [m.team_id, m.status]));
  assert.equal(byTeam[team.id], 'accepted');
  assert.equal(byTeam[goTeam.id], 'cancelled', 'the other open request was withdrawn');
  r = await lead.s.post(`/api/teams/requests/${req1.id}/decline`);
  assert.equal(r.status, 409, 'an answered request stays answered');

  // Decline and withdraw.
  const late = await register(ev, 'mm-late', { skills: ['Rust'] });
  await admin.patch(`/api/events/${ev.id}/participants/${late.pid}`, { status: 'approved' });
  r = await late.s.post(`/api/teams/${team.id}/requests`, {});
  assert.equal(r.status, 201, r.text);
  r = await lead.s.post(`/api/teams/requests/${r.data.id}/decline`);
  assert.equal(r.status, 200, r.text);
  r = await late.s.post(`/api/teams/${goTeam.id}/requests`, {});
  const goReq = r.data;
  r = await go.s.delete(`/api/teams/requests/${goReq.id}`);
  assert.equal(r.status, 404, 'only the requester withdraws');
  r = await late.s.delete(`/api/teams/requests/${goReq.id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'cancelled');
});

// ── Who may do which ────────────────────────────────────────────────────────

test('participants and other organisations cannot manage people', async () => {
  const { ev, react } = ctx.mm;
  let r = await react.s.get(`/api/events/${ev.id}/participants/summary`);
  assert.equal(r.status, 403);
  r = await react.s.post(`/api/events/${ev.id}/participants/bulk`, { ids: [react.pid], status: 'approved' });
  assert.equal(r.status, 403);
  const { session: other } = await approvedBuyer('pp-other');
  for (const [m, path, body] of [
    ['get', `/api/events/${ev.id}/participants/summary`],
    ['post', `/api/events/${ev.id}/participants/bulk`, { ids: [react.pid], status: 'rejected' }],
    ['get', `/api/events/${ev.id}/participants/unassigned`],
    ['post', `/api/events/${ev.id}/participants/promote`, {}],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    r = await other[m](path, body);
    assert.equal(r.status, 404, `${m} ${path} → ${r.status}`);
  }
  r = await other.post('/api/teams', { eventId: ev.id, name: 'Hijack team' });
  assert.equal(r.status, 404, 'an organiser cannot make teams in another organisation’s event');
  const rejected = await statusOf(react.pid);
  assert.equal(rejected, 'approved', 'nothing changed');
});
