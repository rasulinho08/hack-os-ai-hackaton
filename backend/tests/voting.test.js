/**
 * People's choice end to end: off until the organiser switches it on; opens
 * when the event starts; admitted participants only, one vote each, never
 * for their own team or an eliminated one; the vote can change or be
 * withdrawn; participants never see counts, the organiser does; publishing
 * the results closes it; other organisations are kept out; the export
 * carries the count.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, approvedBuyer, closeSubmissions } = require('./fixtures');
const { unzip } = require('./unzip');

const HOUR = 3600e3;
const admin = new Session('vt-admin');
const ctx = { people: {}, teams: {} };
const base = () => `/api/events/${ctx.ev.id}/voting`;

async function register(tag, name, approve = true) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ctx.ev.slug}/register`, {
    account: { fullName: name, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  const userId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(tag)])).rows[0].id;
  const pid = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, userId])).rows[0].id;
  if (approve) {
    const a = await admin.patch(`/api/events/${ctx.ev.id}/participants/${pid}`, { status: 'approved' });
    assert.equal(a.status, 200, a.text);
  }
  return { s, userId };
}

test('setup: three teams with projects, a pending registration, a judge', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  let r = await admin.post('/api/events', {
    event_code: `VT${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Voting ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, { items: [{ cid: 'q', name: 'Quality', maxScore: 10, weight: 1 }] });
  ctx.crit = r.data.idsByCid.q;
  for (const [k, n] of [['a', 'Aynur'], ['b', 'Bəhruz'], ['c', 'Cəmilə'], ['solo', 'Sənan']]) {
    // eslint-disable-next-line no-await-in-loop
    ctx.people[k] = await register(`vt-${k}`, n);
  }
  ctx.people.pending = await register('vt-pend', 'Pərviz', false);
  for (const k of ['a', 'b', 'c']) {
    // eslint-disable-next-line no-await-in-loop
    r = await admin.post('/api/teams', { eventId: ctx.ev.id, name: `Team ${k} ${RUN_ID}`, memberIds: [ctx.people[k].userId], leaderId: ctx.people[k].userId });
    assert.equal(r.status, 201, r.text);
    ctx.teams[k] = { id: r.data.id };
  }
  r = await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email('vt-judge'), role: 'judge' });
  ctx.judge = new Session('vt-judge');
  await ctx.judge.register({ fullName: 'Judge Vüsal', email: email('vt-judge'), eventCode: ctx.ev.event_code });
  await admin.put(`/api/events/${ctx.ev.id}`, { start_date: iso(-HOUR), end_date: iso(DAY) });
  // Judging opens early too (rolling judging), so the last test can score.
  await dbQuery("UPDATE events SET judging_start = now() - interval '1 minute' WHERE id = $1", [ctx.ev.id]);
  for (const k of ['a', 'b', 'c']) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.people[k].s.post('/api/submissions', { eventId: ctx.ev.id, projectName: `Project ${k.toUpperCase()}`, description: 'x', repoLink: `https://github.com/vt/${k}${RUN_ID}` });
    assert.equal(r.status, 201, r.text);
    ctx.teams[k].sub = r.data.id;
  }
});

test('off until the organiser switches it on', async () => {
  let r = await ctx.people.a.s.get(`${base()}/me`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.enabled, false);
  r = await ctx.people.a.s.post(`${base()}/me`, { submissionId: ctx.teams.b.sub });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'VOTING_OFF');
  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { judging_config: { peopleChoice: true } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.judging_config.peopleChoice, true);
  // Without a voting start it opens when submissions close; the organiser
  // opens it now (rolesFlow.test.js covers the default).
  r = await ctx.people.a.s.get(`${base()}/me`);
  assert.equal(r.data.state, 'not_open', 'submissions are still open');
  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { judging_config: { votingStart: new Date(Date.now() - 60e3).toISOString() } });
  assert.equal(r.status, 200, r.text);
});

test('a participant sees the other teams\' projects and votes once; the vote can change', async () => {
  const { a, b, c, solo } = ctx.people;
  let r = await a.s.get(`${base()}/me`);
  assert.equal(r.data.state, 'open');
  assert.equal(r.data.eligible, true);
  assert.deepEqual(r.data.candidates.map((x) => x.projectName), ['Project B', 'Project C'], 'not their own team');
  assert.ok(!('votes' in r.data.candidates[0]), 'no counts for participants');

  r = await a.s.post(`${base()}/me`, { submissionId: ctx.teams.a.sub });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'OWN_TEAM');
  r = await a.s.post(`${base()}/me`, { submissionId: ctx.teams.b.sub });
  assert.equal(r.status, 200, r.text);
  r = await a.s.post(`${base()}/me`, { submissionId: ctx.teams.c.sub });
  assert.equal(r.status, 200, 'a vote can change');
  r = await a.s.get(`${base()}/me`);
  assert.equal(r.data.myVote, ctx.teams.c.sub);
  assert.equal((await dbQuery('SELECT COUNT(*)::int AS n FROM people_choice_votes WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, a.userId])).rows[0].n, 1);

  for (const [p, team] of [[b, 'c'], [c, 'b'], [solo, 'c']]) {
    // eslint-disable-next-line no-await-in-loop
    r = await p.s.post(`${base()}/me`, { submissionId: ctx.teams[team].sub });
    assert.equal(r.status, 200, r.text);
  }
  r = await solo.s.delete(`${base()}/me`);
  assert.equal(r.status, 200, 'withdrawn');
  r = await solo.s.post(`${base()}/me`, { submissionId: ctx.teams.c.sub });
  assert.equal(r.status, 200, 'and cast again');
});

test('only admitted participants vote; nobody votes for an eliminated team or a foreign project', async () => {
  let r = await ctx.people.pending.s.post(`${base()}/me`, { submissionId: ctx.teams.b.sub });
  assert.equal(r.status, 403, 'a pending registration does not vote');
  r = await ctx.judge.post(`${base()}/me`, { submissionId: ctx.teams.b.sub });
  assert.equal(r.status, 403, 'judges score, they do not vote');
  r = await ctx.people.a.s.post(`${base()}/me`, { submissionId: 99999999 });
  assert.equal(r.status, 404);
  r = await ctx.people.a.s.post(`${base()}/me`, {});
  assert.equal(r.status, 400);

  r = await admin.patch(`/api/teams/${ctx.teams.b.id}/status`, { status: 'eliminated', reason: 'Rules' });
  assert.equal(r.status, 200, r.text);
  r = await ctx.people.solo.s.post(`${base()}/me`, { submissionId: ctx.teams.b.sub });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'TEAM_ELIMINATED');
  r = await ctx.people.solo.s.get(`${base()}/me`);
  assert.ok(!r.data.candidates.some((x) => x.submissionId === ctx.teams.b.sub), 'eliminated teams are not listed');
});

test('the organiser sees the count; participants and other organisations do not', async () => {
  let r = await admin.get(base());
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.state, 'open');
  assert.deepEqual(r.data.tally.map((x) => [x.projectName, x.votes]), [['Project C', 3], ['Project A', 0]], 'eliminated team B is left out');
  assert.equal(r.data.voters, 3);
  assert.equal(r.data.tally[0].share, 100);
  r = await ctx.people.a.s.get(base());
  assert.equal(r.status, 403);
  const other = await approvedBuyer('vt-other');
  r = await other.session.get(base());
  assert.equal(r.status, 404);
  r = await other.session.post(`${base()}/me`, { submissionId: ctx.teams.c.sub });
  assert.equal(r.status, 404);
});

test('publishing the results closes the vote; the export carries the count', async () => {
  await admin.patch(`/api/teams/${ctx.teams.b.id}/status`, { status: 'active' });
  let r = await ctx.judge.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, { submissionId: ctx.teams.a.sub, scores: [{ criterionId: ctx.crit, score: 7 }] });
  assert.equal(r.status, 200, r.text);
  await closeSubmissions(ctx.ev.id);
  // Only team A is scored: published anyway, as the organiser confirms.
  r = await admin.post(`/api/events/${ctx.ev.id}/results/publish`, { confirmIncomplete: true });
  assert.equal(r.status, 200, r.text);
  r = await ctx.people.a.s.post(`${base()}/me`, { submissionId: ctx.teams.b.sub });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'VOTING_CLOSED');
  r = await ctx.people.a.s.get(`${base()}/me`);
  assert.equal(r.data.state, 'closed');
  assert.equal(r.data.myVote, ctx.teams.c.sub, 'their vote is still shown');

  const zip = await admin.download(`/api/events/${ctx.ev.id}/export.zip`);
  assert.equal(zip.status, 200);
  const votes = unzip(zip.body)['votes.csv'].toString('utf8');
  assert.match(votes, /Project C,,3,/);
});
