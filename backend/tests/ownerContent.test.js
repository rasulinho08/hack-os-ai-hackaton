/**
 * The owner console's content management (Phase 11): the owner edits any
 * customer's event page through the builder's own checks, renames it without
 * breaking its old links, pins events to the top of the directory, marks
 * tests (gone from the directory and the figures), publishes, unpublishes,
 * archives; and writes stories that publish on a schedule. Only the owner
 * may do any of it, and every change is in the audit trail.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, DAY, iso } = require('./helpers');
const { dbQuery, ownerSession } = require('./fixtures');

const admin = new Session('oc-admin');
const anon = new Session('oc-anon');
const ctx = { ev: {} };
const TAG = `oc${RUN_ID}`;
const dir = (qs = '') => anon.get(`/api/public/directory?q=${TAG}${qs}`);
const slugsOf = (r) => r.data.items.map((x) => x.slug);
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function makeEvent(key, { start, end, regStart, regEnd }) {
  const code = `${TAG}${key}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  let r = await admin.post('/api/events', {
    event_code: code, name: `Owner content ${key} ${TAG}`,
    registration_start: regStart, registration_end: regEnd, start_date: start, end_date: end,
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  const slug = `${TAG}-${key}`.toLowerCase();
  r = await admin.patch(`/api/events/${r.data.id}/builder`, { slug, format: 'online', directory_listed: true, tagline: `Tagline ${key}` });
  assert.equal(r.status, 200, r.text);
  ctx.ev[key] = { id: r.data.event.id, slug };
  return ctx.ev[key];
}

/** The newest audit rows of one action about one target. */
const auditOf = async (action, targetId) => (await dbQuery(
  `SELECT actor_user_id, event_id, customer_id, target_type, target_id, meta FROM audit_log
    WHERE action = $1 AND target_id = $2 ORDER BY id DESC`,
  [action, String(targetId)],
)).rows;

test('setup: the owner, an organiser and three listed events', async () => {
  ctx.owner = await ownerSession();
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  await makeEvent('a', { regStart: iso(-DAY), regEnd: iso(5 * DAY), start: iso(7 * DAY), end: iso(8 * DAY) });
  await makeEvent('b', { regStart: iso(-DAY), regEnd: iso(6 * DAY), start: iso(9 * DAY), end: iso(10 * DAY) });
  await makeEvent('c', { regStart: iso(-DAY), regEnd: iso(7 * DAY), start: iso(11 * DAY), end: iso(12 * DAY) });
  const r = await dir();
  assert.deepEqual(slugsOf(r), ['a', 'b', 'c'].map((k) => ctx.ev[k].slug));
});

test('only the platform owner: an organiser is refused (403), a visitor too (401)', async () => {
  const id = ctx.ev.a.id;
  const calls = [
    ['get', `/api/owner/events/${id}/page`],
    ['patch', `/api/owner/events/${id}/page`, { name: 'Taken over' }],
    ['patch', `/api/owner/events/${id}/flags`, { featured: true }],
    ['post', `/api/owner/events/${id}/unpublish`, {}],
    ['post', `/api/owner/events/${id}/archive`, {}],
    ['post', '/api/owner/showcase/1/schedule', { publishAt: iso(DAY) }],
  ];
  for (const [who, s, code] of [['organiser', admin, 403], ['anonymous', anon, 401]]) {
    for (const [method, path, body] of calls) {
      // eslint-disable-next-line no-await-in-loop
      const r = await s[method](path, body);
      assert.equal(r.status, code, `${who}: ${method} ${path}`);
    }
  }
  const page = await ctx.owner.get(`/api/owner/events/${id}`);
  assert.equal(page.status, 200);
  assert.equal(page.data.event.name, `Owner content a ${TAG}`);
});

test('the editor answers the page fields and why the event is (not) listed', async () => {
  const r = await ctx.owner.get(`/api/owner/events/${ctx.ev.a.id}/page`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.slug, ctx.ev.a.slug);
  assert.equal(r.data.visibility, 'public');
  assert.deepEqual(r.data.directory, { listed: true, blockers: [] });
  assert.equal(r.data.is_test, false);
  assert.equal(r.data.directory_featured, false);
  assert.ok(Array.isArray(r.data.old_slugs));
  assert.equal(typeof r.data.checklist.ready, 'boolean');
});

