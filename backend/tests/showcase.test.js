/**
 * Stories from past hackathons (Phase 7): the owner writes them in the
 * console, the public site reads the published ones.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery, ownerSession, approvedBuyer } = require('./fixtures');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ctx = {};
const photo = (s, name = 'photo.png') => s.upload('/api/owner/showcase/files', PNG, { type: 'image/png', name });

test('setup: the owner, an organiser, a participant', async () => {
  ctx.owner = await ownerSession();
  ctx.org = await approvedBuyer('sc-org');
  ctx.person = new Session('sc-person');
  await ctx.person.register({ fullName: 'Story Reader', email: email('sc-person') });
});

test('only the platform owner writes stories', async () => {
  for (const [who, s, code] of [['organiser', ctx.org.session, 403], ['participant', ctx.person, 403], ['anonymous', new Session('anon'), 401]]) {
    /* eslint-disable no-await-in-loop */
    assert.equal((await s.get('/api/owner/showcase')).status, code, `${who}: list`);
    assert.equal((await s.post('/api/owner/showcase', { title: { en: 'Nope' } })).status, code, `${who}: create`);
    assert.equal((await photo(s)).status, code, `${who}: upload`);
    /* eslint-enable no-await-in-loop */
  }
});

test('story photos: images only, through the owner route alone', async () => {
  let r = await photo(ctx.owner, 'Bakı 1.png');
  assert.equal(r.status, 201, r.text);
  assert.match(r.data.id, /^[0-9a-f-]{36}$/);
  assert.equal(r.data.url, `/api/files/${r.data.id}`);
  assert.equal(r.data.mime, 'image/png');
  assert.equal(r.data.sizeBytes, PNG.length);
  ctx.p1 = r.data.id;
  ctx.p2 = (await photo(ctx.owner, 'two.png')).data.id;
  ctx.p3 = (await photo(ctx.owner, 'three.png')).data.id;
  const row = (await dbQuery('SELECT purpose, event_id, customer_id, is_public FROM files WHERE id = $1', [ctx.p1])).rows[0];
  assert.deepEqual(row, { purpose: 'showcase', event_id: null, customer_id: null, is_public: true });
  const pub = await new Session('anon').download(`/api/files/${ctx.p1}`);
  assert.equal(pub.status, 200, 'public by link');
  assert.ok(pub.body.equals(PNG));

  r = await ctx.owner.upload('/api/owner/showcase/files', Buffer.from('%PDF-1.4 not an image at all'), { type: 'application/pdf' });
  assert.equal(r.status, 415, r.text);
  // Not through the event uploads.
  const ev = await ctx.org.session.post('/api/events', {
    event_code: `SC${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Story source ${RUN_ID}`,
    registration_start: iso(-DAY), registration_end: iso(DAY), start_date: iso(2 * DAY), end_date: iso(3 * DAY),
  });
  assert.equal(ev.status, 201, ev.text);
  ctx.ev = ev.data;
  r = await ctx.org.session.upload(`/api/files?purpose=showcase&eventId=${ctx.ev.id}`, PNG, { type: 'image/png' });
  assert.equal(r.status, 400, 'no story photos through /api/files');
  r = await ctx.org.session.upload(`/api/files?purpose=sponsor_logo&eventId=${ctx.ev.id}`, PNG, { type: 'image/png' });
  assert.equal(r.status, 201, r.text);
  ctx.logo = r.data.id;
});

