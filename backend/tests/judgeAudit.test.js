/**
 * The judge audit and the GitHub check, end to end against a running API
 * started with GITHUB_API_BASE pointing at tests/fakeGithub.js (port 5098).
 *
 * Covers: every score given and changed is kept with who, when, from and to
 * (whichever endpoint wrote it), with how often a judge changed their mind;
 * the GitHub check flags a repository made or worked on before the start
 * and one with no work during the event, says when a repository is missing
 * or private, skips links that are not GitHub, and is the organiser's only;
 * the setting is validated.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, approvedBuyer } = require('./fixtures');
const { parseGithub } = require('../src/services/repoCheck.service');

const HOUR = 3600e3;
const FAKE_GITHUB = process.env.FAKE_GITHUB || 'http://127.0.0.1:5098';
const admin = new Session('ja-admin');
const ctx = { people: {}, teams: {} };
const owner = `ja${RUN_ID}`.slice(0, 39);

async function fakeRepo(repo, data) {
  const r = await fetch(`${FAKE_GITHUB}/__repos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner, repo, ...data }),
  });
  assert.equal(r.status, 204, 'the fake GitHub API is running (node tests/fakeGithub.js 5098)');
}

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

async function waitFor(what, fn, ms = 45000) {
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

test('github links are read strictly', () => {
  assert.deepEqual(parseGithub('https://github.com/team/project'), { owner: 'team', repo: 'project' });
  assert.deepEqual(parseGithub('https://www.github.com/team/project.git'), { owner: 'team', repo: 'project' });
  assert.deepEqual(parseGithub('https://github.com/team/project/tree/main/src'), { owner: 'team', repo: 'project' });
  assert.equal(parseGithub('https://gitlab.com/team/project'), null);
  assert.equal(parseGithub('https://github.com/team'), null);
  assert.equal(parseGithub('javascript:alert(1)'), null);
  // The URL is normalised first; only /repos/<owner>/<repo> is ever asked.
  assert.deepEqual(parseGithub('https://github.com/../../etc/passwd'), { owner: 'etc', repo: 'passwd' });
  assert.equal(parseGithub('https://github.com/a/..%2F..%2Fusers'), null);
  assert.equal(parseGithub('https://github.com/a%2Fb/c'), null);
  assert.equal(parseGithub('https://evil.example/github.com/a/b'), null);
});

test('setup: four teams — a fresh repository, one from before, a missing one, GitLab', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  let r = await admin.post('/api/events', {
    event_code: `JA${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Judge audit ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, { items: [{ cid: 'q', name: 'Quality', maxScore: 10, weight: 1 }, { cid: 'w', name: 'Wow', maxScore: 5, weight: 1 }] });
  ctx.crit = r.data.idsByCid;
  for (const k of ['fresh', 'old', 'gone', 'lab']) {
    // eslint-disable-next-line no-await-in-loop
    ctx.people[k] = await register(`ja-${k}`, `Lead ${k}`);
    // eslint-disable-next-line no-await-in-loop
    r = await admin.post('/api/teams', { eventId: ctx.ev.id, name: `Team ${k} ${RUN_ID}`, memberIds: [ctx.people[k].userId], leaderId: ctx.people[k].userId });
    assert.equal(r.status, 201, r.text);
    ctx.teams[k] = { id: r.data.id };
  }
  r = await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email('ja-judge'), role: 'judge' });
  ctx.judge = new Session('ja-judge');
  await ctx.judge.register({ fullName: 'Judge Lalə', email: email('ja-judge'), eventCode: ctx.ev.event_code });

  await admin.put(`/api/events/${ctx.ev.id}`, { start_date: iso(-6 * HOUR), end_date: iso(DAY) });
  // The organiser opened judging while submissions are still open (rolling
  // judging); without a judging start it opens when submissions close.
  await dbQuery("UPDATE events SET judging_start = now() - interval '1 minute' WHERE id = $1", [ctx.ev.id]);
  const links = {
    fresh: `https://github.com/${owner}/fresh`, old: `https://github.com/${owner}/old-project`,
    gone: `https://github.com/${owner}/private-one`, lab: `https://gitlab.com/${owner}/lab`,
  };
  for (const k of Object.keys(links)) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.people[k].s.post('/api/submissions', { eventId: ctx.ev.id, projectName: `Project ${k}`, description: 'x', repoLink: links[k] });
    assert.equal(r.status, 201, r.text);
    ctx.teams[k].sub = r.data.id;
  }
  await fakeRepo('fresh', { createdAt: iso(-5 * HOUR), commits: [iso(-5 * HOUR), iso(-3 * HOUR), iso(-HOUR)] });
  await fakeRepo('old-project', { createdAt: iso(-40 * DAY), commits: [iso(-40 * DAY), iso(-10 * DAY), iso(-2 * HOUR)] });
  await fakeRepo('private-one', { status: 404 });
});

test('every score given and changed is kept, from every endpoint', async () => {
  const { q, w } = ctx.crit;
  const sub = ctx.teams.fresh.sub;
  let r = await ctx.judge.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, { submissionId: sub, scores: [{ criterionId: q, score: 6 }, { criterionId: w, score: 3 }] });
  assert.equal(r.status, 200, r.text);
  r = await ctx.judge.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, { submissionId: sub, scores: [{ criterionId: q, score: 9 }, { criterionId: w, score: 3 }], feedback: 'Better on a second look' });
  assert.equal(r.status, 200, r.text);
  // The older endpoint writes through the same table, and is kept too.
  const scoreId = (await dbQuery('SELECT id FROM scores WHERE submission_id = $1 AND criterion_id = $2', [sub, w])).rows[0].id;
  r = await ctx.judge.put(`/api/events/${ctx.ev.id}/judging/scores/${scoreId}`, { score: 4 });
  assert.equal(r.status, 200, r.text);

  r = await admin.get(`/api/events/${ctx.ev.id}/judging/history?submissionId=${sub}`);
  assert.equal(r.status, 200, r.text);
  const q9 = r.data.entries.find((e) => e.criterion.id === q && e.to === 9);
  assert.equal(q9.from, 6);
  assert.equal(q9.judge.name, 'Judge Lalə');
  assert.equal(q9.teamName, `Team fresh ${RUN_ID}`);
  assert.ok(r.data.entries.some((e) => e.criterion.id === w && e.from === 3 && e.to === 4), 'the older endpoint too');
  assert.ok(r.data.entries.some((e) => e.criterion.id === q && e.from === null && e.to === 6), 'the first score');
  assert.equal(r.data.entries.filter((e) => e.criterion.id === w && e.from === 3 && e.to === 3).length, 0, 'unchanged scores are not entries');
  assert.deepEqual(r.data.changed, [{ submissionId: sub, judgeId: q9.judge.id, times: 2 }]);
  assert.ok(new Date(r.data.entries[0].at) >= new Date(r.data.entries[r.data.entries.length - 1].at), 'newest first');

  r = await admin.get(`/api/events/${ctx.ev.id}/results`);
  assert.equal(r.data.reviews.find((x) => x.teamId === ctx.teams.fresh.id).changed, 2, 'the results page shows it per review');

  r = await ctx.judge.get(`/api/events/${ctx.ev.id}/judging/history`);
  assert.equal(r.status, 403, 'judges do not read the audit');
});

test('the GitHub check is a setting, validated', async () => {
  let r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { submission_config: { githubCheck: 'yes' } });
  assert.equal(r.status, 400, r.text);
  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { submission_config: { githubCheck: true } });
  assert.equal(r.status, 200, r.text);
  r = await admin.get(`/api/events/${ctx.ev.id}/judging/repo-checks`);
  assert.equal(r.data.enabled, true);
  assert.equal(r.data.projects.length, 4);
  assert.ok(r.data.projects.every((p) => p.check === null), 'nothing checked yet');
});

test('checking: made before the start, worked on before it, missing, not GitHub', async () => {
  let r = await admin.post(`/api/events/${ctx.ev.id}/judging/repo-checks`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.queued, 3);
  assert.equal(r.data.notGithub, 1);
  const projects = await waitFor('the checks', async () => {
    const x = await admin.get(`/api/events/${ctx.ev.id}/judging/repo-checks`);
    const gh = x.data.projects.filter((p) => p.github);
    return gh.every((p) => p.check) ? x.data.projects : null;
  });
  const by = Object.fromEntries(projects.map((p) => [p.projectName, p]));
  assert.equal(by['Project fresh'].check.status, 'ok');
  assert.deepEqual(by['Project fresh'].check.flags, []);
  assert.equal(by['Project fresh'].check.commitsDuring, 3);
  assert.equal(by['Project old'].check.status, 'warn');
  assert.deepEqual(by['Project old'].check.flags.sort(), ['COMMITS_BEFORE_START', 'CREATED_BEFORE_START']);
  assert.equal(by['Project old'].check.commitsBefore, 2);
  assert.equal(by['Project old'].check.commitsDuring, 1);
  assert.equal(by['Project gone'].check.status, 'warn');
  assert.deepEqual(by['Project gone'].check.flags, ['NOT_FOUND']);
  assert.equal(by['Project lab'].github, false);
  assert.equal(by['Project lab'].check, null, 'GitLab is not checked');
  assert.equal(projects[0].check?.status, 'warn', 'warnings first');

  // Nobody pushed during the event: flagged once the work should be there.
  await fakeRepo('fresh', { createdAt: iso(-5 * HOUR), commits: [iso(-30 * DAY)] });
  r = await admin.post(`/api/events/${ctx.ev.id}/judging/repo-checks`, { submissionIds: [ctx.teams.fresh.sub] });
  assert.equal(r.data.queued, 1);
  await waitFor('the second check', async () => {
    const x = await admin.get(`/api/events/${ctx.ev.id}/judging/repo-checks`);
    const p = x.data.projects.find((y) => y.submissionId === ctx.teams.fresh.sub);
    return p.check.flags.includes('NO_COMMITS_DURING') ? p : null;
  });
});

test('only the organiser checks; other organisations are kept out', async () => {
  let r = await ctx.people.fresh.s.post(`/api/events/${ctx.ev.id}/judging/repo-checks`, {});
  assert.equal(r.status, 403);
  r = await ctx.judge.get(`/api/events/${ctx.ev.id}/judging/repo-checks`);
  assert.equal(r.status, 403);
  const other = await approvedBuyer('ja-other');
  r = await other.session.get(`/api/events/${ctx.ev.id}/judging/repo-checks`);
  assert.equal(r.status, 404);
  r = await other.session.get(`/api/events/${ctx.ev.id}/judging/history`);
  assert.equal(r.status, 404);
  r = await admin.post(`/api/events/${ctx.ev.id}/judging/repo-checks`, { submissionIds: [99999999] });
  assert.equal(r.status, 404);
});
