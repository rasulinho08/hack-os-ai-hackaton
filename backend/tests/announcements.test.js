/**
 * Announcements and Telegram, end to end against a running API that talks to
 * the fake Telegram and mail servers instead of real ones:
 *
 *   node tests/fakeTelegram.js 5099 &      node tests/fakeSmtp.js 2525 &
 *   TELEGRAM_BOT_TOKEN=test TELEGRAM_API_BASE=http://127.0.0.1:5099 \
 *   TELEGRAM_WEBHOOK_SECRET=local-webhook-secret \
 *   MAIL_PROVIDER=smtp SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_USER=x SMTP_PASS=x \
 *   MAIL_FROM_EMAIL=noreply@hackos.test JOBS_INTERVAL_MS=2000 AUTO_ANNOUNCE_EVERY_MS=2000 npm run dev
 *   node --test tests/announcements.test.js
 *
 * Covers: who sees which announcement; scheduling, moving, cancelling and
 * sending now, and the worker publishing on time; a person connecting their
 * Telegram; an event's channel by code and by @name (with proof that the
 * organiser runs it); deliveries by e-mail, Telegram and channel post, a
 * blocked chat and a refused address, and the delivery report; edits and
 * deletions following to the channel; posts written in the channel copied
 * into the app; automatic announcements (once, in the event's language,
 * only on plans with automations); input checks, the daily e-mail cap, the
 * webhook secret; another organisation's organiser seeing none of it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { API_URL, Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, approvedBuyer } = require('./fixtures');

const TG = process.env.FAKE_TELEGRAM_URL || 'http://127.0.0.1:5099';
const MAIL_LOG = process.env.FAKE_SMTP_LOG || 'http://127.0.0.1:2526/__log';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'local-webhook-secret';
const BLOCKED_CHAT = 999000999; // the fake answers 403 for it

const admin = new Session('ann-admin');
const ctx = {};
const chatBase = 7_000_000 + Math.floor(Math.random() * 1_000_000);

const tgLog = async () => (await fetch(`${TG}/__log`)).json();
const tgCalls = async (method, pred = () => true) => (await tgLog()).filter((c) => c.method === method && pred(c.params || {}));
const setAdmin = (key, yes) => fetch(`${TG}/__admin/${key}/${yes ? 'yes' : 'no'}`);
const mailLog = async () => {
  try { return await (await fetch(MAIL_LOG)).json(); } catch { return null; }
};

let updateId = Date.now() * 10;
async function webhook(update, secret = SECRET) {
  updateId += 1;
  const res = await fetch(`${API_URL}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) },
    body: JSON.stringify({ update_id: updateId, ...update }),
  });
  return { status: res.status, json: await res.json().catch(() => null), updateId };
}

async function until(fn, label, { timeout = 25_000, every = 400 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, every); });
  }
}

async function makeEvent(tag, extra = {}, session = admin) {
  const r = await session.post('/api/events', {
    event_code: `AN${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    name: `Announce ${tag} ${RUN_ID}`,
    registration_start: iso(-1 * DAY),
    registration_end: iso(3 * DAY),
    start_date: iso(4 * DAY),
    end_date: iso(5 * DAY),
    team_size_limit: 4,
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
  const u = await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email(tag)]);
  return { s, userId: u.rows[0].id };
}

async function setStatus(ev, tag, status) {
  const list = await admin.get(`/api/events/${ev.id}/participants`);
  const p = list.data.find((x) => String(x.email).toLowerCase() === email(tag).toLowerCase());
  const r = await admin.patch(`/api/events/${ev.id}/participants/${p.id}`, { status });
  assert.equal(r.status, 200, r.text);
}

const titles = (r) => (r.data || []).map((a) => a.title);

async function announce(body, session = admin) {
  const r = await session.post('/api/announcements', { eventId: ctx.ev.id, content: 'Details inside.', ...body });
  return r;
}

/** Connect `person`'s Telegram through the real flow: link from the app, /start in the chat. */
async function connectTelegram(person, chatId, lang = 'en') {
  const r = await person.s.post('/api/telegram/me/link');
  assert.equal(r.status, 201, r.text);
  const code = new URL(r.data.url).searchParams.get('start');
  assert.match(r.data.url, /^https:\/\/t\.me\/hackos_test_bot\?start=/);
  const w = await webhook({ message: { message_id: 1, chat: { id: chatId, type: 'private' }, from: { id: chatId, first_name: 'T', language_code: lang }, text: `/start ${code}` } });
  assert.equal(w.status, 200);
  assert.equal(w.json.result.result, 'user-linked', JSON.stringify(w.json));
  return code;
}

