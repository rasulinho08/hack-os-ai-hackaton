/**
 * Results that cannot be decided early or by half a review, end to end
 * against a running API (with its job worker).
 *
 * Covers: a judge's partial review neither ranks a team nor counts as a
 * scored project on the Submissions page (reported as incomplete instead);
 * publishing is refused while submissions are open (by the deadline, or by
 * the end when there is none) and while assigned reviews are unfinished
 * unless the organiser confirms; no certificate goes out by itself without
 * a signer; unpublishing revokes the certificates the publication issued, so
 * the public check says so; publishing again issues fresh ones.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, closeSubmissions } = require('./fixtures');

const HOUR = 3600e3;
const admin = new Session('ri-admin');
const anon = new Session('ri-anon');
const ctx = { people: {}, teams: {} };

const userIdOf = async (mail) => (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [mail])).rows[0].id;
const publish = (body = {}) => admin.post(`/api/events/${ctx.ev.id}/results/publish`, { visibility: 'full', ...body });
const review = (submissionId, scores) => ctx.judge.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, {
  submissionId, scores: Object.entries(scores).map(([k, score]) => ({ criterionId: ctx.crit[k], score })),
});
const certs = async () => (await dbQuery('SELECT id, code, kind, user_id, revoked_at, issued_by FROM certificates WHERE event_id = $1 ORDER BY id', [ctx.ev.id])).rows;

/** Every certificate-issuing job of the event has run. */
const issuingDone = async () => (await dbQuery(
  "SELECT 1 FROM jobs WHERE type = 'certificates.issue' AND (payload->>'eventId')::int = $1 AND finished_at IS NULL",
  [ctx.ev.id],
)).rowCount === 0;

async function waitFor(what, fn, ms = 30000) {
  const until = Date.now() + ms;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 500); });
  }
}

test('setup: four criteria, two teams with projects, one judge', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  let r = await admin.post('/api/events', {
    event_code: `RI${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Results integrity ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, {
    items: ['inn', 'exe', 'des', 'imp'].map((cid) => ({ cid, name: cid, maxScore: 10, weight: 1 })),
  });
  assert.equal(r.status, 200, r.text);
  ctx.crit = r.data.idsByCid;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/prizes`, { items: [{ cid: 'p1', kind: 'place', position: 1, name: 'Grand prize' }] });
  assert.equal(r.status, 200, r.text);

  for (const key of ['gophers', 'rockets']) {
    const s = new Session(`ri-${key}`);
    // eslint-disable-next-line no-await-in-loop
    r = await s.post(`/api/public/events/${ctx.ev.slug}/register`, {
      account: { fullName: `Lead ${key}`, email: email(`ri-${key}`), password: 'Test1234!' },
      entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
    });
    assert.equal(r.status, 201, r.text);
    // eslint-disable-next-line no-await-in-loop
    const userId = await userIdOf(email(`ri-${key}`));
    // eslint-disable-next-line no-await-in-loop
    const pid = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, userId])).rows[0].id;
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await admin.patch(`/api/events/${ctx.ev.id}/participants/${pid}`, { status: 'approved' })).status, 200);
    // eslint-disable-next-line no-await-in-loop
    r = await admin.post('/api/teams', { eventId: ctx.ev.id, name: `${key} ${RUN_ID}`, memberIds: [userId], leaderId: userId });
    assert.equal(r.status, 201, r.text);
    ctx.people[key] = { s, userId };
    ctx.teams[key] = { id: r.data.id };
  }
  await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email('ri-judge'), role: 'judge' });
  ctx.judge = new Session('ri-judge');
  await ctx.judge.register({ fullName: 'Judge Ri', email: email('ri-judge'), eventCode: ctx.ev.event_code });

  // Hacking now: projects due in 22 hours.
  await dbQuery('UPDATE events SET start_date = $2, end_date = $3, submission_deadline = $4 WHERE id = $1', [ctx.ev.id, iso(-HOUR), iso(DAY), iso(22 * HOUR)]);
  // The organiser opened judging while submissions are still open (rolling
  // judging); without a judging start it opens when submissions close.
  await dbQuery("UPDATE events SET judging_start = now() - interval '1 minute' WHERE id = $1", [ctx.ev.id]);
  for (const key of ['gophers', 'rockets']) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.people[key].s.post('/api/submissions', { eventId: ctx.ev.id, projectName: `P ${key}`, description: 'x', repoLink: `https://github.com/ri/${key}${RUN_ID}` });
    assert.equal(r.status, 201, r.text);
    ctx.teams[key].sub = r.data.id;
  }
});

