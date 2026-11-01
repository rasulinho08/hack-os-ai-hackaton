/**
 * A hackathon that has run its course, for the suites that read what is left
 * afterwards (the participant's record and profile, the post-event report):
 * people registered through the public form (some admitted, one waiting,
 * one refused), answers to the standard questions, two teams with projects,
 * a judge who scored both, prizes, published results, check-ins, NPS
 * answers and a sponsor.
 */

const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, closeSubmissions } = require('./fixtures');

const HOUR = 3600e3;

/**
 * @param {Session} admin a signed-in organiser
 * @param {string} tag    short and unique per suite
 * @param {{ people?: Array<{ key: string, name: string, answers?: object }> }} [opts]
 */
async function finishedEvent(admin, tag, opts = {}) {
  const ctx = { tag, people: {}, teams: {} };
  const code = `${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  let r = await admin.post('/api/events', {
    event_code: code, name: `Finished ${tag} ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await admin.get(`/api/events/${ctx.ev.id}/builder`);
  ctx.ev.slug = r.data.event.slug;
  // The standard questions the report counts.
  const fields = r.data.fields.map((f) => ({
    id: f.id, key: f.field_key, enabled: ['university', 'experience', 'city', 'phone'].includes(f.field_key), required: false, sensitive: f.sensitive,
  }));
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/form`, { items: fields });
  assert.equal(r.status, 200, r.text);
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, { items: [{ cid: 'q', name: 'Quality', maxScore: 10, weight: 1 }] });
  assert.equal(r.status, 200, r.text);
  ctx.crit = r.data.idsByCid.q;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/prizes`, {
    items: [{ cid: 'p1', kind: 'place', position: 1, name: 'Grand prize', value: '1000 AZN' }, { cid: 'sp', kind: 'special', name: 'Best design' }],
  });
  assert.equal(r.status, 200, r.text);
  ctx.prizeSpecial = r.data.idsByCid.sp;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/sponsors`, { items: [{ cid: 's1', name: `Sponsor ${tag}`, tier: 'gold' }] });
  assert.equal(r.status, 200, r.text);

  const people = opts.people || [
    { key: 'a', name: `Aysel ${tag}` }, { key: 'b', name: `Bəhruz ${tag}` }, { key: 'c', name: `Cəmilə ${tag}` },
    { key: 'd', name: `Dilarə ${tag}` }, { key: 'e', name: `Elnur ${tag}` }, { key: 'f', name: `Fərid ${tag}` },
  ];
  for (const [i, p] of people.entries()) {
    const s = new Session(`${tag}-${p.key}`);
    // eslint-disable-next-line no-await-in-loop
    r = await s.post(`/api/public/events/${ctx.ev.slug}/register`, {
      account: { fullName: p.name, email: email(`${tag}-${p.key}`), password: 'Test1234!' },
      entry: { type: 'solo' },
      answers: p.answers || { university: i < 4 ? 'ADA Universiteti' : `Uni ${i}`, experience: 'intermediate', city: 'Bakı', phone: '+994501234567' },
      accept: { rules: true, coc: true },
    });
    assert.equal(r.status, 201, r.text);
    // eslint-disable-next-line no-await-in-loop
    const row = (await dbQuery(
      'SELECT u.id AS user_id, p.id AS pid FROM users u JOIN participants p ON p.user_id = u.id AND p.event_id = $2 WHERE LOWER(u.email) = LOWER($1)',
      [email(`${tag}-${p.key}`), ctx.ev.id],
    )).rows[0];
    ctx.people[p.key] = { s, userId: row.user_id, pid: row.pid, name: p.name, email: email(`${tag}-${p.key}`) };
  }
  const keys = Object.keys(ctx.people);
  // Four admitted, one on the waiting list, one refused.
  for (const [i, k] of keys.entries()) {
    const status = i < 4 ? 'approved' : i === 4 ? 'waitlisted' : 'rejected';
    // eslint-disable-next-line no-await-in-loop
    r = await admin.patch(`/api/events/${ctx.ev.id}/participants/${ctx.people[k].pid}`, { status });
    assert.equal(r.status, 200, r.text);
  }
  for (const [k, members] of [['x', [keys[0], keys[1]]], ['y', [keys[2], keys[3]]]]) {
    const ids = members.map((m) => ctx.people[m].userId);
    // eslint-disable-next-line no-await-in-loop
    r = await admin.post('/api/teams', { eventId: ctx.ev.id, name: `Team ${k.toUpperCase()} ${tag}`, memberIds: ids, leaderId: ids[0] });
    assert.equal(r.status, 201, r.text);
    ctx.teams[k] = { id: r.data.id, name: `Team ${k.toUpperCase()} ${tag}` };
  }
  r = await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email(`${tag}-judge`), role: 'judge' });
  assert.ok([200, 201].includes(r.status), r.text);
  ctx.judge = new Session(`${tag}-judge`);
  await ctx.judge.register({ fullName: `Judge ${tag}`, email: email(`${tag}-judge`), eventCode: ctx.ev.event_code });
  r = await admin.put(`/api/events/${ctx.ev.id}`, { start_date: iso(-HOUR), end_date: iso(DAY) });
  assert.equal(r.status, 200, r.text);
  // Judges score while the event runs: the organiser opened judging early.
  await dbQuery("UPDATE events SET judging_start = now() - interval '1 minute' WHERE id = $1", [ctx.ev.id]);
  for (const [k, lead, project] of [['x', keys[0], `Project X ${tag}`], ['y', keys[2], `Project Y ${tag}`]]) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.people[lead].s.post('/api/submissions', { eventId: ctx.ev.id, projectName: project, description: 'Built at the event', repoLink: `https://github.com/e2e/${k}${RUN_ID}` });
    assert.equal(r.status, 201, r.text);
    ctx.teams[k].sub = r.data.id;
    ctx.teams[k].project = project;
  }
  for (const [k, score] of [['x', 9], ['y', 6]]) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.judge.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, { submissionId: ctx.teams[k].sub, scores: [{ criterionId: ctx.crit, score }] });
    assert.equal(r.status, 200, r.text);
  }
  r = await admin.patch(`/api/events/${ctx.ev.id}/results/prizes/${ctx.prizeSpecial}`, { teamId: ctx.teams.y.id });
  assert.equal(r.status, 200, r.text);
  await closeSubmissions(ctx.ev.id);
  r = await admin.post(`/api/events/${ctx.ev.id}/results/publish`, { visibility: 'own_and_winners' });
  assert.equal(r.status, 200, r.text);
  // Check-ins and feedback, written straight: their own suites cover the flows.
  for (const k of keys.slice(0, 3)) {
    // eslint-disable-next-line no-await-in-loop
    await dbQuery("INSERT INTO event_checkins (event_id, participant_id, method) VALUES ($1, $2, 'manual') ON CONFLICT DO NOTHING", [ctx.ev.id, ctx.people[k].pid]);
  }
  for (const [k, nps] of [[keys[0], 10], [keys[1], 9], [keys[2], 7], [keys[3], 3]]) {
    // eslint-disable-next-line no-await-in-loop
    await dbQuery("INSERT INTO feedback (event_id, user_id, type, nps, comment) VALUES ($1, $2, 'nps', $3, $4)", [ctx.ev.id, ctx.people[k].userId, nps, `Private comment by ${ctx.people[k].name}`]);
  }
  return ctx;
}

module.exports = { finishedEvent };
