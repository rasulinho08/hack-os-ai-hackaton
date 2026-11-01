/**
 * Judging, results and elimination end to end against a running API.
 *
 * Covers: the judge portal (their teams, blind judging, one review saved as a
 * whole with range checks), never one's own team, declared conflicts,
 * per-team assignments drawn evenly, judging by track, the conflict-of-
 * interest declaration, a judge seeing only their own scores, the
 * organiser's progress matrix; the weighted ranking, publishing with each
 * visibility (E8) and scores locked after it, unpublishing, special prize
 * winners; elimination rounds with the cut suggestion and restoring; and
 * other organisations kept out.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, confirmEmail } = require('./helpers');
const { dbQuery, approvedBuyer, closeSubmissions } = require('./fixtures');

const HOUR = 3600e3;
const admin = new Session('jd-admin');
const ctx = { people: {}, judges: {}, teams: {} };

async function userIdOf(mail) {
  return (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [mail])).rows[0].id;
}

async function register(tag, name) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ctx.ev.slug}/register`, {
    account: { fullName: name, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  // They open the confirmation e-mail: one of them is invited to judge later.
  await confirmEmail(email(tag));
  const userId = await userIdOf(email(tag));
  const pid = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, userId])).rows[0].id;
  const a = await admin.patch(`/api/events/${ctx.ev.id}/participants/${pid}`, { status: 'approved' });
  assert.equal(a.status, 200, a.text);
  return { s, userId, pid, name };
}

async function judgeViaInvite(tag, name, existing = null) {
  const r = await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email(tag), role: 'judge' });
  assert.ok([200, 201].includes(r.status), r.text);
  // An existing account is added at once; a new one joins by registering.
  const s = existing || new Session(tag);
  if (!existing) await s.register({ fullName: name, email: email(tag), eventCode: ctx.ev.event_code });
  const userId = await userIdOf(email(tag));
  const judgeId = (await dbQuery('SELECT id FROM judges WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, userId])).rows[0].id;
  return { s, userId, judgeId };
}

const me = (j) => j.s.get(`/api/events/${ctx.ev.id}/judging/me`);
const review = (j, submissionId, scores, feedback) => j.s.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, { submissionId, scores, feedback });
const setJudging = (patch) => admin.patch(`/api/events/${ctx.ev.id}/builder`, { judging_config: patch });
const sid = (key) => ctx.teams[key].submissionId;

test('setup: an event with criteria, three teams with projects and three judges', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  let r = await admin.post('/api/events', {
    event_code: `JD${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    name: `Judging ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, {
    items: [{ cid: 'inn', name: 'Innovation', maxScore: 10, weight: 2 }, { cid: 'exe', name: 'Execution', maxScore: 10, weight: 1 }],
  });
  assert.equal(r.status, 200, r.text);
  ctx.crit = { inn: r.data.idsByCid.inn, exe: r.data.idsByCid.exe };

  for (const [key, name] of [['a', 'Aysel'], ['b', 'Babək'], ['c', 'Cavid'], ['c2', 'Ceyhun']]) {
    // eslint-disable-next-line no-await-in-loop
    ctx.people[key] = await register(`jd-${key}`, name);
  }
  // A participant of team C who is also invited to judge: never their own team.
  ctx.judges.j3 = await judgeViaInvite('jd-c2', 'Ceyhun', ctx.people.c2.s);
  ctx.judges.j1 = await judgeViaInvite('jd-j1', 'Judge One');
  ctx.judges.j2 = await judgeViaInvite('jd-j2', 'Judge Two');

  for (const [key, members] of [['a', ['a']], ['b', ['b']], ['c', ['c', 'c2']]]) {
    const ids = members.map((m) => ctx.people[m].userId);
    // eslint-disable-next-line no-await-in-loop
    r = await admin.post('/api/teams', { eventId: ctx.ev.id, name: `Team ${key.toUpperCase()} ${RUN_ID}`, memberIds: ids, leaderId: ids[0] });
    assert.equal(r.status, 201, r.text);
    ctx.teams[key] = { id: r.data.id };
  }
  await admin.put(`/api/events/${ctx.ev.id}`, { start_date: iso(-HOUR), end_date: iso(DAY) });
  // The organiser opened judging while submissions are still open (rolling
  // judging); without a judging start it opens when submissions close.
  await dbQuery("UPDATE events SET judging_start = now() - interval '1 minute' WHERE id = $1", [ctx.ev.id]);
  for (const key of ['a', 'b', 'c']) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.people[key].s.post('/api/submissions', {
      eventId: ctx.ev.id, project_name: `Project ${key.toUpperCase()}`, description: `What team ${key} built`,
      repo_link: `https://github.com/jd/${key}${RUN_ID}`,
    });
    assert.equal(r.status, 201, r.text);
    ctx.teams[key].submissionId = r.data.id;
  }
});

test('the judge portal lists the teams; blind judging hides names', async () => {
  let r = await me(ctx.judges.j1);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.teams.map((t) => t.projectName).sort(), ['Project A', 'Project B', 'Project C']);
  assert.ok(r.data.teams.every((t) => t.teamName && t.state === 'todo'));
  assert.deepEqual(r.data.criteria.map((c) => [c.name, c.weight]), [['Innovation', 2], ['Execution', 1]]);

  assert.equal((await setJudging({ blind: true })).status, 200);
  r = await me(ctx.judges.j1);
  assert.ok(r.data.config.blind);
  assert.ok(r.data.teams.every((t) => t.teamName === null && Number.isInteger(t.number)));
  r = await ctx.judges.j1.s.get(`/api/submissions?eventId=${ctx.ev.id}`);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.every((x) => !x.team_name), 'the submissions list does not give names away either');
  await setJudging({ blind: false });
});

test('a review is saved whole and checked against each criterion', async () => {
  const { j1, j2 } = ctx.judges;
  let r = await review(j1, sid('a'), [{ criterionId: ctx.crit.inn, score: 11 }, { criterionId: ctx.crit.exe, score: 5 }]);
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.errors[0].code, 'SCORE_OUT_OF_RANGE');
  const none = (await dbQuery('SELECT COUNT(*)::int AS n FROM scores WHERE submission_id = $1', [sid('a')])).rows[0].n;
  assert.equal(none, 0, 'nothing saved when one score is wrong');

  r = await review(j1, sid('a'), [{ criterionId: ctx.crit.inn, score: 8 }, { criterionId: ctx.crit.exe, score: 6 }], 'Clear idea, rough demo');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.state, 'done');
  assert.equal(r.data.feedback, 'Clear idea, rough demo');
  r = await review(j2, sid('a'), [{ criterionId: ctx.crit.inn, score: 10 }, { criterionId: ctx.crit.exe, score: 10 }]);
  assert.equal(r.status, 200, r.text);
  r = await review(j1, sid('b'), [{ criterionId: ctx.crit.inn, score: 5 }]);
  assert.equal(r.data.state, 'partial');
  r = await review(j1, sid('b'), [], 'Feedback alone is fine');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.scores[ctx.crit.inn], 5, 'saving feedback keeps the scores');
});

test('a judge never scores their own team', async () => {
  const { j3 } = ctx.judges;
  let r = await me(j3);
  assert.equal(r.status, 200, r.text);
  assert.ok(!r.data.teams.some((t) => t.submissionId === sid('c')), 'their team is not on their list');
  r = await review(j3, sid('c'), [{ criterionId: ctx.crit.inn, score: 10 }]);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'CONFLICT_OF_INTEREST');
  // Nor through the old single-score route.
  r = await j3.s.post(`/api/events/${ctx.ev.id}/judging/scores`, { submissionId: sid('c'), criterionId: ctx.crit.inn, score: 10 });
  assert.equal(r.status, 403);
});

test('a declared conflict takes the team off the judge\'s list', async () => {
  const { j2 } = ctx.judges;
  let r = await j2.s.post(`/api/events/${ctx.ev.id}/judging/me/conflicts`, { teamId: ctx.teams.b.id, reason: 'My cousin is on it' });
  assert.equal(r.status, 201, r.text);
  r = await me(j2);
  assert.ok(!r.data.teams.some((t) => t.submissionId === sid('b')));
  assert.equal(r.data.conflicts[0].reason, 'My cousin is on it');
  r = await review(j2, sid('b'), [{ criterionId: ctx.crit.inn, score: 9 }]);
  assert.equal(r.json.code, 'CONFLICT_OF_INTEREST');
  r = await admin.get(`/api/events/${ctx.ev.id}/judging/conflicts`);
  assert.ok(r.data.some((c) => c.team_id === ctx.teams.b.id && c.by_judge));
});

test('a judge sees only their own scores', async () => {
  const r = await ctx.judges.j1.s.get(`/api/events/${ctx.ev.id}/judging/scores`);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.length > 0);
  assert.ok(r.data.every((s) => s.user_id === ctx.judges.j1.userId), 'no anchoring on other judges');
  const all = await admin.get(`/api/events/${ctx.ev.id}/judging/scores`);
  assert.ok(all.data.some((s) => s.user_id === ctx.judges.j2.userId));
});

test('per-team judging: assignments drawn evenly, others refused', async () => {
  assert.equal((await setJudging({ assignment: 'per_team', judgesPerTeam: 1 })).status, 200);
  let r = await admin.post(`/api/events/${ctx.ev.id}/judging/assignments/generate`, { replace: true });
  assert.equal(r.status, 200, r.text);
  r = await admin.get(`/api/events/${ctx.ev.id}/judging/assignments`);
  const perTeam = {};
  for (const [judgeId, teams] of Object.entries(r.data)) for (const t of teams) (perTeam[t] ||= []).push(Number(judgeId));
  for (const key of ['a', 'b', 'c']) assert.ok((perTeam[ctx.teams[key].id] || []).length >= 1, `team ${key} has a judge`);
  assert.ok(!(perTeam[ctx.teams.c.id] || []).includes(ctx.judges.j3.judgeId), 'never the own team');
  assert.ok(!(perTeam[ctx.teams.b.id] || []).includes(ctx.judges.j2.judgeId), 'never a declared conflict');
  // Judges who already scored keep their teams.
  assert.ok((perTeam[ctx.teams.a.id] || []).includes(ctx.judges.j1.judgeId) && (perTeam[ctx.teams.a.id] || []).includes(ctx.judges.j2.judgeId));

  // Set j3 to exactly team B and check the refusal elsewhere.
  r = await admin.put(`/api/events/${ctx.ev.id}/judging/assignments/${ctx.judges.j3.judgeId}`, { teamIds: [ctx.teams.b.id] });
  assert.equal(r.status, 200, r.text);
  r = await me(ctx.judges.j3);
  assert.deepEqual(r.data.teams.map((t) => t.submissionId), [sid('b')]);
  r = await review(ctx.judges.j3, sid('a'), [{ criterionId: ctx.crit.inn, score: 3 }]);
  assert.equal(r.json.code, 'NOT_ASSIGNED');
  r = await admin.put(`/api/events/${ctx.ev.id}/judging/assignments/${ctx.judges.j3.judgeId}`, { teamIds: [ctx.teams.c.id] });
  assert.equal(r.status, 409, 'cannot assign the judge their own team');
  await setJudging({ assignment: 'all' });
});

test('judging by track: a judge with a track sees that track', async () => {
  let r = await admin.put(`/api/events/${ctx.ev.id}/builder/tracks`, { items: [{ cid: 'ai', name: 'AI' }] });
  assert.equal(r.status, 200, r.text);
  const ai = r.data.idsByCid.ai;
  await dbQuery('UPDATE teams SET track_id = $2 WHERE id = $1', [ctx.teams.a.id, ai]);
  await setJudging({ assignment: 'track' });
  r = await admin.patch(`/api/events/${ctx.ev.id}/judging/judges/${ctx.judges.j1.judgeId}`, { trackId: ai });
  assert.equal(r.status, 200, r.text);
  r = await me(ctx.judges.j1);
  assert.deepEqual(r.data.teams.map((t) => t.submissionId), [sid('a')]);
  r = await me(ctx.judges.j2);
  assert.ok(r.data.teams.length >= 2, 'a judge without a track judges every team');
  await admin.patch(`/api/events/${ctx.ev.id}/judging/judges/${ctx.judges.j1.judgeId}`, { trackId: null });
  await setJudging({ assignment: 'all' });
});

test('with the declaration required, judges confirm it before scoring', async () => {
  await setJudging({ coiRequired: true });
  const { j2 } = ctx.judges;
  let r = await review(j2, sid('c'), [{ criterionId: ctx.crit.inn, score: 4 }, { criterionId: ctx.crit.exe, score: 4 }]);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'COI_NOT_CONFIRMED');
  r = await j2.s.post(`/api/events/${ctx.ev.id}/judging/me/coi`, {});
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.coiConfirmedAt);
  r = await review(j2, sid('c'), [{ criterionId: ctx.crit.inn, score: 4 }, { criterionId: ctx.crit.exe, score: 4 }]);
  assert.equal(r.status, 200, r.text);
  await setJudging({ coiRequired: false });
});

test('the organiser sees who judged what', async () => {
  const r = await admin.get(`/api/events/${ctx.ev.id}/judging/progress`);
  assert.equal(r.status, 200, r.text);
  const cell = (judge, team) => r.data.cells.find((c) => c.judgeId === ctx.judges[judge].judgeId && c.teamId === ctx.teams[team].id).state;
  assert.equal(cell('j1', 'a'), 'done');
  assert.equal(cell('j1', 'b'), 'partial');
  assert.equal(cell('j1', 'c'), 'todo');
  assert.equal(cell('j2', 'b'), 'conflict');
  assert.equal(cell('j3', 'c'), 'conflict');
  assert.equal(r.data.criteria, 2);
});

test('the ranking is weighted and per judge; participants see nothing yet', async () => {
  let r = await admin.get(`/api/events/${ctx.ev.id}/results`);
  assert.equal(r.status, 200, r.text);
  // B has only j1's partial review (Innovation alone): not counted, not ranked.
  assert.ok(!r.data.ranking.some((x) => x.teamId === ctx.teams.b.id), 'a partial review does not rank a team');
  assert.equal(r.data.unscored.find((x) => x.teamId === ctx.teams.b.id).partialReviews, 1);
  assert.ok(r.data.incomplete.some((x) => x.teamId === ctx.teams.b.id && x.judgeId === ctx.judges.j1.judgeId && x.filled === 1 && x.of === 2));
  r = await review(ctx.judges.j1, sid('b'), [{ criterionId: ctx.crit.inn, score: 5 }, { criterionId: ctx.crit.exe, score: 5 }]);
  assert.equal(r.data.state, 'done');

  r = await admin.get(`/api/events/${ctx.ev.id}/results`);
  const row = (key) => r.data.ranking.find((x) => x.teamId === ctx.teams[key].id);
  // A: j1 (8×2+6)/30 = 73.33 %, j2 30/30 = 100 % → 86.67. B: j1 (5×2+5)/30 = 50. C: j2 (4×2+4)/30 = 40.
  assert.equal(row('a').score, 86.67);
  assert.equal(row('b').score, 50);
  assert.equal(row('c').score, 40);
  assert.deepEqual([row('a').place, row('b').place, row('c').place], [1, 2, 3]);
  assert.equal(row('a').breakdown.find((b) => b.criterionId === ctx.crit.inn).avg, 9);
  assert.ok(r.data.reviews.some((x) => x.feedback === 'Clear idea, rough demo'));
  assert.equal(r.data.published, null);

  r = await ctx.people.a.s.get(`/api/events/${ctx.ev.id}/results/me`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.published, null);
  r = await ctx.people.a.s.get(`/api/events/${ctx.ev.id}/judging/leaderboard`);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'RESULTS_NOT_PUBLISHED');
});

test('publishing: own place and scores with the winners, then locked scores', async () => {
  let r = await admin.post(`/api/events/${ctx.ev.id}/results/publish`, { visibility: 'own_and_winners', showScores: true });
  assert.equal(r.status, 409, 'not while submissions are open');
  assert.equal(r.json.code, 'SUBMISSIONS_OPEN');
  await closeSubmissions(ctx.ev.id);
  r = await admin.post(`/api/events/${ctx.ev.id}/results/publish`, { visibility: 'own_and_winners', showScores: true });
  assert.equal(r.status, 409, 'j1 has not judged C, j3 nobody yet');
  assert.equal(r.json.code, 'JUDGING_INCOMPLETE');
  r = await admin.post(`/api/events/${ctx.ev.id}/results/publish`, { visibility: 'own_and_winners', showScores: true, confirmIncomplete: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.published.visibility, 'own_and_winners');

  r = await ctx.people.b.s.get(`/api/events/${ctx.ev.id}/results/me`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.mine.place, 2);
  assert.equal(r.data.mine.of, 3);
  assert.equal(r.data.mine.score, 50);
  assert.deepEqual(r.data.mine.feedback, ['Feedback alone is fine']);
  assert.equal(r.data.leaderboard, null, 'no full leaderboard in this mode');
  const first = r.data.winners.find((w) => w.prize.kind === 'place' && w.prize.position === 1);
  if (first) assert.equal(first.teams[0].teamId, ctx.teams.a.id);

  r = await review(ctx.judges.j1, sid('c'), [{ criterionId: ctx.crit.inn, score: 10 }]);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'RESULTS_PUBLISHED');
});

test('the full leaderboard and winners only', async () => {
  let r = await admin.post(`/api/events/${ctx.ev.id}/results/publish`, { visibility: 'full', showScores: false, confirmIncomplete: true });
  assert.equal(r.status, 200, r.text);
  r = await ctx.people.c.s.get(`/api/events/${ctx.ev.id}/results/me`);
  assert.deepEqual(r.data.leaderboard.map((x) => x.teamId), [ctx.teams.a.id, ctx.teams.b.id, ctx.teams.c.id]);
  assert.ok(r.data.leaderboard.every((x) => x.score === null), 'scores hidden');
  assert.equal(r.data.mine.score, null);
  r = await ctx.people.c.s.get(`/api/events/${ctx.ev.id}/judging/leaderboard`);
  assert.equal(r.status, 200, r.text);

  r = await admin.post(`/api/events/${ctx.ev.id}/results/publish`, { visibility: 'winners', confirmIncomplete: true });
  r = await ctx.people.c.s.get(`/api/events/${ctx.ev.id}/results/me`);
  assert.equal(r.data.mine.place, null, 'winners only: nobody sees their own place');
  assert.equal(r.data.leaderboard, null);
});

test('special prizes are given by the organiser', async () => {
  let r = await admin.get(`/api/events/${ctx.ev.id}/builder`);
  const places = (r.data.prizes || []).filter((p) => p.kind === 'place');
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/prizes`, {
    items: [...places.map((p) => ({ id: p.id, kind: 'place', position: p.position, name: p.name })), { cid: 'sp', kind: 'special', name: 'Best design' }],
  });
  assert.equal(r.status, 200, r.text);
  const special = r.data.idsByCid.sp;
  r = await admin.patch(`/api/events/${ctx.ev.id}/results/prizes/${special}`, { teamId: ctx.teams.c.id });
  assert.equal(r.status, 200, r.text);
  r = await ctx.people.c.s.get(`/api/events/${ctx.ev.id}/results/me`);
  const sp = r.data.winners.find((w) => w.prize.id === special);
  assert.equal(sp.teams[0].teamId, ctx.teams.c.id);
  assert.ok(r.data.mine.won.some((p) => p.id === special));
  if (places[0]) {
    r = await admin.patch(`/api/events/${ctx.ev.id}/results/prizes/${places[0].id}`, { teamId: ctx.teams.c.id });
    assert.equal(r.status, 409, 'place prizes follow the ranking');
  }
});

test('unpublishing hides results again and unlocks scoring', async () => {
  let r = await admin.post(`/api/events/${ctx.ev.id}/results/unpublish`, {});
  assert.equal(r.status, 200, r.text);
  r = await ctx.people.a.s.get(`/api/events/${ctx.ev.id}/results/me`);
  assert.equal(r.data.published, null);
  // C: j2 40 %, j1 (3×2+3)/30 = 30 % → 35, below B's 50.
  r = await review(ctx.judges.j1, sid('c'), [{ criterionId: ctx.crit.inn, score: 3 }, { criterionId: ctx.crit.exe, score: 3 }]);
  assert.equal(r.status, 200, r.text);
});

test('elimination rounds: a suggested cut, a reason, and bringing a team back', async () => {
  let r = await admin.get(`/api/events/${ctx.ev.id}/elimination/suggest?keep=2`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.eliminate.map((x) => x.teamId), [ctx.teams.c.id]);
  r = await admin.post(`/api/events/${ctx.ev.id}/elimination/rounds`, { name: 'Round 1 — top 2 go on' });
  assert.equal(r.status, 201, r.text);
  const roundId = r.data.id;
  r = await admin.post(`/api/events/${ctx.ev.id}/elimination/rounds/${roundId}/eliminate`, { teamIds: [ctx.teams.c.id, 999999], reason: 'Below the cut' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.eliminated, [ctx.teams.c.id]);
  assert.equal(r.data.skipped[0].reason, 'NOT_FOUND');

  const st = (await dbQuery('SELECT status, eliminated_round_id, elimination_reason FROM teams WHERE id = $1', [ctx.teams.c.id])).rows[0];
  assert.deepEqual([st.status, Number(st.eliminated_round_id), st.elimination_reason], ['eliminated', roundId, 'Below the cut']);
  const members = (await dbQuery('SELECT status FROM participants WHERE event_id = $1 AND user_id = ANY($2::int[])', [ctx.ev.id, [ctx.people.c.userId]])).rows;
  assert.equal(members[0].status, 'eliminated');

  r = await admin.get(`/api/events/${ctx.ev.id}/results`);
  assert.ok(!r.data.ranking.some((x) => x.teamId === ctx.teams.c.id), 'eliminated teams are not ranked');
  r = await review(ctx.judges.j2, sid('c'), [{ criterionId: ctx.crit.inn, score: 7 }]);
  assert.equal(r.json.code, 'TEAM_ELIMINATED');
  r = await admin.delete(`/api/events/${ctx.ev.id}/elimination/rounds/${roundId}`);
  assert.equal(r.status, 409, 'a round with teams stays');

  r = await admin.post(`/api/events/${ctx.ev.id}/elimination/teams/${ctx.teams.c.id}/restore`, {});
  assert.equal(r.status, 200, r.text);
  const back = (await dbQuery('SELECT status FROM participants WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, ctx.people.c.userId])).rows[0];
  assert.equal(back.status, 'approved');
  r = await admin.get(`/api/events/${ctx.ev.id}/elimination/rounds`);
  assert.equal(r.data.rounds[0].teams.length, 0);
});

test('other organisations and participants are kept out', async () => {
  const other = await approvedBuyer('jd-other');
  for (const path of ['results', 'judging/progress', 'judging/assignments', 'elimination/rounds']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await other.session.get(`/api/events/${ctx.ev.id}/${path}`);
    assert.equal(r.status, 404, `${path}: ${r.status}`);
  }
  let r = await ctx.people.a.s.get(`/api/events/${ctx.ev.id}/results`);
  assert.equal(r.status, 403);
  r = await ctx.people.a.s.get(`/api/events/${ctx.ev.id}/judging/me`);
  assert.equal(r.status, 403);
  r = await ctx.people.a.s.post(`/api/events/${ctx.ev.id}/results/publish`, {});
  assert.equal(r.status, 403);
});
