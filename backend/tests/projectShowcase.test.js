/**
 * The public page of an event's projects end to end: closed by default;
 * opened by the organiser but shown only once the results are published;
 * places as public as the organiser made the results (only prize places
 * unless the results are fully public); no people, scores or files; links
 * only when http(s); a team lead (and only the lead) keeps their project off
 * it; eliminated teams are left out; other organisations cannot open it; an
 * archived event's page stays readable but cannot change. And the platform's
 * public status.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, approvedBuyer, closeSubmissions } = require('./fixtures');

const HOUR = 3600e3;
const admin = new Session('ps-admin');
const anon = new Session('ps-anon');
const ctx = { people: {}, teams: {} };
const pub = () => `/api/public/events/${ctx.ev.slug}/projects`;
const org = () => `/api/events/${ctx.ev.id}/results/projects`;

async function register(tag, name) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ctx.ev.slug}/register`, {
    account: { fullName: name, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  const userId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(tag)])).rows[0].id;
  const pid = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, userId])).rows[0].id;
  const a = await admin.patch(`/api/events/${ctx.ev.id}/participants/${pid}`, { status: 'approved' });
  assert.equal(a.status, 200, a.text);
  return { s, userId };
}

/** Every key anywhere in a JSON value. */
function keysOf(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.add(k); keysOf(v, out); }
  }
  return out;
}

test('setup: three teams with projects, prizes, a judge who scored them', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  let r = await admin.post('/api/events', {
    event_code: `PS${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Projects ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, { items: [{ cid: 'q', name: 'Quality', maxScore: 10, weight: 1 }] });
  assert.equal(r.status, 200, r.text);
  ctx.crit = r.data.idsByCid.q;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/prizes`, {
    items: [
      { cid: 'p1', kind: 'place', position: 1, name: 'Grand prize' },
      { cid: 'p2', kind: 'place', position: 2, name: 'Runner-up' },
      { cid: 'sp', kind: 'special', name: 'Best design' },
    ],
  });
  assert.equal(r.status, 200, r.text);
  ctx.prize = { sp: r.data.idsByCid.sp };

  for (const [k, n] of [['a', 'Aysel'], ['a2', 'Anar'], ['b', 'Bəhruz'], ['c', 'Cəmilə']]) {
    // eslint-disable-next-line no-await-in-loop
    ctx.people[k] = await register(`ps-${k}`, n);
  }
  for (const [k, members] of [['a', ['a', 'a2']], ['b', ['b']], ['c', ['c']]]) {
    const ids = members.map((m) => ctx.people[m].userId);
    // eslint-disable-next-line no-await-in-loop
    r = await admin.post('/api/teams', { eventId: ctx.ev.id, name: `Team ${k.toUpperCase()} ${RUN_ID}`, memberIds: ids, leaderId: ids[0] });
    assert.equal(r.status, 201, r.text);
    ctx.teams[k] = { id: r.data.id };
  }
  r = await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email('ps-judge'), role: 'judge' });
  assert.ok([200, 201].includes(r.status), r.text);
  ctx.judge = new Session('ps-judge');
  await ctx.judge.register({ fullName: 'Judge Vüsal', email: email('ps-judge'), eventCode: ctx.ev.event_code });
  r = await admin.put(`/api/events/${ctx.ev.id}`, { start_date: iso(-HOUR), end_date: iso(DAY) });
  // The organiser opened judging while submissions are still open (rolling
  // judging); without a judging start it opens when submissions close.
  await dbQuery("UPDATE events SET judging_start = now() - interval '1 minute' WHERE id = $1", [ctx.ev.id]);
  assert.equal(r.status, 200, r.text);

  const long = 'Bakı metrosu üçün sıxlıq xəritəsi. '.repeat(40);
  for (const [k, title, desc] of [['a', 'Metro Pulse', long], ['b', 'Kür Sensor', 'Su səviyyəsi'], ['c', 'Dizayn Lab', 'UI']]) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.people[k].s.post('/api/submissions', {
      eventId: ctx.ev.id, projectName: title, description: desc, repoLink: `https://github.com/ps/${k}${RUN_ID}`,
    });
    assert.equal(r.status, 201, r.text);
    ctx.teams[k].sub = r.data.id;
  }
  // Links typed by hand: a bare domain gets https, anything not http(s) is never shown.
  await dbQuery('UPDATE submissions SET demo_link = $2, video_link = $3, tech_stack = $4 WHERE id = $1',
    [ctx.teams.a.sub, 'javascript:alert(1)', 'youtu.be/demo-a', 'Node, PostGIS']);
  await dbQuery('UPDATE submissions SET demo_link = $2 WHERE id = $1', [ctx.teams.b.sub, 'ftp://files.example.az/b']);
  for (const [k, score] of [['a', 9], ['b', 7], ['c', 5]]) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.judge.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, { submissionId: ctx.teams[k].sub, scores: [{ criterionId: ctx.crit, score }] });
    assert.equal(r.status, 200, r.text);
  }
  r = await admin.patch(`/api/events/${ctx.ev.id}/results/prizes/${ctx.prize.sp}`, { teamId: ctx.teams.c.id });
  assert.equal(r.status, 200, r.text);
});

