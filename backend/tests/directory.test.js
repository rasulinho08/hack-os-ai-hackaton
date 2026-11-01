/**
 * The public directory of hackathons and who can find an event:
 * only published, public events their organiser left listed appear (a
 * draft, a private, an invite-only, an unlisted or an archived one never
 * does, and changes show at once despite the cache); the answer names no
 * person; filters, search, order and pages; an invite-only event takes only
 * invited addresses; a private event is missing from the anonymous event
 * list; the builder refuses an unknown visibility.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, email, DAY, iso } = require('./helpers');
const { dbQuery } = require('./fixtures');

const admin = new Session('dir-admin');
const anon = new Session('dir-anon');
const ctx = { ev: {} };
const TAG = `dir${RUN_ID}`;
const dir = (qs = '') => anon.get(`/api/public/directory?q=${TAG}${qs}`);
const slugsOf = (r) => r.data.items.map((x) => x.slug);

/** Every key and every string anywhere in a JSON value. */
function walk(value, keys = new Set(), strings = []) {
  if (Array.isArray(value)) value.forEach((v) => walk(v, keys, strings));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { keys.add(k); walk(v, keys, strings); }
  } else if (typeof value === 'string') strings.push(value);
  return { keys, strings };
}

async function makeEvent(key, { start, end, regStart, regEnd, format = 'offline', city = null, visibility }) {
  const code = `${TAG}${key}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  let r = await admin.post('/api/events', {
    event_code: code, name: `Directory ${key} ${TAG}`,
    registration_start: regStart, registration_end: regEnd, start_date: start, end_date: end,
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  const ev = r.data;
  const patch = { format, slug: `${TAG}-${key}`.toLowerCase(), tagline: `Tagline ${key}` };
  if (city) patch.city = city;
  if (visibility) patch.visibility = visibility;
  r = await admin.patch(`/api/events/${ev.id}/builder`, patch);
  assert.equal(r.status, 200, r.text);
  ctx.ev[key] = { ...ev, slug: patch.slug };
  return ctx.ev[key];
}

test('setup: events in every phase, format and visibility', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  await makeEvent('open', { regStart: iso(-DAY), regEnd: iso(5 * DAY), start: iso(7 * DAY), end: iso(8 * DAY), format: 'hybrid', city: 'Gəncə' });
  await makeEvent('soon', { regStart: iso(3 * DAY), regEnd: iso(9 * DAY), start: iso(10 * DAY), end: iso(11 * DAY), format: 'online' });
  await makeEvent('live', { regStart: iso(-9 * DAY), regEnd: iso(-2 * DAY), start: iso(-DAY), end: iso(DAY), city: 'Bakı' });
  await makeEvent('done', { regStart: iso(-20 * DAY), regEnd: iso(-12 * DAY), start: iso(-10 * DAY), end: iso(-9 * DAY), city: 'Bakı' });
  await makeEvent('private', { regStart: iso(-DAY), regEnd: iso(5 * DAY), start: iso(7 * DAY), end: iso(8 * DAY), visibility: 'private' });
  await makeEvent('invite', { regStart: iso(-DAY), regEnd: iso(5 * DAY), start: iso(7 * DAY), end: iso(8 * DAY), visibility: 'invite' });
  // A registered participant whose name and address must never show.
  const r = await anon.post(`/api/public/events/${ctx.ev.open.slug}/register`, {
    account: { fullName: `Secret Person ${TAG}`, email: email('dir-person'), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
});

test('lists the public events, registration open first, then upcoming, running, finished', async () => {
  const r = await dir();
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(slugsOf(r), ['open', 'soon', 'live', 'done'].map((k) => ctx.ev[k].slug));
  assert.deepEqual(r.data.items.map((x) => x.phase), ['open', 'upcoming', 'running', 'past']);
  assert.equal(r.data.total, 4);
  assert.equal(r.data.page, 1);
  assert.equal(r.data.pages, 1);
});

test('a card holds the event page facts and the link', async () => {
  const card = (await dir('&status=open')).data.items[0];
  assert.equal(card.slug, ctx.ev.open.slug);
  assert.equal(card.url, `/e/${ctx.ev.open.slug}`);
  assert.equal(card.name, `Directory open ${TAG}`);
  assert.equal(card.format, 'hybrid');
  assert.equal(card.city, 'Gəncə');
  assert.deepEqual(card.teamSize, { min: 1, max: 4 });
  assert.equal(card.registration.open, true);
  assert.ok(card.registration.closesAt);
  assert.ok(card.startDate && card.endDate);
  assert.ok('cover' in card && 'organiser' in card);
});

test('no personal data: no ids, e-mails, phones or participant names anywhere in the answer', async () => {
  const r = await dir();
  const { keys, strings } = walk(r.json);
  for (const k of ['id', 'email', 'phone', 'full_name', 'fullName', 'created_by', 'customer_id', 'participants', 'user_id', 'event_code', 'online_url']) {
    assert.ok(!keys.has(k), `key ${k} must not be in the directory`);
  }
  const all = strings.join('\n');
  assert.ok(!all.includes('Secret Person'), 'a participant name leaked');
  assert.ok(!/@/.test(all), 'an e-mail address leaked');
});

test('private and invite-only events never appear, whatever the switch says', async () => {
  for (const key of ['private', 'invite']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await admin.patch(`/api/events/${ctx.ev[key].id}/builder`, { directory_listed: true });
    assert.equal(r.status, 200, r.text);
  }
  const slugs = slugsOf(await dir());
  assert.ok(!slugs.includes(ctx.ev.private.slug));
  assert.ok(!slugs.includes(ctx.ev.invite.slug));
});

test('the organiser takes an event off the directory, and it is gone at once (cache or not)', async () => {
  assert.ok(slugsOf(await dir()).includes(ctx.ev.soon.slug));
  let r = await admin.patch(`/api/events/${ctx.ev.soon.id}/builder`, { directoryListed: false });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.event.directory_listed, false);
  assert.ok(!slugsOf(await dir()).includes(ctx.ev.soon.slug));
  r = await admin.patch(`/api/events/${ctx.ev.soon.id}/builder`, { directoryListed: true });
  assert.equal(r.status, 200, r.text);
  assert.ok(slugsOf(await dir()).includes(ctx.ev.soon.slug));
});

test('an unpublished (draft) or archived event never appears', async () => {
  let r = await admin.post(`/api/events/${ctx.ev.soon.id}/builder/unpublish`, {});
  assert.equal(r.status, 200, r.text);
  assert.ok(!slugsOf(await dir()).includes(ctx.ev.soon.slug));
  await dbQuery("UPDATE events SET is_published = true, status = 'upcoming' WHERE id = $1", [ctx.ev.soon.id]);
  r = await admin.post(`/api/events/${ctx.ev.done.id}/archive`, {});
  assert.equal(r.status, 200, r.text);
  assert.ok(!slugsOf(await dir()).includes(ctx.ev.done.slug));
  await dbQuery("UPDATE events SET status = 'upcoming', archived_at = NULL WHERE id = $1", [ctx.ev.done.id]);
  assert.ok(slugsOf(await dir()).includes(ctx.ev.done.slug));
});

test('filters: status, format, city; search; facets count the listed events', async () => {
  assert.deepEqual(slugsOf(await dir('&status=open')), [ctx.ev.open.slug]);
  assert.deepEqual(slugsOf(await dir('&status=upcoming')), [ctx.ev.open.slug, ctx.ev.soon.slug]);
  assert.deepEqual(slugsOf(await dir('&status=running')), [ctx.ev.live.slug]);
  assert.deepEqual(slugsOf(await dir('&status=past')), [ctx.ev.done.slug]);
  assert.deepEqual(slugsOf(await dir('&format=online')), [ctx.ev.soon.slug]);
  assert.deepEqual(slugsOf(await dir('&city=bakı')).sort(), [ctx.ev.live.slug, ctx.ev.done.slug].sort());
  assert.deepEqual(slugsOf(await dir('&status=past&city=Bakı')), [ctx.ev.done.slug]);
  // Unknown values are dropped, not refused.
  const loose = await dir('&status=whatever&format=space');
  assert.equal(loose.status, 200);
  assert.equal(loose.data.total, 4);
  // Search matches the tagline too, and % or _ match only themselves.
  assert.equal((await anon.get(`/api/public/directory?q=${encodeURIComponent('Tagline live')}`)).data.items.some((x) => x.slug === ctx.ev.live.slug), true);
  assert.equal((await anon.get(`/api/public/directory?q=${encodeURIComponent('%%%_%')}`)).data.total, 0);
  const all = await anon.get('/api/public/directory');
  assert.ok(all.data.facets.total >= 4);
  assert.ok(all.data.facets.formats.hybrid >= 1);
  assert.ok(all.data.facets.cities.some((c) => c.name.toLowerCase() === 'gəncə'));
});

test('pages: limit and page, with the total and the number of pages', async () => {
  const p1 = await dir('&limit=3&page=1');
  const p2 = await dir('&limit=3&page=2');
  assert.equal(p1.data.items.length, 3);
  assert.equal(p2.data.items.length, 1);
  assert.equal(p1.data.total, 4);
  assert.equal(p1.data.pages, 2);
  assert.equal(p2.data.items[0].slug, ctx.ev.done.slug);
  const capped = await anon.get('/api/public/directory?limit=1000&page=-4');
  assert.equal(capped.data.limit, 48);
  assert.equal(capped.data.page, 1);
});

test('cached publicly for a minute; open to anyone', async () => {
  const res = await fetch(`${process.env.API_URL || 'http://localhost:5000'}/api/public/directory?q=${TAG}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /public, max-age=60/);
  const slugs = await anon.get('/api/public/directory/slugs');
  assert.equal(slugs.status, 200, slugs.text);
  assert.ok(slugs.data.some((x) => x.slug === ctx.ev.open.slug));
  assert.ok(!slugs.data.some((x) => x.slug === ctx.ev.private.slug));
});

