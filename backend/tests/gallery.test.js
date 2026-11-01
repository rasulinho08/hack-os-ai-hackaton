/**
 * An event's photo gallery (Phase 7): the organisers put photos up and tell
 * people (general chat, e-mail); the event's people look at them.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso, confirmEmail, mailsTo } = require('./helpers');
const { dbQuery, approvedBuyer } = require('./fixtures');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const admin = new Session('gl-admin');
const ctx = {};
const base = (id = ctx.ev.id) => `/api/events/${id}/gallery`;
const upload = (s, eventId = ctx.ev.id, name = 'photo.png') => s.upload(`/api/files?purpose=gallery&eventId=${eventId}`, PNG, { type: 'image/png', name });

async function createEvent(s, tag, extra = {}) {
  const r = await s.post('/api/events', {
    event_code: `${tag}${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Gallery ${tag} ${RUN_ID}`,
    registration_start: iso(-3 * DAY), registration_end: iso(-DAY), start_date: iso(-2 * DAY), end_date: iso(-DAY),
    is_published: true, ...extra,
  });
  assert.equal(r.status, 201, r.text);
  return r.data;
}

async function participant(tag, { approve = true } = {}) {
  const s = new Session(tag);
  await dbQuery("UPDATE events SET registration_end = now() + interval '1 day', end_date = now() + interval '2 days' WHERE id = $1", [ctx.ev.id]);
  const r = await s.post(`/api/public/events/${ctx.ev.slug}/register`, {
    account: { fullName: `Person ${tag}`, email: email(tag), password: 'Test1234!' },
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
  return { s, userId, mail: email(tag) };
}

test('setup: a finished event, its people, outsiders, a Starter-plan event', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  ctx.ev = await createEvent(admin, 'GL');
  ctx.ev.slug = (await dbQuery('SELECT slug FROM events WHERE id = $1', [ctx.ev.id])).rows[0].slug;
  ctx.ok = await participant('gl-ok');
  ctx.pending = await participant('gl-pend', { approve: false });
  await dbQuery("UPDATE events SET registration_end = now() - interval '1 day', end_date = now() - interval '1 hour' WHERE id = $1", [ctx.ev.id]);
  await admin.post(`/api/events/${ctx.ev.id}/invites`, { email: email('gl-judge'), role: 'judge' });
  ctx.judge = new Session('gl-judge');
  await ctx.judge.register({ fullName: 'Judge Gallery', email: email('gl-judge'), eventCode: ctx.ev.event_code });
  ctx.outsider = new Session('gl-out');
  await ctx.outsider.register({ fullName: 'Not In It', email: email('gl-out') });
  ctx.other = await approvedBuyer('gl-other', { plan: 'business' });
  ctx.starter = await approvedBuyer('gl-starter');
  ctx.starterEv = await createEvent(ctx.starter.session, 'GS');
});

test('the plan decides: no gallery on Starter', async () => {
  let r = await ctx.starter.session.get(base(ctx.starterEv.id));
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'MODULE_DISABLED');
  r = await upload(ctx.starter.session, ctx.starterEv.id);
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'MODULE_DISABLED');
  const slug = (await dbQuery('SELECT slug FROM events WHERE id = $1', [ctx.starterEv.id])).rows[0].slug;
  r = await ctx.starter.session.get(`/api/gallery/${slug}`);
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'MODULE_DISABLED');
});

test('only the organisers upload gallery photos', async () => {
  let r = await upload(ctx.ok.s);
  assert.equal(r.status, 404, `participant: ${r.text}`);
  r = await upload(ctx.other.session);
  assert.equal(r.status, 404, `another organisation: ${r.text}`);
  r = await upload(new Session('anon'));
  assert.equal(r.status, 401);
  r = await upload(admin, ctx.ev.id, 'Açılış.png');
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.purpose, 'gallery');
  assert.equal(r.data.isPublic, true);
  ctx.f1 = r.data.id;
  ctx.f2 = (await upload(admin)).data.id;
  ctx.f3 = (await upload(admin)).data.id;
  r = await admin.upload(`/api/files?purpose=sponsor_logo&eventId=${ctx.ev.id}`, PNG, { type: 'image/png' });
  ctx.logo = r.data.id;
});

test('nothing to share in an empty gallery', async () => {
  const r = await admin.post(`${base()}/share`, { chat: true });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'GALLERY_EMPTY');
});

test('organisers add uploaded photos; nobody else can', async () => {
  let r = await ctx.ok.s.post(base(), { fileIds: [ctx.f1] });
  assert.equal(r.status, 403, `a participant reads but does not manage: ${r.text}`);
  r = await ctx.pending.s.post(base(), { fileIds: [ctx.f1] });
  assert.equal(r.status, 404);
  r = await admin.post(base(), { fileIds: [ctx.logo] });
  assert.equal(r.status, 400, 'not a gallery upload');
  r = await admin.post(base(), { fileIds: [] });
  assert.equal(r.status, 400);
  r = await admin.post(base(), { fileIds: [ctx.f1, ctx.f2, ctx.f1] });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.added, 2);
  assert.deepEqual(r.data.items.map((i) => i.fileId), [ctx.f1, ctx.f2]);
  assert.deepEqual(r.data.items.map((i) => i.position), [1, 2]);
  r = await admin.post(base(), { fileIds: [ctx.f2, ctx.f3] });
  assert.equal(r.data.added, 1, 'already there once');
  assert.equal(r.data.items.length, 3);
  ctx.items = r.data.items;
  assert.equal(r.data.canManage, true);
  assert.equal(r.data.eventSlug, ctx.ev.slug);
});

test('the event\'s people see it; others do not', async () => {
  for (const [who, s] of [['participant', ctx.ok.s], ['judge', ctx.judge]]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await s.get(base());
    assert.equal(r.status, 200, `${who}: ${r.text}`);
    assert.equal(r.data.canManage, false, who);
    assert.equal(r.data.items.length, 3, who);
    assert.equal(r.data.items[0].url, `/api/files/${ctx.f1}`);
  }
  for (const [who, s] of [['pending', ctx.pending.s], ['outsider', ctx.outsider], ['another organisation', ctx.other.session]]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await s.get(base());
    assert.equal(r.status, 404, `${who}: ${r.text}`);
  }
  assert.equal((await new Session('anon').get(base())).status, 401);

  let r = await ctx.ok.s.get(`/api/gallery/${ctx.ev.slug}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.eventId, ctx.ev.id);
  assert.equal(r.data.items.length, 3);
  r = await ctx.pending.s.get(`/api/gallery/${ctx.ev.slug}`);
  assert.equal(r.status, 404);
  r = await new Session('anon').get(`/api/gallery/${ctx.ev.slug}`);
  assert.equal(r.status, 401);
  r = await ctx.ok.s.get('/api/gallery/no-such-event-anywhere');
  assert.equal(r.status, 404);

  const pub = await new Session('anon').get(`/api/public/events/${ctx.ev.slug}`);
  assert.equal(pub.status, 200, pub.text);
  assert.equal(pub.data.features.gallery, true, 'the event page knows there is a gallery');
});

test('captions and order; removing a photo removes its file', async () => {
  const [a, b, c] = ctx.items;
  let r = await ctx.ok.s.patch(`${base()}/${a.id}`, { caption: 'x' });
  assert.equal(r.status, 403);
  r = await admin.patch(`${base()}/${a.id}`, { caption: '  Açılış mərasimi  ', position: 10 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.photo.caption, 'Açılış mərasimi');
  assert.deepEqual(r.data.items.map((i) => i.id), [b.id, c.id, a.id], 'ordered by position');
  r = await admin.patch(`${base()}/${a.id}`, { caption: 'c'.repeat(201) });
  assert.equal(r.status, 400);
  r = await admin.patch(`${base()}/999999999`, { caption: 'x' });
  assert.equal(r.status, 404);
  r = await admin.delete(`${base()}/${c.id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal((await new Session('anon').download(`/api/files/${ctx.f3}`)).status, 404, 'the file is gone');
  r = await admin.get(base());
  assert.equal(r.data.items.length, 2);
});

test('sharing: the general chat and an e-mail to the people who took part', async () => {
  let r = await admin.post(`${base()}/share`, {});
  assert.equal(r.status, 400, 'choose where');
  r = await admin.post(`${base()}/share`, { chat: true, message: 'm'.repeat(501) });
  assert.equal(r.status, 400);
  r = await ctx.ok.s.post(`${base()}/share`, { chat: true });
  assert.equal(r.status, 403);

  r = await admin.post(`${base()}/share`, { chat: true, email: true, message: `Şəkillər hazırdır ${RUN_ID}` });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.chat, 'sent');
  assert.equal(r.data.email, 'queued');
  assert.ok(r.data.link.endsWith(`/e/${ctx.ev.slug}/gallery`), r.data.link);

  const channels = await ctx.ok.s.get(`/api/events/${ctx.ev.id}/chat`);
  const general = channels.data.channels.find((c) => c.kind === 'general');
  const msgs = await ctx.ok.s.get(`/api/events/${ctx.ev.id}/chat/channels/${general.id}/messages`);
  const last = msgs.data.messages.at(-1);
  assert.match(last.body, new RegExp(`Şəkillər hazırdır ${RUN_ID}`));
  assert.ok(last.body.includes(`/e/${ctx.ev.slug}/gallery`));
  assert.equal(last.author.role, 'organizer');

  const ann = (await dbQuery('SELECT title, content, audience, channels FROM announcements WHERE id = $1', [r.data.announcementId])).rows[0];
  assert.equal(ann.audience, 'attendees');
  assert.ok(ann.channels.includes('email'));
  assert.equal(ann.title, 'Tədbirdən şəkillər', 'in the event\'s language');
  assert.ok(ann.content.includes(`/e/${ctx.ev.slug}/gallery`));

  r = await admin.get(base());
  assert.ok(r.data.shared.chatAt && r.data.shared.emailAt);

  // The approved participant gets the e-mail; the announcement shows in their app.
  let mail = null;
  for (let i = 0; i < 60 && !mail; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    mail = (await mailsTo(ctx.ok.mail)).find((m) => m.text.includes(`/e/${ctx.ev.slug}/gallery`));
    // eslint-disable-next-line no-await-in-loop
    if (!mail) await new Promise((done) => { setTimeout(done, 250); });
  }
  assert.ok(mail, 'the e-mail went out');
  const mine = await ctx.ok.s.get(`/api/announcements?eventId=${ctx.ev.id}`);
  assert.ok(mine.data.some((a) => a.title === 'Tədbirdən şəkillər'), 'in the app too');
  const pendingSees = await ctx.pending.s.get(`/api/announcements?eventId=${ctx.ev.id}`);
  assert.ok(!(pendingSees.data || []).some((a) => a.title === 'Tədbirdən şəkillər'), 'not for someone never admitted');

  // With the general channel switched off, the chat part says so.
  await dbQuery(
    `UPDATE events SET comms_config = jsonb_set(COALESCE(comms_config, '{}'::jsonb), '{chat}', '{"general": false, "team": true, "support": true}'::jsonb)
      WHERE id = $1`,
    [ctx.ev.id],
  );
  r = await admin.post(`${base()}/share`, { chat: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.chat, 'off');
  assert.equal(r.data.email, null);
});

test('a gallery holds at most 200 photos', async () => {
  const ev = await createEvent(admin, 'GF');
  const filler = await dbQuery(
    `INSERT INTO files (id, event_id, purpose, filename, mime, size_bytes, sha256, is_public)
     SELECT gen_random_uuid(), $1, 'gallery', 'x.png', 'image/png', 1, repeat('0', 64), true
       FROM generate_series(1, 200) RETURNING id`,
    [ev.id],
  );
  await dbQuery(
    `INSERT INTO event_gallery_photos (event_id, file_id, position)
     SELECT $1, f, row_number() OVER () FROM unnest($2::uuid[]) f`,
    [ev.id, filler.rows.map((r) => r.id)],
  );
  const extra = await upload(admin, ev.id);
  assert.equal(extra.status, 201, extra.text);
  const r = await admin.post(base(ev.id), { fileIds: [extra.data.id] });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'GALLERY_FULL');
});

test('an archived event\'s gallery is read-only', async () => {
  await dbQuery("UPDATE events SET status = 'archived', archived_at = now() WHERE id = $1", [ctx.ev.id]);
  let r = await ctx.ok.s.get(base());
  assert.equal(r.status, 200, 'still readable');
  r = await ctx.ok.s.get(`/api/gallery/${ctx.ev.slug}`);
  assert.equal(r.status, 200, 'the shared link still opens');
  r = await admin.post(base(), { fileIds: [ctx.f1] });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'EVENT_ARCHIVED');
  r = await upload(admin);
  assert.equal(r.status, 409);
  r = await admin.post(`${base()}/share`, { email: true });
  assert.equal(r.status, 409);
  r = await admin.delete(`${base()}/${ctx.items[0].id}`);
  assert.equal(r.status, 409);
});