test('closed by default: the public page is not there and the event page does not link to it', async () => {
  let r = await anon.get(pub());
  assert.equal(r.status, 404);
  r = await anon.get(`/api/public/events/${ctx.ev.slug}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.features.projects, false);
  r = await admin.get(org());
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.public, false);
  assert.equal(r.data.live, false);
  assert.equal(r.data.projects.listed, 3);
});

test('opened by the organiser, it still waits for the published results', async () => {
  let r = await admin.put(org(), { public: 'yes' });
  assert.equal(r.status, 400, 'a boolean, not a word');
  r = await admin.put(org(), { public: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.public, true);
  assert.equal(r.data.live, false, 'results not published yet');
  r = await anon.get(pub());
  assert.equal(r.status, 404);
  const audit = await dbQuery("SELECT 1 FROM audit_log WHERE event_id = $1 AND action = 'projects.public_on'", [ctx.ev.id]);
  assert.equal(audit.rowCount, 1);
});

test('after publishing: winners first, only prize places unless the results are fully public', async () => {
  await closeSubmissions(ctx.ev.id);
  let r = await admin.post(`/api/events/${ctx.ev.id}/results/publish`, { visibility: 'own_and_winners' });
  assert.equal(r.status, 200, r.text);
  r = await anon.get(pub());
  assert.equal(r.status, 200, r.text);
  const d = r.data;
  assert.equal(d.event.slug, ctx.ev.slug);
  assert.equal(d.places, 'winners');
  assert.deepEqual(d.projects.map((p) => [p.title, p.place]), [['Metro Pulse', 1], ['Kür Sensor', 2], ['Dizayn Lab', null]],
    'third place won no place prize: under "own and winners" it is not public');
  const c = d.projects.find((p) => p.title === 'Dizayn Lab');
  assert.deepEqual(c.awards.map((a) => [a.name, a.kind]), [['Best design', 'special']]);
  const a = d.projects.find((p) => p.title === 'Metro Pulse');
  assert.deepEqual(a.awards.map((x) => x.name), ['Grand prize']);
  assert.ok(a.description.length <= 601 && a.description.endsWith('…'), 'a short description');
  assert.equal(a.links.repo, `https://github.com/ps/a${RUN_ID}`);
  assert.equal(a.links.demo, null, 'javascript: is never shown');
  assert.equal(a.links.video, 'https://youtu.be/demo-a', 'a bare domain gets https');
  assert.equal(a.techStack, 'Node, PostGIS');
  assert.equal(d.projects.find((p) => p.title === 'Kür Sensor').links.demo, null, 'ftp: is never shown');
  assert.match(r.text, /"teamName"/);
  assert.equal(r.json.success, true);

  r = await anon.get(`/api/public/events/${ctx.ev.slug}`);
  assert.equal(r.data.features.projects, true, 'the event page links to it now');

  r = await admin.post(`/api/events/${ctx.ev.id}/results/publish`, { visibility: 'full' });
  assert.equal(r.status, 200, r.text);
  r = await anon.get(pub());
  assert.equal(r.data.places, 'all');
  assert.deepEqual(r.data.projects.map((p) => [p.title, p.place]), [['Metro Pulse', 1], ['Kür Sensor', 2], ['Dizayn Lab', 3]]);
});

test('no people, no scores, no files on the public page', async () => {
  const r = await anon.get(pub());
  assert.equal(r.status, 200);
  const keys = [...keysOf(r.json)];
  for (const banned of ['email', 'phone', 'score', 'scores', 'breakdown', 'judgesCount', 'members', 'leaderId', 'userId', 'files', 'feedback', 'joinCode', 'join_code']) {
    assert.ok(!keys.some((k) => k.toLowerCase() === banned.toLowerCase()), `no "${banned}" field`);
  }
  assert.ok(!/@e2e\.test/.test(r.text), 'no e-mail address anywhere');
  assert.ok(!/Aysel|Anar|Bəhruz|Cəmilə|Vüsal/.test(r.text), 'no names of people');
  assert.equal(r.json.data.projects.length, 3);
});

test('only the team lead keeps the project off the page, and can bring it back', async () => {
  const mine = `${org()}/mine`;
  let r = await ctx.people.a2.s.get(mine);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.team.isLead, false);
  r = await ctx.people.a2.s.put(mine, { hidden: true });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'NOT_TEAM_LEAD');

  r = await ctx.people.a.s.get(mine);
  assert.equal(r.data.team.isLead, true);
  assert.equal(r.data.live, true);
  r = await ctx.people.a.s.put(mine, { hidden: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.team.hidden, true);
  r = await anon.get(pub());
  assert.deepEqual(r.data.projects.map((p) => p.title), ['Kür Sensor', 'Dizayn Lab'], 'hidden by its lead');
  r = await admin.get(org());
  assert.equal(r.data.projects.hidden, 1);
  r = await ctx.people.a.s.put(mine, { hidden: false });
  assert.equal(r.status, 200, r.text);
  r = await anon.get(pub());
  assert.equal(r.data.projects.length, 3);
  const audit = await dbQuery("SELECT action FROM audit_log WHERE event_id = $1 AND action LIKE 'projects.team_%' ORDER BY id", [ctx.ev.id]);
  assert.deepEqual(audit.rows.map((x) => x.action), ['projects.team_hidden', 'projects.team_shown']);
});

