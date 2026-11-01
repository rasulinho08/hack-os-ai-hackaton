/**
 * Regressions found while building the Phase 5 screens:
 *   - a project is "graded" once every judge MEANT to judge it scored every
 *     criterion (not every judge of the event: conflicts and assignments
 *     leave some out);
 *   - the results' per-judge reviews leave out the scores the ranking does
 *     not count (a declared conflict);
 *   - "keep the best N" with N above the number of ranked teams suggests
 *     nobody ranked (it suggested everyone);
 *   - a presentation's status is one of waiting / presenting / done;
 *   - a judge whose scores are in published results cannot be removed until
 *     the results are unpublished.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, closeSubmissions } = require('./fixtures');

const HOUR = 3600e3;
const admin = new Session('jf-admin');
const ctx = { people: {}, teams: {}, judges: {} };
const statusOf = async (submissionId) => (await dbQuery('SELECT status FROM submissions WHERE id = $1', [submissionId])).rows[0].status;

async function register(tag, name) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ctx.ev.slug}/register`, {
    account: { fullName: name, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  const userId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(tag)])).rows[0].id;
  const pid = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, userId])).rows[0].id;
  assert.equal((await admin.patch(`/api/events/${ctx.ev.id}/participants/${pid}`, { status: 'approved' })).status, 200);
  return { s, userId };
}

const review = (j, sub, scores) => j.s.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, { submissionId: sub, scores });

test('setup: two teams with projects, three judges, two criteria', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  let r = await admin.post('/api/events', {
    event_code: `JF${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Judging fixes ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, { items: [{ cid: 'a', name: 'A', maxScore: 10, weight: 1 }, { cid: 'b', name: 'B', maxScore: 10, weight: 1 }] });
  ctx.crit = r.data.idsByCid;
  for (const k of ['x', 'y']) {
    // eslint-disable-next-line no-await-in-loop
    ctx.people[k] = await register(`jf-${k}`, `Lead ${k}`);
    // eslint-disable-next-line no-await-in-loop
    r = await admin.post('/api/teams', { eventId: ctx.ev.id, name: `Team ${k} ${RUN_ID}`, memberIds: [ctx.people[k].userId], leaderId: ctx.people[k].userId });
    ctx.teams[k] = { id: r.data.id };
  }
  for (const k of ['j1', 'j2', 'j3']) {
    // eslint-disable-next-line no-await-in-loop
    await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email(`jf-${k}`), role: 'judge' });
    const s = new Session(`jf-${k}`);
    // eslint-disable-next-line no-await-in-loop
    await s.register({ fullName: `Judge ${k}`, email: email(`jf-${k}`), eventCode: ctx.ev.event_code });
    // eslint-disable-next-line no-await-in-loop
    const uid = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(`jf-${k}`)])).rows[0].id;
    // eslint-disable-next-line no-await-in-loop
    ctx.judges[k] = { s, id: (await dbQuery('SELECT id FROM judges WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, uid])).rows[0].id };
  }
  await admin.put(`/api/events/${ctx.ev.id}`, { start_date: iso(-HOUR), end_date: iso(DAY) });
  // The organiser opened judging while submissions are still open (rolling
  // judging); without a judging start it opens when submissions close.
  await dbQuery("UPDATE events SET judging_start = now() - interval '1 minute' WHERE id = $1", [ctx.ev.id]);
  for (const k of ['x', 'y']) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.people[k].s.post('/api/submissions', { eventId: ctx.ev.id, projectName: `P${k}`, description: 'x', repoLink: `https://github.com/jf/${k}${RUN_ID}` });
    assert.equal(r.status, 201, r.text);
    ctx.teams[k].sub = r.data.id;
  }
});

test('graded once every judge meant to judge the project scored all of it', async () => {
  const { a, b } = ctx.crit;
  const { j1, j2, j3 } = ctx.judges;
  const sub = ctx.teams.x.sub;
  // Judge 3 scores, then remembers a conflict with team X.
  let r = await review(j3, sub, [{ criterionId: a, score: 1 }, { criterionId: b, score: 1 }]);
  assert.equal(r.status, 200, r.text);
  r = await j3.s.post(`/api/events/${ctx.ev.id}/judging/me/conflicts`, { teamId: ctx.teams.x.id, reason: 'My cousin' });
  assert.ok([200, 201].includes(r.status), r.text);

  r = await review(j1, sub, [{ criterionId: a, score: 8 }, { criterionId: b, score: 8 }]);
  assert.equal(await statusOf(sub), 'reviewing');
  r = await review(j2, sub, [{ criterionId: a, score: 6 }]);
  assert.equal(await statusOf(sub), 'reviewing', 'one criterion still missing');
  r = await review(j2, sub, [{ criterionId: a, score: 6 }, { criterionId: b, score: 7 }]);
  assert.equal(await statusOf(sub), 'graded', 'judge 3 is out of it: their conflict');
  assert.equal(await statusOf(ctx.teams.y.sub), 'submitted');
});

test('the results leave out the scores the ranking does not count', async () => {
  const r = await admin.get(`/api/events/${ctx.ev.id}/results`);
  assert.equal(r.status, 200, r.text);
  const x = r.data.ranking.find((t) => t.teamId === ctx.teams.x.id);
  assert.equal(x.judgesCount, 2);
  const reviews = r.data.reviews.filter((v) => v.teamId === ctx.teams.x.id).map((v) => v.judgeId).sort();
  assert.deepEqual(reviews, [ctx.judges.j1.id, ctx.judges.j2.id].sort(), 'not the conflicted judge');
});

test('keeping more than are ranked suggests nobody ranked', async () => {
  let r = await admin.get(`/api/events/${ctx.ev.id}/elimination/suggest?keep=5`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.eliminate.map((t) => t.teamId), [ctx.teams.y.id], 'only the unscored team');
  assert.deepEqual(r.data.stays.map((t) => t.teamId), [ctx.teams.x.id]);
  r = await admin.get(`/api/events/${ctx.ev.id}/elimination/suggest?keep=1`);
  assert.deepEqual(r.data.stays.map((t) => t.teamId), [ctx.teams.x.id]);
  r = await admin.get(`/api/events/${ctx.ev.id}/elimination/suggest?keep=0`);
  assert.equal(r.data.stays.length, 0, 'keep none: everyone goes');
});

test('a presentation\'s status is one of waiting, presenting, done', async () => {
  let r = await admin.post(`/api/events/${ctx.ev.id}/presentations/generate`, {});
  assert.ok([200, 201].includes(r.status), r.text);
  r = await admin.get(`/api/events/${ctx.ev.id}/presentations`);
  const id = (r.data[0] || r.data.presentations?.[0]).id;
  r = await admin.patch(`/api/events/${ctx.ev.id}/presentations/${id}`, { status: '<script>' });
  assert.equal(r.status, 400, r.text);
  r = await admin.patch(`/api/events/${ctx.ev.id}/presentations/${id}`, { status: 'presenting' });
  assert.equal(r.status, 200, r.text);
  r = await admin.patch(`/api/events/${ctx.ev.id}/presentations/${id}`, { status: 'done' });
  assert.equal(r.status, 200, r.text);
});

test('a judge in published results stays until the results are unpublished', async () => {
  await closeSubmissions(ctx.ev.id);
  // Team Y has no scores yet: published anyway, as the organiser confirms.
  let r = await admin.post(`/api/events/${ctx.ev.id}/results/publish`, { confirmIncomplete: true });
  assert.equal(r.status, 200, r.text);
  r = await admin.delete(`/api/events/${ctx.ev.id}/judging/judges/${ctx.judges.j1.id}`);
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'RESULTS_PUBLISHED');
  r = await admin.delete(`/api/events/${ctx.ev.id}/judging/judges/${ctx.judges.j3.id}`);
  assert.equal(r.status, 409, 'their (uncounted) scores are still in the data');
  r = await admin.post(`/api/events/${ctx.ev.id}/results/unpublish`, {});
  assert.equal(r.status, 200, r.text);
  r = await admin.delete(`/api/events/${ctx.ev.id}/judging/judges/${ctx.judges.j1.id}`);
  assert.equal(r.status, 200, r.text);
});