test('edits are checked like the builder: no impossible schedule, no foreign fields', async () => {
  const path = `/api/owner/events/${ctx.ev.a.id}/page`;
  let r = await ctx.owner.patch(path, { end_date: iso(6 * DAY) });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.errors[0].field, 'end_date');
  r = await ctx.owner.patch(path, { registration_end: iso(30 * DAY) });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.errors[0].field, 'registration_end');
  r = await ctx.owner.patch(path, { timezone: 'Mars/Olympus' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.errors[0].field, 'timezone');
  r = await ctx.owner.patch(path, { slug: '-Bad Slug-' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.errors[0].field, 'slug');
  r = await ctx.owner.patch(path, { slug: ctx.ev.b.slug });
  assert.equal(r.status, 400, 'another event has this address');
  r = await ctx.owner.patch(path, { visibility: 'secret' });
  assert.equal(r.status, 400);
  r = await ctx.owner.patch(path, { rules: 'Owner rules', is_published: true });
  assert.equal(r.status, 400, r.text);
  assert.deepEqual(r.json.errors.map((e) => e.field).sort(), ['is_published', 'rules']);
  // Nothing was saved by any of these.
  const page = await ctx.owner.get(path);
  assert.equal(page.data.slug, ctx.ev.a.slug);
  assert.ok(new Date(page.data.end_date) > new Date(page.data.start_date));
});