test('an eliminated team is left out', async () => {
  // Under published results the organiser cannot eliminate a ranked team (they unpublish first)...
  let r = await admin.patch(`/api/teams/${ctx.teams.b.id}/status`, { status: 'eliminated', reason: 'Rules' });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'RESULTS_PUBLISHED');
  // ...but a team eliminated before (an older event) stays off the public page.
  await dbQuery("UPDATE teams SET status = 'eliminated' WHERE id = $1", [ctx.teams.b.id]);
  try {
    r = await anon.get(pub());
    assert.ok(!r.data.projects.some((p) => p.title === 'Kür Sensor'));
  } finally {
    await dbQuery("UPDATE teams SET status = 'active' WHERE id = $1", [ctx.teams.b.id]);
  }
});

test('other organisations and participants cannot open or close it', async () => {
  const other = await approvedBuyer('ps-other');
  let r = await other.session.put(org(), { public: false });
  assert.equal(r.status, 404, 'another organisation does not see the event');
  r = await other.session.get(org());
  assert.equal(r.status, 404);
  r = await ctx.people.a.s.put(org(), { public: false });
  assert.equal(r.status, 403, 'a participant is not the organiser');
  r = await other.session.put(`${org()}/mine`, { hidden: true });
  assert.equal(r.status, 404);
  r = await anon.put(org(), { public: false });
  assert.equal(r.status, 401);
  r = await anon.get(pub());
  assert.equal(r.status, 200, 'still open');
});

test('closing it takes the page down at once', async () => {
  let r = await admin.put(org(), { public: false });
  assert.equal(r.status, 200, r.text);
  r = await anon.get(pub());
  assert.equal(r.status, 404);
  assert.equal(r.json.code, 'NOT_FOUND');
  r = await admin.put(org(), { public: true });
  assert.equal(r.status, 200, r.text);
});

test('an archived event: the page stays readable, nothing can change', async () => {
  let r = await admin.post(`/api/events/${ctx.ev.id}/archive`, {});
  assert.equal(r.status, 200, r.text);
  r = await anon.get(pub());
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.archived, true);
  assert.equal(r.data.projects.length, 3);
  r = await admin.put(org(), { public: false });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'EVENT_ARCHIVED');
  r = await ctx.people.a.s.put(`${org()}/mine`, { hidden: true });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'EVENT_ARCHIVED');
  r = await admin.post(`/api/events/${ctx.ev.id}/unarchive`, {});
  assert.equal(r.status, 200, r.text);
});

test('an unknown address answers 404', async () => {
  const r = await anon.get('/api/public/events/no-such-event-anywhere/projects');
  assert.equal(r.status, 404);
});

test('the platform status: api, database, jobs and mail, nothing secret', async () => {
  const r = await anon.get('/api/public/status');
  assert.equal(r.status, 200, r.text);
  const d = r.data;
  assert.ok(['ok', 'degraded'].includes(d.status), d.status);
  assert.deepEqual(Object.keys(d.checks).sort(), ['api', 'database', 'jobs', 'mail']);
  assert.equal(d.checks.api.state, 'ok');
  assert.equal(d.checks.database.state, 'ok');
  assert.equal(typeof d.checks.database.latencyMs, 'number');
  assert.ok(['ok', 'degraded', 'down'].includes(d.checks.jobs.state));
  assert.equal(typeof d.checks.jobs.lagSeconds, 'number');
  assert.ok(['ok', 'off'].includes(d.checks.mail.state));
  assert.ok(!Number.isNaN(Date.parse(d.time)));
  assert.ok(d.version === null || /^[0-9a-f]{7}$/.test(d.version));
  assert.ok(!/smtp|resend|brevo|password|secret|@/i.test(r.text), 'no provider, address or secret');
  assert.match(String(r.text), /"status"/);
  const again = await anon.get('/api/public/status');
  assert.equal(again.data.time, d.time, 'kept for half a minute');
});
