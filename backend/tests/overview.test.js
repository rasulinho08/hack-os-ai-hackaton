/**
 * The organiser's event home, end to end against a running API: where the
 * event is, the counts, what needs attention and the latest activity — and
 * that nobody but the event's own organisers can read it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, approvedBuyer } = require('./fixtures');

const admin = new Session('ov-admin');
const ctx = {};

async function makeEvent(tag, extra = {}) {
  const r = await admin.post('/api/events', {
    event_code: `OV${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    name: `Overview ${tag} ${RUN_ID}`,
    registration_start: iso(-1 * DAY),
    registration_end: iso(3 * DAY),
    start_date: iso(4 * DAY),
    end_date: iso(5 * DAY),
    team_size_limit: 3,
    min_team_size: 1,
    is_published: true,
    ...extra,
  });
  assert.equal(r.status, 201, r.text);
  return r.data;
}

async function register(ev, tag) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ev.slug}/register`, {
    account: { fullName: `Person ${tag}`, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' },
    answers: {},
    accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  const u = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(tag)])).rows[0];
  const p = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ev.id, u.id])).rows[0];
  return { s, userId: u.id, pid: p.id, name: `Person ${tag}` };
}

const overview = async (s = admin, id = ctx.ev.id) => s.get(`/api/events/${id}/overview`);
const alert = (data, code) => data.alerts.find((a) => a.code === code);

test('setup: an event in registration with three people', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  ctx.ev = await makeEvent('a');
  const b = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { max_participants: 3 });
  assert.equal(b.status, 200, b.text);
  ctx.p1 = await register(ctx.ev, 'ov-p1');
  ctx.p2 = await register(ctx.ev, 'ov-p2');
  ctx.p3 = await register(ctx.ev, 'ov-p3');
  let r = await admin.patch(`/api/events/${ctx.ev.id}/participants/${ctx.p1.pid}`, { status: 'approved' });
  assert.equal(r.status, 200, r.text);
  r = await admin.patch(`/api/events/${ctx.ev.id}/participants/${ctx.p3.pid}`, { status: 'rejected' });
  assert.equal(r.status, 200, r.text);
  // p2 has been waiting for a decision for two days.
  await dbQuery("UPDATE participants SET registered_at = now() - interval '2 days' WHERE id = $1", [ctx.p2.pid]);
});

test('the home says where the event is, what comes next and the counts', async () => {
  const r = await overview();
  assert.equal(r.status, 200, r.text);
  const d = r.data;
  assert.equal(d.event.id, ctx.ev.id);
  assert.equal(d.phase.key, 'registration');
  assert.equal(d.next.key, 'registration_closes');
  assert.deepEqual(d.milestones.map((m) => m.key), ['registration_opens', 'registration_closes', 'start', 'end']);
  assert.deepEqual(d.milestones.map((m) => m.state), ['done', 'next', 'upcoming', 'upcoming']);

  const p = d.kpis.participants;
  assert.equal(p.total, 3);
  assert.deepEqual(
    { pending: p.byStatus.pending, approved: p.byStatus.approved, rejected: p.byStatus.rejected },
    { pending: 1, approved: 1, rejected: 1 },
  );
  assert.equal(p.new24h, 2, 'two registered in the last day; p2 two days ago');
  assert.equal(p.pendingOld, 1);
  assert.equal(p.capacity.limit, 3);
  assert.equal(p.capacity.taken, 2, 'pending and approved hold a seat');
  assert.equal(d.kpis.teams.teamlessApproved, 1);
  assert.equal(d.kpis.help.open, 0);
  assert.equal(d.kpis.help.medianWaitMin, null);
  assert.deepEqual(d.kpis.mentors, { total: 0, online: 0 });

  const a = alert(d, 'pending_old');
  assert.ok(a, JSON.stringify(d.alerts));
  assert.equal(a.count, 1);
  assert.equal(a.severity, 'warn');
  assert.equal(a.href, '/participants?status=pending');
  assert.equal(alert(d, 'help_waiting'), undefined, 'nothing waits yet');
});

test('the feed lists registrations and what the organiser decided, by name', async () => {
  const d = (await overview()).data;
  const types = d.activity.map((x) => x.type);
  assert.equal(types.filter((t) => t === 'registered').length, 3);
  const approved = d.activity.find((x) => x.type === 'status_changed' && x.meta.to === 'approved');
  assert.ok(approved, JSON.stringify(d.activity));
  assert.equal(approved.subject, ctx.p1.name, 'the person the decision was about');
  assert.ok(approved.actor, 'and who made it');
  assert.equal(approved.meta.from, 'pending');
  for (let i = 1; i < d.activity.length; i += 1) {
    assert.ok(d.activity[i - 1].at >= d.activity[i].at, 'newest first');
  }
  const ids = new Set(d.activity.map((x) => x.id));
  assert.equal(ids.size, d.activity.length, 'every item has its own id');

  // The audit log keeps ids, not names.
  const meta = (await dbQuery(
    "SELECT meta FROM audit_log WHERE event_id = $1 AND action = 'participant.status' ORDER BY id DESC LIMIT 1",
    [ctx.ev.id],
  )).rows[0].meta;
  assert.equal(meta.name, undefined);
});

test('help waiting too long with nobody online, overdue tasks and failed deliveries raise alerts', async () => {
  const { ev, p1 } = ctx;
  await dbQuery(
    `INSERT INTO help_tickets (event_id, requester_id, topic, description, status, created_at, escalated_to_admin)
     VALUES ($1, $2, 'Docker build', 'It fails', 'open', now() - interval '20 minutes', false),
            ($1, $2, 'Wi-Fi', 'No network', 'open', now() - interval '2 minutes', true),
            ($1, $2, 'CORS', 'Fixed', 'resolved', now() - interval '1 hour', false)`,
    [ev.id, p1.userId],
  );
  await dbQuery(
    `UPDATE help_tickets SET claimed_at = created_at + interval '6 minutes', resolved_at = now() - interval '10 minutes',
            closed_reason = 'resolved'
      WHERE event_id = $1 AND topic = 'CORS'`,
    [ev.id],
  );
  await dbQuery(
    `INSERT INTO volunteer_tasks (event_id, title, status, due_at) VALUES ($1, 'Badges', 'todo', now() - interval '1 hour'),
            ($1, 'Lunch', 'todo', now() + interval '3 hours')`,
    [ev.id],
  );
  const ann = (await dbQuery(
    `INSERT INTO announcements (event_id, title, content, status, sent_at) VALUES ($1, 'Welcome', 'Hello', 'sent', now())
     RETURNING id`,
    [ev.id],
  )).rows[0];
  await dbQuery(
    `INSERT INTO announcement_deliveries (announcement_id, channel, user_id, status, last_error)
     VALUES ($1, 'email', $2, 'failed', 'mailbox full')`,
    [ann.id, p1.userId],
  );

  const d = (await overview()).data;
  assert.deepEqual(
    { open: d.kpis.help.open, flagged: d.kpis.help.flagged, waitingLong: d.kpis.help.waitingLong, resolved24h: d.kpis.help.resolved24h },
    { open: 2, flagged: 1, waitingLong: 1, resolved24h: 1 },
  );
  assert.equal(d.kpis.help.medianWaitMin, 6);
  assert.ok(d.kpis.help.oldestOpenAt);
  assert.deepEqual({ open: d.kpis.volunteers.tasksOpen, overdue: d.kpis.volunteers.tasksOverdue }, { open: 2, overdue: 1 });
  assert.equal(d.kpis.announcements.sent, 1);
  assert.equal(d.kpis.announcements.failed24h, 1);

  const codes = d.alerts.map((a) => a.code);
  for (const c of ['help_flagged', 'help_waiting', 'no_mentor_online', 'tasks_overdue', 'delivery_failures', 'pending_old']) {
    assert.ok(codes.includes(c), `${c} in ${codes}`);
  }
  assert.equal(alert(d, 'no_mentor_online').count, 2);
  // The most urgent first.
  const sev = d.alerts.map((a) => a.severity);
  assert.deepEqual(sev, [...sev].sort((a, b) => ['danger', 'warn', 'info'].indexOf(a) - ['danger', 'warn', 'info'].indexOf(b)));

  const types = new Set(d.activity.map((x) => x.type));
  for (const t of ['help_asked', 'help_resolved', 'announced']) assert.ok(types.has(t), `${t} in the feed`);
});

test('a mentor online clears "nobody online"', async () => {
  const { ev } = ctx;
  const tag = 'ov-mentor';
  let r = await admin.post(`/api/events/${ev.id}/invites`, { email: email(tag), role: 'mentor' });
  assert.ok([200, 201].includes(r.status), r.text);
  const m = new Session(tag);
  await m.register({ fullName: 'Mentor Ov', email: email(tag), eventCode: ev.event_code });
  r = await m.post(`/api/events/${ev.id}/mentors/me/heartbeat`, {});
  assert.equal(r.status, 200, r.text);
  const d = (await overview()).data;
  assert.deepEqual(d.kpis.mentors, { total: 1, online: 1 });
  assert.equal(alert(d, 'no_mentor_online'), undefined);
  const joined = d.activity.find((x) => x.type === 'staff_joined');
  assert.ok(joined, JSON.stringify(d.activity.map((x) => x.type)));
  assert.deepEqual({ who: joined.subject, role: joined.meta.role }, { who: 'Mentor Ov', role: 'mentor' });
});

test('while hacking: teams without a project near the deadline', async () => {
  const { ev, p1 } = ctx;
  let r = await admin.post('/api/teams', { eventId: ev.id, name: `Ov Team ${RUN_ID}`, memberIds: [p1.userId], leaderId: p1.userId });
  assert.equal(r.status, 201, r.text);
  ctx.teamId = r.data.id;
  r = await admin.post(`/api/teams/${ctx.teamId}/members`, { userId: ctx.p2.userId });
  assert.equal(r.status, 201, r.text);
  await dbQuery(
    `UPDATE events SET registration_end = now() - interval '2 hours', start_date = now() - interval '1 hour',
            submission_deadline = now() + interval '2 hours', end_date = now() + interval '2 hours'
      WHERE id = $1`,
    [ev.id],
  );
  const d = (await overview()).data;
  assert.equal(d.phase.key, 'hacking');
  assert.equal(d.next.key, 'submission_deadline');
  assert.equal(d.kpis.teams.active, 1);
  assert.equal(d.kpis.teams.withoutSubmission, 1);
  const a = alert(d, 'teams_without_submission');
  assert.ok(a, JSON.stringify(d.alerts));
  assert.equal(a.count, 1);
  assert.equal(a.href, '/submissions');
  assert.ok(d.activity.some((x) => x.type === 'team_created' && x.subject === `Ov Team ${RUN_ID}`));
  const added = d.activity.find((x) => x.type === 'member_added');
  assert.ok(added, JSON.stringify(d.activity.map((x) => x.type)));
  assert.deepEqual({ team: added.subject, who: added.meta.member }, { team: `Ov Team ${RUN_ID}`, who: ctx.p2.name });
});

test('after the deadline it is judging, then results; old pending people stop nagging', async () => {
  const { ev } = ctx;
  await dbQuery(
    `UPDATE events SET submission_deadline = now() - interval '1 hour', end_date = now() - interval '1 hour',
            judging_start = now() - interval '30 minutes', judging_end = now() + interval '3 hours'
      WHERE id = $1`,
    [ev.id],
  );
  let d = (await overview()).data;
  assert.equal(d.phase.key, 'judging');
  assert.equal(alert(d, 'teams_without_submission'), undefined);
  await dbQuery("UPDATE events SET judging_end = now() - interval '5 minutes', results_at = now() - interval '1 minute' WHERE id = $1", [ev.id]);
  d = (await overview()).data;
  assert.equal(d.phase.key, 'judging', 'the results date passed, but nothing is published: not "results out"');
  if (d.kpis.submissions.total > 0) {
    const late = alert(d, 'results_not_published');
    assert.ok(late, JSON.stringify(d.alerts));
    assert.equal(late.severity, 'danger');
    assert.equal(late.href, '/results');
  }
  assert.equal(alert(d, 'pending_old'), undefined, 'registration questions are over once projects are in');
  await dbQuery('UPDATE events SET results_published_at = now() WHERE id = $1', [ev.id]);
  try {
    d = (await overview()).data;
    assert.equal(d.phase.key, 'results');
    assert.equal(alert(d, 'results_not_published'), undefined);
  } finally {
    await dbQuery('UPDATE events SET results_published_at = NULL WHERE id = $1', [ev.id]);
  }
});

test('a draft says it is not published yet', async () => {
  const draft = await makeEvent('draft', { is_published: false });
  await dbQuery("UPDATE events SET status = 'draft', is_published = false WHERE id = $1", [draft.id]);
  const r = await overview(admin, draft.id);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.phase.key, 'draft');
  const a = alert(r.data, 'not_published');
  assert.ok(a);
  assert.equal(a.href, `/create-event/${draft.id}`);
});

test('only the event\'s own organisers read it', async () => {
  const { ev, p1 } = ctx;
  let r = await p1.s.get(`/api/events/${ev.id}/overview`);
  assert.equal(r.status, 403, 'a participant is not an organiser');
  r = await new Session('ov-anon').get(`/api/events/${ev.id}/overview`);
  assert.equal(r.status, 401);
  const other = await approvedBuyer('ov-other');
  r = await other.session.get(`/api/events/${ev.id}/overview`);
  assert.equal(r.status, 404, 'another organisation does not learn the event exists');
  r = await admin.get('/api/events/999999999/overview');
  assert.equal(r.status, 404);
});

test('the participant\'s next step points at the team finder', async () => {
  const ev = await makeEvent('progress');
  const p = await register(ev, 'ov-prog');
  await admin.patch(`/api/events/${ev.id}/participants/${p.pid}`, { status: 'approved' });
  const r = await p.s.get(`/api/me/event-progress?eventId=${ev.id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.next.code, 'find_team');
  assert.equal(r.data.next.href, '/hacker/lobby');
});