// ── Setup ───────────────────────────────────────────────────────────────────

test('setup: an event with approved, waiting and staff people', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  ctx.ev = await makeEvent('main');
  ctx.a = await register(ctx.ev, 'ann-a');
  ctx.b = await register(ctx.ev, 'ann-b'); // stays pending
  ctx.c = await register(ctx.ev, 'ann-c');
  await setStatus(ctx.ev, 'ann-a', 'approved');
  await setStatus(ctx.ev, 'ann-c', 'approved');
  ctx.j = { s: new Session('ann-j') };
  await ctx.j.s.register({ fullName: 'Judge J', email: email('ann-j') });
  ctx.j.userId = (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email('ann-j')])).rows[0].id;
  const r = await admin.post(`/api/events/${ctx.ev.id}/judging/judges`, { userId: ctx.j.userId });
  assert.ok([200, 201].includes(r.status), r.text);
});

// ── Who sees what ───────────────────────────────────────────────────────────

test('each person sees the announcements meant for them; organisers see all', async () => {
  for (const [title, audience] of [['For everyone', 'everyone'], ['For participants', 'participants'], ['For judges', 'judges'], ['For waiting', 'waiting']]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await announce({ title: `${title} ${RUN_ID}`, audience });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.data.status, 'sent');
  }
  const t = (s) => `${s} ${RUN_ID}`;
  const seen = async (person) => titles(await person.get(`/api/announcements?eventId=${ctx.ev.id}`));

  const a = await seen(ctx.a.s);
  assert.ok(a.includes(t('For everyone')) && a.includes(t('For participants')));
  assert.ok(!a.includes(t('For judges')) && !a.includes(t('For waiting')), 'an approved participant sees no judges-only or waiting-list notes');

  const b = await seen(ctx.b.s);
  assert.ok(b.includes(t('For everyone')) && b.includes(t('For waiting')));
  assert.ok(!b.includes(t('For participants')), 'a pending participant is not yet a participant');

  const j = await seen(ctx.j.s);
  assert.ok(j.includes(t('For everyone')) && j.includes(t('For judges')));
  assert.ok(!j.includes(t('For participants')));

  const all = await admin.get(`/api/announcements?eventId=${ctx.ev.id}`);
  assert.equal(all.status, 200);
  for (const s of ['For everyone', 'For participants', 'For judges', 'For waiting']) assert.ok(titles(all).includes(t(s)));
  assert.ok(all.data.every((x) => x.deliveries && typeof x.deliveries === 'object'), 'organisers get the delivery report');

  // Members do not see the organisers' bookkeeping.
  const raw = (await ctx.a.s.get(`/api/announcements?eventId=${ctx.ev.id}`)).data[0];
  assert.equal(raw.channels, undefined);
  assert.equal(raw.scheduled_at, undefined);

  // Without an event in the query, a participant gets their own event's.
  const own = await ctx.a.s.get('/api/announcements');
  assert.equal(own.status, 200);
  assert.ok(titles(own).includes(t('For everyone')));
  assert.ok(!titles(own).includes(t('For judges')));
});