test('a draft: addresses from the title, in Azerbaijani and Russian too', async () => {
  let r = await ctx.owner.post('/api/owner/showcase', { title: { az: `Bakı Süni İntellekt Hakatonu ${RUN_ID}` } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.status, 'draft');
  assert.equal(r.data.slug, `baki-suni-intellekt-hakatonu-${RUN_ID}`);
  ctx.az = r.data;
  r = await ctx.owner.post('/api/owner/showcase', { title: { ru: `Хакатон Щука ${RUN_ID}` } });
  assert.equal(r.data.slug, `khakaton-shchuka-${RUN_ID}`);
  ctx.ru = r.data;
  r = await ctx.owner.post('/api/owner/showcase', { title: { en: `Хакатон Щука ${RUN_ID}` } });
  assert.equal(r.data.slug, `khakaton-shchuka-${RUN_ID}-2`, 'a free address');
  ctx.dup = r.data;
  r = await ctx.owner.post('/api/owner/showcase', {});
  assert.equal(r.status, 201, 'an empty draft is fine');
  assert.match(r.data.slug, /^story(-\d+)?$/);
  ctx.empty = r.data;
  const slugify = require('../src/services/showcase.service').slugify;
  assert.equal(slugify('ŞƏKİ Çağ Ğöy Ünvan'), 'seki-cag-goy-unvan');
  assert.equal(slugify('Ёлка — Жизнь!'), 'yolka-zhizn');
  assert.equal(slugify('!!!'), '');
});

test('what a story may hold is checked', async () => {
  const bad = async (body, field) => {
    const r = await ctx.owner.patch(`/api/owner/showcase/${ctx.az.id}`, body);
    assert.equal(r.status, 400, `${field}: ${r.text}`);
    assert.equal(r.json.code, 'VALIDATION_ERROR');
    assert.ok(r.json.errors.some((e) => e.field.startsWith(field)), `${field}: ${JSON.stringify(r.json.errors)}`);
  };
  await bad({ title: { en: 'x'.repeat(161) } }, 'title.en');
  await bad({ summary: 'just text' }, 'summary');
  await bad({ heldFrom: '2026-02-30' }, 'heldFrom');
  await bad({ heldFrom: '2026-04-27', heldTo: '2026-04-25' }, 'heldTo');
  await bad({ figures: { participants: -1 } }, 'figures.participants');
  await bad({ photos: [{ fileId: ctx.logo }] }, 'photos.0.fileId');
  await bad({ photos: [{ fileId: ctx.p1, caption: 'c'.repeat(201) }] }, 'photos.0.caption');
  await bad({ coverFileId: 'not-a-uuid' }, 'coverFileId');
  await bad({ eventId: 999999999 }, 'eventId');
  await bad({ slug: 'Not A Slug' }, 'slug');
  const r = await ctx.owner.post(`/api/owner/showcase/${ctx.empty.id}/publish`);
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'TITLE_REQUIRED');
});

