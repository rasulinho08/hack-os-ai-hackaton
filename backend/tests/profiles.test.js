/**
 * "My hackathons" and the public profile end to end: the record lists each
 * event the person took part in with role, team, project, place and prizes
 * and their certificates; it needs a session. The public profile is off by
 * default (404), shows only the parts the person ticked, never an e-mail,
 * a phone number or an id, never a private event, a refused or still
 * pending registration, or an event the person hid; handles are checked,
 * reserved and unique; switching it off takes it down at once.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { Session, RUN_ID, DAY, iso } = require('./helpers');
const { dbQuery } = require('./fixtures');
const { finishedEvent } = require('./finishedEvent');

const admin = new Session('pf-admin');
const anon = new Session('pf-anon');
let ctx;
let me; // the lead of the winning team
const handle = `pf-${RUN_ID}`.toLowerCase().slice(0, 30);
const pub = (h = handle) => anon.get(`/api/public/profiles/${h}`);

function walk(value, keys = new Set(), strings = []) {
  if (Array.isArray(value)) value.forEach((v) => walk(v, keys, strings));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { keys.add(k); walk(v, keys, strings); }
  } else if (value != null) strings.push(String(value));
  return { keys, strings };
}

test('setup: a finished event, a private one and a pending registration', async () => {
  await admin.login(process.env.E2E_ADMIN_EMAIL || 'admin@test.com');
  ctx = await finishedEvent(admin, 'pf');
  me = ctx.people.a;
  await dbQuery("UPDATE users SET phone = '+994551112233' WHERE id = $1", [me.userId]);
  // A certificate for the finished event.
  await dbQuery(
    `INSERT INTO certificates (event_id, user_id, type, code, kind, team_id, place, title, recipient_name, issued_by)
     VALUES ($1, $2, 'winner', $3, 'winner', $4, 1, 'Grand prize', $5, 'organiser')`,
    [ctx.ev.id, me.userId, `PF${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(12, 'X').slice(0, 12).replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3'), ctx.teams.x.id, me.name],
  );
  ctx.certCode = (await dbQuery('SELECT code FROM certificates WHERE user_id = $1', [me.userId])).rows[0].code;
  // A private event they also took part in, with its own certificate.
  let r = await admin.post('/api/events', {
    event_code: `PFP${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Private Hack ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.privateEv = r.data;
  r = await admin.patch(`/api/events/${ctx.privateEv.id}/builder`, { visibility: 'private' });
  assert.equal(r.status, 200, r.text);
  await dbQuery("INSERT INTO participants (user_id, event_id, status) VALUES ($1, $2, 'approved')", [me.userId, ctx.privateEv.id]);
  await dbQuery(
    "INSERT INTO certificates (event_id, user_id, type, code, kind, recipient_name, issued_by) VALUES ($1, $2, 'participation', $3, 'participation', $4, 'organiser')",
    [ctx.privateEv.id, me.userId, ctx.certCode.replace(/^.{4}/, 'PRIV'), me.name],
  );
  // A third event where their registration is still waiting.
  r = await admin.post('/api/events', {
    event_code: `PFW${RUN_ID}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), name: `Waiting Hack ${RUN_ID}`,
    registration_start: iso(-2 * DAY), registration_end: iso(DAY), start_date: iso(3 * DAY), end_date: iso(4 * DAY),
    team_size_limit: 4, min_team_size: 1, is_published: true,
  });
  assert.equal(r.status, 201, r.text);
  ctx.waitingEv = r.data;
  await dbQuery("INSERT INTO participants (user_id, event_id, status) VALUES ($1, $2, 'pending')", [me.userId, ctx.waitingEv.id]);
});

test('my hackathons needs a session', async () => {
  assert.equal((await anon.get('/api/me/hackathons')).status, 401);
  assert.equal((await anon.get('/api/me/public-profile')).status, 401);
  assert.equal((await anon.put('/api/me/public-profile', { enabled: true })).status, 401);
});

test('my hackathons: role, team, project, place and prizes, and the certificates', async () => {
  const r = await me.s.get('/api/me/hackathons');
  assert.equal(r.status, 200, r.text);
  const row = r.data.events.find((x) => x.event.id === ctx.ev.id);
  assert.ok(row, 'the finished event is listed');
  assert.equal(row.role, 'lead');
  assert.equal(row.status, 'approved');
  assert.equal(row.team.name, ctx.teams.x.name);
  assert.equal(row.project.name, ctx.teams.x.project);
  assert.equal(row.result.published, true);
  assert.equal(row.result.place, 1);
  assert.ok(row.result.prizes.some((p) => p.name === 'Grand prize'));
  assert.equal(row.event.slug, ctx.ev.slug);
  assert.equal(row.shareable, true);
  const priv = r.data.events.find((x) => x.event.id === ctx.privateEv.id);
  assert.ok(priv, 'the private event is in their own record');
  assert.equal(priv.shareable, false);
  assert.equal(priv.event.slug, null, 'no link to a private event page');
  const waiting = r.data.events.find((x) => x.event.id === ctx.waitingEv.id);
  assert.equal(waiting.status, 'pending');
  assert.equal(waiting.shareable, false);
  const cert = r.data.certificates.find((c) => c.code === ctx.certCode);
  assert.ok(cert);
  assert.match(cert.verifyUrl, new RegExp(`/verify/${ctx.certCode}$`));
  assert.equal(cert.pdfUrl, `/api/public/certificates/${ctx.certCode}/pdf`);
  // A refused registration is not "taking part".
  const refused = await ctx.people.f.s.get('/api/me/hackathons');
  assert.equal(refused.status, 200);
  assert.ok(!refused.data.events.some((x) => x.event.id === ctx.ev.id));
});

test('the public profile is off by default, every part unticked', async () => {
  const r = await me.s.get('/api/me/public-profile');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.enabled, false);
  assert.equal(r.data.showName, false);
  assert.equal(r.data.showEvents, false);
  assert.equal(r.data.showProjects, false);
  assert.equal(r.data.showCertificates, false);
  assert.match(r.data.suggestedHandle, /^[a-z0-9-]{3,30}$/);
  assert.equal((await pub(r.data.suggestedHandle)).status, 404);
});

test('handles: shape, reserved words, uniqueness', async () => {
  for (const bad of ['ab', '-abc', 'abc-', 'Has Space', 'a'.repeat(31), 'üñî', 'a--b']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await me.s.put('/api/me/public-profile', { handle: bad });
    assert.equal(r.status, 400, `${bad}: ${r.text}`);
  }
  let r = await me.s.put('/api/me/public-profile', { handle: 'admin' });
  assert.equal(r.status, 400, r.text);
  r = await me.s.put('/api/me/public-profile', { handle: handle.toUpperCase() });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.handle, handle);
  r = await ctx.people.b.s.put('/api/me/public-profile', { handle });
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.code, 'HANDLE_TAKEN');
  r = await me.s.put('/api/me/public-profile', { enabled: 'yes' });
  assert.equal(r.status, 400, r.text);
  // Saving the handle did not switch anything on.
  assert.equal((await pub()).status, 404);
});

test('switched on with only the name: the name and nothing else', async () => {
  let r = await me.s.put('/api/me/public-profile', { enabled: true, showName: true, headline: 'Full-stack developer' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.path, `/u/${handle}`);
  r = await pub();
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.name, me.name);
  assert.equal(r.data.headline, 'Full-stack developer');
  for (const k of ['events', 'projects', 'certificates']) assert.ok(!(k in r.data), `${k} must be absent`);
  r = await me.s.put('/api/me/public-profile', { showName: false });
  assert.equal((await pub()).data.name, null);
});

test('events, projects and certificates: only public events where they took part', async () => {
  let r = await me.s.put('/api/me/public-profile', { showName: true, showEvents: true, showProjects: true, showCertificates: true });
  assert.equal(r.status, 200, r.text);
  r = await pub();
  assert.equal(r.status, 200, r.text);
  const names = r.data.events.map((e) => e.event.name);
  assert.ok(names.includes(ctx.ev.name));
  assert.ok(!names.includes(ctx.privateEv.name), 'a private event never shows');
  assert.ok(!names.includes(ctx.waitingEv.name), 'a pending registration never shows');
  const ev = r.data.events.find((e) => e.event.name === ctx.ev.name);
  assert.equal(ev.role, 'lead');
  assert.equal(ev.team, ctx.teams.x.name);
  assert.equal(ev.event.slug, ctx.ev.slug);
  const project = r.data.projects.find((p) => p.name === ctx.teams.x.project);
  assert.ok(project);
  assert.equal(project.place, 1, 'a prize place is public');
  assert.ok(project.prizes.some((p) => p.name === 'Grand prize'));
  assert.equal(r.data.certificates.length, 1);
  assert.equal(r.data.certificates[0].code, ctx.certCode);
  assert.ok(!r.data.certificates.some((c) => c.code.startsWith('PRIV')));
});

test('never an e-mail, a phone, an id or another person', async () => {
  const r = await pub();
  const { keys, strings } = walk(r.json);
  for (const k of ['email', 'phone', 'id', 'userId', 'user_id', 'eventId', 'teamId', 'members', 'age', 'university', 'hiddenEventIds']) {
    assert.ok(!keys.has(k), `key ${k} must not be on the public profile`);
  }
  const all = strings.join('\n');
  assert.ok(!all.includes(me.email) && !/@/.test(all), 'an e-mail address leaked');
  assert.ok(!all.includes('551112233'), 'a phone number leaked');
  assert.ok(!all.includes(ctx.people.b.name), 'a teammate leaked');
});

test('an event the person hides leaves the page with its project and certificate', async () => {
  let r = await me.s.put('/api/me/public-profile', { hiddenEventIds: [ctx.ev.id] });
  assert.equal(r.status, 200, r.text);
  r = await pub();
  assert.ok(!r.data.events.some((e) => e.event.name === ctx.ev.name));
  assert.ok(!r.data.projects.some((p) => p.name === ctx.teams.x.project));
  assert.equal(r.data.certificates.length, 0);
  r = await me.s.put('/api/me/public-profile', { hiddenEventIds: [] });
  assert.equal(r.status, 200, r.text);
  r = await me.s.put('/api/me/public-profile', { hiddenEventIds: ['x'] });
  assert.equal(r.status, 400, r.text);
});

test('switched off: gone at once, and the settings stay for next time', async () => {
  let r = await me.s.put('/api/me/public-profile', { enabled: false });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.path, null);
  assert.equal((await pub()).status, 404);
  r = await me.s.get('/api/me/public-profile');
  assert.equal(r.data.handle, handle);
  assert.equal(r.data.showEvents, true);
  // Unknown handles and odd input answer 404, never an error.
  assert.equal((await pub('no-such-handle-zz')).status, 404);
  assert.equal((await anon.get('/api/public/profiles/%27%20OR%201%3D1')).status, 404);
});

test('a person changes only their own profile', async () => {
  // b has no profile of their own yet; saving theirs never touches a's.
  const r = await ctx.people.b.s.put('/api/me/public-profile', { enabled: true, handle: `${handle.slice(0, 26)}-b`, showName: true });
  assert.equal(r.status, 200, r.text);
  const mine = await me.s.get('/api/me/public-profile');
  assert.equal(mine.data.handle, handle);
  assert.equal(mine.data.enabled, false);
  const theirs = await pub(`${handle.slice(0, 26)}-b`);
  assert.equal(theirs.data.name, ctx.people.b.name);
});

test('search engines: off by default, only while the page is on, in the sitemap until switched off', async () => {
  const sitemap = async () => {
    const r = await anon.get('/api/public/profiles/sitemap');
    assert.equal(r.status, 200, r.text);
    return r;
  };
  const listed = async () => (await sitemap()).data.some((x) => x.handle === handle);

  let r = await me.s.get('/api/me/public-profile');
  assert.equal(r.data.indexable, false, 'off by default');
  // The page is off (previous test): asking to be indexed is refused.
  r = await me.s.put('/api/me/public-profile', { indexable: true });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.errors[0].field, 'indexable');

  r = await me.s.put('/api/me/public-profile', { enabled: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.indexable, false, 'switching the page on does not make it indexable');
  assert.equal((await pub()).data.indexable, false);
  assert.equal(await listed(), false);

  r = await me.s.put('/api/me/public-profile', { indexable: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.indexable, true);
  const page = await pub();
  assert.equal(page.data.indexable, true);
  assert.ok(page.data.updatedAt);
  assert.equal(await listed(), true, 'listed in the sitemap');

  // The sitemap names handles and dates only: no e-mail, phone, name or id.
  const s = await sitemap();
  for (const row of s.data) assert.deepEqual(Object.keys(row).sort(), ['handle', 'updatedAt']);
  const { strings } = walk(s.json);
  assert.ok(!strings.join('\n').includes(me.email) && !strings.join('\n').includes(me.name));
  const { keys, strings: pageStrings } = walk(page.json);
  for (const k of ['email', 'phone', 'id', 'userId', 'user_id']) assert.ok(!keys.has(k), k);
  assert.ok(!/@/.test(pageStrings.join('\n')));

  // Turned off: out of the sitemap and not indexable, at once.
  r = await me.s.put('/api/me/public-profile', { indexable: false });
  assert.equal(r.status, 200, r.text);
  assert.equal((await pub()).data.indexable, false);
  assert.equal(await listed(), false);

  // Switching the page off takes the choice with it.
  r = await me.s.put('/api/me/public-profile', { indexable: true });
  assert.equal(r.data.indexable, true);
  r = await me.s.put('/api/me/public-profile', { enabled: false });
  assert.equal(r.data.indexable, false);
  assert.equal(await listed(), false);
  r = await me.s.put('/api/me/public-profile', { enabled: true });
  assert.equal(r.data.indexable, false, 'not back in search engines without asking');

  const audit = await dbQuery(
    "SELECT action FROM audit_log WHERE actor_user_id = $1 AND action IN ('profile.indexable', 'profile.noindex') ORDER BY id",
    [me.userId],
  );
  assert.deepEqual(audit.rows.map((x) => x.action), ['profile.indexable', 'profile.noindex', 'profile.indexable', 'profile.noindex']);
  // "sitemap" is not a handle anyone can take.
  r = await me.s.put('/api/me/public-profile', { handle: 'sitemap' });
  assert.equal(r.status, 400, r.text);
  r = await me.s.put('/api/me/public-profile', { enabled: false });
  assert.equal(r.status, 200, r.text);
});