test('an invite-only event takes only invited addresses', async () => {
  let r = await new Session('dir-stranger').post(`/api/public/events/${ctx.ev.invite.slug}/register`, {
    account: { fullName: 'Stranger', email: email('dir-stranger'), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, 'INVITE_ONLY');
  r = await admin.post(`/api/events/${ctx.ev.invite.id}/invites`, { email: email('dir-guest'), role: 'hacker' });
  assert.ok([200, 201].includes(r.status), r.text);
  r = await new Session('dir-guest').post(`/api/public/events/${ctx.ev.invite.slug}/register`, {
    account: { fullName: 'Guest', email: email('dir-guest'), password: 'Test1234!' },
    entry: { type: 'solo' }, answers: {}, accept: { rules: true, coc: true },
  });
  assert.equal(r.status, 201, r.text);
  // The page itself still opens by its link, and says how to get in.
  r = await anon.get(`/api/public/events/${ctx.ev.invite.slug}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.visibility, 'invite');
});

test('a private event is reached by its link only: not in the anonymous event list', async () => {
  const r = await anon.get('/api/events');
  assert.equal(r.status, 200, r.text);
  const codes = r.data.map((e) => e.id);
  assert.ok(!codes.includes(ctx.ev.private.id));
  assert.ok(!codes.includes(ctx.ev.invite.id));
  assert.ok(codes.includes(ctx.ev.open.id));
  assert.equal((await anon.get(`/api/public/events/${ctx.ev.private.slug}`)).status, 200);
});

test('the builder checks the visibility and the switch', async () => {
  let r = await admin.patch(`/api/events/${ctx.ev.open.id}/builder`, { visibility: 'secret' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.errors?.[0]?.field || r.json.data?.errors?.[0]?.field || 'visibility', 'visibility');
  r = await admin.patch(`/api/events/${ctx.ev.open.id}/builder`, { directory_listed: 'maybe' });
  assert.equal(r.status, 400, r.text);
  r = await admin.get('/api/events/builder/catalog');
  assert.deepEqual(r.data.visibilities, ['public', 'private', 'invite']);
  r = await admin.get(`/api/events/${ctx.ev.open.id}/builder`);
  assert.equal(r.data.event.visibility, 'public');
  assert.equal(r.data.event.directory_listed, true);
});

test('another organisation cannot change who finds the event', async () => {
  const other = new Session('dir-other');
  await other.register({ fullName: 'Other Org', email: email('dir-other') });
  const r = await other.patch(`/api/events/${ctx.ev.open.id}/builder`, { directory_listed: false });
  assert.ok([403, 404].includes(r.status), r.text);
  assert.ok(slugsOf(await dir()).includes(ctx.ev.open.slug));
});