test('the owner edits the page; the public page shows it and the audit trail says what changed', async () => {
  const r = await ctx.owner.patch(`/api/owner/events/${ctx.ev.a.id}/page`, {
    name: `Renamed by owner ${TAG}`, tagline: 'Fixed by HackOS', max_participants: 120, city: 'Bakı',
  });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.changed.sort(), ['city', 'max_participants', 'name', 'tagline']);
  const pub = await anon.get(`/api/public/events/${ctx.ev.a.slug}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.name, `Renamed by owner ${TAG}`);
  assert.equal(pub.data.tagline, 'Fixed by HackOS');
  const rows = await auditOf('owner.event.update', ctx.ev.a.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_id, ctx.ev.a.id);
  assert.equal(rows[0].target_type, 'event');
  assert.deepEqual(rows[0].meta.fields.sort(), ['city', 'max_participants', 'name', 'tagline']);
  // A save that changes nothing writes nothing.
  const same = await ctx.owner.patch(`/api/owner/events/${ctx.ev.a.id}/page`, { tagline: 'Fixed by HackOS' });
  assert.equal(same.status, 200);
  assert.deepEqual(same.data.changed, []);
  assert.equal((await auditOf('owner.event.update', ctx.ev.a.id)).length, 1);
});

test('a new address keeps the old one working, and nobody else can take it', async () => {
  const from = ctx.ev.a.slug;
  const to = `${TAG}-renamed`;
  let r = await ctx.owner.patch(`/api/owner/events/${ctx.ev.a.id}/page`, { slug: to });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.changed, ['slug']);
  assert.equal(r.data.event.old_slugs[0].slug, from, 'the address it had is remembered first');
  ctx.ev.a.slug = to;

  const now = await anon.get(`/api/public/events/${to}`);
  assert.equal(now.status, 200);
  assert.equal(now.data.slug, to);
  assert.equal(now.data.moved_from, undefined);
  const old = await anon.get(`/api/public/events/${from}`);
  assert.equal(old.status, 200, 'the old address still finds the event');
  assert.equal(old.data.id, ctx.ev.a.id);
  assert.equal(old.data.slug, to, 'with the address to redirect to');
  assert.equal(old.data.moved_from, from);

  // The old address stays this event's: another event cannot take it…
  r = await admin.patch(`/api/events/${ctx.ev.c.id}/builder`, { slug: from });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.errors[0].field, 'slug');
  // …but the event itself can go back to it.
  r = await ctx.owner.patch(`/api/owner/events/${ctx.ev.a.id}/page`, { slug: from });
  assert.equal(r.status, 200, r.text);
  const remembered = r.data.event.old_slugs.map((s) => s.slug);
  assert.equal(remembered[0], to);
  assert.ok(!remembered.includes(from), 'the address in use is not an old one');
  ctx.ev.a.slug = from;
  assert.equal((await anon.get(`/api/public/events/${to}`)).data.moved_from, to);

  const rows = await auditOf('owner.event.update', ctx.ev.a.id);
  assert.deepEqual(rows[1].meta.slug, { from, to });
});

test('featured events come first in the directory, in the owner\'s order', async () => {
  let r = await ctx.owner.patch(`/api/owner/events/${ctx.ev.c.id}/flags`, { featured: true, featuredRank: 2 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.directory_featured, true);
  r = await ctx.owner.patch(`/api/owner/events/${ctx.ev.b.id}/flags`, { featured: true, featuredRank: 1 });
  assert.equal(r.status, 200, r.text);
  r = await dir();
  assert.deepEqual(slugsOf(r), ['b', 'c', 'a'].map((k) => ctx.ev[k].slug));
  assert.deepEqual(r.data.items.map((x) => x.featured), [true, true, false]);
  // A filter keeps the pins on top of what matches.
  r = await dir('&status=open');
  assert.deepEqual(slugsOf(r), ['b', 'c', 'a'].map((k) => ctx.ev[k].slug));

  r = await ctx.owner.patch(`/api/owner/events/${ctx.ev.c.id}/flags`, { featuredRank: 0 });
  assert.equal(r.status, 400, 'a rank is 1 to 999');
  r = await ctx.owner.patch(`/api/owner/events/${ctx.ev.b.id}/flags`, { featured: false });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.directory_featured_rank, null, 'unpinning clears the rank');
  r = await dir();
  assert.deepEqual(slugsOf(r), ['c', 'a', 'b'].map((k) => ctx.ev[k].slug));

  // Pinning never lists an event its organiser took off.
  await admin.patch(`/api/events/${ctx.ev.c.id}/builder`, { directory_listed: false });
  r = await dir();
  assert.deepEqual(slugsOf(r), ['a', 'b'].map((k) => ctx.ev[k].slug));
  await admin.patch(`/api/events/${ctx.ev.c.id}/builder`, { directory_listed: true });

  const feature = await auditOf('owner.event.feature', ctx.ev.b.id);
  assert.equal(feature.length, 1);
  assert.equal(feature[0].meta.rank, 1);
  assert.equal((await auditOf('owner.event.unfeature', ctx.ev.b.id)).length, 1);
});

test('the console lists events by directory state and test marks', async () => {
  let r = await ctx.owner.get(`/api/owner/events?q=${TAG}&featured=yes`);
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.rows.map((x) => x.id), [ctx.ev.c.id]);
  r = await ctx.owner.get(`/api/owner/events?q=${TAG}&visibility=private`);
  assert.equal(r.data.total, 0);
  r = await ctx.owner.get(`/api/owner/events?q=${TAG}&listed=yes&archived=hide&sort=featured&dir=asc`);
  assert.equal(r.data.total, 3);
  assert.equal(r.data.rows[0].id, ctx.ev.c.id, 'pinned first');
  assert.ok(r.data.rows.every((x) => typeof x.test_looking === 'boolean' && x.visibility === 'public'));
});

test('a test event leaves the directory, the public figures and the console statistics', async () => {
  let r = await ctx.owner.patch(`/api/owner/events/${ctx.ev.c.id}/flags`, { isTest: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.is_test, true);
  assert.equal(r.data.event.directory_featured, false, 'a test is unpinned');
  assert.deepEqual(r.data.event.directory.blockers, ['test']);
  r = await dir();
  assert.deepEqual(slugsOf(r), ['a', 'b'].map((k) => ctx.ev[k].slug));
  const slugs = (await anon.get('/api/public/directory/slugs')).data.map((x) => x.slug);
  assert.ok(!slugs.includes(ctx.ev.c.slug), 'not in the sitemap');
  // The page itself still works: a test is often a rehearsal.
  assert.equal((await anon.get(`/api/public/events/${ctx.ev.c.slug}`)).status, 200);

  const marked = (await anon.get('/api/public/stats')).data;
  const statsMarked = (await ctx.owner.get('/api/owner/analytics')).data;
  r = await ctx.owner.patch(`/api/owner/events/${ctx.ev.c.id}/flags`, { isTest: false });
  assert.equal(r.status, 200, r.text);
  const unmarked = (await anon.get('/api/public/stats')).data;
  const statsUnmarked = (await ctx.owner.get('/api/owner/analytics')).data;
  assert.equal(unmarked.events - marked.events, 1, 'the public count of events');
  assert.equal(statsUnmarked.totals.events - statsMarked.totals.events, 1, 'the console analytics');
  assert.ok(!statsMarked.topEvents.some((e) => e.id === ctx.ev.c.id) || statsMarked.topEvents.length < 12);
  assert.equal(slugsOf(await dir()).length, 3);

  assert.equal((await auditOf('owner.event.mark_test', ctx.ev.c.id)).length, 1);
  assert.equal((await auditOf('owner.event.unmark_test', ctx.ev.c.id)).length, 1);
});

test('unpublish, publish, archive and unarchive, each audited; an archived event is not edited', async () => {
  const id = ctx.ev.b.id;
  let r = await ctx.owner.post(`/api/owner/events/${id}/unpublish`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.is_published, false);
  assert.equal((await anon.get(`/api/public/events/${ctx.ev.b.slug}`)).status, 404);
  assert.ok(!slugsOf(await dir()).includes(ctx.ev.b.slug));
  r = await ctx.owner.post(`/api/owner/events/${id}/publish`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal((await anon.get(`/api/public/events/${ctx.ev.b.slug}`)).status, 200);

  r = await ctx.owner.post(`/api/owner/events/${id}/archive`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.archived, true);
  assert.ok(r.data.event.directory.blockers.includes('archived'));
  r = await ctx.owner.patch(`/api/owner/events/${id}/page`, { tagline: 'Changed while archived' });
  assert.equal(r.status, 409, r.text);
  assert.equal((await dbQuery('SELECT COUNT(*)::int AS n FROM events WHERE id = $1', [id])).rows[0].n, 1, 'never deleted');
  r = await ctx.owner.post(`/api/owner/events/${id}/unarchive`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.archived, false);

  for (const action of ['unpublish', 'publish', 'archive', 'unarchive']) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await auditOf(`owner.event.${action}`, id);
    assert.equal(rows.length, 1, action);
    assert.equal(rows[0].event_id, id);
  }
});

/* ── Stories ────────────────────────────────────────────────────────────── */

test('a draft is never public; a rich story keeps only safe links and its own photos', async () => {
  let r = await ctx.owner.post('/api/owner/showcase', {
    title: { en: `Scheduled story ${TAG}` }, bodyFormat: 'rich',
    body: { en: '## Heading\n\n- one\n- two\n\n[bad](javascript:alert(1))' },
  });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.errors[0].field, 'body.en');
  r = await ctx.owner.post('/api/owner/showcase', {
    title: { en: `Scheduled story ${TAG}` }, bodyFormat: 'rich',
    body: { en: '![x](00000000-0000-4000-8000-000000000000)' },
  });
  assert.equal(r.status, 400, 'an image that is not a story photo');

  r = await ctx.owner.post('/api/owner/showcase', {
    title: { en: `Scheduled story ${TAG}`, az: `Planlı hekayə ${TAG}` },
    bodyFormat: 'rich',
    body: { en: '## What happened\n\n> A quote\n\n1. First\n2. Second\n\nSee [the event](/hackathons) and **more**.' },
    tags: ['AI', 'ai', 'Baku'],
    authorName: 'HackOS team',
    seoTitle: { en: 'SEO title' },
    seoDescription: { en: 'SEO description' },
    coverFocus: { x: 30, y: 70 },
    eventId: ctx.ev.a.id,
  });
  assert.equal(r.status, 201, r.text);
  ctx.story = r.data;
  assert.equal(r.data.status, 'draft');
  assert.equal(r.data.bodyFormat, 'rich');
  assert.deepEqual(r.data.tags, ['AI', 'Baku']);
  assert.deepEqual(r.data.coverFocus, { x: 30, y: 70 });
  assert.equal((await anon.get(`/api/public/showcase/${ctx.story.slug}`)).status, 404, 'a draft is not public');
  const list = await anon.get('/api/public/showcase?limit=24');
  assert.ok(!list.data.items.some((s) => s.slug === ctx.story.slug));
  // A body sent alone keeps the story's format.
  r = await ctx.owner.patch(`/api/owner/showcase/${ctx.story.id}`, { body: { en: '## Still rich\n\nText.' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.bodyFormat, 'rich');
});

test('a scheduled story is not public before its time, and the job publishes it then', async () => {
  const at = new Date(Date.now() + 4000).toISOString();
  let r = await ctx.owner.post(`/api/owner/showcase/${ctx.story.id}/schedule`, { publishAt: at });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'scheduled');
  assert.equal(r.data.live, false);
  assert.equal(new Date(r.data.publishAt).getTime(), new Date(at).getTime());
  assert.equal((await anon.get(`/api/public/showcase/${ctx.story.slug}`)).status, 404, 'not before its time');
  const job = (await dbQuery("SELECT status FROM jobs WHERE type = 'showcase.publish' AND dedupe_key LIKE $1", [`showcase.publish:${ctx.story.id}:%`])).rows;
  assert.equal(job.length, 1, 'one job in the queue');

  let story = null;
  for (let i = 0; i < 30; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(1000);
    // eslint-disable-next-line no-await-in-loop
    story = (await ctx.owner.get(`/api/owner/showcase/${ctx.story.id}`)).data;
    if (story.status === 'published') break;
  }
  assert.equal(story.status, 'published', 'the job published it');
  const pub = await anon.get(`/api/public/showcase/${ctx.story.slug}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.data.bodyFormat, 'rich');
  assert.deepEqual(pub.data.tags, ['AI', 'Baku']);
  assert.equal(pub.data.authorName, 'HackOS team');
  assert.deepEqual(pub.data.seoTitle, { en: 'SEO title' });
  assert.deepEqual(pub.data.event, { name: `Renamed by owner ${TAG}`, slug: ctx.ev.a.slug });
  const tagged = await anon.get('/api/public/showcase?tag=baku&limit=24');
  assert.ok(tagged.data.items.some((s) => s.slug === ctx.story.slug), 'found by its tag');
  assert.equal((await auditOf('owner.showcase.schedule', ctx.story.id)).length, 1);
  assert.equal((await auditOf('owner.showcase.publish_scheduled', ctx.story.id)).length, 1);
});

