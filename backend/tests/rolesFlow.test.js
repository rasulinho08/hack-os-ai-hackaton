/**
 * Participant, judge and mentor rules, end to end against a running API:
 *
 *   - judging opens when submissions close unless the organiser set a
 *     judging start of its own;
 *   - a project changed after a judge's review is flagged for that judge
 *     and in the organiser's judging progress, until the judge saves again;
 *     saving the same content again changes nothing;
 *   - only accepted participants ask the mentors for help (pending and
 *     rejected people are told why);
 *   - after the team deadline the public page says team formation is
 *     closed, and an event that needs teams of two or more refuses people
 *     registering alone (they could never hand in a project);
 *   - people's choice opens when submissions close, or at the organiser's
 *     voting start;
 *   - a repository typed without https:// is accepted and stored with it;
 *   - announcements tell a staff page which posts are automatic;
 *   - the confirmation e-mail of an event's registration links to a page in
 *     the event's language.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, confirmEmail, mailsTo, verifyTokenFor } = require('./helpers');
const { dbQuery } = require('./fixtures');

const HOUR = 3600e3;
const admin = new Session('rf-admin');
const ctx = {};

const code = (tag) => `RF${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
const uidOf = async (mail) => (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [mail])).rows[0].id;
const pidOf = async (eventId, userId) => (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [eventId, userId])).rows[0].id;

async function newEvent(tag, extra = {}) {
  const r = await admin.post('/api/events', {
    event_code: code(tag), name: `Roles flow ${tag} ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true, ...extra,
  });
  assert.equal(r.status, 201, r.text);
  return r.data;
}

/** A new person registered alone for `ev`, signed in, with the given status. */
async function participant(ev, tag, status = 'approved') {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: `Person ${tag}`, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  await confirmEmail(email(tag));
  await s.login(email(tag));
  const userId = await uidOf(email(tag));
  if (status !== 'pending') {
    const p = await admin.patch(`/api/events/${ev.id}/participants/${await pidOf(ev.id, userId)}`, { status });
    assert.equal(p.status, 200, p.text);
  }
  return { s, userId };
}

async function judgeOf(ev, tag) {
  await admin.post(`/api/events/${ev.id}/invites`, { email: email(tag), role: 'judge' });
  const s = new Session(tag);
  await s.register({ fullName: `Judge ${tag}`, email: email(tag), eventCode: ev.event_code });
  const uid = await uidOf(email(tag));
  return { s, id: (await dbQuery('SELECT id FROM judges WHERE event_id = $1 AND user_id = $2', [ev.id, uid])).rows[0].id };
}

const setTimes = (eventId, cols) => {
  const keys = Object.keys(cols);
  return dbQuery(
    `UPDATE events SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
    [eventId, ...keys.map((k) => cols[k])],
  );
};

test('setup: an event running now, a team with a project, a judge, two criteria', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  ctx.ev = await newEvent('J');
  let r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, {
    items: [{ cid: 'a', name: 'Idea', maxScore: 10, weight: 1 }, { cid: 'b', name: 'Build', maxScore: 10, weight: 1 }],
  });
  assert.equal(r.status, 200, r.text);
  ctx.crit = r.data.idsByCid;
  ctx.lead = await participant(ctx.ev, 'rf-lead');
  r = await admin.post('/api/teams', { eventId: ctx.ev.id, name: `Team Rf ${RUN_ID}`, memberIds: [ctx.lead.userId], leaderId: ctx.lead.userId });
  assert.equal(r.status, 201, r.text);
  ctx.teamId = r.data.id;
  ctx.judge = await judgeOf(ctx.ev, 'rf-judge');
  // Running: started an hour ago, submissions close in a day, no judging start.
  await setTimes(ctx.ev.id, { start_date: iso(-HOUR), end_date: iso(2 * DAY), submission_deadline: iso(DAY), judging_start: null });
});

test('a repository typed without https:// is accepted and stored with it', async () => {
  const r = await ctx.lead.s.post('/api/submissions', {
    eventId: ctx.ev.id, projectName: 'Rf Bot', description: 'First', repoLink: `github.com/rf/bot${RUN_ID}`,
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.repo_link, `https://github.com/rf/bot${RUN_ID}`);
  ctx.sub = r.data.id;
  const bad = await ctx.lead.s.put(`/api/submissions/${ctx.sub}`, { repoLink: 'javascript:alert(1)' });
  assert.equal(bad.status, 400, 'a link with another scheme is still refused');
});

