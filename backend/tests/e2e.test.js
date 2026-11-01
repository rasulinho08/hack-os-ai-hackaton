/**
 * End-to-end API tests. Run against a live server + database:
 *
 *   npm run dev            (in another terminal)
 *   npm test               (API_URL defaults to http://localhost:5000)
 *
 * Requires the seeded admin account (npm run seed): admin@test.com / Test1234!
 * Every run creates its own event + users (unique suffix), so it is safe to
 * run repeatedly against the same database.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, mailsTo } = require('./helpers');

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@test.com';

const admin   = new Session('admin');
const judge   = new Session('judge');
const mentor  = new Session('mentor');
const hackerA = new Session('hackerA');
const hackerB = new Session('hackerB');
const hackerC = new Session('hackerC');
const hackerD = new Session('hackerD');

const ctx = {
  event: null,
  participants: {},   // email -> participant row
  team: null,
  submission: null,
  criteria: [],
  ticket: null,
};

const byEmail = (rows, mail) => rows.find((p) => String(p.email).toLowerCase() === mail.toLowerCase());

const { dbQuery, ownerSession, approvedBuyer } = require('./fixtures');

test('admin can log in and /me reports role + approved status', async () => {
  await admin.login(ADMIN_EMAIL);
  const me = await admin.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.role, 'admin');
  assert.equal(me.data.status, 'approved');
});

test('anonymous GET /api/events is allowed (login/register page needs it)', async () => {
  const anon = new Session('anon');
  const r = await anon.get('/api/events');
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text.slice(0, 200)}`);
  assert.ok(Array.isArray(r.data));
});

test('admin creates an upcoming event (team formation open, hacking not started)', async () => {
  const r = await admin.post('/api/events', {
    event_code: `E2E-${RUN_ID}`,
    name: `E2E Hackathon ${RUN_ID}`,
    description: 'created by tests/e2e.test.js',
    registration_start: iso(-1 * DAY),
    registration_end: iso(1 * DAY),
    start_date: iso(2 * DAY),
    end_date: iso(4 * DAY),
    team_size_limit: 3,
    min_team_size: 1,
    is_published: true,
    criteria: [
      { name: 'Innovation', maxScore: 10, weight: 1.5 },
      { name: 'Tech', maxScore: 10, weight: 1 },
    ],
  });
  assert.equal(r.status, 201, r.text);
  ctx.event = r.data;

  const crit = await admin.get(`/api/events/${ctx.event.id}/judging/criteria`);
  assert.equal(crit.status, 200);
  ctx.criteria = crit.data;

  assert.equal(ctx.event.team_size_limit, 3);
  assert.equal(ctx.event.is_published, true, 'is_published sent on create must be persisted');
  assert.equal(crit.data.length, 2, 'criteria passed on create must be stored');
});

test('duplicate event_code is rejected with 409', async () => {
  const r = await admin.post('/api/events', {
    event_code: `E2E-${RUN_ID}`,
    name: 'dup',
    start_date: iso(2 * DAY),
    end_date: iso(4 * DAY),
  });
  assert.equal(r.status, 409, r.text);
});

test('event with end_date before start_date is rejected with 400', async () => {
  const r = await admin.post('/api/events', {
    event_code: `E2E-BAD-${RUN_ID}`,
    name: 'bad dates',
    start_date: iso(4 * DAY),
    end_date: iso(2 * DAY),
  });
  assert.equal(r.status, 400, r.text);
});

test('invites pre-assign judge / mentor roles on registration', async () => {
  const eid = ctx.event.id;
  let r = await admin.post(`/api/events/${eid}/invites`, { email: email('judge'), role: 'judge' });
  assert.equal(r.status, 201, r.text);
  r = await admin.post(`/api/events/${eid}/invites`, { email: email('mentor'), role: 'mentor' });
  assert.equal(r.status, 201, r.text);

  // Signing up with the invited address holds the invitation until the
  // address is confirmed (register() opens the e-mailed link, then signs in).
  const j = await judge.register({ fullName: 'E2E Judge', email: email('judge'), eventId: eid });
  assert.deepEqual(j.pendingInvite, { eventId: eid, role: 'judge' });
  assert.equal(judge.user.role, 'judge');
  const m = await mentor.register({ fullName: 'E2E Mentor', email: email('mentor'), eventCode: ctx.event.event_code });
  assert.deepEqual(m.pendingInvite, { eventId: eid, role: 'mentor' });
  assert.equal(mentor.user.role, 'mentor');

  const judges = await admin.get(`/api/events/${eid}/judging/judges`);
  assert.ok(byEmail(judges.data, email('judge')), 'judge row must be created from the invite');
  const mentors = await admin.get(`/api/events/${eid}/mentors`);
  assert.ok(byEmail(mentors.data, email('mentor')), 'mentor_assignments row must be created from the invite');
});

test('staff invite e-mail goes only to an address with a pending invite', async () => {
  const eid = ctx.event.id;
  let r = await admin.post(`/api/events/${eid}/invites`, { email: email('volunteer'), role: 'volunteer' });
  assert.equal(r.status, 201, r.text);

  // An attacker-chosen link is not used: the server builds the link itself.
  r = await admin.post('/api/mail/staff-invite', {
    to: email('volunteer'), eventId: eid, inviteUrl: 'https://evil.example/login?eventId=1',
  });
  assert.equal(r.status, 200, r.text);

  r = await admin.post('/api/mail/staff-invite', { to: email('nobody'), eventId: eid });
  assert.equal(r.status, 404, 'an address with no invite must not get a HackOS-branded e-mail');

  r = await admin.post('/api/mail/staff-invite', { to: email('volunteer') });
  assert.equal(r.status, 400, 'the event must be named');
});

test('mail status and test send are for organisers only', async () => {
  let r = await admin.get('/api/mail/status');
  assert.equal(r.status, 200, r.text);
  assert.equal(typeof r.data.configured, 'boolean');
  r = await admin.post('/api/mail/test', {});
  assert.equal(r.status, 200, r.text);

  const anon = new Session('anon-mail');
  r = await anon.post('/api/mail/test', {});
  assert.equal(r.status, 401);
});

test('hackers register into the event as pending participants', async () => {
  const eid = ctx.event.id;
  for (const [s, name] of [[hackerA, 'hackerA'], [hackerB, 'hackerB'], [hackerC, 'hackerC'], [hackerD, 'hackerD']]) {
    const u = await s.register({ fullName: `E2E ${name}`, email: email(name), eventId: eid, isSolo: true });
    assert.equal(u.role, 'hacker');
  }
  const me = await hackerA.get('/api/auth/me');
  assert.equal(me.data.status, 'pending');

  const list = await admin.get(`/api/events/${eid}/participants`);
  assert.equal(list.status, 200);
  for (const name of ['hackerA', 'hackerB', 'hackerC', 'hackerD']) {
    const p = byEmail(list.data, email(name));
    assert.ok(p, `${name} must appear in the participants list`);
    assert.equal(p.status, 'pending');
    ctx.participants[name] = p;
  }
});

test('client-supplied role is ignored on public registration', async () => {
  const s = new Session('wannabe-admin');
  const u = await s.register({ fullName: 'Sneaky', email: email('sneaky'), role: 'admin', eventId: ctx.event.id });
  assert.equal(u.role, 'hacker');
});

test('pending hacker cannot create a team', async () => {
  const r = await hackerA.post('/api/teams', { eventId: ctx.event.id, name: 'Too Early' });
  assert.equal(r.status, 403, r.text);
});

test('admin approves hackers A and B; status is scoped to the right event', async () => {
  const eid = ctx.event.id;
  for (const name of ['hackerA', 'hackerB']) {
    const r = await admin.patch(`/api/events/${eid}/participants/${ctx.participants[name].id}`, { status: 'approved' });
    assert.equal(r.status, 200, r.text);
  }
  // participant id from another event must be rejected (no cross-event writes)
  const other = await admin.get('/api/events/1/participants');
  if (other.status === 200 && other.data.length) {
    const foreign = other.data[0];
    const r = await admin.patch(`/api/events/${eid}/participants/${foreign.id}`, { status: 'rejected' });
    assert.equal(r.status, 404, 'participant from a different event must not be reachable via this event');
  }
  const me = await hackerA.get('/api/auth/me');
  assert.equal(me.data.status, 'approved');
});

test('approved hacker creates a team and becomes its leader', async () => {
  const r = await hackerA.post('/api/teams', { eventId: ctx.event.id, name: `Team ${RUN_ID}` });
  assert.equal(r.status, 201, r.text);
  ctx.team = r.data;
  assert.ok(ctx.team.join_code);

  const mine = await hackerA.get(`/api/teams/mine?eventId=${ctx.event.id}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.data.id, ctx.team.id);
  const leader = mine.data.members.find((m) => m.is_leader);
  assert.equal(String(leader.email).toLowerCase(), email('hackerA').toLowerCase());
});

test('creating a second team for the same event is rejected (not silently swallowed)', async () => {
  const r = await hackerA.post('/api/teams', { eventId: ctx.event.id, name: 'Second Team' });
  assert.equal(r.status, 409, `expected 409, got ${r.status}: ${r.text.slice(0, 200)}`);
});

test('hacker B joins via join code; pending hacker C is refused', async () => {
  let r = await hackerB.post('/api/teams/join', { joinCode: ctx.team.join_code });
  assert.equal(r.status, 200, r.text);
  r = await hackerC.post('/api/teams/join', { joinCode: ctx.team.join_code });
  assert.equal(r.status, 403, r.text);
});

test('a hacker outside the team cannot read its join code', async () => {
  // The join code is the team's invitation. C (pending, not on the team) must
  // get the team without it; the leader and an organiser still see it.
  const outsider = await hackerC.get(`/api/teams/${ctx.team.id}`);
  assert.equal(outsider.status, 200, outsider.text);
  assert.equal(outsider.data.join_code, undefined, 'join_code leaked to a non-member');
  const leader = await hackerA.get(`/api/teams/${ctx.team.id}`);
  assert.equal(leader.data.join_code, ctx.team.join_code);
  const organiser = await admin.get(`/api/teams/${ctx.team.id}`);
  assert.equal(organiser.data.join_code, ctx.team.join_code);
});

test('team invites: target must be approved, accept adds member, team becomes full', async () => {
  const eid = ctx.event.id;
  let r = await hackerA.post('/api/team-invites', { toUserId: hackerC.user.id, eventId: eid });
  assert.equal(r.status, 400, 'inviting a pending hacker must fail');
  assert.equal(r.json.code, 'TARGET_NOT_APPROVED', 'the reason comes as a code the page can translate');

  r = await admin.patch(`/api/events/${eid}/participants/${ctx.participants.hackerC.id}`, { status: 'approved' });
  assert.equal(r.status, 200);

  r = await hackerA.post('/api/team-invites', { toUserId: hackerC.user.id, eventId: eid });
  assert.equal(r.status, 201, r.text);
  const inviteId = r.data.id;
  r = await hackerA.post('/api/team-invites', { toUserId: hackerC.user.id, eventId: eid });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'INVITE_EXISTS');

  const inbox = await hackerC.get(`/api/team-invites/incoming?eventId=${eid}`);
  assert.equal(inbox.data.length, 1);

  r = await hackerC.post(`/api/team-invites/${inviteId}/accept`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.teamId, ctx.team.id);

  const team = await hackerA.get(`/api/teams/${ctx.team.id}`);
  assert.equal(team.data.members.length, 3);

  // Team is at team_size_limit (3): D is approved but cannot join
  r = await admin.patch(`/api/events/${eid}/participants/${ctx.participants.hackerD.id}`, { status: 'approved' });
  assert.equal(r.status, 200);
  r = await hackerD.post('/api/teams/join', { joinCode: ctx.team.join_code });
  assert.equal(r.status, 400, `full team must refuse: ${r.text.slice(0, 200)}`);
});

test('only leader or admin can remove members; a member can leave', async () => {
  const { id: teamId } = ctx.team;
  // B (plain member) must NOT be able to kick C
  let r = await hackerB.delete(`/api/teams/${teamId}/members/${hackerC.user.id}`);
  assert.equal(r.status, 403, `non-leader removing another member must be 403, got ${r.status}`);
  // B can leave the team themselves
  r = await hackerB.delete(`/api/teams/${teamId}/members/${hackerB.user.id}`);
  assert.equal(r.status, 200, r.text);
  // Leader re-adds B by email
  r = await hackerA.post(`/api/teams/${teamId}/members`, { email: email('hackerB') });
  assert.equal(r.status, 201, r.text);
  const team = await hackerA.get(`/api/teams/${teamId}`);
  assert.equal(team.data.members.length, 3);
});

test('submission is blocked before the hackathon starts', async () => {
  const r = await hackerA.post('/api/submissions', {
    eventId: ctx.event.id,
    project_name: 'Early Bird',
    description: 'too early',
    repo_link: 'https://github.com/e2e/early',
  });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'HACKATHON_NOT_STARTED');
});

test('admin moves start_date into the past; leader can submit, member cannot', async () => {
  const eid = ctx.event.id;
  let r = await admin.put(`/api/events/${eid}`, { start_date: iso(-1 * 60 * 60 * 1000) });
  assert.equal(r.status, 200, r.text);
  // The organiser opened judging while submissions are still open (rolling
  // judging); without a judging start it opens when submissions close.
  await dbQuery("UPDATE events SET judging_start = now() - interval '1 minute' WHERE id = $1", [eid]);

  r = await hackerB.post('/api/submissions', {
    eventId: eid, project_name: 'Not Lead', description: 'x', repo_link: 'https://github.com/e2e/x',
  });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'NOT_TEAM_LEAD');

  r = await hackerA.post('/api/submissions', {
    eventId: eid,
    project_name: `Project ${RUN_ID}`,
    description: 'A real project',
    repo_link: 'https://github.com/e2e/project',
    demo_link: 'https://demo.example.com',
    tech_stack: 'Node, Postgres',
  });
  assert.equal(r.status, 201, r.text);
  ctx.submission = r.data;

  // team formation is now closed: D cannot join even with a free seat elsewhere
  r = await hackerD.post('/api/teams', { eventId: eid, name: 'Late Team' });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'TEAM_FORMATION_CLOSED');
});

test('hacker sees only own team submission; judge/mentor see event submissions', async () => {
  const eid = ctx.event.id;
  let r = await hackerA.get('/api/submissions');
  assert.equal(r.status, 200);
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].id, ctx.submission.id);

  r = await hackerD.get(`/api/submissions/${ctx.submission.id}`);
  assert.equal(r.status, 403, 'hacker from another team must not read the submission');

  r = await judge.get(`/api/submissions?eventId=${eid}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.length, 1);
  r = await mentor.get(`/api/submissions?eventId=${eid}`);
  assert.equal(r.status, 200, r.text);
});

test('judge scores the submission; leaderboard and auto status update', async () => {
  const eid = ctx.event.id;
  for (const c of ctx.criteria) {
    const r = await judge.post(`/api/events/${eid}/judging/scores`, {
      submissionId: ctx.submission.id, criterionId: c.id, score: 8, feedback: 'nice',
    });
    assert.equal(r.status, 201, r.text);
  }
  // score outside the criterion's max_score must be rejected
  let r = await judge.post(`/api/events/${eid}/judging/scores`, {
    submissionId: ctx.submission.id, criterionId: ctx.criteria[0].id, score: 99,
  });
  assert.equal(r.status, 400, 'score above max_score must be rejected');

  // hacker cannot score
  r = await hackerA.post(`/api/events/${eid}/judging/scores`, {
    submissionId: ctx.submission.id, criterionId: ctx.criteria[0].id, score: 1,
  });
  assert.equal(r.status, 403);

  // Participants see no ranking before results are published (E8);
  // the organiser sees it live.
  let lb = await hackerA.get(`/api/events/${eid}/judging/leaderboard`);
  assert.equal(lb.status, 403);
  assert.equal(lb.json.code, 'RESULTS_NOT_PUBLISHED');
  lb = await admin.get(`/api/events/${eid}/judging/leaderboard`);
  assert.equal(lb.status, 200, lb.text);
  assert.equal(lb.data.length, 1);
  assert.equal(Number(lb.data[0].judges_count), 1);

  const sub = await admin.get(`/api/submissions/${ctx.submission.id}`);
  assert.equal(sub.data.status, 'graded');
});

test('judge cannot edit another judge\'s score (IDOR)', async () => {
  const eid = ctx.event.id;
  // second judge via invite
  const judge2 = new Session('judge2');
  let r = await admin.post(`/api/events/${eid}/invites`, { email: email('judge2'), role: 'judge' });
  assert.equal(r.status, 201);
  await judge2.register({ fullName: 'E2E Judge 2', email: email('judge2'), eventId: eid });

  const scores = await admin.get(`/api/events/${eid}/judging/scores`);
  const first = scores.data[0];
  r = await judge2.put(`/api/events/${eid}/judging/scores/${first.id}`, { score: 1 });
  assert.equal(r.status, 403, `expected 403 editing another judge's score, got ${r.status}`);
});

test('help tickets: hacker creates, unassigned mentor cannot claim, assigned mentor claims/resolves', async () => {
  const eid = ctx.event.id;
  let r = await hackerA.post('/api/tickets', {
    eventId: eid, topic: 'Docker', description: 'container will not build', tableLocation: 'T5', priority: 'high',
  });
  assert.equal(r.status, 201, r.text);
  ctx.ticket = r.data;
  assert.equal(ctx.ticket.event_id, eid, 'ticket must be bound to the requested event');
  assert.equal(ctx.ticket.team_id, ctx.team.id);
  assert.equal(ctx.ticket.priority, 'high', 'priority sent by the hacker must be stored');

  // a mentor of a different event must not be able to claim (the suite's
  // own second event: a seeded one may be archived by the time it runs)
  const outsider = new Session('outsider-mentor');
  const second = await admin.post('/api/events', {
    event_code: `E2E-2-${RUN_ID}`, name: `E2E Second ${RUN_ID}`,
    registration_start: iso(-1 * DAY), registration_end: iso(1 * DAY), start_date: iso(2 * DAY), end_date: iso(4 * DAY),
    is_published: true,
  });
  assert.equal(second.status, 201, second.text);
  r = await admin.post(`/api/events/${second.data.id}/invites`, { email: email('outsider'), role: 'mentor' });
  assert.equal(r.status, 201);
  await outsider.register({ fullName: 'Outsider Mentor', email: email('outsider'), eventId: second.data.id });
  r = await outsider.patch(`/api/tickets/${ctx.ticket.id}/claim`);
  assert.equal(r.status, 403, `mentor not assigned to the event must not claim: ${r.status}`);

  r = await mentor.patch(`/api/tickets/${ctx.ticket.id}/claim`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'in-progress');

  r = await outsider.patch(`/api/tickets/${ctx.ticket.id}/resolve`);
  assert.equal(r.status, 403, 'only the claiming mentor (or admin) may resolve');

  r = await mentor.patch(`/api/tickets/${ctx.ticket.id}/escalate`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.escalated_to_admin, true);

  r = await mentor.patch(`/api/tickets/${ctx.ticket.id}/resolve`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'resolved');

  r = await mentor.patch(`/api/tickets/${ctx.ticket.id}/unresolve`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'in-progress');

  const mine = await hackerA.get(`/api/tickets?eventId=${eid}`);
  assert.equal(mine.data.length, 1);
  const others = await hackerD.get(`/api/tickets?eventId=${eid}`);
  assert.equal(others.data.length, 0, 'hackers only see their own tickets');
});

test('basic RBAC / IDOR protections on users', async () => {
  let r = await hackerA.get('/api/users');
  assert.equal(r.status, 403);
  r = await hackerA.patch(`/api/users/${hackerB.user.id}`, { full_name: 'Hacked' });
  assert.equal(r.status, 403);
  r = await hackerA.patch(`/api/users/${hackerA.user.id}`, { full_name: 'Renamed A' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.full_name, 'Renamed A');
  r = await hackerA.patch(`/api/users/${hackerA.user.id}/role`, { role: 'admin' });
  assert.equal(r.status, 403);
});

test('hacker stays logged in after the event ends (can view results)', async () => {
  const eid = ctx.event.id;
  let r = await admin.put(`/api/events/${eid}`, { end_date: iso(-30 * 60 * 1000), start_date: iso(-2 * DAY) });
  assert.equal(r.status, 200, r.text);
  const me = await hackerA.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.status, 'approved', 'approval must not flip to pending just because the event ended');
});

test('logout clears the session cookie', async () => {
  let r = await hackerD.post('/api/auth/logout');
  assert.equal(r.status, 200);
  r = await hackerD.get('/api/auth/me');
  assert.equal(r.status, 401);
});

test('password lifecycle: forgot/reset, change, admin set', async () => {
  const hackerEmail = email('hackerB');

  // forgot → reset. Without a mail server, development returns the link in
  // the response; with one (tests/fakeSmtp.js) the link arrives by e-mail.
  let r = await new Session('anon').post('/api/auth/forgot-password', { email: hackerEmail });
  assert.equal(r.status, 200, r.text);
  let resetUrl = r.data?.resetUrl;
  if (!resetUrl) {
    // The e-mail is sent after the response; give it a moment to arrive.
    const link = /https?:\/\/[^\s"<>]+reset-password\?token=[A-Za-z0-9_-]+/;
    for (let i = 0; i < 20 && !resetUrl; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const mail = (await mailsTo(hackerEmail)).find((m) => link.test(m.text));
      resetUrl = mail?.text.match(link)[0];
      // eslint-disable-next-line no-await-in-loop
      if (!resetUrl) await new Promise((res) => { setTimeout(res, 250); });
    }
  }
  assert.ok(resetUrl, 'the reset link is in the response (no mail server) or in the e-mail');
  const token = new URL(resetUrl).searchParams.get('token');
  assert.ok(token);

  r = await new Session('anon').post('/api/auth/forgot-password', { email: `nobody.${RUN_ID}@e2e.test` });
  assert.equal(r.status, 200, 'unknown e-mail must not be revealed');

  r = await new Session('anon').post('/api/auth/reset-password', { token, password: 'short' });
  assert.equal(r.status, 400, 'weak password rejected');
  r = await new Session('anon').post('/api/auth/reset-password', { token, password: 'NewPass123' });
  assert.equal(r.status, 200, r.text);
  r = await new Session('anon').post('/api/auth/reset-password', { token, password: 'NewPass456' });
  assert.equal(r.status, 400, 'token is single-use');

  const s = new Session('hackerB-new');
  await s.login(hackerEmail, 'NewPass123');

  // change password (requires current password)
  r = await s.post('/api/auth/change-password', { currentPassword: 'wrong', newPassword: 'Another123' });
  assert.equal(r.status, 400);
  r = await s.post('/api/auth/change-password', { currentPassword: 'NewPass123', newPassword: 'Another123' });
  assert.equal(r.status, 200, r.text);
  await new Session('hackerB-new2').login(hackerEmail, 'Another123');

  // Only the platform owner sets a participant's password: a hacker cannot,
  // and neither can the organiser — being in their event is not authority
  // over the account (anyone can be added to an event as a judge).
  r = await hackerA.patch(`/api/users/${hackerB.user.id}/password`, { password: 'Hacked1234' });
  assert.equal(r.status, 403);
  r = await admin.patch(`/api/users/${hackerB.user.id}/password`, { password: 'Temp12345' });
  assert.equal(r.status, 404, r.text);
  const owner = await ownerSession();
  r = await owner.patch(`/api/users/${hackerB.user.id}/password`, { password: 'Temp12345' });
  assert.equal(r.status, 200, r.text);
  await new Session('hackerB-temp').login(hackerEmail, 'Temp12345');
});

// ── regressions found in the 2026-08-23 audit ────────────────────────────────

test('team and sponsor names cannot be links', async () => {
  const eid = ctx.event.id;
  await hackerD.login(email('hackerD'));    // an earlier test logged this session out
  // Earlier tests moved the event into the past, which closes team formation.
  // Put the start back in the future so this test exercises validation rather
  // than the lifecycle guard.
  await admin.put(`/api/events/${eid}`, { start_date: iso(1 * DAY), end_date: iso(3 * DAY) });
  // A team in the live database was called http://…requestrepo.com — an
  // out-of-band probe that reached the database unchecked. Names travel into
  // e-mail and CSV, which do not escape the way React does.
  let r = await hackerD.post('/api/teams', { eventId: eid, name: 'http://evil.example.com' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'VALIDATION_ERROR');

  r = await hackerD.post('/api/teams', { eventId: eid, name: 'javascript:alert(1)' });
  assert.equal(r.status, 400);

  r = await admin.post(`/api/events/${eid}/sponsors`, { name: 'Sponsor', website: 'javascript:alert(1)' });
  assert.equal(r.status, 400, 'javascript: URLs must be refused');

  r = await admin.post(`/api/events/${eid}/sponsors`, { name: 'Real Sponsor', website: 'https://example.com', tier: 'gold' });
  assert.equal(r.status, 201, r.text);

  // …and neither can they contain markup. A submission in the live database was
  // called `CargoShare <img src=x onerror=alert(1)>`.
  r = await hackerD.post('/api/teams', { eventId: eid, name: 'Team <img src=x onerror=alert(1)>' });
  assert.equal(r.status, 400, 'markup in a team name must be refused');

  // A bare angle bracket is not markup and must still be accepted.
  r = await hackerD.post('/api/teams', { eventId: eid, name: 'A < B Crew' });
  assert.equal(r.status, 201, `a name containing "<" must still be allowed: ${r.text.slice(0, 120)}`);
  await hackerD.delete(`/api/teams/${r.data.id}/members/${hackerD.user.id}`);
});

test('a project name cannot smuggle markup into e-mail and CSV', async () => {
  await admin.put(`/api/events/${ctx.event.id}`, { start_date: iso(-1 * DAY), end_date: iso(2 * DAY) });
  // project_name only had a length check, so the payload above reached the
  // database. React escapes it; e-mail, Telegram and CSV export do not.
  const r = await hackerA.post('/api/submissions', {
    eventId: ctx.event.id,
    project_name: 'CargoShare <img src=x onerror=alert(1)>',
    description: 'probe',
    repo_link: 'https://github.com/e2e/probe',
  });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'VALIDATION_ERROR');

  // The real submission is untouched by the rejected write.
  const still = await hackerA.get(`/api/submissions?eventId=${ctx.event.id}`);
  assert.equal(still.data.length, 1);
  assert.ok(!String(still.data[0].project_name).includes('<img'));
});

test('an event that has finished is still the one the app falls back to', async () => {
  // Every event in the real database had ended, and getActiveEvent required
  // end_date >= now(), so participants' dashboards went blank the day the
  // hackathon closed. Move the E2E event fully into the past and check that
  // the event-less endpoints still resolve to it.
  const eid = ctx.event.id;
  let r = await admin.put(`/api/events/${eid}`, {
    start_date: iso(-5 * DAY),
    end_date: iso(-2 * DAY),
  });
  assert.equal(r.status, 200, r.text);

  // The fallback never 404s any more. Which event wins depends on what else
  // lives in the database (a still-upcoming event outranks a finished one), so
  // assert the part that regressed: it resolves to something.
  r = await hackerA.get('/api/events/active');
  assert.equal(r.status, 200, 'active-event lookup must not 404 once every event has ended');

  // Scoped to the finished event, the roster and the project are still there.
  r = await hackerA.get(`/api/teams/mine?eventId=${eid}`);
  assert.equal(r.status, 200);
  assert.ok(r.data, 'the team must survive the event ending');
  assert.equal(r.data.id, ctx.team.id);

  r = await hackerA.get(`/api/submissions?eventId=${eid}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.length, 1, 'the submission must still be visible after the event ends');
});

test('a user with no team gets data: null, not a missing field', async () => {
  await hackerD.login(email('hackerD'));   // the logout test above ended this session
  const r = await hackerD.get(`/api/teams/mine?eventId=${ctx.event.id}`);
  assert.equal(r.status, 200);
  assert.ok('data' in r.json, 'the data key must be present even when it is null');
  assert.equal(r.json.data, null);
});



test('a judge who scored only some criteria neither drags the leaderboard down nor counts yet', async () => {
  const eid = ctx.event.id;
  const subs = await admin.get(`/api/submissions?eventId=${eid}`);
  const submissionId = subs.data[0].id;
  const criteria = (await admin.get(`/api/events/${eid}/judging/criteria`)).data;

  const before = (await admin.get(`/api/events/${eid}/judging/leaderboard`)).data
    .find((row) => row.id === submissionId);

  // A second judge records a single criterion and stops — the common case when
  // a judge runs out of time. Under the old formula this alone could halve the
  // project's score; then it counted as a full review out of that criterion.
  // Now an unfinished review is left out until every criterion is scored.
  const judge2 = new Session('judge-partial');
  let r = await admin.post(`/api/events/${eid}/invites`, { email: email('judgePartial'), role: 'judge' });
  assert.equal(r.status, 201);
  await judge2.register({ fullName: 'Partial Judge', email: email('judgePartial'), eventId: eid });
  r = await judge2.post(`/api/events/${eid}/judging/scores`, {
    submissionId, criterionId: criteria[0].id, score: criteria[0].max_score,
  });
  assert.equal(r.status, 201, r.text);

  const after = (await admin.get(`/api/events/${eid}/judging/leaderboard`)).data
    .find((row) => row.id === submissionId);

  assert.equal(Number(after.judges_count), Number(before.judges_count), 'the partial review is not counted');
  assert.equal(Number(after.percent), Number(before.percent), 'nor does it move the score');
});

test('an event reports where it actually is, not the status nobody updates', async () => {
  // Nothing in the app ever advanced `status`: all three events in the live
  // database still said "upcoming" months after they finished, so the phase
  // badge and the notifications bell were wrong for every one of them. The
  // stored value is left alone — an organiser may have set it deliberately —
  // and every read carries a derived one alongside it.
  const eid = ctx.event.id;

  const phases = [
    { label: 'upcoming',  start: 2 * DAY,  end: 6 * DAY },
    { label: 'ongoing',   start: -1 * DAY, end: 1 * DAY },
    { label: 'completed', start: -5 * DAY, end: -2 * DAY },
  ];

  for (const phase of phases) {
    let r = await admin.put(`/api/events/${eid}`, {
      start_date: iso(phase.start),
      end_date: iso(phase.end),
    });
    assert.equal(r.status, 200, r.text);

    r = await admin.get(`/api/events/${eid}`);
    assert.equal(r.status, 200, r.text);
    assert.equal(
      r.data.derived_status, phase.label,
      `dates ${phase.start}..${phase.end} should read as ${phase.label}`,
    );
    assert.equal(
      r.data.status, 'upcoming',
      'the stored status must be left exactly as the organiser set it',
    );
  }
});

test('registration cannot outlive the event it belongs to', async () => {
  // The live database holds an event whose registration closed a week after
  // the hackathon finished, because only `end_date > start_date` was checked.
  const eid = ctx.event.id;

  let r = await admin.put(`/api/events/${eid}`, {
    start_date: iso(2 * DAY),
    end_date: iso(6 * DAY),
    registration_start: iso(-1 * DAY),
    registration_end: iso(5 * DAY),
  });
  assert.equal(r.status, 200, r.text);

  // Sending the offending date itself is bad input and is refused.
  r = await admin.put(`/api/events/${eid}`, { registration_end: iso(9 * DAY) });
  assert.equal(r.status, 400, 'registration must not be allowed to close after the event ends');
  assert.match(r.text, /registration_end/);

  r = await admin.put(`/api/events/${eid}`, { registration_start: iso(3 * DAY) });
  assert.equal(r.status, 400, 'registration must not be allowed to open after the event starts');

  // Only moving the boundary drags the dependent date along instead of
  // erroring — an organiser shortening an event should not get a complaint
  // about a field they never touched.
  r = await admin.put(`/api/events/${eid}`, { end_date: iso(4 * DAY) });
  assert.equal(r.status, 200, r.text);

  r = await admin.get(`/api/events/${eid}`);
  assert.equal(r.status, 200);
  const regEnd = new Date(r.data.registration_end).getTime();
  const endDate = new Date(r.data.end_date).getTime();
  assert.ok(
    regEnd <= endDate,
    `registration_end (${r.data.registration_end}) should have been pulled back to end_date (${r.data.end_date})`,
  );
});

test('a self-serve buyer sees nothing of other organisations', async () => {
  const eid = ctx.event.id;
  const buyer = new Session('buyer');
  await buyer.register({ fullName: 'E2E Buyer', email: email('buyer') });
  let r = await buyer.post('/api/checkout', {
    plan: 'starter', billingPeriod: 'per_event', organisation: `E2E Buyer Org ${RUN_ID}`, acceptTerms: true,
    // A modified client sending card fields with a bank transfer: none of them is kept.
    payment: { method: 'bank_transfer', card: { brand: 'visa', last4: '4242', number: '4242424242424242', cvc: '123' } },
  });
  assert.equal(r.status, 201, r.text);
  const placed = r.data.order;
  assert.equal(placed.status, 'pending');
  assert.equal(placed.card_last4, null);
  assert.equal(placed.card_brand, null);
  const stored = await dbQuery('SELECT row_to_json(o)::text AS j FROM orders o WHERE id = $1', [placed.id]);
  assert.ok(!stored.rows[0].j.includes('4242424242424242'), 'the card number is never stored');
  assert.ok(!stored.rows[0].j.includes('"123"'), 'the security code is never stored');

  // Nothing is granted before the owner approves.
  r = await buyer.get('/api/auth/me');
  assert.notEqual(r.data.role, 'org_admin', 'a buyer is not an organiser before approval');
  r = await buyer.post('/api/events', { event_code: `PRE-${RUN_ID}`.slice(0, 20), name: 'Too early', start_date: iso(2 * DAY), end_date: iso(3 * DAY) });
  assert.equal(r.status, 403, 'no events before approval');

  const owner = await ownerSession();
  r = await owner.post(`/api/orders/${placed.id}/approve`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.order.status, 'delivered');
  assert.equal(r.data.entitlement.kind, 'per_event');
  assert.equal(r.data.entitlement.events_allowed, 1);
  assert.match(r.data.setupUrl, /\/setup\/[A-Za-z0-9_-]{20,}$/);

  const signIn = await buyer.login(email('buyer'));
  const me = await buyer.get('/api/auth/me');
  assert.equal(me.data.role, 'org_admin', 'a buyer manages their organisation');
  assert.equal(signIn.data.role, me.data.role,
    'sign-in reports the role /me reports; the web app keeps it in a cookie the API checks');

  // The E2E event belongs to no customer: it used to be visible to every organiser.
  // An event with no customer, as every pre-tenancy event in production is.
  // Created straight in the database: through the API an event always gets
  // its organiser's customer.
  require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
  const { Client } = require('pg');
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  let orphanId;
  try {
    const ins = await pg.query(
      `INSERT INTO events (name, event_code, start_date, end_date, customer_id, created_by)
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '1 day', NULL, NULL) RETURNING id`,
      [`E2E Orphan ${RUN_ID}`, `ORPH${RUN_ID}`.slice(0, 20)],
    );
    orphanId = ins.rows[0].id;

    r = await buyer.get('/api/events');
    assert.ok(!r.data.some((e) => e.id === orphanId), 'an event with no customer must not be listed to a new organiser');
    r = await buyer.get(`/api/events/${orphanId}/participants`);
    assert.equal(r.status, 404, 'an event with no customer must not be readable by a new organiser');
  } finally {
    if (orphanId) await pg.query('DELETE FROM events WHERE id = $1', [orphanId]);
    await pg.end();
  }

  // Every event the buyer can list is theirs: created by them or their
  // customer's. Unassigned events (no customer) used to be listed to every
  // organiser, which is how a stranger reached other organisations' data.
  const buyerCustomerId = (await buyer.get('/api/me/orders')).data?.orders?.[0]?.customer_id;
  r = await buyer.get('/api/events');
  assert.equal(r.status, 200, r.text);
  assert.ok(!r.data.some((e) => e.id === eid), 'another organisation\'s event must not be listed');
  for (const e of r.data) {
    assert.ok(
      e.created_by === buyer.user.id || (e.customer_id != null && e.customer_id === buyerCustomerId),
      `event ${e.id} (customer ${e.customer_id}) is not the buyer's`,
    );
  }

  // A published event is public; only its public columns may come back.
  r = await buyer.get(`/api/events/${eid}`);
  if (r.status === 200) {
    assert.equal(r.data.created_by, undefined, 'only the public view of another organisation\'s event');
    assert.equal(r.data.customer_id, undefined, 'only the public view of another organisation\'s event');
  }

  r = await buyer.get(`/api/events/${eid}/participants`);
  assert.equal(r.status, 404, 'another organisation\'s participants must not be readable');

  r = await buyer.get('/api/events/active');
  assert.ok(r.status === 404 || r.data?.id !== eid, 'the "active event" must not be someone else\'s');

  r = await buyer.get('/api/users');
  assert.equal(r.status, 200, r.text);
  const users = r.data?.users || r.data?.rows || r.data || [];
  assert.ok(Array.isArray(users), 'user list shape');
  assert.ok(!users.some((u) => String(u.email).toLowerCase() === 'admin@test.com'), 'other organisers must not be listed');

  r = await buyer.patch(`/api/users/${admin.user.id}/password`, { password: 'Pwned1234!' });
  assert.ok(r.status === 403 || r.status === 404, `password of another organiser must not be settable (got ${r.status})`);

  // With an event of their own, the buyer still cannot reach into another
  // event by putting its row ids under their own event's URL.
  // A draft is free; going public takes the plan's event. This older route
  // publishes on create, so it takes the credit there.
  r = await buyer.post('/api/events', {
    event_code: `BUY0-${RUN_ID}`.slice(0, 20), name: `Buyer draft ${RUN_ID}`,
    start_date: iso(2 * DAY), end_date: iso(3 * DAY),
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.entitlement_id, null, 'a draft takes nothing from the plan');
  const draftId = r.data.id;
  r = await buyer.post('/api/events', {
    event_code: `BUY-${RUN_ID}`.slice(0, 20), name: `Buyer event ${RUN_ID}`,
    start_date: iso(2 * DAY), end_date: iso(3 * DAY), is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  const own = r.data.id;
  assert.ok(r.data.entitlement_id, 'the published event takes the plan\'s one event');
  r = await buyer.post('/api/events', {
    event_code: `BUY2-${RUN_ID}`.slice(0, 20), name: `Buyer second ${RUN_ID}`,
    start_date: iso(2 * DAY), end_date: iso(3 * DAY), is_published: true,
  });
  assert.equal(r.status, 402, 'a per-event purchase is one event');
  assert.equal(r.json.code, 'NO_EVENT_CREDIT');
  r = await buyer.put(`/api/events/${draftId}`, { is_published: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.is_published, false, 'an update cannot publish around the plan');
  r = await buyer.delete(`/api/events/${draftId}`);
  assert.equal(r.status, 200, r.text);
  r = await admin.post(`/api/events/${eid}/sponsors`, { name: 'Victim Sponsor', website: 'https://example.com', tier: 'gold' });
  assert.equal(r.status, 201, r.text);
  const victimSponsor = r.data.id;
  r = await buyer.delete(`/api/events/${own}/sponsors/${victimSponsor}`);
  assert.equal(r.status, 404, 'a sponsor of another event must not be deletable through your own event');
  r = await buyer.put(`/api/events/${own}/sponsors/${victimSponsor}`, { name: 'Hijacked' });
  assert.equal(r.status, 404, 'a sponsor of another event must not be editable through your own event');
  r = await admin.get(`/api/events/${eid}/sponsors`);
  assert.ok(r.data.some((x) => x.id === victimSponsor && x.name === 'Victim Sponsor'), 'the sponsor is untouched');

  r = await buyer.patch(`/api/teams/${ctx.team.id}/status`, { status: 'eliminated', reason: 'x' });
  assert.equal(r.status, 404, 'another organisation\'s team must not be eliminable');
  r = await buyer.delete(`/api/teams/${ctx.team.id}`);
  assert.equal(r.status, 404, 'another organisation\'s team must not be deletable');
  r = await buyer.get(`/api/teams/${ctx.team.id}/members`);
  assert.equal(r.status, 404, 'another organisation\'s team members must not be listed');

  r = await buyer.delete(`/api/events/${own}`);
  assert.equal(r.status, 200, r.text);
});

test('website contact form reaches the sales inbox, not the visitor', async () => {
  const visitor = new Session('visitor');
  let r = await visitor.post('/api/leads', { name: 'E2E Visitor', email: email('lead'), organisation: 'E2E Org', message: 'Hello' });
  assert.equal(r.status, 200, r.text);
  r = await visitor.post('/api/leads', { name: '', email: 'not-an-address' });
  assert.equal(r.status, 400);
  r = await visitor.post('/api/leads', { name: 'Bot', email: email('bot'), website: 'http://spam.example' });
  assert.equal(r.status, 200, 'a bot gets no signal from the honeypot');
});

test('organiser eliminates a team and restores it', async () => {
  let r = await admin.patch(`/api/teams/${ctx.team.id}/status`, { status: 'eliminated', reason: 'E2E rule check' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'eliminated');
  assert.ok(r.data.eliminated_at, 'eliminated_at is stamped');
  r = await admin.patch(`/api/teams/${ctx.team.id}/status`, { status: 'active' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'active');
  assert.equal(r.data.eliminated_at, null);
});

test('open registration closes; an invited person can still sign up', async () => {
  const eid = ctx.event.id;
  let r = await admin.put(`/api/events/${eid}`, { registration_start: iso(-3 * DAY), registration_end: iso(-1 * DAY) });
  assert.equal(r.status, 200, r.text);

  const late = new Session('late');
  r = await late.post('/api/auth/register', { fullName: 'Too Late', email: email('late'), password: 'Test1234!', eventId: eid });
  assert.equal(r.status, 403, r.text);
  assert.match(r.text, /REGISTRATION_CLOSED/);

  r = await admin.post(`/api/events/${eid}/invites`, { email: email('latejudge'), role: 'judge' });
  assert.equal(r.status, 201, r.text);
  const lateJudge = new Session('latejudge');
  const j = await lateJudge.register({ fullName: 'Late Judge', email: email('latejudge'), eventId: eid });
  assert.deepEqual(j.pendingInvite, { eventId: eid, role: 'judge' }, 'the closed window does not stop the account');
  assert.equal(lateJudge.user.role, 'judge', 'confirmed: the invitation is theirs');
});

test('no one but the owner mints accounts; non-participants cannot read an event\'s staff', async () => {
  const eid = ctx.event.id;

  // A self-serve buyer is an organiser after checkout; they must not be able
  // to create a platform owner or import people into someone else's event.
  const buyer2 = new Session('buyer2');
  await buyer2.register({ fullName: 'E2E Buyer Two', email: email('buyer2') });
  let r = await buyer2.post('/api/checkout', { plan: 'starter', billingPeriod: 'per_event', organisation: `E2E Buyer Two ${RUN_ID}`, acceptTerms: true });
  assert.equal(r.status, 201, r.text);
  r = await (await ownerSession()).post(`/api/orders/${r.data.order.id}/approve`, {});
  assert.equal(r.status, 200, r.text);
  await buyer2.login(email('buyer2'));
  r = await buyer2.post('/api/users', { fullName: 'Evil Owner', email: email('evil'), password: 'Test1234!', role: 'superadmin' });
  assert.equal(r.status, 403, 'an organiser must not be able to create a superadmin');
  r = await buyer2.post('/api/users/bulk-import', { eventId: eid, users: [{ fullName: 'Bulk X', email: email('bulkx') }] });
  assert.equal(r.status, 404, 'import into another organisation\'s event must be refused');

  // A signed-in hacker who is not registered for the event.
  const outsider = new Session('stranger');
  await outsider.register({ fullName: 'E2E Stranger', email: email('stranger') });
  for (const path of ['judging/judges', 'judging/leaderboard', 'mentors', 'resources', 'presentations']) {
    r = await outsider.get(`/api/events/${eid}/${path}`);
    assert.equal(r.status, 404, `${path} must not be readable by someone not registered for the event`);
  }

  // A registered participant sees the judges, without their e-mail addresses.
  r = await hackerA.get(`/api/events/${eid}/judging/judges`);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.length > 0, 'the event has judges');
  assert.ok(r.data.every((j) => j.email === undefined), 'participants must not receive judge e-mail addresses');
});

test('an organiser can open their own unpublished event by id', async () => {
  let r = await admin.post('/api/events', {
    event_code: `DRAFT-${RUN_ID}`.slice(0, 20), name: `Draft ${RUN_ID}`, is_published: false,
    start_date: iso(5 * DAY), end_date: iso(6 * DAY),
  });
  assert.equal(r.status, 201, r.text);
  const id = r.data.id;
  r = await admin.get(`/api/events/${id}`);
  assert.equal(r.status, 200, 'the organiser must see their own draft');
  assert.notEqual(r.data.created_by, undefined, 'the organiser gets the full record, not the public view');
  r = await new Session('anon-draft').get(`/api/events/${id}`);
  assert.equal(r.status, 404, 'a draft stays hidden from the public');
  r = await admin.delete(`/api/events/${id}`);
  assert.equal(r.status, 200, r.text);
});

test('one account, different roles in different events', async () => {
  const eid = ctx.event.id;
  // A second event of the same organiser.
  let r = await admin.post('/api/events', {
    event_code: `ROLE-${RUN_ID}`.slice(0, 20), name: `Second ${RUN_ID}`,
    start_date: iso(3 * DAY), end_date: iso(4 * DAY), is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  const second = r.data.id;

  // hackerA takes part in the first event and is added as a judge of the second.
  r = await admin.post(`/api/events/${second}/invites`, { email: email('hackerA'), role: 'judge' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.assigned, true, 'an existing account is put on the event straight away');

  r = await hackerA.get(`/api/events/${second}/judging/criteria`);
  assert.equal(r.status, 200, 'judge routes of the second event open for them');
  r = await hackerA.get(`/api/events/${eid}/judging/criteria`);
  assert.equal(r.status, 403, 'but not of the event they take part in');

  r = await hackerA.get('/api/me/workspaces');
  assert.equal(r.status, 200, r.text);
  const roles = Object.fromEntries(r.data.events.map((e) => [e.id, e.role]));
  assert.equal(roles[eid], 'participant');
  assert.equal(roles[second], 'judge');

  // The workspace picker's cookie switches the role /me reports.
  hackerA.cookies.set('hh_event', String(second));
  r = await hackerA.get('/api/auth/me');
  assert.equal(r.data.role, 'judge');
  hackerA.cookies.set('hh_event', String(eid));
  r = await hackerA.get('/api/auth/me');
  assert.equal(r.data.role, 'hacker');
  assert.equal(r.data.status, 'approved', 'status follows the event in use');
  hackerA.cookies.set('hh_event', String(second));
  r = await hackerA.login(email('hackerA'));
  assert.equal(r.data.role, 'judge', 'signing in reports the role of the workspace in use');
  hackerA.cookies.delete('hh_event');
  r = await hackerA.login(email('hackerA'));
  assert.equal(r.data.role, 'hacker');

  r = await admin.delete(`/api/events/${second}`);
  assert.equal(r.status, 200, r.text);
});

test('changing the password signs out every other session', async () => {
  const one = new Session('dev-one');
  await one.register({ fullName: 'E2E Devices', email: email('devices') });
  await one.login(email('devices'));
  const two = new Session('dev-two');
  two.cookies = new Map(one.cookies);

  let r = await one.post('/api/auth/change-password', { currentPassword: 'Test1234!', newPassword: 'Test5678!' });
  assert.equal(r.status, 200, r.text);
  r = await one.get('/api/auth/me');
  assert.equal(r.status, 200, 'the device that changed it stays signed in');
  r = await two.get('/api/auth/me');
  assert.equal(r.status, 401, 'other devices are signed out');

  r = await one.post('/api/auth/logout-all', {});
  assert.equal(r.status, 200, r.text);
  r = await one.get('/api/auth/me');
  assert.equal(r.status, 401, 'sign out everywhere includes this device');
});

test('only the platform owner can use the second-step endpoint', async () => {
  const s = new Session('not-owner');
  await s.register({ fullName: 'E2E Not Owner', email: email('notowner') });
  await s.login(email('notowner'));
  const r = await s.post('/api/auth/elevate', { pin: '000000' });
  assert.equal(r.status, 403, r.text);
});

test('bank transfer is invoiced on approval; only the organisation can download it', async () => {
  const buyer = new Session('payer');
  await buyer.register({ fullName: 'E2E Payer', email: email('payer') });
  let r = await buyer.post('/api/checkout', {
    plan: 'professional', billingPeriod: 'annual', organisation: `E2E Payer Org ${RUN_ID}`,
    vatId: '1700000001', country: 'Azerbaijan', city: 'Baku', payment: { method: 'bank_transfer' }, acceptTerms: true,
  });
  assert.equal(r.status, 201, r.text);
  const order = r.data.order;
  assert.equal(order.invoice_number, null, 'the invoice comes with approval');
  assert.equal(order.payment_method, 'bank_transfer');

  const pdf = await fetch(`${process.env.API_URL || 'http://localhost:5000'}/api/me/orders/${order.id}/invoice.pdf`, {
    headers: { Cookie: [...buyer.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
  });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');

  r = await hackerA.get(`/api/me/orders/${order.id}/invoice.pdf`);
  assert.equal(r.status, 404, 'someone else\'s invoice answers like a missing one');

  r = await buyer.get('/api/me/orders');
  const mine = r.data.orders.find((o) => o.id === order.id);
  assert.ok(mine, 'the buyer sees the order');
  assert.equal(mine.notes, undefined, 'the owner\'s notes stay internal');

  // Money arrives: placed → paid, then approval keeps the payment.
  const owner = await ownerSession();
  r = await owner.post(`/api/orders/${order.id}/payment`, { method: 'bank_transfer', reference: 'TRX-1' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.order.status, 'paid');
  assert.ok(r.data.order.paid_at);
  r = await owner.post(`/api/orders/${order.id}/approve`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.entitlement.kind, 'annual');
  assert.equal(r.data.entitlement.events_allowed, 6);
  assert.ok(r.data.order.paid_at, 'approval keeps the payment');
  assert.match(r.data.order.invoice_number, /^INV-\d{4}-\d{4,}$/, 'and issues the invoice');
  r = await owner.post(`/api/orders/${order.id}/approve`, {});
  assert.equal(r.status, 409, 'an order is approved once');
});

test('the setup link: one use, only by the account it was sent to', async () => {
  const { session: buyer, approval, customerId } = await approvedBuyer('setup');
  const token = approval.setupUrl.split('/setup/')[1];

  let r = await new Session('anon-setup').get(`/api/setup/${token}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.state, 'valid');
  assert.ok(!r.data.email.includes(email('setup')), 'the address is masked');
  assert.match(r.data.organisation.name, /E2E setup Org/);

  const other = new Session('setup-other');
  await other.register({ fullName: 'E2E Setup Other', email: email('setupother') });
  r = await other.post(`/api/setup/${token}`, { timezone: 'Asia/Baku' });
  assert.equal(r.status, 403, 'another account cannot use the link');

  r = await buyer.post(`/api/setup/${token}`, { timezone: 'Mars/Olympus' });
  assert.equal(r.status, 400, 'an unknown time zone is refused');
  r = await buyer.post(`/api/setup/${token}`, { logoUrl: 'javascript:alert(1)' });
  assert.equal(r.status, 400, 'only https links');

  r = await buyer.post(`/api/setup/${token}`, {
    timezone: 'Asia/Baku', locale: 'az', brandColor: '#C8102E', website: 'https://example.az',
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.brandColor, '#C8102E');
  const org = await dbQuery('SELECT onboarded_at, status FROM customers WHERE id = $1', [customerId]);
  assert.ok(org.rows[0].onboarded_at, 'setup is recorded');
  assert.equal(org.rows[0].status, 'active');

  r = await buyer.post(`/api/setup/${token}`, { timezone: 'Asia/Baku' });
  assert.equal(r.status, 410, 'the link works once');
  r = await new Session('anon-setup2').get(`/api/setup/${token}`);
  assert.equal(r.data.state, 'used');
});

test('a refused order says why and closes the organisation it created', async () => {
  const buyer = new Session('refused');
  await buyer.register({ fullName: 'E2E Refused', email: email('refused') });
  let r = await buyer.post('/api/checkout', { plan: 'starter', billingPeriod: 'per_event', organisation: `E2E Refused Org ${RUN_ID}`, acceptTerms: true });
  assert.equal(r.status, 201, r.text);
  const order = r.data.order;
  r = await buyer.post('/api/checkout', { plan: 'starter', billingPeriod: 'event', organisation: `E2E Refused Org ${RUN_ID}`, acceptTerms: true });
  assert.equal(r.status, 400, 'an unknown billing period is an error, not "annual"');
  const owner = await ownerSession();
  r = await owner.post(`/api/orders/${order.id}/reject`, {});
  assert.equal(r.status, 400, 'a reason is required');
  r = await owner.post(`/api/orders/${order.id}/reject`, { reason: 'We could not verify the organisation.' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.order.status, 'cancelled');
  r = await buyer.get('/api/me/orders');
  const mine = r.data.orders.find((o) => o.id === order.id);
  assert.equal(mine.status_reason, 'We could not verify the organisation.');
  const org = await dbQuery('SELECT status FROM customers WHERE id = $1', [order.customer_id]);
  assert.equal(org.rows[0].status, 'cancelled');
  r = await owner.post(`/api/orders/${order.id}/approve`, {});
  assert.equal(r.status, 409, 'a refused order cannot be approved');
  r = await buyer.post(`/api/orders/${order.id}/approve`, {});
  assert.equal(r.status, 403, 'only the owner decides');
});

test('plans decide modules; the owner can switch one on for an organisation', async () => {
  const { session: buyer, customerId } = await approvedBuyer('modules');
  let r = await buyer.post('/api/events', {
    event_code: `MOD-${RUN_ID}`.slice(0, 20), name: `Modules ${RUN_ID}`, start_date: iso(5 * DAY), end_date: iso(6 * DAY),
  });
  assert.equal(r.status, 201, r.text);
  const ev = r.data.id;

  r = await buyer.get(`/api/events/${ev}/modules`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.plan, 'starter');
  assert.ok(r.data.modules.includes('judging'));
  assert.ok(!r.data.modules.includes('mentors'), 'Starter has no mentors');
  assert.equal(r.data.limits.participants, require('../src/constants/plans').PLANS.starter.participants);

  r = await buyer.get(`/api/events/${ev}/mentors`);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'MODULE_DISABLED');

  const owner = await ownerSession();
  r = await owner.put(`/api/customers/${customerId}/modules/mentors`, { enabled: true, note: 'trial' });
  assert.equal(r.status, 200, r.text);
  r = await buyer.get(`/api/events/${ev}/mentors`);
  assert.equal(r.status, 200, 'switched on for this organisation');
  r = await owner.put(`/api/customers/${customerId}/modules/mentors`, { enabled: null });
  r = await buyer.get(`/api/events/${ev}/mentors`);
  assert.equal(r.status, 403, 'back to the plan');

  r = await owner.put(`/api/customers/${customerId}/modules/nonsense`, { enabled: true });
  assert.equal(r.status, 400);

  // An unpublished event gives its credit back when deleted.
  r = await buyer.delete(`/api/events/${ev}`);
  assert.equal(r.status, 200, r.text);
  r = await owner.get(`/api/customers/${customerId}/plan`);
  assert.equal(r.data.eventsRemaining, 1, 'the credit came back');

  // Events from before plans keep everything.
  r = await admin.get(`/api/events/${ctx.event.id}/modules`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.plan, null);
  assert.ok(r.data.modules.includes('mentors') && r.data.modules.includes('certificates'));
});

test('cleanup: admin archives and deletes the E2E event', async () => {
  const eid = ctx.event.id;
  let r = await admin.post(`/api/events/${eid}/archive`);
  assert.equal(r.status, 200);
  r = await admin.delete(`/api/events/${eid}`);
  assert.equal(r.status, 200, r.text);
  r = await admin.get(`/api/events/${eid}`);
  assert.equal(r.status, 404);
});
