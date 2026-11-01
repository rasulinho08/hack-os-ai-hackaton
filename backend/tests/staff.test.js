/**
 * Mentors and volunteers while an event runs, end to end against a running
 * API (with or without the fake Telegram / mail servers).
 *
 * Covers: a mentor's own profile, presence and the online dot (and the
 * organiser's switch that hides it from participants); hours (slots) with
 * their checks; partial edits by the organiser; help requests addressed to
 * one mentor, the race to claim, resolve / withdraw and why a request was
 * closed, requests of ended events closed by the job; volunteer tasks
 * (create, assign, take, hand back, done) and who may do which.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, approvedBuyer } = require('./fixtures');
const ticketService = require('../src/services/ticket.service');

const admin = new Session('st-admin');
const ctx = {};
const HOUR = 3600e3;

async function staffViaInvite(ev, tag, role) {
  let r = await admin.post(`/api/events/${ev.id}/invites`, { email: email(tag), role });
  assert.ok([200, 201].includes(r.status), r.text);
  const s = new Session(tag);
  await s.register({ fullName: `Staff ${tag}`, email: email(tag), eventCode: ev.event_code });
  return { s, userId: await userIdOf(email(tag)) };
}

async function userIdOf(mail) {
  return (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [mail])).rows[0].id;
}

test('setup: an event with two mentors, a volunteer and two participants', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  const r = await admin.post('/api/events', {
    event_code: `ST${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    name: `Staff ${RUN_ID}`,
    registration_start: iso(-1 * DAY),
    registration_end: iso(3 * DAY),
    start_date: iso(4 * DAY),
    end_date: iso(5 * DAY),
    team_size_limit: 4,
    is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  ctx.m1 = await staffViaInvite(ctx.ev, 'st-mentor1', 'mentor');
  ctx.m2 = await staffViaInvite(ctx.ev, 'st-mentor2', 'mentor');
  ctx.vol = await staffViaInvite(ctx.ev, 'st-vol', 'volunteer');
  ctx.p1 = new Session('st-p1');
  await ctx.p1.register({ fullName: 'Participant One', email: email('st-p1'), eventCode: ctx.ev.event_code });
  ctx.p1.userId = await userIdOf(email('st-p1'));
  // Only accepted participants ask the mentors for help.
  await dbQuery("UPDATE participants SET status = 'approved' WHERE event_id = $1 AND user_id = $2", [ctx.ev.id, ctx.p1.userId]);
  ctx.p2 = new Session('st-p2');
  await ctx.p2.register({ fullName: 'Participant Two', email: email('st-p2'), eventCode: ctx.ev.event_code });
  ctx.p2.userId = await userIdOf(email('st-p2'));
  const parts = await dbQuery('SELECT COUNT(*)::int AS n FROM participants WHERE event_id = $1', [ctx.ev.id]);
  assert.equal(parts.rows[0].n, 2);
});

// ── Mentors ─────────────────────────────────────────────────────────────────

test('a mentor edits their own profile and shows up online while their page is open', async () => {
  const { ev, m1 } = ctx;
  let r = await m1.s.patch(`/api/events/${ev.id}/mentors/me`, {
    skills: 'React, Node.js, react', bio: 'Frontend lead', location: 'Table 3', presence: 'available',
  });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.skills, ['React', 'Node.js'], 'skills are a clean list without duplicates');
  assert.equal(r.data.location, 'Table 3');
  r = await m1.s.patch(`/api/events/${ev.id}/mentors/me`, { presence: 'sleeping' });
  assert.equal(r.status, 400);
  r = await m1.s.post(`/api/events/${ev.id}/mentors/me/heartbeat`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.online, true);

  // Participants see the mentor (no e-mail) and the online dot.
  r = await ctx.p1.get(`/api/events/${ev.id}/mentors`);
  assert.equal(r.status, 200, r.text);
  const seen = r.data.find((m) => m.user_id === m1.userId);
  assert.equal(seen.online, true);
  assert.equal(seen.email, undefined, 'participants do not get mentors\' e-mail addresses');
  assert.deepEqual(seen.skills, ['React', 'Node.js']);

  // Away hides the dot even with the page open.
  await m1.s.patch(`/api/events/${ev.id}/mentors/me`, { presence: 'away' });
  r = await ctx.p1.get(`/api/events/${ev.id}/mentors`);
  assert.equal(r.data.find((m) => m.user_id === m1.userId).online, false);
  await m1.s.patch(`/api/events/${ev.id}/mentors/me`, { presence: 'available' });

  // The organiser can turn online status off for participants.
  r = await admin.patch(`/api/events/${ev.id}/builder`, { mentor_config: { showOnlineStatus: false } });
  assert.equal(r.status, 200, r.text);
  r = await ctx.p1.get(`/api/events/${ev.id}/mentors`);
  const hidden = r.data.find((m) => m.user_id === m1.userId);
  assert.equal(hidden.online, null);
  assert.equal(hidden.presence, null);
  r = await admin.get(`/api/events/${ev.id}/mentors`);
  assert.equal(r.data.find((m) => m.user_id === m1.userId).online, true, 'organisers still see it');
  await admin.patch(`/api/events/${ev.id}/builder`, { mentor_config: { showOnlineStatus: true } });

  // Not a mentor here: no "me".
  r = await ctx.p1.get(`/api/events/${ev.id}/mentors/me`);
  assert.equal(r.status, 403);
});

test('an organiser edit changes only the fields sent', async () => {
  const { ev, m2 } = ctx;
  const row = (await dbQuery('SELECT id FROM mentor_assignments WHERE event_id = $1 AND user_id = $2', [ev.id, m2.userId])).rows[0];
  let r = await admin.put(`/api/events/${ev.id}/mentors/${row.id}`, { availability: 'Saturday 10–14' });
  assert.equal(r.status, 200, r.text);
  r = await admin.put(`/api/events/${ev.id}/mentors/${row.id}`, { skills: ['Python', 'ML'] });
  assert.equal(r.status, 200, r.text);
  const after = (await dbQuery('SELECT availability, skills FROM mentor_assignments WHERE id = $1', [row.id])).rows[0];
  assert.equal(after.availability, 'Saturday 10–14', 'sending skills keeps the availability');
  assert.deepEqual(after.skills, ['Python', 'ML']);
});

test('mentor hours: add, the checks, everyone sees them, only the mentor or an organiser removes', async () => {
  const { ev, m1, m2 } = ctx;
  const start = Date.now() + 2 * HOUR;
  let r = await m1.s.post(`/api/events/${ev.id}/mentors/slots`, { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * HOUR).toISOString(), mode: 'onsite', note: 'Main hall' });
  assert.equal(r.status, 201, r.text);
  const slot = r.data;
  r = await m1.s.post(`/api/events/${ev.id}/mentors/slots`, { startsAt: new Date(start + HOUR).toISOString(), endsAt: new Date(start + 3 * HOUR).toISOString() });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'SLOT_OVERLAP');
  r = await m1.s.post(`/api/events/${ev.id}/mentors/slots`, { startsAt: new Date(start + 5 * HOUR).toISOString(), endsAt: new Date(start + 4 * HOUR).toISOString() });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'SLOT_INVALID');
  assert.equal(r.json.errors[0].code, 'BEFORE_START');
  r = await m1.s.post(`/api/events/${ev.id}/mentors/slots`, { startsAt: new Date(start + 5 * HOUR).toISOString(), endsAt: new Date(start + 20 * HOUR).toISOString() });
  assert.equal(r.json.errors[0].code, 'TOO_LONG');

  r = await ctx.p1.get(`/api/events/${ev.id}/mentors/slots`);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.some((x) => x.id === slot.id && x.mentor_name === 'Staff st-mentor1'));
  r = await ctx.p1.get(`/api/events/${ev.id}/mentors`);
  assert.ok(r.data.find((m) => m.user_id === m1.userId).next_slot, 'the mentor list shows the next slot');

  r = await ctx.p1.post(`/api/events/${ev.id}/mentors/slots`, { startsAt: new Date(start).toISOString(), endsAt: new Date(start + HOUR).toISOString() });
  assert.equal(r.status, 403, 'participants cannot add hours');
  r = await m2.s.delete(`/api/events/${ev.id}/mentors/slots/${slot.id}`);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'NOT_SLOT_OWNER');
  // An organiser adds hours for a mentor and removes the first slot.
  r = await admin.post(`/api/events/${ev.id}/mentors/slots`, { userId: m2.userId, startsAt: new Date(start).toISOString(), endsAt: new Date(start + HOUR).toISOString(), mode: 'online' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.user_id, m2.userId);
  r = await admin.delete(`/api/events/${ev.id}/mentors/slots/${slot.id}`);
  assert.equal(r.status, 200, r.text);
});

// ── Help requests ───────────────────────────────────────────────────────────

test('a participant asks for one mentor; that mentor hears about it; anyone can still take it', async () => {
  const { ev, m1, m2, p1 } = ctx;
  let r = await p1.post('/api/tickets', { eventId: ev.id, topic: 'CORS error', description: 'Fetch fails from localhost', preferredMentorId: m2.userId, tableLocation: 'Table 7' });
  assert.equal(r.status, 201, r.text);
  const ticket = r.data;
  assert.equal(ticket.preferred_mentor_id, m2.userId);
  assert.equal(ticket.preferred_mentor_name, 'Staff st-mentor2');
  const job = await dbQuery("SELECT payload FROM jobs WHERE type = 'ticket.notify' AND (payload->>'ticketId')::int = $1", [ticket.id]);
  assert.ok(job.rows.some((j) => j.payload.kind === 'new_for_you'), 'the mentor asked for is notified');

  r = await p1.post('/api/tickets', { eventId: ev.id, topic: 'x', description: 'y', preferredMentorId: p1.userId });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'NOT_EVENT_MENTOR');

  r = await m1.s.get(`/api/tickets?eventId=${ev.id}`);
  const row = r.data.find((x) => x.id === ticket.id);
  assert.equal(row.preferred_mentor, 'Staff st-mentor2', 'the queue shows who was asked for');

  // Two mentors press "take" at once: one wins.
  const [a, b] = await Promise.all([
    m1.s.patch(`/api/tickets/${ticket.id}/claim`, {}),
    m2.s.patch(`/api/tickets/${ticket.id}/claim`, {}),
  ]);
  const codes = [a.status, b.status].sort();
  assert.equal(codes[0], 200, `${a.text} | ${b.text}`);
  assert.ok([400, 409].includes(codes[1]), `the second one is refused: ${codes[1]}`);
  const claimed = (await dbQuery('SELECT mentor_id, claimed_at FROM help_tickets WHERE id = $1', [ticket.id])).rows[0];
  assert.ok(claimed.claimed_at, 'claim time is kept');
  const winner = Number(claimed.mentor_id) === m1.userId ? m1 : m2;
  r = await winner.s.patch(`/api/tickets/${ticket.id}/resolve`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.closed_reason, 'resolved');
  const notices = await dbQuery("SELECT payload->>'kind' AS kind FROM jobs WHERE type = 'ticket.notify' AND (payload->>'ticketId')::int = $1", [ticket.id]);
  const kinds = notices.rows.map((n) => n.kind);
  assert.ok(kinds.includes('claimed') && kinds.includes('resolved'), kinds.join(','));
});

test('a participant withdraws their own request, once; nobody else can', async () => {
  const { ev, p1, p2 } = ctx;
  let r = await p1.post('/api/tickets', { eventId: ev.id, topic: 'Deploy question', description: 'Vercel env vars' });
  assert.equal(r.status, 201, r.text);
  const id = r.data.id;
  r = await p2.post(`/api/tickets/${id}/withdraw`, {});
  assert.equal(r.status, 404);
  r = await p1.post(`/api/tickets/${id}/withdraw`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.closed_reason, 'withdrawn');
  assert.equal(r.data.status, 'resolved');
  r = await p1.post(`/api/tickets/${id}/withdraw`, {});
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'TICKET_CLOSED');
});

test('requests still open after their event ended are closed by the job', async () => {
  const { ev, p1 } = ctx;
  const r = await p1.post('/api/tickets', { eventId: ev.id, topic: 'Left open', description: 'Nobody came' });
  assert.equal(r.status, 201, r.text);
  await dbQuery("UPDATE events SET end_date = now() - interval '3 hours', start_date = now() - interval '2 days' WHERE id = $1", [ev.id]);
  try {
    const closed = await ticketService.closeRequestsOfEndedEvents();
    assert.ok(closed >= 1);
    const row = (await dbQuery('SELECT status, closed_reason FROM help_tickets WHERE id = $1', [r.data.id])).rows[0];
    assert.deepEqual(row, { status: 'resolved', closed_reason: 'event_ended' });
  } finally {
    await dbQuery("UPDATE events SET start_date = now() + interval '4 days', end_date = now() + interval '5 days' WHERE id = $1", [ev.id]);
  }
});

// ── Volunteers ──────────────────────────────────────────────────────────────

test('volunteer tasks: an organiser assigns, the volunteer works through them', async () => {
  const { ev, vol, p1 } = ctx;
  let r = await admin.post(`/api/events/${ev.id}/volunteer-tasks`, { title: 'Registration desk', location: 'Entrance', dueAt: iso(3 * HOUR), assigneeId: vol.userId });
  assert.equal(r.status, 201, r.text);
  const desk = r.data;
  const job = await dbQuery("SELECT 1 FROM jobs WHERE type = 'volunteer.task_assigned' AND (payload->>'taskId')::int = $1", [desk.id]);
  assert.equal(job.rows.length, 1, 'the volunteer hears about the task');
  r = await admin.post(`/api/events/${ev.id}/volunteer-tasks`, { title: 'Pizza pickup' });
  assert.equal(r.status, 201, r.text);
  const pizza = r.data;
  r = await admin.post(`/api/events/${ev.id}/volunteer-tasks`, { title: 'Chairs', assigneeId: p1.userId });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'NOT_EVENT_VOLUNTEER');
  r = await admin.post(`/api/events/${ev.id}/volunteer-tasks`, { title: '' });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'TASK_INVALID');

  // The volunteer's own view: their tasks and the free ones.
  r = await vol.s.get(`/api/events/${ev.id}/volunteers/me`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.tasks.map((t) => t.title).sort(), ['Pizza pickup', 'Registration desk']);

  r = await vol.s.patch(`/api/events/${ev.id}/volunteer-tasks/${desk.id}`, { status: 'doing' });
  assert.equal(r.status, 200, r.text);
  r = await vol.s.patch(`/api/events/${ev.id}/volunteer-tasks/${desk.id}`, { status: 'done' });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.data.done_at, 'done gets a time');
  r = await vol.s.patch(`/api/events/${ev.id}/volunteer-tasks/${desk.id}`, { title: 'Renamed' });
  assert.equal(r.status, 403, 'volunteers do not edit tasks');
  r = await vol.s.patch(`/api/events/${ev.id}/volunteer-tasks/${pizza.id}`, { assigneeId: vol.userId });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.assignee_id, vol.userId, 'a free task can be taken');
  r = await vol.s.patch(`/api/events/${ev.id}/volunteer-tasks/${pizza.id}`, { assigneeId: null });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.assignee_id, null, 'and handed back');
  assert.equal(r.data.status, 'todo');

  // Organiser view: progress per volunteer.
  r = await admin.get(`/api/events/${ev.id}/volunteers`);
  const row = r.data.find((v) => v.user_id === vol.userId);
  assert.equal(row.tasks_done, 1);

  // Participants have no business here.
  r = await p1.get(`/api/events/${ev.id}/volunteer-tasks`);
  assert.equal(r.status, 403);
  ctx.tasks = { desk, pizza };
});

test('removing a volunteer hands their open tasks back; notes can be cleared', async () => {
  const { ev, vol } = ctx;
  const r1 = await admin.post(`/api/events/${ev.id}/volunteer-tasks`, { title: 'Badges', assigneeId: vol.userId });
  assert.equal(r1.status, 201, r1.text);
  const v = (await dbQuery('SELECT id FROM volunteers WHERE event_id = $1 AND user_id = $2', [ev.id, vol.userId])).rows[0];
  let r = await admin.put(`/api/events/${ev.id}/volunteers/${v.id}`, { assignedTasks: 'Bring a jacket' });
  assert.equal(r.status, 200, r.text);
  r = await admin.put(`/api/events/${ev.id}/volunteers/${v.id}`, { assignedTasks: '' });
  assert.equal(r.data.assigned_tasks, null, 'an empty note clears it');
  r = await admin.delete(`/api/events/${ev.id}/volunteers/${v.id}`);
  assert.equal(r.status, 200, r.text);
  const badges = (await dbQuery('SELECT assignee_id, status FROM volunteer_tasks WHERE id = $1', [r1.data.id])).rows[0];
  assert.deepEqual(badges, { assignee_id: null, status: 'todo' });
  const desk = (await dbQuery('SELECT assignee_id FROM volunteer_tasks WHERE id = $1', [ctx.tasks.desk.id])).rows[0];
  assert.equal(desk.assignee_id, vol.userId, 'done tasks keep who did them');
});

test('another organisation cannot see or touch this event\'s mentors and tasks', async () => {
  const { ev } = ctx;
  const other = await approvedBuyer('st-other');
  let r = await other.session.get(`/api/events/${ev.id}/mentors`);
  assert.equal(r.status, 404);
  r = await other.session.get(`/api/events/${ev.id}/volunteer-tasks`);
  assert.equal(r.status, 404);
  r = await other.session.post(`/api/events/${ev.id}/volunteer-tasks`, { title: 'Sneaky' });
  assert.equal(r.status, 404);
});