test('a draft is the owner\'s alone; publishing shows it to everyone', async () => {
  const anon = new Session('anon');
  let r = await anon.get(`/api/public/showcase/${ctx.az.slug}`);
  assert.equal(r.status, 404, 'a draft is not public');

  r = await ctx.owner.patch(`/api/owner/showcase/${ctx.az.id}`, {
    title: { az: `AZCON Future Tech ${RUN_ID}`, en: `AZCON Future Tech ${RUN_ID}` },
    summary: { az: '48 saatlıq hakaton', en: 'A 48-hour hackathon' },
    body: { en: 'Day one.\r\n\r\n\r\nDay two <b>bold</b>.\u0007', az: 'Birinci gün.' },
    heldFrom: '2026-04-25', heldTo: '2026-04-27',
    location: 'Holberton School Azerbaijan, Bakı',
    organisers: 'AZCON Holding · Holberton School Azerbaijan',
    figures: { participants: 120, teams: '24', hours: 48, projects: '' },
    photos: [{ fileId: ctx.p1, caption: 'Açılış' }, { fileId: ctx.p2 }, { fileId: ctx.p1 }],
    coverFileId: ctx.p2,
    eventId: ctx.ev.id,
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.slug, `azcon-future-tech-${RUN_ID}`, 'a draft\'s address follows its title');
  assert.equal(r.data.body.en, 'Day one.\n\nDay two <b>bold</b>.', 'plain text kept as text, tidied');
  assert.deepEqual(r.data.figures, { participants: 120, teams: 24, hours: 48 });
  assert.equal(r.data.photos.length, 2, 'the same photo once');
  assert.deepEqual(r.data.photos[0], { id: ctx.p1, url: `/api/files/${ctx.p1}`, caption: 'Açılış' });
  assert.deepEqual(r.data.cover, { id: ctx.p2, url: `/api/files/${ctx.p2}` });
  assert.equal(r.data.eventId, ctx.ev.id);
  ctx.az = r.data;

  r = await ctx.owner.post(`/api/owner/showcase/${ctx.az.id}/publish`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'published');
  assert.ok(r.data.publishedAt);

  const raw = await fetch(`${process.env.API_URL || 'http://localhost:5000'}/api/public/showcase`);
  assert.match(raw.headers.get('cache-control') || '', /public, max-age=300/);
  r = await anon.get('/api/public/showcase?limit=24');
  assert.equal(r.status, 200, r.text);
  const item = r.data.items.find((i) => i.slug === ctx.az.slug);
  assert.ok(item, 'listed');
  assert.deepEqual(Object.keys(item).sort(), ['authorName', 'cover', 'coverFocus', 'figures', 'heldFrom', 'heldTo', 'location', 'organisers', 'photoCount', 'publishedAt', 'slug', 'summary', 'tags', 'title']);
  assert.deepEqual(item.coverFocus, { x: 50, y: 50 }, 'a story written before the focus point is centred');
  assert.deepEqual(item.tags, []);
  assert.equal(item.photoCount, 2);
  assert.equal(item.heldFrom, '2026-04-25');
  assert.ok(!r.data.items.some((i) => i.slug === ctx.ru.slug), 'drafts are not listed');

  r = await anon.get(`/api/public/showcase/${ctx.az.slug}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.body.az, 'Birinci gün.');
  assert.equal(r.data.bodyFormat, 'plain', 'a story saved without a format stays plain text');
  assert.equal(r.data.event, null, 'its event page is not public');
  assert.equal(r.data.photos[1].caption, null);
  assert.equal(r.data.id, undefined, 'no owner fields in public');
  assert.equal(r.data.status, undefined);
  assert.equal(r.data.eventId, undefined);

  const audit = await dbQuery("SELECT 1 FROM audit_log WHERE action = 'owner.showcase.publish' AND target_id = $1", [String(ctx.az.id)]);
  assert.equal(audit.rows.length, 1);
});

test('a published story keeps its address; the owner may change it', async () => {
  let r = await ctx.owner.patch(`/api/owner/showcase/${ctx.az.id}`, { title: { en: `Renamed ${RUN_ID}` } });
  assert.equal(r.data.slug, ctx.az.slug, 'links keep working');
  r = await ctx.owner.patch(`/api/owner/showcase/${ctx.az.id}`, { slug: ctx.ru.slug });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'SLUG_TAKEN');
  r = await ctx.owner.patch(`/api/owner/showcase/${ctx.az.id}`, { slug: `azcon-2026-${RUN_ID}` });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.slug, `azcon-2026-${RUN_ID}`);
  assert.equal((await new Session('anon').get(`/api/public/showcase/azcon-2026-${RUN_ID}`)).status, 200);
  ctx.az = r.data;
});

test('newest event first; unpublishing takes it down', async () => {
  let r = await ctx.owner.patch(`/api/owner/showcase/${ctx.ru.id}`, { heldFrom: '2025-11-01', photos: [{ fileId: ctx.p3 }] });
  assert.equal(r.status, 200, r.text);
  await ctx.owner.post(`/api/owner/showcase/${ctx.ru.id}/publish`);
  r = await new Session('anon').get('/api/public/showcase?limit=24');
  const slugs = r.data.items.map((i) => i.slug);
  assert.ok(slugs.indexOf(ctx.az.slug) < slugs.indexOf(ctx.ru.slug), 'April 2026 before November 2025');
  r = await ctx.owner.post(`/api/owner/showcase/${ctx.ru.id}/unpublish`);
  assert.equal(r.data.status, 'draft');
  assert.equal((await new Session('anon').get(`/api/public/showcase/${ctx.ru.slug}`)).status, 404);
  r = await ctx.owner.get('/api/owner/showcase');
  assert.equal(r.status, 200);
  assert.ok(r.data.some((s) => s.id === ctx.ru.id && s.status === 'draft'));
});

test('deleting a story removes it and its photos', async () => {
  let r = await ctx.owner.delete(`/api/owner/showcase/${ctx.az.id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.removedFiles, 2);
  assert.equal((await ctx.owner.get(`/api/owner/showcase/${ctx.az.id}`)).status, 404);
  assert.equal((await new Session('anon').get(`/api/public/showcase/${ctx.az.slug}`)).status, 404);
  assert.equal((await new Session('anon').download(`/api/files/${ctx.p1}`)).status, 404);
  assert.equal((await new Session('anon').download(`/api/files/${ctx.p2}`)).status, 404);
  assert.equal((await new Session('anon').download(`/api/files/${ctx.p3}`)).status, 200, 'another story\'s photo stays');
  for (const s of [ctx.ru, ctx.dup, ctx.empty]) {
    // eslint-disable-next-line no-await-in-loop
    r = await ctx.owner.delete(`/api/owner/showcase/${s.id}`);
    assert.equal(r.status, 200, r.text);
  }
});
