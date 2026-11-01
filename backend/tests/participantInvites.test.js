/**
 * Personal invitations to register (the organiser's Invitations screen),
 * end to end against a running API:
 *
 *   - only the event's own organisers list, send, resend, withdraw, copy or
 *     export invitations (another organisation's organiser gets 404, a
 *     participant 403, nobody signed in 401);
 *   - a pasted list is validated and de-duplicated; each address gets an
 *     e-mail in the event's language with a personal registration link;
 *   - an invite-only event refuses registration without an invitation and
 *     takes it with one; the link is bound to its address, and opening it
 *     marks the invitation "opened";
 *   - expired and withdrawn invitations are refused with their own reason;
 *     sending an expired one again renews it; inviting a withdrawn address
 *     again gives a new link and the old one stays dead;
 *   - a team on the list: the first one invited creates it, the next joins
 *     it without a code;
 *   - a copied link lets its person in but does not prove the address;
 *   - the CSV export cannot run a formula in a spreadsheet;
 *   - a personal invitation also gets its person into a public event whose
 *     registration has closed; an unpublished event sends none.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, mailsTo } = require('./helpers');
const { dbQuery, approvedBuyer } = require('./fixtures');

const admin = new Session('pi-admin');
const anon = new Session('pi-anon');
const ctx = {};
const base = (id = ctx.ev.id) => `/api/events/${id}/participant-invites`;
const code = (tag) => `PI${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

async function newEvent(tag, patch = {}) {
  let r = await admin.post('/api/events', {
    event_code: code(tag), name: `Invitations ${tag} ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  const ev = r.data;
  if (Object.keys(patch).length) {
    r = await admin.patch(`/api/events/${ev.id}/builder`, patch);
    assert.equal(r.status, 200, r.text);
  }
  r = await admin.get(`/api/events/${ev.id}/builder`);
  ev.slug = r.data.event.slug;
  return ev;
}

/** The newest invitation link e-mailed to `address` (waits for the mail). */
async function linkFor(address, { after = 0 } = {}) {
  for (let i = 0; i < 80; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const all = await mailsTo(address);
    const mail = all.length > after ? all.find((m) => /inviteToken=/.test(m.text)) : null;
    if (mail) {
      const url = /https?:\/\/[^\s"<>]+inviteToken=[A-Za-z0-9._%-]+/.exec(mail.text)[0].replace(/&amp;/g, '&');
      return { url: new URL(url), mail, token: new URL(url).searchParams.get('inviteToken') };
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((done) => { setTimeout(done, 100); });
  }
  return null;
}

const body = (k, extra = {}) => ({
  account: { fullName: `Invited ${k}`, email: email(k), password: 'Test1234!' },
  entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true }, ...extra,
});
const register = (ev, k, extra) => new Session(k).post(`/api/public/events/${ev.slug}/register`, body(k, extra));
const rowOf = async (eventId, address) => (await dbQuery('SELECT * FROM event_invites WHERE event_id = $1 AND LOWER(email) = LOWER($2)', [eventId, address])).rows[0];
const itemOf = async (address, eventId = ctx.ev.id) => (await admin.get(base(eventId))).data.items.find((x) => x.email === address.toLowerCase());

test('setup: an invite-only event in Russian, and a mail server to read', async (t) => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  ctx.ev = await newEvent('IO', { visibility: 'invite', language: 'ru', max_participants: 3 });
  const probe = await fetch(process.env.FAKE_SMTP_LOG || 'http://127.0.0.1:2526/__log').then(() => true, () => false);
  ctx.mail = probe;
  if (!probe) t.diagnostic('no test mail server: the links are read from the database instead');
});

test('only the event\'s organisers manage its invitations', async () => {
  assert.equal((await anon.get(base())).status, 401);
  assert.equal((await anon.post(base(), { invitees: [email('pi-x')] })).status, 401);

  const other = await approvedBuyer(`pi-other-${RUN_ID}`.slice(0, 30));
  ctx.other = other.session;
  const tries = [
    ['get', base()], ['post', base(), { invitees: [email('pi-x')] }], ['post', `${base()}/resend`, { ids: [1] }],
    ['post', `${base()}/revoke`, { ids: [1] }], ['get', `${base()}/1/link`], ['get', `${base()}/export.csv`],
  ];
  for (const [m, path, b] of tries) {
    // eslint-disable-next-line no-await-in-loop
    const r = await other.session[m](path, b);
    assert.equal(r.status, 404, `another organisation: ${m} ${path} ${r.text}`);
  }
  // A participant of some event is not an organiser.
  const hacker = new Session('pi-hacker');
  await hacker.login('hacker@test.com');
  assert.equal((await hacker.get(base())).status, 403);
  assert.equal((await hacker.post(base(), { invitees: [email('pi-x')] })).status, 403);
  // And their own event's list is theirs: the other organiser sees an empty one of their own making.
  assert.equal((await dbQuery("SELECT COUNT(*)::int AS n FROM event_invites WHERE event_id = $1 AND role = 'hacker'", [ctx.ev.id])).rows[0].n, 0);
});

