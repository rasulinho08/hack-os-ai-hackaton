/**
 * Who may compete, end to end against a running API: only participants the
 * organiser approved hand in a project, and a team is judged, voted for and
 * ranked only while it has an approved member.
 *
 * Covers: a pending lead cannot submit; rejecting a lead takes them off the
 * team and hands it to an approved teammate, who can then hand in; a lead
 * eliminated on their own hands over too but stays on the team; a team left
 * with no approved member keeps its project but leaves the judge's list, the
 * vote and the ranking (reported apart); rejected members no longer count
 * towards the team size; while a lead is not approved (pending, or rejected
 * before rejecting took people off their team), an approved member hands
 * in the project instead.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, confirmEmail } = require('./helpers');
const { dbQuery } = require('./fixtures');

const HOUR = 3600e3;
const admin = new Session('el-admin');
const ctx = { people: {}, teams: {} };

const userIdOf = async (mail) => (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [mail])).rows[0].id;
const pidOf = async (userId) => (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, userId])).rows[0].id;
const setStatus = async (key, status) => admin.patch(`/api/events/${ctx.ev.id}/participants/${ctx.people[key].pid}`, { status });
const teamRow = async (key) => (await dbQuery(
  `SELECT t.leader_id, ARRAY(SELECT user_id FROM team_members WHERE team_id = t.id ORDER BY user_id) AS members
     FROM teams t WHERE t.id = $1`,
  [ctx.teams[key].id],
)).rows[0];
const project = (key) => ({ projectName: `Project ${key} ${RUN_ID}`, description: 'x', repoLink: `https://github.com/el/${key}${RUN_ID}` });

async function register(key, { approve = true } = {}) {
  const s = new Session(`el-${key}`);
  const r = await s.post(`/api/public/events/${ctx.ev.slug}/register`, {
    account: { fullName: `Person ${key}`, email: email(`el-${key}`), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  await confirmEmail(email(`el-${key}`));
  await s.login(email(`el-${key}`));
  const userId = await userIdOf(email(`el-${key}`));
  ctx.people[key] = { s, userId, pid: await pidOf(userId) };
  if (approve) assert.equal((await setStatus(key, 'approved')).status, 200);
  return ctx.people[key];
}

test('setup: an event with a judge, people\'s choice, and three teams', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  let r = await admin.post('/api/events', {
    event_code: `EL${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Eligibility ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, { items: [{ cid: 'a', name: 'A', maxScore: 10, weight: 1 }] });
  assert.equal(r.status, 200, r.text);
  ctx.crit = r.data.idsByCid.a;
  assert.equal((await admin.patch(`/api/events/${ctx.ev.id}/builder`, { judging_config: { peopleChoice: true, votingStart: iso(-60e3) } })).status, 200);

  // Alpha: two approved. Rockets: approved lead and member. Gamma: a pending lead.
  // Pend: a pending lead and an approved member. Legacy: two approved (the lead is rejected later).
  for (const key of ['a1', 'a2', 'r1', 'r2', 'v', 'p2', 'q1', 'q2']) {
    // eslint-disable-next-line no-await-in-loop
    await register(key);
  }
  await register('g1', { approve: false });
  await register('p1', { approve: false });
  for (const [key, members] of [['alpha', ['a1', 'a2']], ['rockets', ['r1', 'r2']], ['gamma', ['g1']], ['pend', ['p1', 'p2']], ['legacy', ['q1', 'q2']]]) {
    const ids = members.map((m) => ctx.people[m].userId);
    // eslint-disable-next-line no-await-in-loop
    r = await admin.post('/api/teams', { eventId: ctx.ev.id, name: `Team ${key} ${RUN_ID}`, memberIds: ids, leaderId: ids[0] });
    assert.equal(r.status, 201, r.text);
    ctx.teams[key] = { id: r.data.id };
  }
  await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email('el-judge'), role: 'judge' });
  ctx.judge = new Session('el-judge');
  await ctx.judge.register({ fullName: 'Judge El', email: email('el-judge'), eventCode: ctx.ev.event_code });
  await dbQuery('UPDATE events SET start_date = $2, end_date = $3 WHERE id = $1', [ctx.ev.id, iso(-HOUR), iso(DAY)]);
  // The organiser opened judging while submissions are still open (rolling
  // judging); without a judging start it opens when submissions close.
  await dbQuery("UPDATE events SET judging_start = now() - interval '1 minute' WHERE id = $1", [ctx.ev.id]);
});

test('a participant the organiser has not approved cannot hand in a project', async () => {
  const r = await ctx.people.g1.s.post('/api/submissions', { eventId: ctx.ev.id, ...project('gamma') });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'HACKER_NOT_APPROVED');
  const none = await dbQuery('SELECT 1 FROM submissions WHERE team_id = $1', [ctx.teams.gamma.id]);
  assert.equal(none.rowCount, 0);
});

test('rejecting a lead takes them off the team; an approved teammate leads and hands in', async () => {
  let r = await ctx.people.r1.s.post('/api/submissions', { eventId: ctx.ev.id, ...project('rockets') });
  assert.equal(r.status, 201, r.text);
  ctx.teams.rockets.sub = r.data.id;

  r = await setStatus('r1', 'rejected');
  assert.equal(r.status, 200, r.text);
  const t = await teamRow('rockets');
  assert.equal(t.leader_id, ctx.people.r2.userId, 'the approved teammate leads now');
  assert.deepEqual(t.members, [ctx.people.r2.userId], 'the rejected lead left the team');
  const lead = await dbQuery('SELECT user_id FROM participants WHERE event_id = $1 AND is_team_lead', [ctx.ev.id]);
  assert.ok(lead.rows.some((x) => x.user_id === ctx.people.r2.userId) && !lead.rows.some((x) => x.user_id === ctx.people.r1.userId));

  r = await ctx.people.r2.s.put(`/api/submissions/${ctx.teams.rockets.sub}`, { ...project('rockets'), description: 'Handed in by the new lead' });
  assert.equal(r.status, 200, r.text);
  r = await ctx.people.r1.s.put(`/api/submissions/${ctx.teams.rockets.sub}`, { ...project('rockets'), description: 'Still me?' });
  assert.equal(r.status, 403, 'the rejected person has no say any more');
});

test('a lead eliminated on their own hands over, and stays on the team', async () => {
  let r = await ctx.people.a1.s.post('/api/submissions', { eventId: ctx.ev.id, ...project('alpha') });
  assert.equal(r.status, 201, r.text);
  ctx.teams.alpha.sub = r.data.id;
  r = await setStatus('a1', 'eliminated');
  assert.equal(r.status, 200, r.text);
  const t = await teamRow('alpha');
  assert.equal(t.leader_id, ctx.people.a2.userId);
  assert.deepEqual(t.members, [ctx.people.a1.userId, ctx.people.a2.userId].sort((x, y) => x - y));
  r = await ctx.people.a1.s.put(`/api/submissions/${ctx.teams.alpha.sub}`, project('alpha'));
  assert.equal(r.status, 403);
  assert.equal((await setStatus('a1', 'approved')).status, 200);
});

test('a team without an approved member is not judged, voted for or ranked', async () => {
  // Gamma's lead is approved, hands in, then is rejected: the project stays, nobody is left.
  assert.equal((await setStatus('g1', 'approved')).status, 200);
  let r = await ctx.people.g1.s.post('/api/submissions', { eventId: ctx.ev.id, ...project('gamma') });
  assert.equal(r.status, 201, r.text);
  ctx.teams.gamma.sub = r.data.id;
  assert.equal((await setStatus('g1', 'rejected')).status, 200);
  const t = await teamRow('gamma');
  assert.ok(t, 'a team that handed in a project is kept');
  assert.deepEqual(t.members, []);

  r = await ctx.judge.get(`/api/events/${ctx.ev.id}/judging/me`);
  assert.equal(r.status, 200, r.text);
  const listed = r.data.teams.map((x) => x.teamId);
  assert.ok(listed.includes(ctx.teams.alpha.id) && listed.includes(ctx.teams.rockets.id));
  assert.ok(!listed.includes(ctx.teams.gamma.id), 'not on the judge\'s list');
  r = await ctx.judge.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, { submissionId: ctx.teams.gamma.sub, scores: [{ criterionId: ctx.crit, score: 10 }] });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'TEAM_NOT_ELIGIBLE');
  for (const [key, score] of [['alpha', 6], ['rockets', 8]]) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.judge.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, { submissionId: ctx.teams[key].sub, scores: [{ criterionId: ctx.crit, score }] });
    assert.equal(r.status, 200, r.text);
  }

  // A score saved for Gamma before it lost its last approved member does not rank it.
  const judgeId = (await dbQuery('SELECT id FROM judges WHERE event_id = $1', [ctx.ev.id])).rows[0].id;
  await dbQuery('INSERT INTO scores (judge_id, submission_id, criterion_id, score) VALUES ($1, $2, $3, 10)', [judgeId, ctx.teams.gamma.sub, ctx.crit]);
  r = await admin.get(`/api/events/${ctx.ev.id}/results`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.ranking.map((x) => x.teamId), [ctx.teams.rockets.id, ctx.teams.alpha.id]);
  assert.deepEqual(r.data.ineligible.map((x) => x.teamId), [ctx.teams.gamma.id], 'reported apart');

  r = await ctx.people.v.s.get(`/api/events/${ctx.ev.id}/voting/me`);
  assert.equal(r.status, 200, r.text);
  assert.ok(!r.data.candidates.some((c) => c.teamId === ctx.teams.gamma.id), 'not offered in the vote');
  r = await ctx.people.v.s.post(`/api/events/${ctx.ev.id}/voting/me`, { submissionId: ctx.teams.gamma.sub });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'TEAM_NOT_ELIGIBLE');
});

test('rejected members do not count towards the team size', async () => {
  // A rejected member still on a team from before the rule: not counted.
  await dbQuery('INSERT INTO team_members (team_id, user_id, is_leader) VALUES ($1, $2, false)', [ctx.teams.rockets.id, ctx.people.r1.userId]);
  await dbQuery('UPDATE events SET min_team_size = 2 WHERE id = $1', [ctx.ev.id]);
  const r = await ctx.people.r2.s.put(`/api/submissions/${ctx.teams.rockets.sub}`, project('rockets'));
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'TEAM_TOO_SMALL');
  assert.equal(r.json.current, 1);
  await dbQuery('UPDATE events SET min_team_size = 1 WHERE id = $1', [ctx.ev.id]);
});

test('while the lead is not approved, an approved member hands in the project', async () => {
  const mine = (key) => ctx.people[key].s.get(`/api/teams/mine?eventId=${ctx.ev.id}`);
  // Pend: the lead is still pending.
  let r = await mine('p2');
  assert.deepEqual([r.data.can_submit, r.data.submit_as_lead], [true, false], 'the team page can say so');
  r = await ctx.people.p2.s.post('/api/submissions', { eventId: ctx.ev.id, ...project('pend') });
  assert.equal(r.status, 201, r.text);
  const sub = r.data.id;
  r = await ctx.people.p2.s.put(`/api/submissions/${sub}`, { ...project('pend'), description: 'Edited by the approved member' });
  assert.equal(r.status, 200, r.text);
  r = await ctx.people.p1.s.put(`/api/submissions/${sub}`, project('pend'));
  assert.equal(r.status, 403, 'the pending lead still may not');

  // Once the lead is approved, the lead hands in again, and only the lead.
  assert.equal((await setStatus('p1', 'approved')).status, 200);
  r = await mine('p2');
  assert.deepEqual([r.data.can_submit, r.data.submit_as_lead], [false, false]);
  r = await ctx.people.p2.s.put(`/api/submissions/${sub}`, project('pend'));
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'NOT_TEAM_LEAD');
  r = await mine('p1');
  assert.deepEqual([r.data.can_submit, r.data.submit_as_lead], [true, true]);
  r = await ctx.people.p1.s.put(`/api/submissions/${sub}`, project('pend'));
  assert.equal(r.status, 200, r.text);

  // Legacy: a lead rejected before rejecting took people off their team (only the
  // status changed, the lead stayed): the approved teammate is not blocked.
  await dbQuery("UPDATE participants SET status = 'rejected' WHERE id = $1", [ctx.people.q1.pid]);
  r = await ctx.people.q2.s.post('/api/submissions', { eventId: ctx.ev.id, ...project('legacy') });
  assert.equal(r.status, 201, r.text);
  assert.equal((await teamRow('legacy')).leader_id, ctx.people.q1.userId, 'no data was changed to allow it');
});
