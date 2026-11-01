/**
 * Tenant isolation, checked without a database.
 *
 * The P0 found in the release audit: every event-scoped route checked only
 * the caller's role, so an organiser of one customer could read, change and
 * delete another customer's event and reset another customer's admin
 * password. These tests pin the wiring — which mounts and routes carry the
 * guard — and the pure parts of the rule, so a new router cannot be added
 * without it and a refactor cannot silently drop it.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('every event-scoped mount in app.js carries the tenant guard', () => {
  const src = read('src/app.js');
  const mounts = src.match(/app\.use\('\/api\/events\/:eventId\/[^']+',[^\n]+/g) || [];
  assert.ok(mounts.length >= 13, `expected the 13 event-scoped mounts, found ${mounts.length}`);
  for (const line of mounts) {
    assert.match(line, /eventExists, eventAccess, /, `mount without tenant guard: ${line}`);
  }
});

test('the event routes that read or change one event by id carry the guard', () => {
  const src = read('src/routes/event.routes.js');
  const byId = src.match(/router\.(?:get|put|patch|delete|post)\('\/(?:details\/)?:id(?:\/[a-z]+)?'[^\n]+/g) || [];
  const guarded = byId.filter((l) => l.includes('eventAccessById'));
  // /:id/customer is the owner's own route (superadmin only) and needs no tenant check.
  const needing = byId.filter((l) => !l.includes("'/:id/customer'"));
  assert.ok(needing.length >= 7, `expected at least 7 by-id routes, found ${needing.length}`);
  for (const line of needing) {
    assert.ok(guarded.includes(line), `event route without tenant guard: ${line}`);
  }
});

test('by-id resources that belong to an event are guarded in their routers', () => {
  const tickets = read('src/routes/ticket.routes.js');
  const ticketById = tickets.match(/router\.(?:get|patch|post|delete)\(\s*'\/:id[^']*'[\s\S]*?\);/g) || [];
  assert.ok(ticketById.length >= 9, `ticket by-id routes: ${ticketById.length}`);
  for (const r of ticketById) assert.match(r, /byIdEventAccess\('help_tickets'/, r);

  const subs = read('src/routes/submission.routes.js');
  const subById = subs.match(/router\.(?:get|put|delete)\(\s*'\/:id'[\s\S]*?\);/g) || [];
  assert.equal(subById.length, 3);
  for (const r of subById) assert.match(r, /byIdEventAccess\('submissions'/, r);

  const ann = read('src/routes/announcement.routes.js');
  assert.match(ann, /router\.put\('\/:id'[^\n]*byIdEventAccess\('announcements'/);
  assert.match(ann, /router\.delete\('\/:id'[^\n]*byIdEventAccess\('announcements'/);
});

test('user administration is scoped to the organiser\'s own tenant', () => {
  const src = read('src/controllers/user.controller.js');
  const body = (handler) => {
    const start = src.indexOf(`const ${handler} = async`);
    assert.ok(start >= 0, handler);
    return src.slice(start, src.indexOf('\n};', start));
  };
  // Seeing someone needs a shared event; the full profile, and any change to
  // the account, need the stricter rule (own account, or a co-member of the
  // organiser's organisation): sharing an event is not owning the account.
  assert.match(body('getUserById'), /adminMayManageUser\(req\.user, req\.params\.id\)/);
  assert.match(body('getUserById'), /adminMayChangeAccount\(req\.user, req\.params\.id\)/);
  for (const handler of ['updateUser', 'deleteUser', 'changeUserRole', 'setPassword']) {
    assert.match(body(handler), /adminMayChangeAccount\(req\.user, req\.params\.id\)/, `${handler} does not check adminMayChangeAccount`);
  }
  assert.match(src, /visibleToAdminId: isOwnerUser\(req\.user\) \? null : req\.user\.id/);
});

test('the pure parts of the rule: owner always, anonymous and hackers pass, bad ids fail', async () => {
  const { userMayAccessEvent, adminMayManageUser } = require('../src/services/tenantAccess.service');
  assert.equal(await userMayAccessEvent(null, 1), true);
  assert.equal(await userMayAccessEvent({ id: 1, role: 'superadmin' }, 99), true);
  assert.equal(await userMayAccessEvent({ id: 1, role: 'hacker' }, 99), true);
  assert.equal(await userMayAccessEvent({ id: 1, role: 'pending' }, 99), true);
  // An organiser asking about a nonsense id never reaches the database.
  assert.equal(await userMayAccessEvent({ id: 1, role: 'admin' }, 'abc'), false);
  assert.equal(await userMayAccessEvent({ id: 1, role: 'judge' }, -5), false);
  assert.equal(await adminMayManageUser(null, 1), false);
  assert.equal(await adminMayManageUser({ id: 7, role: 'superadmin' }, 1), true);
  assert.equal(await adminMayManageUser({ id: 7, role: 'hacker' }, 7), true);
  assert.equal(await adminMayManageUser({ id: 7, role: 'hacker' }, 8), false);
  assert.equal(await adminMayManageUser({ id: 7, role: 'admin' }, 'x'), false);
});