test('one 10 out of 10 on one criterion does not beat a fully scored 90', async () => {
  let r = await review(ctx.teams.gophers.sub, { inn: 10 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.state, 'partial');
  r = await review(ctx.teams.rockets.sub, { inn: 9, exe: 9, des: 9, imp: 9 });
  assert.equal(r.data.state, 'done');

  r = await admin.get(`/api/events/${ctx.ev.id}/results`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.ranking.map((x) => [x.teamId, x.place, x.score]), [[ctx.teams.rockets.id, 1, 90]]);
  const g = r.data.unscored.find((x) => x.teamId === ctx.teams.gophers.id);
  assert.ok(g, 'the half-reviewed team waits for its scores');
  assert.equal(g.partialReviews, 1);
  assert.deepEqual(r.data.incomplete.map((x) => [x.teamId, x.filled, x.of]), [[ctx.teams.gophers.id, 1, 4]]);

  // The Submissions page counts the same way: started, not scored.
  r = await admin.get(`/api/submissions?eventId=${ctx.ev.id}`);
  const row = (key) => r.data.find((x) => x.id === ctx.teams[key].sub);
  assert.equal(Number(row('gophers').scored_judges), 0);
  assert.equal(row('gophers').status, 'reviewing');
  assert.equal(Number(row('rockets').scored_judges), 1);
  assert.equal(row('rockets').status, 'graded');
});

test('not while submissions are open: by the deadline, else by the end', async () => {
  let r = await publish({ confirmIncomplete: true });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'SUBMISSIONS_OPEN');
  assert.match(r.json.message, /Submissions are open until/);
  await dbQuery('UPDATE events SET submission_deadline = NULL WHERE id = $1', [ctx.ev.id]);
  r = await publish({ confirmIncomplete: true });
  assert.equal(r.json.code, 'SUBMISSIONS_OPEN', 'no deadline: the end of the event');

  const ev = (await dbQuery('SELECT results_published_at FROM events WHERE id = $1', [ctx.ev.id])).rows[0];
  assert.equal(ev.results_published_at, null);
  assert.equal((await dbQuery('SELECT 1 FROM event_results WHERE event_id = $1', [ctx.ev.id])).rowCount, 0);
  assert.equal((await certs()).length, 0, 'nothing issued');
});

test('the organiser home names the judge who has not finished, and the results waiting', async () => {
  await closeSubmissions(ctx.ev.id);
  // The setup opened judging early (judging_start); no judging window from here on.
  await dbQuery('UPDATE events SET judging_start = NULL WHERE id = $1', [ctx.ev.id]);
  const r = await admin.get(`/api/events/${ctx.ev.id}/overview`);
  assert.equal(r.status, 200, r.text);
  const codes = r.data.alerts.map((a) => a.code);
  const judging = r.data.alerts.find((a) => a.code === 'judging_unfinished');
  assert.ok(judging, codes.join(','));
  assert.deepEqual(judging.judges.map((j) => [j.name, j.todo, j.partial]), [['Judge Ri', 0, 1]]);
  assert.ok(codes.includes('results_not_published'), codes.join(','));
  assert.equal(r.data.phase.key, 'ended', 'projects are in; no judging window or results date set');
});

test('unfinished reviews: refused unless the organiser confirms; no signer, no certificates', async () => {
  await closeSubmissions(ctx.ev.id);
  let r = await publish();
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'JUDGING_INCOMPLETE');
  assert.match(r.json.message, /1 not finished/);

  r = await publish({ confirmIncomplete: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.judgingIncomplete, 1);
  assert.deepEqual([r.data.certificates.issuing, r.data.certificates.reason], [false, 'SIGNER_MISSING']);
  assert.match(r.data.certificates.message, /signer/);
  const job = await dbQuery("SELECT 1 FROM jobs WHERE type = 'certificates.issue' AND (payload->>'eventId')::int = $1", [ctx.ev.id]);
  assert.equal(job.rowCount, 0, 'no issuing queued');
  assert.equal((await certs()).length, 0);
  const home = (await admin.get(`/api/events/${ctx.ev.id}/overview`)).data;
  assert.equal(home.phase.key, 'results');
  assert.ok(home.alerts.some((a) => a.code === 'certificate_signer_missing'), 'the home says why no certificate went out');
  assert.equal((await admin.post(`/api/events/${ctx.ev.id}/results/unpublish`, {})).status, 200);
});

