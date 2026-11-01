/**
 * The notification centre and the calendar feeds (Phase 6).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, confirmEmail } = require('./helpers');
const { dbQuery, approvedBuyer, closeSubmissions } = require('./fixtures');

const admin = new Session('nt-admin');
const ctx = { p: {} };
const HOUR = 3600e3;

const bell = async (s) => (await s.get('/api/me/notifications')).data;
/** Waits for a notification (the jobs worker runs every few seconds in tests). */
async function waitFor(s, pred, ms = 15000) {
  const until = Date.now() + ms;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const data = await bell(s);
    const hit = data.items.find(pred);
    if (hit) return { hit, data };
    if (Date.now() > until) return { hit: null, data };
    // eslint-disable-next-line no-await-in-loop
    await new Promise((done) => { setTimeout(done, 300); });
  }
}

async function participant(tag, name, { approve = true } = {}) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ctx.ev.slug}/register`, {
    account: { fullName: name, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  await confirmEmail(email(tag));
  const userId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(tag)])).rows[0].id;
  const pid = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, userId])).rows[0].id;
  if (approve) assert.equal((await admin.patch(`/api/events/${ctx.ev.id}/participants/${pid}`, { status: 'approved' })).status, 200);
  await s.login(email(tag));
  return { s, userId, pid };
}

test('setup: an event with an online room, participants, a mentor and a judge', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  let r = await admin.post('/api/events', {
    event_code: `NT${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Notify ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(2 * DAY), end_date: iso(3 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, {
    format: 'hybrid', venue_name: 'ADA University', city: 'Bakı', online_url: 'https://meet.example/secret-room',
    team_deadline: iso(1.5 * DAY), submission_deadline: iso(3 * DAY - 3 * HOUR), judging_start: iso(3 * DAY - 2 * HOUR), judging_end: iso(3 * DAY - HOUR), results_at: iso(3 * DAY),
  });
  assert.equal(r.status, 200, r.text);
  ctx.p.lead = await participant('nt-lead', 'Leyla');
  ctx.p.joiner = await participant('nt-join', 'Cavid');
  ctx.p.pending = await participant('nt-pend', 'Pərvin', { approve: false });
  r = await ctx.p.lead.s.post('/api/teams', { eventId: ctx.ev.id, name: `Team N ${RUN_ID}` });
  assert.equal(r.status, 201, r.text);
  ctx.team = r.data;
  await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email('nt-mentor'), role: 'mentor' });
  ctx.mentor = new Session('nt-mentor');
  await ctx.mentor.register({ fullName: 'Mentor Mehdi', email: email('nt-mentor'), eventCode: ctx.ev.event_code });
  await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email('nt-judge'), role: 'judge' });
  ctx.judge = new Session('nt-judge');
  await ctx.judge.register({ fullName: 'Judge Jalə', email: email('nt-judge'), eventCode: ctx.ev.event_code });
});

test('status changes, join requests and their answers ring the bell', async () => {
  let { hit } = await waitFor(ctx.p.lead.s, (n) => n.kind === 'participant.approved' && n.eventId === ctx.ev.id);
  assert.ok(hit, 'approved');
  assert.equal(hit.target, 'home');
  let r = await ctx.p.joiner.s.post(`/api/teams/${ctx.team.id}/requests`, { message: 'Can I join?' });
  assert.ok([200, 201].includes(r.status), r.text);
  ({ hit } = await waitFor(ctx.p.lead.s, (n) => n.kind === 'team.request_new'));
  assert.ok(hit, 'the lead hears about the request');
  assert.equal(hit.data.name, 'Cavid');
  assert.equal(hit.target, 'team');
  const requestId = hit.data.requestId;
  r = await ctx.p.lead.s.post(`/api/teams/requests/${requestId}/accept`, {});
  assert.equal(r.status, 200, r.text);
  ({ hit } = await waitFor(ctx.p.joiner.s, (n) => n.kind === 'team.request_accepted'));
  assert.ok(hit, 'the person hears the answer');
  assert.equal(hit.data.team, ctx.team.name);
});