test('without a judging start, judging opens when submissions close', async () => {
  const review = () => ctx.judge.s.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, {
    submissionId: ctx.sub, scores: [{ criterionId: ctx.crit.a, score: 7 }, { criterionId: ctx.crit.b, score: 6 }],
  });
  let r = await ctx.judge.s.get(`/api/events/${ctx.ev.id}/judging/me`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.window.state, 'not_open', 'submissions are still open');
  assert.equal(new Date(r.data.window.start).getTime(), new Date((await dbQuery('SELECT submission_deadline FROM events WHERE id = $1', [ctx.ev.id])).rows[0].submission_deadline).getTime());
  assert.equal(r.data.window.startsAtDeadline, true);
  r = await review();
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'JUDGING_NOT_OPEN');

  // The organiser opens judging early on purpose (rolling judging).
  await setTimes(ctx.ev.id, { judging_start: iso(-HOUR / 2) });
  r = await review();
  assert.equal(r.status, 200, r.text);
  r = await ctx.judge.s.get(`/api/events/${ctx.ev.id}/judging/me`);
  assert.equal(r.data.window.state, 'open');
  const mine = r.data.teams.find((t) => t.submissionId === ctx.sub);
  assert.equal(mine.state, 'done');
  assert.equal(mine.changedSinceReview, false);
});

test('a project changed after the review is flagged until the judge looks again', async () => {
  // Saving exactly what is there already is not a change.
  let r = await ctx.lead.s.put(`/api/submissions/${ctx.sub}`, { projectName: 'Rf Bot', description: 'First', repoLink: `https://github.com/rf/bot${RUN_ID}` });
  assert.equal(r.status, 200, r.text);
  r = await ctx.judge.s.get(`/api/events/${ctx.ev.id}/judging/me`);
  assert.equal(r.data.teams.find((t) => t.submissionId === ctx.sub).changedSinceReview, false, 'same content: no marker');

  r = await ctx.lead.s.put(`/api/submissions/${ctx.sub}`, { projectName: 'Rf Bot v2', description: 'Changed after scoring' });
  assert.equal(r.status, 200, r.text);

  r = await ctx.judge.s.get(`/api/events/${ctx.ev.id}/judging/me`);
  const mine = r.data.teams.find((t) => t.submissionId === ctx.sub);
  assert.equal(mine.changedSinceReview, true, 'the judge sees "changed since your review"');
  assert.ok(mine.changedAt, 'with when it changed');
  assert.equal(mine.state, 'done', 'the review still counts');
  assert.equal(r.data.progress.changed, 1);

  r = await admin.get(`/api/events/${ctx.ev.id}/judging/progress`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.changedSinceReview, 1, 'the organiser sees it in judging progress');
  const cell = r.data.cells.find((c) => c.judgeId === ctx.judge.id && c.teamId === ctx.teamId);
  assert.equal(cell.changedSinceReview, true);
  assert.equal(r.data.judges.find((j) => j.id === ctx.judge.id).changed, 1);
  assert.equal(r.data.teams.find((t) => t.id === ctx.teamId).changed, 1);

  // The judge looks again and saves: the flag goes.
  r = await ctx.judge.s.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, {
    submissionId: ctx.sub, scores: [{ criterionId: ctx.crit.a, score: 8 }, { criterionId: ctx.crit.b, score: 6 }],
  });
  assert.equal(r.status, 200, r.text);
  r = await ctx.judge.s.get(`/api/events/${ctx.ev.id}/judging/me`);
  assert.equal(r.data.teams.find((t) => t.submissionId === ctx.sub).changedSinceReview, false);
  r = await admin.get(`/api/events/${ctx.ev.id}/judging/progress`);
  assert.equal(r.data.changedSinceReview, 0);
});

test('only accepted participants ask the mentors for help', async () => {
  const ask = (s) => s.post('/api/tickets', { eventId: ctx.ev.id, topic: 'Stuck', description: 'The build fails' });
  const pending = await participant(ctx.ev, 'rf-pending', 'pending');
  let r = await ask(pending.s);
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'HACKER_NOT_APPROVED');
  assert.match(r.json.message, /still being reviewed/);

  const rejected = await participant(ctx.ev, 'rf-rejected', 'rejected');
  r = await ask(rejected.s);
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'PARTICIPANT_REJECTED');

  r = await ask(ctx.lead.s);
  assert.equal(r.status, 201, r.text);
  const queue = await dbQuery('SELECT requester_id FROM help_tickets WHERE event_id = $1', [ctx.ev.id]);
  assert.deepEqual(queue.rows.map((x) => Number(x.requester_id)), [Number(ctx.lead.userId)], 'only the accepted person reaches the queue');
});