test('unpublishing revokes the certificates the publication issued; publishing again issues new ones', async () => {
  let r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { certificate_config: { signerName: 'Leyla Əhmədova' } });
  assert.equal(r.status, 200, r.text);
  r = await review(ctx.teams.gophers.sub, { inn: 10, exe: 2, des: 2, imp: 2 });
  assert.equal(r.data.state, 'done');
  r = await publish();
  assert.equal(r.status, 200, 'every assigned review is done: no confirmation needed');
  assert.equal(r.data.certificates.issuing, true);
  const issued = await waitFor('the certificates', async () => {
    const all = await certs();
    return (await issuingDone()) && all.some((c) => c.kind === 'winner') ? all : null;
  });
  assert.ok(issued.every((c) => c.issued_by === 'results'));
  const winner = issued.find((c) => c.kind === 'winner');
  assert.equal(winner.user_id, ctx.people.rockets.userId);
  r = await anon.get(`/api/public/certificates/${winner.code}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.revoked, false);

  r = await admin.post(`/api/events/${ctx.ev.id}/results/unpublish`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.certificatesRevoked, issued.length);
  r = await anon.get(`/api/public/certificates/${winner.code}`);
  assert.equal(r.data.revoked, true, 'the public check no longer vouches for it');
  r = await ctx.people.rockets.s.get('/api/me/certificates');
  assert.ok(!r.data.some((c) => c.code === winner.code));

  r = await publish();
  assert.equal(r.status, 200, r.text);
  const again = await waitFor('the certificates issued again', async () => {
    const live = (await certs()).filter((c) => !c.revoked_at);
    return (await issuingDone()) && live.length ? live : null;
  });
  assert.equal(again.length, issued.length);
  const newWinner = again.find((c) => c.kind === 'winner');
  assert.ok(newWinner && newWinner.code !== winner.code, 'a new certificate, the old code stays revoked');
  r = await anon.get(`/api/public/certificates/${winner.code}`);
  assert.equal(r.data.revoked, true);
});

test('published results cannot change silently: deleting or eliminating a ranked team is refused', async () => {
  const id = ctx.ev.id;
  const team = ctx.teams.rockets.id;
  const frozen = async () => (await dbQuery('SELECT team_id, place FROM event_results WHERE event_id = $1 ORDER BY team_id', [id])).rows;
  const shown = await frozen();
  assert.ok(shown.some((x) => Number(x.team_id) === team), 'the team is in the published results');

  let r = await admin.delete(`/api/teams/${team}`);
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'RESULTS_PUBLISHED');
  assert.match(r.json.message, /Unpublish the results first/);

  r = await admin.patch(`/api/teams/${team}/status`, { status: 'eliminated', reason: 'late' });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'RESULTS_PUBLISHED');

  r = await admin.post(`/api/events/${id}/elimination/rounds`, { name: 'Round after results' });
  assert.equal(r.status, 201, r.text);
  const round = r.data.id;
  r = await admin.post(`/api/events/${id}/elimination/rounds/${round}/eliminate`, { teamIds: [team], reason: 'late' });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'RESULTS_PUBLISHED');

  r = await admin.delete(`/api/submissions/${ctx.teams.rockets.sub}`);
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'RESULTS_PUBLISHED');

  assert.deepEqual(await frozen(), shown, 'the published results did not move');
  const t = (await dbQuery('SELECT status FROM teams WHERE id = $1', [team])).rows[0];
  assert.notEqual(String(t.status).toLowerCase(), 'eliminated');

  // Unpublished, the organiser can change the teams again.
  assert.equal((await admin.post(`/api/events/${id}/results/unpublish`, {})).status, 200);
  r = await admin.post(`/api/events/${id}/elimination/rounds/${round}/eliminate`, { teamIds: [team], reason: 'late' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.eliminated, [team]);
});