test('a pasted list: validated, de-duplicated, and e-mailed in the event\'s language', async () => {
  const r = await admin.post(base(), {
    invitees: [
      { email: `  ${email('pi-a').toUpperCase()} `, fullName: 'Aysel Invited' },
      email('pi-a'),
      'not-an-address',
      { email: email('pi-b'), fullName: 'Bəhruz Invited' },
    ],
  });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.created.length, 2);
  assert.equal(r.data.duplicates, 1);
  assert.deepEqual(r.data.invalid.map((x) => x.reason), ['invalid_email']);
  assert.equal(r.data.sent + r.data.failed, 2);
  assert.equal(r.data.capacity.outstanding, 2);
  assert.equal(r.data.capacity.limit, 3);

  const a = await rowOf(ctx.ev.id, email('pi-a'));
  assert.equal(a.full_name, 'Aysel Invited');
  assert.ok(a.token_nonce, 'a participant invitation signs its own nonce');
  assert.ok(new Date(a.expires_at) > new Date(Date.now() + 13 * DAY), 'two weeks by default');
  if (ctx.mail) {
    const link = await linkFor(email('pi-a'));
    assert.ok(link, 'the invitation reached the address');
    assert.equal(link.url.pathname, `/e/${ctx.ev.slug}/register`);
    assert.match(link.token, /^m\.\d+\./);
    assert.match(link.mail.text, /lang="ru"/, 'in the event\'s language');
    ctx.tokenA = link.token;
    ctx.tokenB = (await linkFor(email('pi-b'))).token;
  } else {
    ctx.tokenA = require('../src/services/inviteToken').sign(a, 'mail');
    ctx.tokenB = require('../src/services/inviteToken').sign(await rowOf(ctx.ev.id, email('pi-b')), 'mail');
  }

  const list = await admin.get(base());
  assert.equal(list.status, 200, list.text);
  assert.equal(list.data.counts.total, 2);
  assert.equal((await itemOf(email('pi-a'))).status, ctx.mail ? 'sent' : 'not_sent');
  assert.equal(list.data.event.visibility, 'invite');
  const audit = await dbQuery("SELECT COUNT(*)::int AS n FROM audit_log WHERE event_id = $1 AND action = 'invitation.sent'", [ctx.ev.id]);
  assert.equal(audit.rows[0].n, 2, 'one audit row per invitation');

  // Inviting the same address again while it is valid: skipped, said so.
  const again = await admin.post(base(), { invitees: [email('pi-a')] });
  assert.equal(again.status, 201, again.text);
  assert.equal(again.data.created.length, 0);
  assert.equal(again.data.skipped[0].reason, 'already_invited');
  const none = await admin.post(base(), { invitees: ['nope', ''] });
  assert.equal(none.status, 400);
  const tooLong = await admin.post(base(), { invitees: [email('pi-z')], expiresInDays: 0 });
  assert.equal(tooLong.status, 400);
  const many = await admin.post(base(), { invitees: Array.from({ length: 501 }, (_, i) => `many${i}.${RUN_ID}@e2e.test`) });
  assert.equal(many.status, 400);
  assert.equal(many.json.code, 'TOO_MANY');
});