test('a track audience reaches only teams in that track', async () => {
  const tr = await admin.post(`/api/events/${ctx.ev.id}/tracks`, { name: `AI ${RUN_ID}` });
  assert.ok([200, 201].includes(tr.status), tr.text);
  const trackId = tr.data.id;
  // C leads a team in the track; A has no team.
  let r = await ctx.c.s.post('/api/teams', { eventId: ctx.ev.id, name: `Track Team ${RUN_ID}` });
  assert.equal(r.status, 201, r.text);
  await dbQuery('UPDATE teams SET track_id = $1 WHERE id = $2', [trackId, r.data.id]);
  r = await announce({ title: `Track news ${RUN_ID}`, audience: 'track', trackId });
  assert.equal(r.status, 201, r.text);
  assert.ok(titles(await ctx.c.s.get(`/api/announcements?eventId=${ctx.ev.id}`)).includes(`Track news ${RUN_ID}`));
  assert.ok(!titles(await ctx.a.s.get(`/api/announcements?eventId=${ctx.ev.id}`)).includes(`Track news ${RUN_ID}`));

  // The organiser's audience counter agrees.
  r = await admin.get(`/api/announcements/audience?eventId=${ctx.ev.id}&audience=track&trackId=${trackId}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.people, 1);
  r = await admin.get(`/api/announcements/audience?eventId=${ctx.ev.id}&audience=no_team`);
  assert.equal(r.data.people, 1, 'A is the only approved participant without a team');
});

// ── Scheduling ──────────────────────────────────────────────────────────────

test('a scheduled announcement stays hidden, can move, be sent now or cancelled', async () => {
  let r = await announce({ title: `Later ${RUN_ID}`, scheduledAt: iso(10 * 60e3) });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.status, 'scheduled');
  const later = r.data;
  assert.ok(!titles(await ctx.a.s.get(`/api/announcements?eventId=${ctx.ev.id}`)).includes(`Later ${RUN_ID}`));

  // Moving it replaces its job.
  r = await admin.put(`/api/announcements/${later.id}`, { scheduledAt: iso(20 * 60e3) });
  assert.equal(r.status, 200, r.text);
  const jobs = await dbQuery("SELECT status FROM jobs WHERE dedupe_key LIKE $1 ORDER BY id", [`ann:${later.id}:publish:%`]);
  assert.deepEqual(jobs.rows.map((x) => x.status), ['cancelled', 'queued']);

  r = await admin.post(`/api/announcements/${later.id}/send-now`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'sent');
  assert.ok(titles(await ctx.a.s.get(`/api/announcements?eventId=${ctx.ev.id}`)).includes(`Later ${RUN_ID}`));
  r = await admin.post(`/api/announcements/${later.id}/cancel`);
  assert.equal(r.status, 409, 'a sent announcement cannot be cancelled');

  r = await announce({ title: `Never ${RUN_ID}`, scheduledAt: iso(30 * 60e3) });
  r = await admin.post(`/api/announcements/${r.data.id}/cancel`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'cancelled');
  assert.ok(!titles(await ctx.a.s.get(`/api/announcements?eventId=${ctx.ev.id}`)).includes(`Never ${RUN_ID}`));
});

test('the worker publishes a scheduled announcement when its time comes', async () => {
  const r = await announce({ title: `On time ${RUN_ID}`, scheduledAt: iso(5 * 60e3) });
  assert.equal(r.status, 201, r.text);
  // Bring the moment forward instead of waiting five minutes.
  await dbQuery("UPDATE announcements SET scheduled_at = now() WHERE id = $1", [r.data.id]);
  await dbQuery("UPDATE jobs SET run_at = now() WHERE dedupe_key LIKE $1 AND status = 'queued'", [`ann:${r.data.id}:publish:%`]);
  await until(async () => titles(await ctx.a.s.get(`/api/announcements?eventId=${ctx.ev.id}`)).includes(`On time ${RUN_ID}`), 'the scheduled announcement');
  const row = await dbQuery('SELECT status, sent_at FROM announcements WHERE id = $1', [r.data.id]);
  assert.equal(row.rows[0].status, 'sent');
  assert.ok(row.rows[0].sent_at);
});

// ── Telegram: a person ──────────────────────────────────────────────────────

test('the webhook is shut without the secret and ignores repeats', async () => {
  let w = await webhook({ message: { chat: { id: 1, type: 'private' }, text: '/start' } }, null);
  assert.equal(w.status, 401);
  w = await webhook({ message: { chat: { id: 1, type: 'private' }, text: '/start' } }, 'wrong-secret');
  assert.equal(w.status, 401);

  const body = { update_id: Date.now() * 10 + 999_999, message: { message_id: 1, chat: { id: chatBase + 50, type: 'private' }, from: { id: chatBase + 50 }, text: '/start' } };
  const send = () => fetch(`${API_URL}/api/telegram/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET }, body: JSON.stringify(body),
  }).then((x) => x.json());
  assert.equal((await send()).result.result, 'welcome');
  assert.equal((await send()).result.skipped, 'duplicate');
});

