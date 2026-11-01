/**
 * E-mail verification and who gets an invitation (Phase 6, security).
 *
 * The hole this closes: an event invitation names an address, and the role
 * it carries went to whoever signed up first with that address and the
 * event's public code. Now the role goes to the person who shows the address
 * is theirs: the confirmation link, a password reset link, or the
 * invitation's own link.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, mailsTo, verifyTokenFor, confirmEmail } = require('./helpers');
const { dbQuery } = require('./fixtures');

const admin = new Session('ev-admin');
const ctx = {};
const userId = async (address) => (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [address])).rows[0]?.id;
const isJudge = async (eventId, uid) => (await dbQuery('SELECT 1 FROM judges WHERE event_id = $1 AND user_id = $2', [eventId, uid])).rows.length > 0;
const inviteOf = async (eventId, address) => (await dbQuery('SELECT * FROM event_invites WHERE event_id = $1 AND LOWER(email) = LOWER($2)', [eventId, address])).rows[0];
const code = (prefix) => `${prefix}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);

/** The invitation link in the newest invite e-mail to `address`. */
async function inviteLinkFor(address) {
  for (let i = 0; i < 40; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const mail = (await mailsTo(address)).find((m) => /inviteToken=/.test(m.text));
    if (mail) return new URL(/https?:\/\/[^\s"<>]+inviteToken=[A-Za-z0-9._%-]+/.exec(mail.text)[0].replace(/&amp;/g, '&'));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((done) => { setTimeout(done, 100); });
  }
  return null;
}

async function makeEvent(prefix, extra = {}) {
  const r = await admin.post('/api/events', {
    event_code: code(prefix), name: `Verify ${prefix} ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(5 * DAY), start_date: iso(6 * DAY), end_date: iso(7 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true, ...extra,
  });
  assert.equal(r.status, 201, r.text);
  return r.data;
}

test('setup: two events and their invitations', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  ctx.ev = await makeEvent('EVA');
  ctx.ev2 = await makeEvent('EVB');
  for (const [address, role] of [[email('ev-judge'), 'judge'], [email('ev-mentor'), 'mentor'], [email('ev-vol'), 'volunteer']]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: address, role });
    assert.equal(r.status, 201, r.text);
    // SEND_EMAIL_ON_EVENT_INVITE is off here: the answer says no e-mail went
    // out, so the builder tells the organiser to pass the link on.
    assert.equal(r.data.emailed, process.env.SEND_EMAIL_ON_EVENT_INVITE === 'true');
  }
  // The volunteer is also invited to the second event, as a judge.
  const r = await admin.post(`/api/events/${ctx.ev2.id}/invites`, { email: email('ev-vol'), role: 'judge' });
  assert.equal(r.status, 201, r.text);
});

test('the address and the public event code alone do not make anyone the judge', async () => {
  const intruder = new Session('ev-intruder');
  const r = await intruder.register({ fullName: 'Not The Judge', email: email('ev-judge'), eventCode: ctx.ev.event_code }, { verify: false });
  assert.equal(r.verificationRequired, true);
  assert.deepEqual(r.pendingInvite, { eventId: ctx.ev.id, role: 'judge' }, 'the invitation waits for the address');
  assert.equal(intruder.user.role, 'hacker');
  const uid = await userId(email('ev-judge'));
  assert.equal(await isJudge(ctx.ev.id, uid), false, 'no judge seat');
  assert.equal((await inviteOf(ctx.ev.id, email('ev-judge'))).used_at, null, 'the invitation is still open');
  const attempt = await intruder.get(`/api/events/${ctx.ev.id}/judging/me`);
  assert.ok([403, 404].includes(attempt.status), `the judge screens stay shut (${attempt.status})`);

  const me = await intruder.get('/api/auth/me');
  assert.equal(me.data.email_verified, false);
  assert.deepEqual(me.data.pending_invites.map((x) => [x.eventId, x.role]), [[ctx.ev.id, 'judge']]);
  ctx.judgeSession = intruder;
});

test('confirming the address hands the invitation over', async () => {
  const token = await verifyTokenFor(email('ev-judge'));
  assert.ok(token, 'a confirmation e-mail went to the address');
  let r = await new Session('anon').post('/api/auth/verify-email', { token });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.applied, [{ eventId: ctx.ev.id, role: 'judge', eventName: ctx.ev.name }]);
  const uid = await userId(email('ev-judge'));
  assert.equal(await isJudge(ctx.ev.id, uid), true);
  assert.ok((await inviteOf(ctx.ev.id, email('ev-judge'))).used_at, 'used');
  assert.equal((await dbQuery('SELECT role FROM users WHERE id = $1', [uid])).rows[0].role, 'judge', 'an account that is nothing else takes the role, as the sign-up did');

  r = await new Session('anon').post('/api/auth/verify-email', { token });
  assert.equal(r.status, 200, 'opening the link twice is fine');
  assert.equal(r.data.alreadyVerified, true);

  await ctx.judgeSession.login(email('ev-judge'));
  const me = await ctx.judgeSession.get('/api/auth/me');
  assert.equal(me.data.email_verified, true);
  assert.deepEqual(me.data.pending_invites, []);
  r = await ctx.judgeSession.get(`/api/events/${ctx.ev.id}/judging/me`);
  assert.equal(r.status, 200, r.text);
});

test('a wrong, used up or expired link is refused', async () => {
  let r = await new Session('anon').post('/api/auth/verify-email', { token: 'x'.repeat(43) });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'INVALID_VERIFY_TOKEN');
  r = await new Session('anon').post('/api/auth/verify-email', { token: 'short' });
  assert.equal(r.status, 400);

  const s = new Session('ev-late');
  await s.register({ fullName: 'Late Clicker', email: email('ev-late') }, { verify: false });
  const token = await verifyTokenFor(email('ev-late'));
  await dbQuery("UPDATE email_verification_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [await userId(email('ev-late'))]);
  r = await new Session('anon').post('/api/auth/verify-email', { token });
  assert.equal(r.status, 400, 'expired');
  assert.equal((await s.get('/api/auth/me')).data.email_verified, false);
});

test('a new link on request, not more than one a minute', async () => {
  const s = new Session('ev-resend');
  await s.register({ fullName: 'Resend Me', email: email('ev-resend') }, { verify: false });
  let r = await s.post('/api/auth/verify-email/resend', {});
  assert.equal(r.status, 429, 'the sign-up link was sent a moment ago');
  assert.equal(r.json.code, 'VERIFY_COOLDOWN');
  await dbQuery("UPDATE email_verification_tokens SET created_at = now() - interval '2 minutes' WHERE user_id = $1", [await userId(email('ev-resend'))]);
  r = await s.post('/api/auth/verify-email/resend', {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.sent, true);
  const n = (await dbQuery('SELECT COUNT(*)::int AS n FROM email_verification_tokens WHERE user_id = $1', [await userId(email('ev-resend'))])).rows[0].n;
  assert.equal(n, 2);
  await confirmEmail(email('ev-resend'));
  r = await s.post('/api/auth/verify-email/resend', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.alreadyVerified, true);
  r = await new Session('anon').post('/api/auth/verify-email/resend', {});
  assert.equal(r.status, 401, 'signed in only');
});

test('the invitation e-mail\'s link opens it at once and proves the address', async () => {
  const r0 = await admin.post('/api/mail/staff-invite', { to: email('ev-mentor'), eventId: ctx.ev.id });
  assert.equal(r0.status, 200, r0.text);
  const link = await inviteLinkFor(email('ev-mentor'));
  assert.ok(link, 'the invite e-mail carries the link');
  const inviteToken = link.searchParams.get('inviteToken');
  assert.match(inviteToken, /^m\.\d+\./);
  assert.equal(link.searchParams.get('email'), email('ev-mentor'));

  // The token is for this address only.
  let r = await new Session('anon').post('/api/auth/register', {
    fullName: 'Someone Else', email: email('ev-other'), password: 'Test1234!', eventCode: ctx.ev.event_code, inviteToken,
  });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.code, 'INVALID_INVITE_TOKEN');
  // A changed token is refused.
  r = await new Session('anon').post('/api/auth/register', {
    fullName: 'Tamperer', email: email('ev-mentor'), password: 'Test1234!', inviteToken: `${inviteToken.slice(0, -1)}${inviteToken.endsWith('A') ? 'B' : 'A'}`,
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'INVALID_INVITE_TOKEN');

  const mentor = new Session('ev-mentor');
  const out = await mentor.register({ fullName: 'Real Mentor', email: email('ev-mentor'), eventCode: link.searchParams.get('eventCode'), inviteToken });
  assert.equal(out.verificationRequired, false, 'the link came to the address');
  assert.equal(out.email_verified, true);
  const uid = await userId(email('ev-mentor'));
  assert.equal((await dbQuery('SELECT 1 FROM mentor_assignments WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, uid])).rows.length, 1);
  assert.equal(mentor.user.role, 'mentor');
  await new Promise((done) => { setTimeout(done, 500); });
  assert.equal((await mailsTo(email('ev-mentor'))).filter((m) => /verify-email\?token=/.test(m.text)).length, 0, 'no confirmation e-mail needed');
});

test('a copied invitation link opens that invitation only', async () => {
  const inv = await inviteOf(ctx.ev.id, email('ev-vol'));
  let r = await admin.get(`/api/events/${ctx.ev.id}/invites/${inv.id}/link`);
  assert.equal(r.status, 200, r.text);
  const link = new URL(r.data.url);
  const inviteToken = link.searchParams.get('inviteToken');
  assert.match(inviteToken, /^l\.\d+\./);
  // Another event's organiser route cannot read it through this event.
  r = await admin.get(`/api/events/${ctx.ev2.id}/invites/${inv.id}/link`);
  assert.equal(r.status, 404);

  const vol = new Session('ev-vol');
  const out = await vol.register({ fullName: 'Real Volunteer', email: email('ev-vol'), inviteToken }, { verify: false });
  assert.equal(out.verificationRequired, true, 'a copied link does not prove the address');
  const uid = await userId(email('ev-vol'));
  assert.equal((await dbQuery('SELECT 1 FROM volunteers WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, uid])).rows.length, 1, 'its invitation is open');
  assert.equal(await isJudge(ctx.ev2.id, uid), false, 'the other event\'s invitation waits for the address');
  r = await admin.get(`/api/events/${ctx.ev.id}/invites/${inv.id}/link`);
  assert.equal(r.status, 409, 'used');

  await confirmEmail(email('ev-vol'));
  assert.equal(await isJudge(ctx.ev2.id, uid), true, 'confirmed: the second invitation follows');
});

test('an unconfirmed account cannot be made staff by its address; the owner of the address takes it back', async () => {
  const squatter = new Session('ev-squat');
  await squatter.register({ fullName: 'Squatter', email: email('ev-target') }, { verify: false });
  const uid = await userId(email('ev-target'));

  let r = await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email('ev-target'), role: 'judge' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.assigned, false);
  assert.equal(r.data.awaitingVerification, true);
  assert.equal(await isJudge(ctx.ev.id, uid), false);
  const builder = await admin.get(`/api/events/${ctx.ev.id}/builder`);
  const row = builder.data.staff.invites.find((i) => i.email === email('ev-target'));
  assert.equal(row.awaiting_verification, true, 'the builder says the invitation waits for the confirmation');

  r = await admin.post(`/api/events/${ctx.ev.id}/judging/judges`, { email: email('ev-target') });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'EMAIL_NOT_VERIFIED');
  r = await admin.post(`/api/events/${ctx.ev.id}/mentors`, { email: email('ev-target') });
  assert.equal(r.status, 409, r.text);
  r = await admin.post(`/api/events/${ctx.ev.id}/volunteers`, { email: email('ev-target') });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'EMAIL_NOT_VERIFIED');

  // The real owner resets the password from their mailbox: the squatter is
  // signed out, the address is proven and the judge seat is theirs.
  r = await new Session('anon').post('/api/auth/forgot-password', { email: email('ev-target') });
  assert.equal(r.status, 200);
  let resetUrl = r.data?.resetUrl;
  for (let i = 0; i < 40 && !resetUrl; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const mail = (await mailsTo(email('ev-target'))).find((m) => /reset-password\?token=/.test(m.text));
    resetUrl = mail ? /https?:\/\/[^\s"<>]+reset-password\?token=[A-Za-z0-9_-]+/.exec(mail.text)[0] : null;
    // eslint-disable-next-line no-await-in-loop
    if (!resetUrl) await new Promise((done) => { setTimeout(done, 100); });
  }
  assert.ok(resetUrl);
  r = await new Session('anon').post('/api/auth/reset-password', { token: new URL(resetUrl).searchParams.get('token'), password: 'Owner1234!' });
  assert.equal(r.status, 200, r.text);
  assert.equal((await squatter.get('/api/auth/me')).status, 401, 'the squatter is signed out');
  assert.equal(await isJudge(ctx.ev.id, uid), true);
  const owner = new Session('ev-owner');
  await owner.login(email('ev-target'), 'Owner1234!');
  assert.equal((await owner.get('/api/auth/me')).data.email_verified, true);

  // Confirmed now: adding by address works again.
  r = await admin.post(`/api/events/${ctx.ev2.id}/volunteers`, { email: email('ev-target') });
  assert.equal(r.status, 201, r.text);
});

test('an invited participant who has not proven the address registers like everyone', async () => {
  const ev = await makeEvent('EVC', { approval_mode: 'manual' });
  for (const k of ['ev-p1', 'ev-p2']) {
    // eslint-disable-next-line no-await-in-loop
    await admin.post(`/api/events/${ev.id}/invites`, { email: email(k), role: 'hacker' });
  }
  const body = (k, extra = {}) => ({
    account: { fullName: `Invited ${k}`, email: email(k), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true }, ...extra,
  });
  let r = await new Session('ev-p1').post(`/api/public/events/${ev.slug}/register`, body('ev-p1'));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.status, 'pending', 'no shortcut past the review');
  assert.equal(r.data.verificationRequired, true);
  assert.equal((await inviteOf(ev.id, email('ev-p1'))).used_at, null);
  await confirmEmail(email('ev-p1'));
  const p1 = (await dbQuery('SELECT status FROM participants WHERE event_id = $1 AND user_id = $2', [ev.id, await userId(email('ev-p1'))])).rows[0];
  assert.equal(p1.status, 'approved', 'confirmed: the invitation approves the place');

  // Through the e-mailed invitation link: approved at once, address proven.
  r = await admin.post('/api/mail/staff-invite', { to: email('ev-p2'), eventId: ev.id });
  assert.equal(r.status, 200, r.text);
  const link = await inviteLinkFor(email('ev-p2'));
  r = await new Session('ev-p2').post(`/api/public/events/${ev.slug}/register`, body('ev-p2', { inviteToken: link.searchParams.get('inviteToken') }));
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.status, 'approved');
  assert.equal(r.data.verificationRequired, false);
  assert.ok((await dbQuery('SELECT email_verified_at FROM users WHERE id = $1', [await userId(email('ev-p2'))])).rows[0].email_verified_at);
});
