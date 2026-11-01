/**
 * Certificates end to end against a running API (with its job worker).
 *
 * Covers: who would get which certificate before and after results
 * (participation for teams that handed in a project, winners by place prize,
 * special prizes, judges, mentors, volunteers), the organiser's chosen kinds,
 * issuing after results are published in the background, issuing by hand and
 * only once, the e-mail to each holder, the public check by code (with no
 * e-mail address), the PDF for the holder, the organiser and anyone with the
 * code, revoking and restoring, the signer's image (PNG only), a person's
 * own certificates, archived events, and other organisations kept out.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { Session, RUN_ID, email, DAY, iso, mailsTo } = require('./helpers');
const { dbQuery, approvedBuyer, closeSubmissions } = require('./fixtures');
const { crc32 } = require('../src/utils/zip');

const HOUR = 3600e3;
const admin = new Session('ct-admin');
const anon = new Session('ct-anon');
const ctx = { people: {}, teams: {} };

async function userIdOf(mail) {
  return (await dbQuery('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [mail])).rows[0].id;
}

async function register(tag, name) {
  const s = new Session(tag);
  const r = await s.post(`/api/public/events/${ctx.ev.slug}/register`, {
    account: { fullName: name, email: email(tag), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  const userId = await userIdOf(email(tag));
  const pid = (await dbQuery('SELECT id FROM participants WHERE event_id = $1 AND user_id = $2', [ctx.ev.id, userId])).rows[0].id;
  const a = await admin.patch(`/api/events/${ctx.ev.id}/participants/${pid}`, { status: 'approved' });
  assert.equal(a.status, 200, a.text);
  return { s, userId, name };
}

async function staff(tag, name, role) {
  const r = await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email(tag), role });
  assert.ok([200, 201].includes(r.status), r.text);
  const s = new Session(tag);
  await s.register({ fullName: name, email: email(tag), eventCode: ctx.ev.event_code });
  return { s, userId: await userIdOf(email(tag)), name };
}

/** A real PNG of w×h pixels (grey), small enough for the signature slot. */
function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = Buffer.alloc((w + 1) * h, 0x40);
  for (let y = 0; y < h; y += 1) rows[y * (w + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function waitFor(what, fn, ms = 45000) {
  const until = Date.now() + ms;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 500); });
  }
}

const certsOf = async (userId) => (await dbQuery(
  'SELECT id, code, kind, place, title, prize_id, emailed_at, revoked_at FROM certificates WHERE event_id = $1 AND user_id = $2 ORDER BY id',
  [ctx.ev.id, userId],
)).rows;
const base = () => `/api/events/${ctx.ev.id}/certificates`;
const review = (j, submissionId, inn, exe) => j.s.post(`/api/events/${ctx.ev.id}/judging/me/reviews`, {
  submissionId, scores: [{ criterionId: ctx.crit.inn, score: inn }, { criterionId: ctx.crit.exe, score: exe }],
});