test('an announcement reaches its audience, not its author', async () => {
  const r = await admin.post('/api/announcements', {
    eventId: ctx.ev.id, title: 'Wi-Fi password', content: 'It is   hackos2026\nat the desk', audience: 'participants', channels: [],
  });
  assert.ok([200, 201].includes(r.status), r.text);
  const { hit } = await waitFor(ctx.p.joiner.s, (n) => n.kind === 'announcement' && n.title === 'Wi-Fi password');
  assert.ok(hit, 'a participant gets it');
  assert.equal(hit.body, 'It is hackos2026 at the desk', 'one line, for the bell');
  assert.equal(hit.target, 'announcements');
  await new Promise((done) => { setTimeout(done, 1500); });
  assert.ok(!(await bell(ctx.mentor)).items.some((n) => n.kind === 'announcement' && n.title === 'Wi-Fi password'), 'not the mentors: not their audience');
  assert.ok(!(await bell(admin)).items.some((n) => n.kind === 'announcement' && n.title === 'Wi-Fi password'), 'not the author');
  const dupes = await dbQuery("SELECT COUNT(*)::int AS n FROM notifications WHERE kind = 'announcement' AND dedupe_key = $1", [`ann:${r.data.id}`]);
  assert.equal(dupes.rows[0].n, 2, 'one each for the two accepted participants');
});

test('a help request taken by a mentor tells the team', async () => {
  let r = await ctx.p.lead.s.post('/api/tickets', { eventId: ctx.ev.id, topic: 'Auth bug', description: 'JWT fails' });
  assert.equal(r.status, 201, r.text);
  ctx.ticketId = r.data.id;
  r = await ctx.mentor.patch(`/api/tickets/${ctx.ticketId}/claim`, { eventId: ctx.ev.id });
  assert.equal(r.status, 200, r.text);
  const { hit } = await waitFor(ctx.p.joiner.s, (n) => n.kind === 'ticket.claimed' && n.data.ticketId === ctx.ticketId);
  assert.ok(hit, 'a teammate hears it too');
  assert.equal(hit.data.mentorName, 'Mentor Mehdi');
  assert.equal(hit.target, 'help');
});

test('messages in a support thread ring once per thread, counted', async () => {
  const chat = `/api/events/${ctx.ev.id}/chat`;
  const thread = (await ctx.p.pending.s.get(chat)).data.channels.find((c) => c.kind === 'support');
  await ctx.p.pending.s.post(`${chat}/channels/${thread.id}/messages`, { body: 'Hello?' });
  await ctx.p.pending.s.post(`${chat}/channels/${thread.id}/messages`, { body: 'Anyone there?' });
  let mine = (await bell(admin)).items.filter((n) => n.kind === 'chat.support' && n.data.channelId === thread.id);
  assert.equal(mine.length, 1, 'one row for the thread');
  assert.equal(mine[0].count, 2);
  assert.equal(mine[0].body, 'Anyone there?', 'the newest message');
  assert.equal(mine[0].data.personName, 'Pərvin');
  let r = await admin.post('/api/me/notifications/read', { ids: [mine[0].id] });
  assert.equal(r.data.marked, 1);
  await ctx.p.pending.s.post(`${chat}/channels/${thread.id}/messages`, { body: 'Third' });
  mine = (await bell(admin)).items.filter((n) => n.kind === 'chat.support' && n.data.channelId === thread.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].read, false, 'unread again');
  assert.equal(mine[0].count, 1, 'counting starts again after reading');

  r = await admin.post(`${chat}/channels/${thread.id}/messages`, { body: 'You will hear from us today.' });
  assert.equal(r.status, 201);
  const reply = (await bell(ctx.p.pending.s)).items.find((n) => n.kind === 'chat.support');
  assert.ok(reply, 'the organisers\' answer rings for the person');
  assert.equal(reply.target, 'chat');
  assert.ok(!(await bell(ctx.p.pending.s)).items.some((n) => n.kind === 'chat.support' && n.body === 'Third'), 'not their own words');
});

