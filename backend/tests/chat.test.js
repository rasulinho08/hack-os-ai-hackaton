/**
 * Event chat (Phase 6): who reads and writes which channel, live delivery
 * (long poll), unread counts, and the organisers' moderation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, confirmEmail } = require('./helpers');
const { dbQuery } = require('./fixtures');

const admin = new Session('ch-admin');
const ctx = { p: {} };
const base = () => `/api/events/${ctx.ev.id}/chat`;
const list = (s) => s.get(base());
const channelOf = async (s, kind) => (await list(s)).data.channels.find((c) => c.kind === kind);
const send = (s, channelId, body) => s.post(`${base()}/channels/${channelId}/messages`, { body });
const read = (s, channelId, q = '') => s.get(`${base()}/channels/${channelId}/messages${q}`);

async function participant(tag, name, { approve = true } = {}) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ctx.ev.slug}/register`, {
    account: { fullName: name, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  await confirmEmail(email(tag));
  const userId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(tag)])).rows[0].id;
  if (approve) {
    const pid = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, userId])).rows[0].id;
    assert.equal((await admin.patch(`/api/events/${ctx.ev.id}/participants/${pid}`, { status: 'approved' })).status, 200);
  }
  await s.login(email(tag));
  return { s, userId };
}

async function staff(tag, name, role) {
  await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email(tag), role });
  const s = new Session(tag);
  await s.register({ fullName: name, email: email(tag), eventCode: ctx.ev.event_code });
  return { s, userId: (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(tag)])).rows[0].id };
}

test('setup: an event, two teams, a pending participant, a mentor and a judge', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  const r = await admin.post('/api/events', {
    event_code: `CH${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Chat ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(-DAY / 2), end_date: iso(2 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  for (const [k, n] of [['a1', 'Aysel'], ['a2', 'Anar'], ['b1', 'Bəhruz']]) {
    // eslint-disable-next-line no-await-in-loop
    ctx.p[k] = await participant(`ch-${k}`, n);
  }
  ctx.p.pending = await participant('ch-pend', 'Pərvin', { approve: false });
  for (const [k, members] of [['A', ['a1', 'a2']], ['B', ['b1']]]) {
    const ids = members.map((m) => ctx.p[m].userId);
    // eslint-disable-next-line no-await-in-loop
    const t = await admin.post('/api/teams', { eventId: ctx.ev.id, name: `Team ${k} ${RUN_ID}`, memberIds: ids, leaderId: ids[0] });
    assert.equal(t.status, 201, t.text);
    ctx[`team${k}`] = t.data.id;
  }
  ctx.mentor = await staff('ch-mentor', 'Mentor Murad', 'mentor');
  ctx.judge = await staff('ch-judge', 'Judge Jalə', 'judge');
});

test('the channels follow who you are', async () => {
  const kinds = async (s) => (await list(s)).data.channels.map((c) => c.kind).sort();
  assert.deepEqual(await kinds(ctx.p.a1.s), ['general', 'support', 'team']);
  assert.deepEqual(await kinds(ctx.p.pending.s), ['support'], 'not accepted yet: only the thread with the organisers');
  assert.deepEqual(await kinds(ctx.mentor.s), ['general', 'support']);
  assert.deepEqual(await kinds(ctx.judge.s), ['general', 'support']);
  const mine = await list(admin);
  assert.equal(mine.status, 200, mine.text);
  assert.deepEqual(mine.data.channels.map((c) => c.kind), ['general'], 'organisers see threads once they have messages');
  assert.equal(mine.data.me.organizer, true);
  assert.equal(mine.data.openReports, 0);
  assert.equal(mine.data.chatModule, true);
  assert.equal(mine.data.archived, false);
  assert.equal((await new Session('anon').get(base())).status, 401);
  ctx.general = (await channelOf(ctx.p.a1.s, 'general')).id;
  ctx.teamAChannel = (await channelOf(ctx.p.a1.s, 'team')).id;
});

test('general is for everyone accepted; a pending participant cannot read it', async () => {
  let r = await send(ctx.p.a1.s, ctx.general, '  Salam, hamıya!  ');
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.body, 'Salam, hamıya!', 'trimmed');
  assert.equal(r.data.author.role, 'participant');
  assert.equal(r.data.mine, true);
  r = await send(ctx.mentor.s, ctx.general, 'Mentors are at table 3.');
  assert.equal(r.data.author.role, 'mentor');
  r = await send(admin, ctx.general, 'Welcome!');
  assert.equal(r.data.author.role, 'organizer');

  r = await read(ctx.p.pending.s, ctx.general);
  assert.equal(r.status, 404, 'not visible at all');
  r = await send(ctx.p.pending.s, ctx.general, 'hi');
  assert.equal(r.status, 404);

  r = await read(ctx.p.b1.s, ctx.general);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.messages.map((m) => m.body), ['Salam, hamıya!', 'Mentors are at table 3.', 'Welcome!']);
  assert.equal(r.data.messages[0].mine, false);
});

test('one channel by id, for a link from the bell', async () => {
  let r = await ctx.p.a1.s.get(`${base()}/channels/${ctx.teamAChannel}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.kind, 'team');
  assert.equal(r.data.canPost, true);
  r = await ctx.p.b1.s.get(`${base()}/channels/${ctx.teamAChannel}`);
  assert.equal(r.status, 404, 'not theirs');
});

test('a team channel is the team\'s own', async () => {
  let r = await read(ctx.p.b1.s, ctx.teamAChannel);
  assert.equal(r.status, 404, 'another team');
  r = await read(ctx.mentor.s, ctx.teamAChannel);
  assert.equal(r.status, 404, 'staff are not in team channels');
  r = await send(ctx.p.a2.s, ctx.teamAChannel, 'I pushed the API.');
  assert.equal(r.status, 201, r.text);
  r = await read(admin, ctx.teamAChannel);
  assert.equal(r.status, 200, 'organisers can read, for moderation');
});

test('a waiting reader is woken by the next message', async () => {
  const last = (await read(ctx.p.a1.s, ctx.teamAChannel)).data.messages.at(-1).id;
  const started = Date.now();
  const waiting = read(ctx.p.a1.s, ctx.teamAChannel, `?after=${last}&wait=15`);
  await new Promise((done) => { setTimeout(done, 400); });
  const sent = await send(ctx.p.a2.s, ctx.teamAChannel, 'Live?');
  assert.equal(sent.status, 201);
  const r = await waiting;
  const took = Date.now() - started;
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.messages.map((m) => m.body), ['Live?']);
  assert.ok(took < 5000, `answered when the message came (${took} ms), not after the wait`);

  // Nothing new: the wait runs out and the answer is empty.
  const t0 = Date.now();
  const empty = await read(ctx.p.a1.s, ctx.teamAChannel, `?after=${sent.data.id}&wait=1`);
  assert.equal(empty.data.messages.length, 0);
  assert.ok(Date.now() - t0 >= 900, 'it waited');
});

test('unread counts and read marks', async () => {
  let ch = await channelOf(ctx.p.a1.s, 'team');
  assert.equal(ch.unread, 2, 'two from Anar');
  assert.equal(ch.lastMessage.preview, 'Live?');
  assert.equal(ch.lastMessage.authorName, 'Anar');
  const r = await ctx.p.a1.s.post(`${base()}/channels/${ch.id}/read`, {});
  assert.equal(r.status, 200, r.text);
  ch = await channelOf(ctx.p.a1.s, 'team');
  assert.equal(ch.unread, 0);
  ch = await channelOf(ctx.p.a2.s, 'team');
  assert.equal(ch.unread, 0, 'one\'s own messages are read');
});

test('a support thread is between one person and the organisers', async () => {
  const mine = await channelOf(ctx.p.a1.s, 'support');
  let r = await send(ctx.p.a1.s, mine.id, 'Is there parking?');
  assert.equal(r.status, 201, r.text);
  r = await read(ctx.p.a2.s, mine.id);
  assert.equal(r.status, 404, 'a teammate does not read it');
  r = await read(ctx.mentor.s, mine.id);
  assert.equal(r.status, 404);

  const inbox = (await list(admin)).data.channels.find((c) => c.kind === 'support' && c.userId === ctx.p.a1.userId);
  assert.ok(inbox, 'the organisers see the thread');
  assert.equal(inbox.personName, 'Aysel');
  assert.equal(inbox.unread, 1);
  r = await send(admin, inbox.id, 'Yes, behind the building.');
  assert.equal(r.status, 201);
  assert.equal((await channelOf(ctx.p.a1.s, 'support')).unread, 1);
  // The pending participant has a thread too.
  const pend = await channelOf(ctx.p.pending.s, 'support');
  r = await send(ctx.p.pending.s, pend.id, 'When will I be approved?');
  assert.equal(r.status, 201, r.text);
});

test('messages are plain text of a sane size', async () => {
  let r = await send(ctx.p.a1.s, ctx.general, '   ');
  assert.equal(r.status, 400);
  r = await send(ctx.p.a1.s, ctx.general, 'x'.repeat(2001));
  assert.equal(r.status, 400);
  r = await send(ctx.p.a1.s, ctx.general, 'line one\nline\u0007 two <b>bold</b>');
  assert.equal(r.status, 201);
  assert.equal(r.data.body, 'line one\nline two <b>bold</b>', 'control characters go; markup is kept as text for the app to escape');
});

test('moderation: remove, report, lock and mute', async () => {
  const bad = await send(ctx.p.b1.s, ctx.general, 'Something rude');
  const since = (await read(ctx.p.a1.s, ctx.general)).data.at;

  // Removing is for the author and the organisers.
  let r = await ctx.p.a1.s.delete(`${base()}/messages/${bad.data.id}`);
  assert.equal(r.status, 403);
  r = await ctx.p.a1.s.post(`${base()}/messages/${bad.data.id}/report`, { reason: 'Rude' });
  assert.equal(r.status, 200, r.text);
  r = await ctx.p.a2.s.post(`${base()}/messages/${bad.data.id}/report`, {});
  assert.equal(r.status, 200);
  r = await ctx.p.b1.s.post(`${base()}/messages/${bad.data.id}/report`, {});
  assert.equal(r.status, 400, 'not one\'s own');

  assert.equal((await list(admin)).data.openReports, 1);
  r = await admin.get(`${base()}/reports`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].reports, 2);
  assert.deepEqual(r.data[0].reasons, ['Rude']);
  assert.equal(r.data[0].author.id, ctx.p.b1.userId);
  r = await ctx.p.a1.s.get(`${base()}/reports`);
  assert.equal(r.status, 403, 'organisers only');
  // The organiser home asks for it until someone deals with it.
  r = await admin.get(`/api/events/${ctx.ev.id}/overview`);
  assert.deepEqual(r.data.alerts.filter((a) => a.code === 'chat_reports').map((a) => [a.count, a.href]), [[1, '/chat?tab=reports']]);

  r = await admin.post(`${base()}/reports/${bad.data.id}/resolve`, { action: 'remove' });
  assert.equal(r.status, 200, r.text);
  assert.equal((await list(admin)).data.openReports, 0);
  r = await admin.get(`/api/events/${ctx.ev.id}/overview`);
  assert.equal(r.data.alerts.some((a) => a.code === 'chat_reports'), false);
  r = await read(ctx.p.a1.s, ctx.general, `?after=${bad.data.id - 1}&since=${encodeURIComponent(since)}`);
  const gone = r.data.messages.find((m) => m.id === bad.data.id);
  assert.equal(gone.removed, true);
  assert.equal(gone.body, null, 'the words are not sent');
  assert.ok(r.data.removed.includes(bad.data.id), 'readers learn what was removed since their last look');
  const audit = await dbQuery("SELECT 1 FROM audit_log WHERE action = 'chat.report.remove' AND event_id = $1", [ctx.ev.id]);
  assert.equal(audit.rows.length, 1);

  // An author removes their own.
  const oops = await send(ctx.p.a2.s, ctx.general, 'wrong channel');
  r = await ctx.p.a2.s.delete(`${base()}/messages/${oops.data.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.byModerator, false);

  // Locked: only the organisers write.
  r = await admin.post(`${base()}/channels/${ctx.general}/lock`, {});
  assert.equal(r.status, 200, r.text);
  r = await send(ctx.p.a1.s, ctx.general, 'hello?');
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'CHAT_LOCKED');
  assert.equal((await channelOf(ctx.p.a1.s, 'general')).canPost, false);
  r = await send(admin, ctx.general, 'Quiet hours.');
  assert.equal(r.status, 201);
  r = await ctx.p.a1.s.post(`${base()}/channels/${ctx.general}/unlock`, {});
  assert.equal(r.status, 403, 'organisers only');
  r = await admin.post(`${base()}/channels/${ctx.general}/unlock`, {});
  assert.equal(r.status, 200);
  r = await admin.post(`${base()}/channels/${(await channelOf(ctx.p.a1.s, 'support')).id}/lock`, {});
  assert.equal(r.status, 400, 'support threads are not locked');

  // Muted: nowhere but one's own support thread.
  r = await admin.post(`${base()}/mutes`, { userId: ctx.p.b1.userId, minutes: 10, reason: 'Cool down' });
  assert.equal(r.status, 200, r.text);
  r = await send(ctx.p.b1.s, ctx.general, 'Why?');
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'CHAT_MUTED');
  const own = await channelOf(ctx.p.b1.s, 'support');
  r = await send(ctx.p.b1.s, own.id, 'Why was I muted?');
  assert.equal(r.status, 201, 'they can still talk to the organisers');
  assert.equal((await list(ctx.p.b1.s)).data.me.muted, true);
  r = await admin.get(`${base()}/mutes`);
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].reason, 'Cool down');
  r = await admin.post(`${base()}/mutes`, { userId: (await dbQuery("SELECT id FROM users WHERE LOWER(email) = LOWER($1)", [process.env.E2E_ADMIN_EMAIL || 'admin@test.com'])).rows[0].id });
  assert.equal(r.status, 400, 'not oneself');
  const outsider = new Session('ch-out');
  await outsider.register({ fullName: 'Outsider', email: email('ch-out') });
  r = await admin.post(`${base()}/mutes`, { userId: (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email('ch-out')])).rows[0].id });
  assert.equal(r.status, 400, 'not on the event');
  r = await admin.delete(`${base()}/mutes/${ctx.p.b1.userId}`);
  assert.equal(r.data.lifted, true);
  r = await send(ctx.p.b1.s, ctx.general, 'Sorry, everyone.');
  assert.equal(r.status, 201);
});

test('a help request has a thread for its team and the mentors', async () => {
  let r = await ctx.p.a1.s.post('/api/tickets', { eventId: ctx.ev.id, topic: 'Docker fails', description: 'Build breaks on ARM' });
  assert.equal(r.status, 201, r.text);
  const ticketId = r.data.id;
  r = await ctx.p.a1.s.get(`${base()}/tickets/${ticketId}`);
  assert.equal(r.status, 200, r.text);
  const thread = r.data;
  assert.equal(thread.kind, 'ticket');
  assert.equal(thread.ticketTopic, 'Docker fails');
  assert.equal(thread.teamName, `Team A ${RUN_ID}`, 'the request\'s team');
  assert.equal(thread.me.muted, false);
  r = await send(ctx.p.a1.s, thread.id, 'We are at table 7.');
  assert.equal(r.status, 201);
  r = await send(ctx.p.a2.s, thread.id, 'Logs are in the repo.');
  assert.equal(r.status, 201, 'the whole team');
  r = await ctx.p.b1.s.get(`${base()}/tickets/${ticketId}`);
  assert.equal(r.status, 404, 'another team');
  r = await ctx.mentor.s.get(`${base()}/tickets/${ticketId}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.canPost, true, 'unassigned: any mentor may answer');
  r = await send(ctx.mentor.s, thread.id, 'Coming over.');
  assert.equal(r.status, 201);
  assert.equal(r.data.author.role, 'mentor');
  r = await ctx.judge.s.get(`${base()}/tickets/${ticketId}`);
  assert.equal(r.status, 404, 'judges are not in it');
  assert.ok((await list(ctx.p.a2.s)).data.channels.some((c) => c.kind === 'ticket' && c.ticketId === ticketId), 'listed for the team');
});

test('with blind judging the judges stay out of the general channel', async () => {
  let r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { judging_config: { blind: true } });
  assert.equal(r.status, 200, r.text);
  assert.ok(!(await list(ctx.judge.s)).data.channels.some((c) => c.kind === 'general'));
  r = await read(ctx.judge.s, ctx.general);
  assert.equal(r.status, 404);
  assert.ok((await list(ctx.mentor.s)).data.channels.some((c) => c.kind === 'general'), 'mentors stay');
  await admin.patch(`/api/events/${ctx.ev.id}/builder`, { judging_config: { blind: false } });
});

test('the organiser switches channels off in the builder', async () => {
  let r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { comms_config: { chat: { general: false } } });
  assert.equal(r.status, 200, r.text);
  const data = (await list(ctx.p.a1.s)).data;
  assert.equal(data.enabled.general, false);
  assert.ok(!data.channels.some((c) => c.kind === 'general'));
  r = await read(ctx.p.a1.s, ctx.general);
  assert.equal(r.status, 404);
  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { comms_config: { chat: { nope: true } } });
  assert.equal(r.status, 400, 'unknown switches are refused');
  await admin.patch(`/api/events/${ctx.ev.id}/builder`, { comms_config: { chat: { general: true } } });
  assert.ok((await list(ctx.p.a1.s)).data.channels.some((c) => c.kind === 'general'));
});

test('a flood is slowed down', async () => {
  const flood = await participant('ch-flood', 'Flood');
  const own = await channelOf(flood.s, 'support');
  let last = null;
  for (let i = 0; i < 21; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await send(flood.s, own.id, `msg ${i}`);
  }
  assert.equal(last.status, 429);
});

test('an archived event\'s chat can be read, not written', async () => {
  let r = await admin.post(`/api/events/${ctx.ev.id}/archive`, {});
  assert.equal(r.status, 200, r.text);
  r = await send(ctx.p.a1.s, ctx.general, 'Anyone?');
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'EVENT_ARCHIVED');
  r = await read(ctx.p.a1.s, ctx.general);
  assert.equal(r.status, 200);
  r = await ctx.p.a1.s.post(`${base()}/channels/${ctx.general}/read`, {});
  assert.equal(r.status, 200, 'the read mark still moves');
  assert.equal((await list(ctx.p.a1.s)).data.archived, true);
  await admin.post(`/api/events/${ctx.ev.id}/unarchive`, {});
});