test('setup: four teams (three handed in), a judge, a mentor, a volunteer, place and special prizes', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  let r = await admin.post('/api/events', {
    event_code: `CT${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20),
    name: `Certificates ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.ev = r.data;
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/criteria`, {
    items: [{ cid: 'inn', name: 'Innovation', maxScore: 10, weight: 1 }, { cid: 'exe', name: 'Execution', maxScore: 10, weight: 1 }],
  });
  assert.equal(r.status, 200, r.text);
  ctx.crit = { inn: r.data.idsByCid.inn, exe: r.data.idsByCid.exe };
  r = await admin.put(`/api/events/${ctx.ev.id}/builder/prizes`, {
    items: [
      { cid: 'p1', kind: 'place', position: 1, name: 'Grand prize' },
      { cid: 'p2', kind: 'place', position: 2, name: 'Runner-up' },
      { cid: 'sp', kind: 'special', name: 'Best design' },
    ],
  });
  assert.equal(r.status, 200, r.text);
  ctx.prize = { p1: r.data.idsByCid.p1, sp: r.data.idsByCid.sp };

  for (const [key, name] of [['a', 'Aysel Məmmədova'], ['a2', 'Anar Quliyev'], ['b', 'Babək Əliyev'], ['c', 'Cavid Həsənov'], ['d', 'Dilarə İsmayılova']]) {
    // eslint-disable-next-line no-await-in-loop
    ctx.people[key] = await register(`ct-${key}`, name);
  }
  for (const [key, members] of [['a', ['a', 'a2']], ['b', ['b']], ['c', ['c']], ['d', ['d']]]) {
    const ids = members.map((m) => ctx.people[m].userId);
    // eslint-disable-next-line no-await-in-loop
    r = await admin.post('/api/teams', { eventId: ctx.ev.id, name: `Team ${key.toUpperCase()} ${RUN_ID}`, memberIds: ids, leaderId: ids[0] });
    assert.equal(r.status, 201, r.text);
    ctx.teams[key] = { id: r.data.id };
  }
  ctx.judge = await staff('ct-j', 'Judge Nigar', 'judge');
  ctx.mentor = await staff('ct-m', 'Mentor Orxan', 'mentor');
  ctx.volunteer = await staff('ct-v', 'Volunteer Leyla', 'volunteer');

  await admin.put(`/api/events/${ctx.ev.id}`, { start_date: iso(-HOUR), end_date: iso(DAY) });
  // The organiser opened judging while submissions are still open (rolling
  // judging); without a judging start it opens when submissions close.
  await dbQuery("UPDATE events SET judging_start = now() - interval '1 minute' WHERE id = $1", [ctx.ev.id]);
  for (const key of ['a', 'b', 'c']) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.people[key].s.post('/api/submissions', {
      eventId: ctx.ev.id, project_name: `Project ${key.toUpperCase()}`, description: `What team ${key} built`,
      repo_link: `https://github.com/ct/${key}${RUN_ID}`,
    });
    assert.equal(r.status, 201, r.text);
    ctx.teams[key].submissionId = r.data.id;
  }
  // A ahead of B ahead of C.
  for (const [key, inn, exe] of [['a', 9, 9], ['b', 7, 7], ['c', 4, 5]]) {
    // eslint-disable-next-line no-await-in-loop
    r = await review(ctx.judge, ctx.teams[key].submissionId, inn, exe);
    assert.equal(r.status, 200, r.text);
  }
});

test('before results: the plan lists participation and staff; winners wait for results', async () => {
  const r = await admin.get(`${base()}/plan`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.needsResults, true);
  const of = (kind) => r.data.items.filter((i) => i.kind === kind).map((i) => i.name).sort();
  assert.deepEqual(of('participation'), ['Anar Quliyev', 'Aysel Məmmədova', 'Babək Əliyev', 'Cavid Həsənov'], 'Dilarə handed nothing in');
  assert.deepEqual(of('judge'), ['Judge Nigar']);
  assert.deepEqual(of('mentor'), ['Mentor Orxan']);
  assert.deepEqual(of('volunteer'), ['Volunteer Leyla']);
  assert.equal(of('winner').length, 0);
  assert.equal(r.data.toIssue, 7);
  assert.ok(r.data.items.every((i) => i.state === 'new'));
  assert.ok(!('email' in r.data.items[0]), 'the plan does not need e-mail addresses');
});

test('the organiser chooses the kinds', async () => {
  let r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { certificate_config: { types: ['participation', 'winners', 'special', 'judge', 'volunteer'] } });
  assert.equal(r.status, 200, r.text);
  r = await admin.get(`${base()}/plan`);
  assert.ok(!r.data.items.some((i) => i.kind === 'mentor'), 'mentors are left out once unticked');
  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { certificate_config: { types: ['participation', 'winners', 'special', 'judge', 'mentor', 'volunteer'] } });
  assert.equal(r.status, 200, r.text);
});

test('participants and other organisations cannot manage certificates', async () => {
  let r = await ctx.people.a.s.get(base());
  assert.equal(r.status, 403, r.text);
  r = await ctx.people.a.s.post(`${base()}/issue`, {});
  assert.equal(r.status, 403, r.text);
  r = await ctx.judge.s.get(`${base()}/plan`);
  assert.equal(r.status, 403, r.text);
  const other = await approvedBuyer('ct-other');
  ctx.other = other.session;
  r = await ctx.other.get(base());
  assert.equal(r.status, 404, r.text);
  r = await ctx.other.post(`${base()}/issue`, {});
  assert.equal(r.status, 404, r.text);
  r = await admin.post(`${base()}/issue`, { kinds: ['bogus'] });
  assert.equal(r.status, 400, r.text);
});