test('a person connects their Telegram once with a code, and can disconnect', async () => {
  let r = await ctx.a.s.get('/api/telegram/me');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.linked, false);
  assert.equal(r.data.botUsername, 'hackos_test_bot');

  const code = await connectTelegram(ctx.a, chatBase + 1, 'az');
  r = await ctx.a.s.get('/api/telegram/me');
  assert.equal(r.data.linked, true);
  const greeting = await tgCalls('sendMessage', (p) => String(p.chat_id) === String(chatBase + 1));
  assert.match(greeting.at(-1).params.text, /Qoşuldu/, 'the bot answers in the person’s Telegram language');

  // A code works once.
  const again = await webhook({ message: { message_id: 2, chat: { id: chatBase + 2, type: 'private' }, from: { id: chatBase + 2 }, text: `/start ${code}` } });
  assert.equal(again.json.result.result, 'code-invalid');

  // /stop disconnects; connecting again works.
  const stop = await webhook({ message: { message_id: 3, chat: { id: chatBase + 1, type: 'private' }, from: { id: chatBase + 1 }, text: '/stop' } });
  assert.equal(stop.json.result.result, 'user-unlinked');
  assert.equal((await ctx.a.s.get('/api/telegram/me')).data.linked, false);
  await connectTelegram(ctx.a, chatBase + 1);
  // C connects to the chat the fake treats as having blocked the bot.
  await connectTelegram(ctx.c, BLOCKED_CHAT);
});

// ── Telegram: the event's channel ───────────────────────────────────────────

test('an organiser connects the event channel by posting a code there', async () => {
  let r = await admin.get(`/api/events/${ctx.ev.id}/telegram`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.linked, false);
  r = await admin.post(`/api/events/${ctx.ev.id}/telegram/code`);
  assert.equal(r.status, 201, r.text);
  assert.match(r.data.command, /^\/link [A-Za-z0-9_-]{24}$/);
  ctx.channelId = -(1_000_000_000_000 + chatBase);
  const w = await webhook({ channel_post: { message_id: 10, chat: { id: ctx.channelId, type: 'channel', title: 'Event News' }, text: r.data.command } });
  assert.equal(w.json.result.result, 'channel-linked', JSON.stringify(w.json));
  r = await admin.get(`/api/events/${ctx.ev.id}/telegram`);
  assert.equal(r.data.linked, true);
  assert.equal(r.data.channel.title, 'Event News');
  assert.ok((await tgCalls('deleteMessage', (p) => String(p.chat_id) === String(ctx.channelId) && p.message_id === 10)).length, 'the code is taken off the channel');

  r = await admin.post(`/api/events/${ctx.ev.id}/telegram/test`);
  assert.equal(r.status, 200, r.text);
});

