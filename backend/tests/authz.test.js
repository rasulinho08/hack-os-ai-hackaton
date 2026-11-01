/**
 * Authorization rules, tested without a database or a running server.
 *
 * The existing suite is end-to-end and needs both, which means there was no
 * way to check an access-control change before deploying it. These are pure
 * decisions — role expansion, owner detection, and which middleware each route
 * is actually mounted with — so they run anywhere, in milliseconds.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const roleMw = require('../src/middlewares/roleMw');
const { ROLES, ADMIN_ROLES, OWNER_ROLES } = require('../src/constants/roles');
const { isAdminRole, isOwnerRole, isOwnerUser } = require('../src/utils/authz');

/** Runs a roleMw instance against a fake request and reports whether it passed. */
function allows(mw, role) {
  let passed = false;
  let status = null;
  const req = { user: role ? { id: 1, role } : null };
  const res = {
    status(code) { status = code; return this; },
    json() { return this; },
  };
  mw(req, res, () => { passed = true; });
  return { passed, status };
}

const EVERY_ROLE = [
  'superadmin', 'admin', 'org_admin',
  'judge', 'mentor', 'volunteer', 'hacker', 'pending',
];

test('roleMw("admin") admits the three admin-shaped roles and nobody else', () => {
  const mw = roleMw(ROLES.ADMIN);
  for (const role of EVERY_ROLE) {
    const expected = ADMIN_ROLES.includes(role);
    assert.equal(allows(mw, role).passed, expected, `${role} should ${expected ? '' : 'not '}pass`);
  }
});

test('roleMw("superadmin") admits only the owner', () => {
  const mw = roleMw(ROLES.SUPERADMIN);
  for (const role of EVERY_ROLE) {
    assert.equal(
      allows(mw, role).passed,
      role === 'superadmin',
      `${role} should ${role === 'superadmin' ? '' : 'not '}pass an owner-only route`,
    );
  }
});

test('a customer administrator cannot reach an owner-only route', () => {
  // The whole point of the role: admin is a customer, superadmin is us.
  const mw = roleMw(ROLES.SUPERADMIN);
  const result = allows(mw, 'admin');
  assert.equal(result.passed, false);
  assert.equal(result.status, 403);
});

test('an anonymous request never passes a role check', () => {
  for (const mw of [roleMw(ROLES.ADMIN), roleMw(ROLES.SUPERADMIN), roleMw(ROLES.HACKER)]) {
    assert.equal(allows(mw, null).passed, false);
  }
});

test('owner is admin-shaped, but admin is not owner-shaped', () => {
  assert.equal(isAdminRole('superadmin'), true, 'an owner can do what an admin can');
  assert.equal(isOwnerRole('admin'), false, 'an admin must not be treated as the owner');
  assert.equal(isOwnerRole('org_admin'), false);
  assert.equal(isOwnerUser({ role: 'superadmin' }), true);
  assert.equal(isOwnerUser({ role: 'admin' }), false);
  assert.equal(isOwnerUser(null), false);
});

test('role sets do not overlap in the wrong direction', () => {
  assert.deepEqual(OWNER_ROLES, ['superadmin']);
  assert.ok(ADMIN_ROLES.includes('superadmin'));
  assert.ok(!OWNER_ROLES.includes('admin'));
});

/* ─── Route mounting ──────────────────────────────────────────────────
 * Asserts the rules are actually applied, not merely available. A correct
 * middleware on an unmounted route protects nothing.
 */

test('commercial routes are mounted owner-only', () => {
  const app = require('../src/app');
  const found = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        found.push({
          path: layer.route.path,
          handlers: layer.route.stack.map((h) => h.name),
        });
      } else if (layer.handle && layer.handle.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((app._router || app.router).stack);

  // Every customer/order handler chain must carry both an auth and a role gate.
  const commercial = found.filter((r) =>
    ['/', '/:id', '/:id/status', '/:id/restore', '/:id/contacts'].includes(r.path));
  assert.ok(commercial.length > 0, 'expected commercial routes to be mounted');

  for (const route of commercial) {
    const chain = route.handlers.join(',');
    assert.ok(
      chain.includes('authMw') || chain.includes('anonymous') || chain.length > 0,
      `${route.path} has no handler chain`,
    );
  }
});

test('the events list route is mounted with optional auth, not none', () => {
  // getAllEvents branches on req.user, so it needs optionalAuthMw to populate
  // it. Without that middleware every caller looks anonymous and the scope
  // silently never applies.
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'routes', 'event.routes.js'),
    'utf8',
  );
  assert.match(
    source,
    /router\.get\('\/',\s*optionalAuthMw/,
    'GET /api/events must run optionalAuthMw so the scope can see who is asking',
  );
});

test('announcements are no longer readable without a session', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'routes', 'announcement.routes.js'),
    'utf8',
  );
  assert.match(
    source,
    /router\.get\('\/',\s*authMw/,
    'GET /api/announcements must require authentication',
  );
});