test('publishing results issues the certificates in the background and e-mails them', async () => {
  // The hackathon is over and the certificate names its signer.
  await closeSubmissions(ctx.ev.id);
  let r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { certificate_config: { signerName: 'Rəşad Kərimov', signerTitle: 'Direktor' } });
  assert.equal(r.status, 200, r.text);
  r = await admin.post(`/api/events/${ctx.ev.id}/results/publish`, { visibility: 'full' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.certificates.issuing, true);
  assert.equal(r.status, 200, r.text);
  // The job saves the certificates one by one: wait for all ten before
  // looking at anyone's (the first person's alone could be ready earlier).
  await waitFor('all ten certificates', async () => {
    const all = await admin.get(base());
    return all.status === 200 && all.data.length === 10;
  });
  const a = await certsOf(ctx.people.a.userId);
  assert.ok(a.some((c) => c.kind === 'winner') && a.some((c) => c.kind === 'participation'), 'winner and participation');
  const win = a.find((c) => c.kind === 'winner');
  assert.equal(win.place, 1);
  assert.equal(win.title, 'Grand prize');
  assert.match(win.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  ctx.code = win.code;
  ctx.certA = win.id;
  ctx.partA = a.find((c) => c.kind === 'participation').id;

  assert.ok((await certsOf(ctx.people.a2.userId)).some((c) => c.kind === 'winner'), 'every member of the winning team');
  assert.equal((await certsOf(ctx.people.b.userId)).find((c) => c.kind === 'winner').place, 2);
  assert.ok(!(await certsOf(ctx.people.c.userId)).some((c) => c.kind === 'winner'), 'third place has no place prize');
  assert.equal((await certsOf(ctx.people.d.userId)).length, 0);
  for (const p of [ctx.judge, ctx.mentor, ctx.volunteer]) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await certsOf(p.userId)).length, 1, p.name);
  }

  const mailed = await waitFor('the e-mail', async () => (await certsOf(ctx.people.a.userId)).every((c) => c.emailed_at));
  assert.ok(mailed);
  const mails = await mailsTo(email('ct-a'));
  if (mails.length) {
    assert.ok(mails.some((m) => m.text.includes(`/verify/${win.code}`)), 'the e-mail links to the certificate page');
  }
  r = await admin.get(base());
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.length, 4 + 3 + 3, 'four participation, three winners (two on team A, one on team B), three staff');
});