test('linking a public channel by @name needs the organiser to run it', async () => {
  const ev = await makeEvent('name');
  let r = await admin.post(`/api/events/${ev.id}/telegram/link`, { username: '@missing_channel' });
  assert.equal(r.status, 404, r.text);
  assert.equal(r.json.code, 'TG_CHAT_NOT_FOUND');
  r = await admin.post(`/api/events/${ev.id}/telegram/link`, { username: 'https://t.me/public_channel' });
  if (r.status === 409 && r.json.code === 'TG_OWNER_NOT_LINKED') {
    // The organiser connects their own Telegram first.
    const adminChat = chatBase + 900;
    await connectTelegram({ s: admin }, adminChat);
    await setAdmin(`-100777:${adminChat}`, false);
    r = await admin.post(`/api/events/${ev.id}/telegram/link`, { username: '@public_channel' });
    assert.equal(r.status, 403, r.text);
    assert.equal(r.json.code, 'TG_NOT_CHANNEL_ADMIN', 'the bot being there proves nothing about who asks');
    await setAdmin(`-100777:${adminChat}`, true);
  }
  r = await admin.post(`/api/events/${ev.id}/telegram/link`, { username: '@public_channel' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.channel.username, 'public_channel');
  r = await admin.delete(`/api/events/${ev.id}/telegram`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.linked, false);
});

// ── Deliveries ──────────────────────────────────────────────────────────────

test('an announcement reaches e-mail, Telegram and the channel, with a report', async () => {
  const before = await mailLog();
  const r = await announce({
    title: `Lunch is served ${RUN_ID}`, content: 'Come to the hall.\n\nVegan options too.',
    audience: 'everyone', channels: ['telegram', 'email'], priority: 'high',
  });
  assert.equal(r.status, 201, r.text);
  const id = r.data.id;
  ctx.lunch = id;
  const report = await until(async () => {
    const d = await admin.get(`/api/announcements/${id}/deliveries`);
    const rep = d.data?.report || {};
    const pending = Object.values(rep).reduce((n, c) => n + c.pending, 0);
    return rep.email && rep.telegram && rep.telegram_channel && pending === 0 ? d.data : null;
  }, 'all deliveries');

  // A (connected) gets a message; C's chat blocked the bot; the channel gets one post.
  assert.equal(report.report.telegram.sent, 1, JSON.stringify(report.report));
  assert.equal(report.report.telegram.failed, 1);
  assert.equal(report.report.telegram_channel.sent, 1);
  const toA = await tgCalls('sendMessage', (p) => String(p.chat_id) === String(chatBase + 1) && p.text.includes(`Lunch is served ${RUN_ID}`));
  assert.equal(toA.length, 1, 'exactly one message, not one per retry');
  assert.match(toA[0].params.text, /<b>Lunch is served/);
  const post = await tgCalls('sendMessage', (p) => String(p.chat_id) === String(ctx.channelId) && p.text.includes(`Lunch is served ${RUN_ID}`));
  assert.equal(post.length, 1);
  const blocked = report.problems.find((p) => p.channel === 'telegram');
  assert.ok(blocked && /blocked/i.test(blocked.last_error), JSON.stringify(report.problems));
  const link = await dbQuery('SELECT blocked_at FROM telegram_links WHERE user_id = $1', [ctx.c.userId]);
  assert.ok(link.rows[0].blocked_at, 'the blocked chat is remembered');

  // Everyone in the event (A, B, C, the judge) is e-mailed — or, without a
  // mail server, the e-mails are recorded as only logged.
  const people = 4;
  const sentOrSkipped = report.report.email.sent + report.report.email.skipped;
  assert.equal(sentOrSkipped, people, JSON.stringify(report.report.email));
  const after = await mailLog();
  if (after && before) {
    const mine = after.slice(before.length).filter((m) => (m.data || '').includes(`Lunch is served ${RUN_ID}`) || m.subject.includes('Lunch'));
    assert.equal(mine.length, people, 'the mail server received one e-mail per person');
    assert.ok(mine.some((m) => m.to.includes(email('ann-a').toLowerCase()) || m.to.includes(email('ann-a'))));
    assert.ok(mine.every((m) => /\[Urgent\]|Təcili|Срочно/.test(m.subject) || m.subject.includes('=?')), 'high priority is marked');
  }
});

test('editing a sent announcement updates its channel post; deleting takes it down', async () => {
  const id = ctx.lunch;
  const post = (await dbQuery("SELECT external_id FROM announcement_deliveries WHERE announcement_id = $1 AND channel = 'telegram_channel'", [id])).rows[0];
  assert.ok(post.external_id);
  let r = await admin.put(`/api/announcements/${id}`, { content: 'Come to hall B.' });
  assert.equal(r.status, 200, r.text);
  await until(async () => (await tgCalls('editMessageText', (p) => String(p.message_id) === post.external_id && p.text.includes('hall B'))).length, 'the edited post');
  // Who and where cannot change once sent.
  r = await admin.put(`/api/announcements/${id}`, { audience: 'judges' });
  assert.equal(r.status, 200);
  assert.equal(r.data.audience, 'everyone');

  r = await admin.delete(`/api/announcements/${id}`);
  assert.equal(r.status, 200, r.text);
  await until(async () => (await tgCalls('deleteMessage', (p) => String(p.message_id) === post.external_id)).length, 'the post taken down');
});

test('posts written in the channel appear in the app, unless switched off', async () => {
  let w = await webhook({ channel_post: { message_id: 501, chat: { id: ctx.channelId, type: 'channel' }, text: `Wifi password changed ${RUN_ID}\nIt is now on the board.` } });
  assert.equal(w.json.result.result, 'mirrored', JSON.stringify(w.json));
  let seen = titles(await ctx.a.s.get(`/api/announcements?eventId=${ctx.ev.id}`));
  assert.ok(seen.includes(`Wifi password changed ${RUN_ID}`));
  w = await webhook({ edited_channel_post: { message_id: 501, chat: { id: ctx.channelId, type: 'channel' }, text: `Wifi password updated ${RUN_ID}\nSee the board.` } });
  assert.equal(w.json.result.result, 'mirror-updated');
  seen = titles(await ctx.a.s.get(`/api/announcements?eventId=${ctx.ev.id}`));
  assert.ok(seen.includes(`Wifi password updated ${RUN_ID}`));

  // The mirrored post is not sent back out.
  const mirrored = (await dbQuery("SELECT id, channels, source FROM announcements WHERE external_ref = $1", [`${ctx.channelId}:501`])).rows[0];
  assert.equal(mirrored.source, 'telegram');
  assert.deepEqual(mirrored.channels, ['platform']);

  let r = await admin.patch(`/api/events/${ctx.ev.id}/telegram`, { mirrorPosts: false });
  assert.equal(r.status, 200, r.text);
  w = await webhook({ channel_post: { message_id: 502, chat: { id: ctx.channelId, type: 'channel' }, text: `Not copied ${RUN_ID}` } });
  assert.equal(w.json.result.skipped, 'mirror-off');
  r = await admin.patch(`/api/events/${ctx.ev.id}/telegram`, { mirrorPosts: true });
});

// ── Automatic announcements ─────────────────────────────────────────────────

test('automatic announcements go out once, in the event language, when due', async () => {
  // Registration closes in 23 hours: "closes in 24 hours" is due.
  const ev = await makeEvent('auto', { registration_end: iso(23 * 3600e3), start_date: iso(3 * DAY), end_date: iso(4 * DAY) });
  await dbQuery("UPDATE events SET language = 'az' WHERE id = $1", [ev.id]);
  const rows = await until(async () => {
    const r = await dbQuery('SELECT a.title, a.audience, a.auto_key, a.channels FROM announcements a WHERE a.event_id = $1 AND a.auto_key IS NOT NULL', [ev.id]);
    return r.rows.length ? r.rows : null;
  }, 'the automatic announcement');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].auto_key, 'reg24');
  assert.equal(rows[0].title, 'Qeydiyyat 24 saata bağlanır');
  assert.equal(rows[0].audience, 'everyone');
  // Give the planner a few more passes: still exactly one.
  await new Promise((r) => { setTimeout(r, 5000); });
  const again = await dbQuery('SELECT COUNT(*)::int AS n FROM announcements WHERE event_id = $1 AND auto_key = $2', [ev.id, 'reg24']);
  assert.equal(again.rows[0].n, 1);

  // Switched off in the builder: not sent.
  const off = await makeEvent('off', { registration_end: iso(23 * 3600e3), start_date: iso(3 * DAY), end_date: iso(4 * DAY) });
  await dbQuery(`UPDATE events SET comms_config = '{"auto":{"reg24":false}}'::jsonb WHERE id = $1`, [off.id]);
  await new Promise((r) => { setTimeout(r, 6000); });
  const none = await dbQuery('SELECT COUNT(*)::int AS n FROM announcements WHERE event_id = $1 AND auto_key IS NOT NULL', [off.id]);
  assert.equal(none.rows[0].n, 0, 'an organiser who switched it off gets none');
});