test('unpublishing cancels a schedule; a time already past publishes at once; no title, no schedule', async () => {
  let r = await ctx.owner.post(`/api/owner/showcase/${ctx.story.id}/unpublish`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'draft');
  r = await ctx.owner.post(`/api/owner/showcase/${ctx.story.id}/schedule`, { publishAt: new Date(Date.now() + 3000).toISOString() });
  assert.equal(r.data.status, 'scheduled');
  r = await ctx.owner.post(`/api/owner/showcase/${ctx.story.id}/unpublish`, {});
  assert.equal(r.data.status, 'draft');
  assert.equal(r.data.publishAt, null);
  await sleep(6000);
  r = await ctx.owner.get(`/api/owner/showcase/${ctx.story.id}`);
  assert.equal(r.data.status, 'draft', 'the cancelled job did not publish it');
  assert.equal((await anon.get(`/api/public/showcase/${ctx.story.slug}`)).status, 404);

  r = await ctx.owner.post(`/api/owner/showcase/${ctx.story.id}/schedule`, { publishAt: new Date(Date.now() - 60000).toISOString() });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.status, 'published', 'a past time publishes now');
  r = await ctx.owner.post(`/api/owner/showcase/${ctx.story.id}/schedule`, { publishAt: new Date(Date.now() + DAY).toISOString() });
  assert.equal(r.status, 409, 'already published');
  r = await ctx.owner.post(`/api/owner/showcase/${ctx.story.id}/schedule`, { publishAt: 'tomorrow-ish' });
  assert.equal(r.status, 400);

  const empty = await ctx.owner.post('/api/owner/showcase', { summary: { en: 'No title' } });
  r = await ctx.owner.post(`/api/owner/showcase/${empty.data.id}/schedule`, { publishAt: new Date(Date.now() + DAY).toISOString() });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'TITLE_REQUIRED');
  await ctx.owner.delete(`/api/owner/showcase/${empty.data.id}`);
});