test('a special prize given later is issued by hand, once', async () => {
  let r = await admin.patch(`/api/events/${ctx.ev.id}/results/prizes/${ctx.prize.sp}`, { teamId: ctx.teams.c.id });
  assert.equal(r.status, 200, r.text);
  r = await admin.get(`${base()}/plan`);
  const sp = r.data.items.find((i) => i.kind === 'special');
  assert.equal(sp.name, 'Cavid Həsənov');
  assert.equal(sp.state, 'new');
  assert.equal(r.data.toIssue, 1);

  r = await admin.post(`${base()}/issue`, { kinds: ['special'] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.issued, 1);
  const special = (await certsOf(ctx.people.c.userId)).find((c) => c.kind === 'special');
  assert.equal(special.title, 'Best design');
  r = await admin.post(`${base()}/issue`, {});
  assert.equal(r.data.issued, 0, 'issuing twice adds nothing');
  assert.ok(r.data.existing >= 10);
});

test('anyone with the code can check it; no e-mail address is shown', async () => {
  let r = await anon.get(`/api/public/certificates/${ctx.code}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.name, 'Aysel Məmmədova');
  assert.equal(r.data.kind, 'winner');
  assert.equal(r.data.place, 1);
  assert.equal(r.data.event.name, `Certificates ${RUN_ID}`);
  assert.equal(r.data.revoked, false);
  assert.ok(!JSON.stringify(r.json).includes('@'), 'no e-mail address');
  assert.ok(!('user_id' in r.data) && !('userId' in r.data));

  r = await anon.get(`/api/public/certificates/${ctx.code.replace(/-/g, '').toLowerCase()}`);
  assert.equal(r.status, 200, 'typed without dashes, in lower case');
  r = await anon.get('/api/public/certificates/AAAA-BBBB-CCCC');
  assert.equal(r.status, 404);
  r = await anon.get(`/api/public/certificates/${encodeURIComponent("' OR 1=1 --")}`);
  assert.equal(r.status, 404);
});

test('the PDF: for anyone with the code, the holder and the organiser', async () => {
  let r = await anon.download(`/api/public/certificates/${ctx.code}/pdf`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.equal(r.body.subarray(0, 5).toString(), '%PDF-');
  r = await ctx.people.a.s.download(`${base()}/${ctx.certA}/pdf`);
  assert.equal(r.status, 200);
  r = await admin.download(`${base()}/${ctx.certA}/pdf`);
  assert.equal(r.status, 200);
  r = await ctx.people.b.s.download(`${base()}/${ctx.certA}/pdf`);
  assert.equal(r.status, 404, 'not someone else\'s');
  r = await ctx.other.download(`${base()}/${ctx.certA}/pdf`);
  assert.equal(r.status, 404);
});

test('a person sees their own certificates across events', async () => {
  let r = await ctx.people.a.s.get('/api/me/certificates');
  assert.equal(r.status, 200, r.text);
  const mine = r.data.filter((c) => c.event.id === ctx.ev.id).map((c) => c.kind).sort();
  assert.deepEqual(mine, ['participation', 'winner']);
  assert.ok(r.data.every((c) => c.url.endsWith(`/verify/${c.code}`)));
  r = await ctx.people.b.s.get('/api/me/certificates');
  assert.ok(!r.data.some((c) => c.code === ctx.code));
  r = await anon.get('/api/me/certificates');
  assert.equal(r.status, 401);
});

test('revoking: the check says so, the PDF is gone, issuing does not bring it back; restoring', async () => {
  let r = await admin.post(`${base()}/${ctx.partA}/revoke`, {});
  assert.equal(r.status, 200, r.text);
  const code = (await certsOf(ctx.people.a.userId)).find((c) => c.id === ctx.partA).code;
  r = await anon.get(`/api/public/certificates/${code}`);
  assert.equal(r.data.revoked, true);
  r = await anon.download(`/api/public/certificates/${code}/pdf`);
  assert.equal(r.status, 410);
  r = await ctx.people.a.s.download(`${base()}/${ctx.partA}/pdf`);
  assert.equal(r.status, 410);
  r = await ctx.people.a.s.get('/api/me/certificates');
  assert.ok(!r.data.some((c) => c.code === code));
  r = await admin.get(`${base()}/plan`);
  assert.equal(r.data.items.find((i) => i.userId === ctx.people.a.userId && i.kind === 'participation').state, 'revoked');
  r = await admin.post(`${base()}/issue`, {});
  assert.equal(r.data.issued, 0, 'a revoked certificate is not issued again by itself');

  r = await admin.post(`${base()}/${ctx.partA}/restore`, {});
  assert.equal(r.status, 200, r.text);
  r = await anon.get(`/api/public/certificates/${code}`);
  assert.equal(r.data.revoked, false);
  r = await admin.post(`${base()}/999999999/revoke`, {});
  assert.equal(r.status, 404);
  r = await ctx.other.post(`${base()}/${ctx.partA}/revoke`, {});
  assert.equal(r.status, 404);
});

test('the e-mail can be sent again for chosen certificates', async () => {
  await dbQuery('UPDATE certificates SET emailed_at = NULL WHERE id = $1', [ctx.certA]);
  const r = await admin.post(`${base()}/email`, { ids: [ctx.certA] });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.queued, 1);
  await waitFor('the second e-mail', async () => (await certsOf(ctx.people.a.userId)).find((c) => c.id === ctx.certA).emailed_at);
});

test('the signer\'s image goes onto the PDF; WebP is refused', async () => {
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(32)]);
  let r = await admin.upload(`/api/files?purpose=signature&eventId=${ctx.ev.id}`, webp, { type: 'image/webp', name: 's.webp' });
  assert.equal(r.status, 415, r.text);
  assert.equal(r.json.code, 'FILE_TYPE_NOT_ALLOWED');
  r = await admin.upload(`/api/files?purpose=signature&eventId=${ctx.ev.id}`, png(120, 40), { type: 'image/png', name: 'signature.png' });
  assert.equal(r.status, 201, r.text);
  const fileId = r.data.id;
  const before = await anon.download(`/api/public/certificates/${ctx.code}/pdf`);
  r = await admin.patch(`/api/events/${ctx.ev.id}/builder`, { certificate_config: { signatureFileId: fileId, signerName: 'Rəşad Kərimov', signerTitle: 'Direktor' } });
  assert.equal(r.status, 200, r.text);
  const after = await anon.download(`/api/public/certificates/${ctx.code}/pdf`);
  assert.equal(after.status, 200);
  assert.ok(!before.body.includes('/Subtype /Image'));
  assert.ok(after.body.includes('/Subtype /Image'), 'the signature is embedded');
});

test('an archived event issues nothing new', async () => {
  await dbQuery('UPDATE events SET archived_at = now() WHERE id = $1', [ctx.ev.id]);
  try {
    const r = await admin.post(`${base()}/issue`, {});
    assert.equal(r.status, 409, r.text);
    assert.equal(r.json.code, 'EVENT_ARCHIVED');
    const v = await anon.get(`/api/public/certificates/${ctx.code}`);
    assert.equal(v.status, 200, 'issued certificates still check out');
  } finally {
    await dbQuery('UPDATE events SET archived_at = NULL WHERE id = $1', [ctx.ev.id]);
  }
});