test('automatic announcements need a plan with automations', async () => {
  const { session: buyer } = await approvedBuyer('ann-starter');
  const ev = await makeEvent('plan', { registration_end: iso(23 * 3600e3), start_date: iso(3 * DAY), end_date: iso(4 * DAY) }, buyer);
  ctx.starter = { buyer, ev };
  await dbQuery('UPDATE events SET is_published = true WHERE id = $1', [ev.id]);
  await new Promise((r) => { setTimeout(r, 6000); });
  const none = await dbQuery('SELECT COUNT(*)::int AS n FROM announcements WHERE event_id = $1 AND auto_key IS NOT NULL', [ev.id]);
  assert.equal(none.rows[0].n, 0, 'Starter has no automations');
});

// ── Checks and limits ───────────────────────────────────────────────────────

test('bad input is refused field by field', async () => {
  let r = await announce({ title: '', content: '' });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'ANNOUNCEMENT_INVALID');
  assert.deepEqual(r.json.errors.map((e) => e.field).sort(), ['content', 'title']);
  r = await announce({ title: 'x', audience: 'aliens' });
  assert.equal(r.status, 400);
  r = await announce({ title: 'x', scheduledAt: iso(-60e3) });
  assert.equal(r.status, 400);
  assert.equal(r.json.errors[0].code, 'IN_PAST');
  // A track of another event is not this event's.
  const other = await makeEvent('trk');
  const tr = await admin.post(`/api/events/${other.id}/tracks`, { name: `Other ${RUN_ID}` });
  r = await announce({ title: 'x', audience: 'track', trackId: tr.data.id });
  assert.equal(r.status, 400);
  assert.equal(r.json.errors[0].field, 'trackId');
  r = await admin.post('/api/announcements', { title: 'x', content: 'y' });
  assert.equal(r.status, 400, 'an event is required');
});