test('invite-only: without an invitation refused, with one in, the link bound to its address', async () => {
  let r = await register(ctx.ev, 'pi-stranger');
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'INVITE_ONLY');

  // The registration page reads the invitation: the address to fill in; it is now "opened".
  r = await anon.get(`/api/public/invitations/${encodeURIComponent(ctx.tokenA)}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'live');
  assert.equal(r.data.email, email('pi-a').toLowerCase());
  assert.equal(r.data.fullName, 'Aysel Invited');
  assert.equal(r.data.event.slug, ctx.ev.slug);
  assert.equal((await itemOf(email('pi-a'))).status, 'opened');

  // Someone else with the link: refused, and told whose it is.
  r = await register(ctx.ev, 'pi-stranger', { inviteToken: ctx.tokenA });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'INVITE_EMAIL_MISMATCH');
  r = await register(ctx.ev, 'pi-a', { inviteToken: `${ctx.tokenA.slice(0, -1)}${ctx.tokenA.endsWith('A') ? 'B' : 'A'}` });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'INVALID_INVITE_TOKEN');
  assert.equal((await anon.get('/api/public/invitations/m.1.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')).status, 404);

  r = await register(ctx.ev, 'pi-a', { inviteToken: ctx.tokenA });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.status, 'approved', 'an invitation is the organiser saying yes');
  assert.equal(r.data.verificationRequired, false, 'the e-mailed link proves the address');
  const item = await itemOf(email('pi-a'));
  assert.equal(item.status, 'registered');
  assert.equal(item.participantStatus, 'approved');
  r = await anon.get(`/api/public/invitations/${encodeURIComponent(ctx.tokenA)}`);
  assert.equal(r.data.status, 'used');
  assert.equal(r.data.email, undefined, 'a used invitation says no more');
});

test('expired and withdrawn invitations are refused, each with its reason', async () => {
  await dbQuery("UPDATE event_invites SET expires_at = now() - interval '1 minute', last_sent_at = now() - interval '1 hour' WHERE event_id = $1 AND LOWER(email) = LOWER($2)", [ctx.ev.id, email('pi-b')]);
  let r = await anon.get(`/api/public/invitations/${encodeURIComponent(ctx.tokenB)}`);
  assert.equal(r.data.status, 'expired');
  assert.equal(r.data.email, undefined);
  r = await register(ctx.ev, 'pi-b', { inviteToken: ctx.tokenB });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'INVITE_EXPIRED');
  const b = await itemOf(email('pi-b'));
  assert.equal(b.status, 'expired');
  assert.equal((await admin.get(base())).data.capacity.outstanding, 0, 'an expired invitation holds no seat');
  r = await admin.get(`${base()}/${b.id}/link`);
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'INVITE_EXPIRED');

  // Sent again: renewed, same link.
  r = await admin.post(`${base()}/resend`, { ids: [b.id] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.renewed, 1);
  assert.equal((await itemOf(email('pi-b'))).status, ctx.mail ? 'sent' : 'not_sent');
  r = await anon.get(`/api/public/invitations/${encodeURIComponent(ctx.tokenB)}`);
  assert.equal(r.data.status, 'live');
  if (ctx.mail) {
    r = await admin.post(`${base()}/resend`, { ids: [b.id] });
    assert.equal(r.data.sent, 0);
    assert.equal(r.data.skipped[0].reason, 'cooldown', 'not twice within minutes');
  }

  // Withdrawn: dead at once.
  r = await admin.post(`${base()}/revoke`, { ids: [b.id, (await itemOf(email('pi-a'))).id] });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.revoked, [b.id], 'a used invitation is not withdrawn');
  r = await register(ctx.ev, 'pi-b', { inviteToken: ctx.tokenB });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'INVITE_REVOKED');
  assert.equal((await anon.get(`/api/public/invitations/${encodeURIComponent(ctx.tokenB)}`)).data.status, 'revoked');
  assert.equal((await itemOf(email('pi-b'))).status, 'revoked');
  r = await admin.post(`${base()}/resend`, { ids: [b.id] });
  assert.equal(r.data.sent, 0);
  assert.equal(r.data.skipped[0].reason, 'revoked');
  r = await register(ctx.ev, 'pi-b');
  assert.equal(r.json.code, 'INVITE_ONLY', 'nor does the address alone get in');

  // Invited again: a new link; the old one stays dead.
  const before = ctx.mail ? (await mailsTo(email('pi-b'))).length : 0;
  r = await admin.post(base(), { invitees: [email('pi-b')] });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.data.reinvited, [b.id]);
  r = await register(ctx.ev, 'pi-b', { inviteToken: ctx.tokenB });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'INVALID_INVITE_TOKEN');
  const fresh = ctx.mail
    ? (await linkFor(email('pi-b'), { after: before })).token
    : require('../src/services/inviteToken').sign(await rowOf(ctx.ev.id, email('pi-b')), 'mail');
  assert.notEqual(fresh, ctx.tokenB);
  r = await register(ctx.ev, 'pi-b', { inviteToken: fresh });
  assert.equal(r.status, 201, r.text);

  const audit = await dbQuery("SELECT action, COUNT(*)::int AS n FROM audit_log WHERE event_id = $1 AND action LIKE 'invitation.%' GROUP BY action", [ctx.ev.id]);
  const n = Object.fromEntries(audit.rows.map((x) => [x.action, x.n]));
  assert.ok(n['invitation.revoked'] >= 1 && n['invitation.resent'] >= 1);
});

test('a team on the list: the first person creates it, the next joins without a code', async () => {
  let r = await admin.post(base(), {
    invitees: [{ email: email('pi-c'), fullName: 'Cəmilə', team: `Owls ${RUN_ID}` }],
  });
  assert.equal(r.status, 201, r.text);
  const sign = require('../src/services/inviteToken').sign;
  const tokenC = sign(await rowOf(ctx.ev.id, email('pi-c')), 'mail');
  r = await anon.get(`/api/public/invitations/${encodeURIComponent(tokenC)}`);
  assert.deepEqual(r.data.team, { name: `Owls ${RUN_ID}`, exists: false });
  r = await register(ctx.ev, 'pi-c', { inviteToken: tokenC, entry: { type: 'lead', teamName: `Owls ${RUN_ID}` } });
  assert.equal(r.status, 201, r.text);
  // The event is full now (3 of 3): the invited still get in.
  r = await admin.post(base(), { invitees: [{ email: email('pi-d'), team: `owls ${RUN_ID}` }] });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.capacity.overBy, 1, 'the screen says the invitations go past the limit');
  const tokenD = sign(await rowOf(ctx.ev.id, email('pi-d')), 'mail');
  r = await anon.get(`/api/public/invitations/${encodeURIComponent(tokenD)}`);
  assert.equal(r.data.team.exists, true);
  r = await register(ctx.ev, 'pi-d', { inviteToken: tokenD, entry: { type: 'member' } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.team?.name, `Owls ${RUN_ID}`, 'joined the team the organiser named');
});

test('a copied link lets its person in, but the new account still confirms its address', async () => {
  let r = await admin.post(base(), { invitees: [email('pi-e')] });
  assert.equal(r.status, 201, r.text);
  const id = r.data.created[0];
  r = await admin.get(`${base()}/${id}/link`);
  assert.equal(r.status, 200, r.text);
  const url = new URL(r.data.url);
  assert.equal(url.pathname, `/e/${ctx.ev.slug}/register`);
  const token = url.searchParams.get('inviteToken');
  assert.match(token, /^l\.\d+\./);
  assert.equal((await dbQuery("SELECT COUNT(*)::int AS n FROM audit_log WHERE event_id = $1 AND action = 'invitation.link_copied' AND target_id = $2", [ctx.ev.id, String(id)])).rows[0].n, 1);
  r = await register(ctx.ev, 'pi-e', { inviteToken: token });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.status, 'approved');
  assert.equal(r.data.verificationRequired, true);
});

test('the CSV export cannot run a formula in a spreadsheet', async () => {
  let r = await admin.post(base(), { invitees: [{ email: email('pi-f'), fullName: '=HYPERLINK("http://evil.test","x")', team: '+cmd' }] });
  assert.equal(r.status, 201, r.text);
  r = await admin.download(`${base()}/export.csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  const csv = r.body.toString('utf8');
  assert.match(csv, /E-mail,Name,Team,Status/);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil.test"",""x"")"`), csv);
  assert.ok(csv.includes("'+cmd"));
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv));
  assert.ok(csv.includes(email('pi-a').toLowerCase()));
  assert.equal((await ctx.other.download(`${base()}/export.csv`)).status, 404);
});

test('a public event: a personal invitation gets its person past closed registration', async () => {
  const ev = await newEvent('PUB');
  await dbQuery("UPDATE events SET registration_end = now() - interval '1 hour' WHERE id = $1", [ev.id]);
  let r = await register(ev, 'pi-late');
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'REGISTRATION_CLOSED');
  r = await admin.post(base(ev.id), { invitees: [email('pi-late')] });
  assert.equal(r.status, 201, r.text);
  const token = require('../src/services/inviteToken').sign(await rowOf(ev.id, email('pi-late')), 'mail');
  r = await register(ev, 'pi-late', { inviteToken: token });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.status, 'approved');
});

test('an unpublished event sends no invitations', async () => {
  const r0 = await admin.post('/api/events', {
    event_code: code('DR'), name: `Draft ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: false,
  });
  assert.equal(r0.status, 201, r0.text);
  const r = await admin.post(base(r0.data.id), { invitees: [email('pi-draft')] });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'EVENT_NOT_PUBLISHED');
  const list = await admin.get(base(r0.data.id));
  assert.equal(list.status, 200);
  assert.equal(list.data.event.published, false);
});
