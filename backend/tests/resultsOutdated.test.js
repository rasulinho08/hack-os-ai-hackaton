/**
 * Publishing results over outdated reviews, end to end against a running API:
 *
 *   - nothing outdated: no warning, publishing goes through as before;
 *   - a team changes its project after the judges reviewed it (rolling
 *     judging): the results page and the organiser home say which judges and
 *     projects, and publishing is refused with REVIEWS_OUTDATED;
 *   - "ask judges to re-check" puts it in the affected judges' bell and
 *     e-mails them in the event's language, once (a second press within the
 *     cooldown skips them); judges with nothing outdated get nothing;
 *   - a judge who saves again is no longer outdated;
 *   - with confirmOutdated the results are published, and the confirmation
 *     is kept with the publication and in the audit log;
 *   - another organisation's organiser reaches none of it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, confirmEmail, mailsTo } = require('./helpers');
const { dbQuery, approvedBuyer } = require('./fixtures');

const HOUR = 3600e3;
const admin = new Session('ro-admin');
const ctx = {};

const uidOf = async (mail) => (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [mail])).rows[0].id;

async function participant(ev, tag) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: `Person ${tag}`, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  await confirmEmail(email(tag));
  await s.login(email(tag));
  const userId = await uidOf(email(tag));
  const pid = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ev.id, userId])).rows[0].id;
  const p = await admin.patch(`/api/events/${ev.id}/participants/${pid}`, { status: 'approved' });
  assert.equal(p.status, 200, p.text);
  return { s, userId };
}

async function judgeOf(ev, tag) {
  await admin.post(`/api/events/${ev.id}/invites`, { email: email(tag), role: 'judge' });
  const s = new Session(tag);
  await s.register({ fullName: `Judge ${tag}`, email: email(tag), eventCode: ev.event_code });
  const uid = await uidOf(email(tag));
  return { s, userId: uid, email: email(tag), id: (await dbQuery('SELECT id FROM judges WHERE event_id = $1 AND user_id = $2', [ev.id, uid])).rows[0].id };
}

const review = (judge, sub, score) => judge.s.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, {
  submissionId: sub, scores: [{ criterionId: ctx.crit, score }],
});
const publish = (body = {}) => admin.post(`/api/events/${ctx.ev.id}/results/publish`, { visibility: 'full', ...body });
const reopen = () => dbQuery("UPDATE events SET submission_deadline = now() + interval '1 day', end_date = now() + interval '2 days' WHERE id = $1", [ctx.ev.id]);
const close = () => dbQuery("UPDATE events SET submission_deadline = now() - interval '2 minutes', end_date = now() - interval '1 minute' WHERE id = $1", [ctx.ev.id]);

test('setup: rolling judging, two teams with projects, two judges who reviewed both', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  let r = await admin.post('/api/events', {
    event_code: `RO${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Outdated ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true, language: 'az',
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await admin.get(`/api/events/${ctx.ev.id}/builder`);
  ctx.ev.slug = r.data.event.slug;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, { items: [{ cid: 'q', name: 'Quality', maxScore: 10, weight: 1 }] });
  assert.equal(r.status, 200, r.text);
  ctx.crit = r.data.idsByCid.q;
  ctx.leads = {};
  ctx.teams = {};
  for (const k of ['x', 'y']) {
    // eslint-disable-next-line no-await-in-loop
    ctx.leads[k] = await participant(ctx.ev, `ro-lead-${k}`);
    // eslint-disable-next-line no-await-in-loop
    r = await admin.post('/api/teams', { eventId: ctx.ev.id, name: `Team ${k.toUpperCase()} ${RUN_ID}`, memberIds: [ctx.leads[k].userId], leaderId: ctx.leads[k].userId });
    assert.equal(r.status, 201, r.text);
    ctx.teams[k] = r.data.id;
  }
  ctx.j1 = await judgeOf(ctx.ev, 'ro-judge-1');
  ctx.j2 = await judgeOf(ctx.ev, 'ro-judge-2');
  ctx.j3 = await judgeOf(ctx.ev, 'ro-judge-3');
  // Running now, submissions open for a day, judging opened early on purpose.
  await dbQuery(
    'UPDATE events SET start_date = $2, end_date = $3, submission_deadline = $4, judging_start = $5 WHERE id = $1',
    [ctx.ev.id, iso(-HOUR), iso(2 * DAY), iso(DAY), iso(-HOUR / 2)],
  );
  ctx.subs = {};
  for (const k of ['x', 'y']) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.leads[k].s.post('/api/submissions', { eventId: ctx.ev.id, projectName: `Project ${k.toUpperCase()} ${RUN_ID}`, description: 'First version', repoLink: `https://github.com/ro/${k}${RUN_ID}` });
    assert.equal(r.status, 201, r.text);
    ctx.subs[k] = r.data.id;
  }
  for (const [j, k, score] of [[ctx.j1, 'x', 8], [ctx.j1, 'y', 6], [ctx.j2, 'x', 7], [ctx.j2, 'y', 5], [ctx.j3, 'x', 9], [ctx.j3, 'y', 4]]) {
    // eslint-disable-next-line no-await-in-loop
    r = await review(j, ctx.subs[k], score);
    assert.equal(r.status, 200, r.text);
  }
});

test('nothing outdated: no warning, and publishing goes through without any confirmation', async () => {
  await close();
  let r = await admin.get(`/api/events/${ctx.ev.id}/results`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.outdated.count, 0);
  assert.equal(r.data.outdated.rolling, true, 'judging opened before submissions closed');
  r = await admin.get(`/api/events/${ctx.ev.id}/overview`);
  assert.equal(r.status, 200, r.text);
  assert.ok(!r.data.alerts.some((a) => a.code === 'reviews_outdated'));
  r = await publish();
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.outdated, null);
  assert.equal(r.data.published.outdatedConfirmed, null);
  assert.equal((await dbQuery('SELECT results_outdated_confirmation FROM events WHERE id = $1', [ctx.ev.id])).rows[0].results_outdated_confirmation, null);
  r = await admin.post(`/api/events/${ctx.ev.id}/results/unpublish`, {});
  assert.equal(r.status, 200, r.text);
});

test('a project changed after its reviews: said by judge and project, and publishing is refused', async () => {
  await reopen();
  let r = await ctx.leads.x.s.put(`/api/submissions/${ctx.subs.x}`, { projectName: `Project X v2 ${RUN_ID}`, description: 'Changed after the judges looked' });
  assert.equal(r.status, 200, r.text);
  await close();

  r = await admin.get(`/api/events/${ctx.ev.id}/results/outdated`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.count, 3, 'three judges reviewed the old version');
  assert.deepEqual(r.data.judges.map((j) => j.judgeId).sort(), [ctx.j1.id, ctx.j2.id, ctx.j3.id].sort());
  assert.equal(r.data.projects.length, 1);
  assert.equal(r.data.projects[0].teamId, ctx.teams.x);
  assert.equal(r.data.projects[0].projectName, `Project X v2 ${RUN_ID}`);
  assert.ok(r.data.reviews.every((x) => x.changedAt && x.reviewedAt && new Date(x.changedAt) > new Date(x.reviewedAt)));
  assert.equal((await admin.get(`/api/events/${ctx.ev.id}/results`)).data.outdated.count, 3, 'the results page carries it too');

  r = await admin.get(`/api/events/${ctx.ev.id}/overview`);
  const alert = r.data.alerts.find((a) => a.code === 'reviews_outdated');
  assert.ok(alert, 'the organiser home lists it among the things that need attention');
  assert.equal(alert.count, 3);
  assert.equal(alert.href, '/judges?tab=progress');

  r = await publish();
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'REVIEWS_OUTDATED');
  assert.equal(r.json.errors.find((e) => e.field === 'count').message, '3');
  assert.equal(r.json.errors.filter((e) => e.field === 'judge').length, 3);
  assert.deepEqual(r.json.errors.filter((e) => e.field === 'project').map((e) => e.id), [ctx.teams.x]);
  r = await publish({ confirmIncomplete: true });
  assert.equal(r.status, 409, 'confirming something else is not confirming this');
  assert.equal((await admin.get(`/api/events/${ctx.ev.id}/results`)).data.published, null, 'nothing was published');
});

test('ask judges to re-check: the affected judges get a notification and an e-mail, once', async () => {
  const before = (await mailsTo(ctx.j1.email)).length;
  let r = await admin.post(`/api/events/${ctx.ev.id}/results/recheck`, { judgeIds: [ctx.j1.id, ctx.j2.id] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.judges, 2, 'only the judges asked for');
  assert.equal(r.data.notified, 2);
  assert.equal(r.data.skipped, 0);

  for (const j of [ctx.j1, ctx.j2]) {
    // eslint-disable-next-line no-await-in-loop
    const n = await j.s.get('/api/me/notifications');
    assert.equal(n.status, 200, n.text);
    const row = n.data.items.find((x) => x.kind === 'judging.recheck' && x.eventId === ctx.ev.id);
    assert.ok(row, 'in the judge\'s bell');
    assert.equal(row.target, 'home');
    assert.equal(row.data.count, 1);
    assert.deepEqual(row.data.projects, [`Project X v2 ${RUN_ID}`]);
    assert.equal(n.data.roles[ctx.ev.id], 'judge', 'it opens the judge\'s screen');
  }
  const j3 = await ctx.j3.s.get('/api/me/notifications');
  assert.ok(!j3.data.items.some((x) => x.kind === 'judging.recheck'), 'a judge not asked gets nothing');
  const lead = await ctx.leads.y.s.get('/api/me/notifications');
  assert.ok(!lead.data.items.some((x) => x.kind === 'judging.recheck'));

  // The e-mail, in the event's language, when the test mail server runs.
  if (r.data.emailed > 0) {
    assert.equal(r.data.emailed, 2);
    let mail = null;
    for (let i = 0; i < 40 && !mail; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const all = await mailsTo(ctx.j1.email);
      if (all.length > before) mail = all.find((m) => /Project X v2/.test(m.text));
      // eslint-disable-next-line no-await-in-loop
      if (!mail) await new Promise((done) => { setTimeout(done, 100); });
    }
    assert.ok(mail, 'the e-mail reached the judge');
    assert.match(mail.text, /\/judge/);
    assert.match(mail.text, /Salam, Judge ro-judge-1/, 'in Azerbaijani, the event\'s language');
  }

  // Pressed again at once: nobody is asked twice.
  r = await admin.post(`/api/events/${ctx.ev.id}/results/recheck`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.judges, 3);
  assert.equal(r.data.skipped, 2, 'the two judges just asked are skipped');
  assert.equal(r.data.notified, 1, 'the third is asked now');

  const audit = await dbQuery("SELECT meta FROM audit_log WHERE event_id = $1 AND action = 'results.recheck_requested' ORDER BY id", [ctx.ev.id]);
  assert.equal(audit.rows.length, 2);
  assert.equal(audit.rows[0].meta.judges, 2);
});

test('a judge who looks again and saves is no longer outdated', async () => {
  // Judging stays open after submissions close; the judge saves the same score.
  const r = await review(ctx.j1, ctx.subs.x, 8);
  assert.equal(r.status, 200, r.text);
  const o = await admin.get(`/api/events/${ctx.ev.id}/results/outdated`);
  assert.equal(o.data.count, 2);
  assert.ok(!o.data.judges.some((j) => j.judgeId === ctx.j1.id));
});

test('published with confirmOutdated: kept with the publication and in the audit log', async () => {
  let r = await publish({ confirmOutdated: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.outdated.count, 2);
  assert.deepEqual(r.data.outdated.teams, [ctx.teams.x]);
  assert.equal(r.data.published.outdatedConfirmed.count, 2);

  r = await admin.get(`/api/events/${ctx.ev.id}/results`);
  assert.equal(r.data.published.outdatedConfirmed.count, 2, 'the publication says it was confirmed');
  const stored = (await dbQuery('SELECT results_outdated_confirmation AS c FROM events WHERE id = $1', [ctx.ev.id])).rows[0].c;
  assert.equal(stored.count, 2);
  assert.deepEqual(stored.judges.sort(), [ctx.j2.id, ctx.j3.id].sort());
  assert.ok(stored.confirmedAt);
  assert.equal(stored.confirmedBy, (await admin.get('/api/auth/me')).data.id);

  const audit = (await dbQuery("SELECT meta FROM audit_log WHERE event_id = $1 AND action = 'results.published' ORDER BY id DESC LIMIT 1", [ctx.ev.id])).rows[0];
  assert.equal(audit.meta.confirmOutdated, true);
  assert.equal(audit.meta.outdatedReviews, 2);

  r = await admin.get(`/api/events/${ctx.ev.id}/overview`);
  assert.ok(!r.data.alerts.some((a) => a.code === 'reviews_outdated'), 'published: nothing to act on any more');
  r = await admin.post(`/api/events/${ctx.ev.id}/results/recheck`, {});
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'RESULTS_PUBLISHED');

  // Unpublishing clears the confirmation with the rest of the publication.
  r = await admin.post(`/api/events/${ctx.ev.id}/results/unpublish`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal((await dbQuery('SELECT results_outdated_confirmation FROM events WHERE id = $1', [ctx.ev.id])).rows[0].results_outdated_confirmation, null);
});

test('another organisation\'s organiser reaches none of it', async () => {
  const other = await approvedBuyer(`ro-other-${RUN_ID}`.slice(0, 30));
  for (const [m, path] of [['get', 'outdated'], ['post', 'recheck'], ['post', 'publish']]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await other.session[m](`/api/events/${ctx.ev.id}/results/${path}`, m === 'post' ? { confirmOutdated: true } : undefined);
    assert.equal(r.status, 404, `${path}: ${r.text}`);
  }
  const judge = await ctx.j2.s.post(`/api/events/${ctx.ev.id}/results/recheck`, {});
  assert.equal(judge.status, 403, 'a judge cannot send it either');
});