test('people\'s choice opens when submissions close, or at the organiser\'s voting start', async () => {
  let r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { judging_config: { peopleChoice: true } });
  assert.equal(r.status, 200, r.text);
  r = await ctx.lead.s.get(`/api/events/${ctx.ev.id}/voting/me`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.state, 'not_open', 'the event runs, submissions are open');
  const deadline = (await dbQuery('SELECT submission_deadline FROM events WHERE id = $1', [ctx.ev.id])).rows[0].submission_deadline;
  assert.equal(new Date(r.data.opensAt).getTime(), new Date(deadline).getTime());

  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { judging_config: { votingStart: iso(-60e3) } });
  assert.equal(r.status, 200, r.text);
  r = await ctx.lead.s.get(`/api/events/${ctx.ev.id}/voting/me`);
  assert.equal(r.data.state, 'open', 'the organiser opened it early');

  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { judging_config: { votingStart: 'soon' } });
  assert.equal(r.status, 400, 'not a date');
});

test('staff pages can tell the automatic posts from the organisers\' own', async () => {
  let r = await admin.post('/api/announcements', { eventId: ctx.ev.id, title: 'Lunch at 14:00', content: 'In the hall', audience: 'everyone' });
  assert.equal(r.status, 201, r.text);
  r = await ctx.judge.s.get(`/api/announcements?eventId=${ctx.ev.id}`);
  assert.equal(r.status, 200, r.text);
  const lunch = r.json.data.find((a) => a.title === 'Lunch at 14:00');
  assert.ok(lunch, 'the judge sees a post for everyone');
  assert.equal(lunch.automatic, false);
});

test('after the team deadline: the page says so, and alone is refused where teams are needed', async () => {
  const ev = await newEvent('T', { min_team_size: 2 });
  // Registration still open, team formation closed an hour ago.
  await setTimes(ev.id, { team_deadline: iso(-HOUR), start_date: iso(DAY), end_date: iso(2 * DAY), registration_end: iso(DAY / 2) });
  let r = await new Session('rf-anon').get(`/api/public/events/${ev.slug}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.registration.state, 'open');
  assert.equal(r.data.registration.teamFormation.open, false);
  assert.equal(r.data.registration.teamFormation.reason, 'deadline');
  assert.equal(r.data.registration.teamFormation.soloCanCompete, false);
  assert.equal(r.data.registration.teamFormation.minTeamSize, 2);

  const body = (tag, entry) => ({
    account: { fullName: `Late ${tag}`, email: email(tag), password: 'Test1234!' },
    entry, answers: {}, accept: { rules: true, coc: true },
  });
  r = await new Session('rf-late1').post(`/api/public/events/${ev.slug}/register`, body('rf-late1', { type: 'solo' }));
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'TEAM_FORMATION_CLOSED_SOLO');
  assert.match(r.json.message, /at least 2/);
  r = await new Session('rf-late2').post(`/api/public/events/${ev.slug}/register`, body('rf-late2', { type: 'lead', teamName: 'Too late' }));
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'TEAM_FORMATION_CLOSED');

  // Teams of one are fine: alone still competes.
  await dbQuery('UPDATE events SET min_team_size = 1 WHERE id = $1', [ev.id]);
  r = await new Session('rf-anon2').get(`/api/public/events/${ev.slug}`);
  assert.equal(r.data.registration.teamFormation.soloCanCompete, true);
  r = await new Session('rf-late3').post(`/api/public/events/${ev.slug}/register`, body('rf-late3', { type: 'solo' }));
  assert.equal(r.status, 201, r.text);
});

test('the confirmation e-mail opens the page in the event\'s language', async () => {
  const ev = await newEvent('L');
  await dbQuery("UPDATE events SET language = 'az' WHERE id = $1", [ev.id]);
  const r = await new Session('rf-az').post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: 'Aysel Az', email: email('rf-az'), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  assert.ok(await verifyTokenFor(email('rf-az')), 'a confirmation e-mail arrived');
  const mails = await mailsTo(email('rf-az'));
  const verify = mails.find((m) => /\/verify-email\?token=/.test(m.text));
  assert.match(verify.text, /\/verify-email\?token=[^\s"&]+&lang=az/, 'the link carries the event language');
});