test('an event can e-mail at most 20 announcements a day', async () => {
  const ev = await makeEvent('cap');
  await dbQuery(
    `INSERT INTO announcements (event_id, title, content, channels, status, sent_at)
     SELECT $1, 'Old ' || g, 'x', '["platform","email"]'::jsonb, 'sent', now() FROM generate_series(1, 20) g`,
    [ev.id],
  );
  let r = await admin.post('/api/announcements', { eventId: ev.id, title: 'One more', content: 'x', channels: ['email'] });
  assert.equal(r.status, 429, r.text);
  assert.equal(r.json.code, 'EMAIL_LIMIT');
  r = await admin.post('/api/announcements', { eventId: ev.id, title: 'In the app only', content: 'x', channels: [] });
  assert.equal(r.status, 201, 'the app and Telegram are not capped');
});

test('another organisation’s organiser sees and changes none of it', async () => {
  const { buyer } = ctx.starter;
  let r = await buyer.get(`/api/announcements?eventId=${ctx.ev.id}`);
  assert.equal(r.status, 404);
  const some = (await admin.get(`/api/announcements?eventId=${ctx.ev.id}`)).data[0];
  r = await buyer.put(`/api/announcements/${some.id}`, { title: 'hijack' });
  assert.equal(r.status, 404);
  r = await buyer.delete(`/api/announcements/${some.id}`);
  assert.equal(r.status, 404);
  r = await buyer.get(`/api/announcements/${some.id}/deliveries`);
  assert.equal(r.status, 404);
  r = await buyer.post('/api/announcements', { eventId: ctx.ev.id, title: 'x', content: 'y' });
  assert.equal(r.status, 404);
  r = await buyer.get(`/api/events/${ctx.ev.id}/telegram`);
  assert.equal(r.status, 404);
  r = await buyer.post(`/api/events/${ctx.ev.id}/telegram/code`);
  assert.equal(r.status, 404);
  // A participant cannot manage the channel or write announcements.
  r = await ctx.a.s.post(`/api/events/${ctx.ev.id}/telegram/code`);
  assert.equal(r.status, 403);
  r = await ctx.a.s.post('/api/announcements', { eventId: ctx.ev.id, title: 'x', content: 'y' });
  assert.equal(r.status, 403);
});