test('the list says the reader\'s role in each event; reading all clears the badge', async () => {
  let data = await bell(ctx.p.joiner.s);
  assert.equal(data.roles[ctx.ev.id], 'participant');
  assert.equal((await bell(admin)).roles[ctx.ev.id], 'organizer');
  assert.ok(data.unread > 0);
  let r = await ctx.p.joiner.s.get('/api/me/notifications/unread');
  assert.equal(r.data.unread, data.unread);
  r = await ctx.p.joiner.s.post('/api/me/notifications/read', { all: true });
  assert.equal(r.status, 200);
  data = await bell(ctx.p.joiner.s);
  assert.equal(data.unread, 0);
  assert.ok(data.items.every((n) => n.read));
  // Someone else's ids are not theirs to mark.
  const theirs = (await bell(ctx.p.lead.s)).items.find((n) => !n.read);
  r = await ctx.p.joiner.s.post('/api/me/notifications/read', { ids: [theirs.id] });
  assert.equal(r.data.marked, 0);
  assert.equal((await new Session('anon').get('/api/me/notifications')).status, 401);
});

test('results and certificates ring for the participants', async () => {
  let r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, { items: [{ cid: 'a', name: 'A', maxScore: 10, weight: 1 }] });
  assert.equal(r.status, 200, r.text);
  const crit = r.data.idsByCid.a;
  await admin.put(`/api/events/${ctx.ev.id}`, { start_date: iso(-2 * HOUR), end_date: iso(DAY) });
  r = await ctx.p.lead.s.post('/api/submissions', { eventId: ctx.ev.id, projectName: 'Notifier', description: 'x', repoLink: `https://github.com/nt/${RUN_ID}` });
  assert.equal(r.status, 201, r.text);
  const submissionId = r.data.id;
  // Over: projects are in, judging opens after them (never before submissions close).
  await closeSubmissions(ctx.ev.id);
  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { judging_start: iso(-30e3), judging_end: iso(DAY), results_at: iso(DAY) });
  assert.equal(r.status, 200, r.text);
  r = await ctx.judge.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, { submissionId, scores: [{ criterionId: crit, score: 9 }] });
  assert.equal(r.status, 200, r.text);
  // The certificate names its signer: certificates follow the results.
  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { certificate_config: { signerName: 'Nərmin Əliyeva' } });
  assert.equal(r.status, 200, r.text);
  r = await admin.post(`/api/events/${ctx.ev.id}/results/publish`, {});
  assert.equal(r.status, 200, r.text);
  let { hit } = await waitFor(ctx.p.joiner.s, (n) => n.kind === 'results.published' && n.eventId === ctx.ev.id);
  assert.ok(hit, 'results');
  assert.equal(hit.target, 'results');
  ({ hit } = await waitFor(ctx.p.lead.s, (n) => n.kind === 'certificate.issued' && n.eventId === ctx.ev.id, 20000));
  assert.ok(hit, 'certificates follow the results');
  assert.equal(hit.target, 'certificates');
  // Publishing again (a correction) does not ring again.
  await admin.post(`/api/events/${ctx.ev.id}/results/publish`, {});
  const n = await dbQuery("SELECT COUNT(*)::int AS n FROM notifications WHERE kind = 'results.published' AND event_id = $1 AND user_id = $2", [ctx.ev.id, ctx.p.joiner.userId]);
  assert.equal(n.rows[0].n, 1);
});

// ── Calendar ────────────────────────────────────────────────────────────────

test('the public calendar has the event\'s public dates, never the room', async () => {
  const r = await new Session('anon').download(`/api/public/events/${ctx.ev.slug}/calendar.ics`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/calendar/);
  const ics = r.body.toString('utf8');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.includes(`SUMMARY:Notify ${RUN_ID}`));
  assert.ok(/SUMMARY:Registration closes|SUMMARY:Qeydiyyat bağlanır/.test(ics));
  assert.ok(!ics.includes('secret-room'), 'the online room is for the event\'s own people');
  assert.ok(!/SUMMARY:(Judging|Qiymətləndirmə)/.test(ics), 'not the judging window');
  assert.equal((await new Session('anon').download('/api/public/events/no-such-event-xyz/calendar.ics')).status, 404);
});

test('a personal feed: own events, own dates, the room only when let in', async () => {
  let r = await ctx.p.joiner.s.get('/api/me/calendar');
  assert.equal(r.status, 200, r.text);
  assert.match(r.data.url, /\/api\/calendar\/\d+\.\d+\.[A-Za-z0-9_-]{32}\.ics$/);
  assert.ok(r.data.webcal.startsWith('webcal:'));
  const path = new URL(r.data.url).pathname;
  let feed = await new Session('calendar-app').download(path);
  assert.equal(feed.status, 200);
  let ics = feed.body.toString('utf8');
  assert.ok(ics.includes(`SUMMARY:Notify ${RUN_ID}`));
  assert.ok(ics.includes('secret-room'), 'an accepted participant sees the room link');
  assert.ok(!/Registration closes|Qeydiyyat bağlanır/.test(ics), 'no registration reminder: they are in');

  const judgePath = new URL((await ctx.judge.get('/api/me/calendar')).data.url).pathname;
  ics = (await new Session('calendar-app').download(judgePath)).body.toString('utf8');
  assert.ok(/SUMMARY:(Judging|Qiymətləndirmə)/.test(ics), 'the judging window for a judge');

  const pendingPath = new URL((await ctx.p.pending.s.get('/api/me/calendar')).data.url).pathname;
  ics = (await new Session('calendar-app').download(pendingPath)).body.toString('utf8');
  assert.ok(ics.includes(`SUMMARY:Notify ${RUN_ID}`));
  assert.ok(!ics.includes('secret-room'), 'not yet accepted: no room link');

  // A changed signature is refused; a reset retires the old link.
  feed = await new Session('calendar-app').download(path.replace(/.(\.ics)$/, (m, ext) => `${m[0] === 'A' ? 'B' : 'A'}${ext}`));
  assert.equal(feed.status, 404);
  r = await ctx.p.joiner.s.post('/api/me/calendar/reset', {});
  assert.equal(r.status, 200);
  assert.equal((await new Session('calendar-app').download(path)).status, 404, 'the old link is dead');
  assert.equal((await new Session('calendar-app').download(new URL(r.data.url).pathname)).status, 200);
});

test('calendars follow the plan: Starter has none', async () => {
  const { session: buyer } = await approvedBuyer('nt-starter');
  const r = await buyer.post('/api/events', {
    event_code: `NS${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Starter cal ${RUN_ID}`,
    registration_start: iso(-DAY), registration_end: iso(DAY), start_date: iso(2 * DAY), end_date: iso(3 * DAY),
  });
  assert.equal(r.status, 201, r.text);
  await dbQuery('UPDATE events SET is_published = true WHERE id = $1', [r.data.id]);
  const slug = (await dbQuery('SELECT slug, event_code FROM events WHERE id = $1', [r.data.id])).rows[0];
  const feed = await new Session('anon').download(`/api/public/events/${slug.slug || slug.event_code}/calendar.ics`);
  assert.equal(feed.status, 404);
  const page = await new Session('anon').get(`/api/public/events/${slug.slug || slug.event_code}`);
  assert.equal(page.status, 200, page.text);
  assert.equal(page.data.features.calendar, false, 'the page does not offer it');
  const ours = await new Session('anon').get(`/api/public/events/${ctx.ev.slug}`);
  assert.equal(ours.data.features.calendar, true);
});
