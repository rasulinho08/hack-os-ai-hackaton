/**
 * Platform-owner checks in authMw, without a database: an owner row only
 * counts when its address is on SUPERADMIN_EMAILS (if set) and, when
 * SUPERADMIN_PIN is set, after the second step has been passed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-owner-checks';
const { finishUser } = require('../src/middlewares/authMw');
const { signToken } = require('../src/utils/jwtHelper');

const KEYS = ['SUPERADMIN_EMAILS', 'SUPERADMIN_PIN'];
function withEnv(vars, fn) {
  return async () => {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, vars);
    try { await fn(); } finally {
      for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  };
}
const owner = () => ({ id: 7, role: 'superadmin', email: 'owner@hack-os.app', full_name: 'Owner', token_version: 2 });
const req = (cookies = {}) => ({ cookies, params: {}, query: {}, body: {} });

test('with nothing configured the owner is the owner', withEnv({}, async () => {
  const u = await finishUser(req(), owner());
  assert.equal(u.role, 'superadmin');
  assert.equal(u.platformRole, 'superadmin');
}));

test('an owner row whose address is not on SUPERADMIN_EMAILS works as a plain admin', withEnv(
  { SUPERADMIN_EMAILS: 'someone.else@hack-os.app' },
  async () => {
    const u = await finishUser(req(), owner());
    assert.equal(u.role, 'admin');
    assert.equal(u.ownerDenied, true);
  },
));

test('with a PIN configured, the owner is an admin until the second step', withEnv(
  { SUPERADMIN_EMAILS: 'Owner@Hack-OS.app', SUPERADMIN_PIN: '482913' },
  async () => {
    const u = await finishUser(req(), owner());
    assert.equal(u.role, 'admin');
    assert.equal(u.elevationRequired, true);
  },
));

test('a valid elevation cookie restores the owner role', withEnv({ SUPERADMIN_PIN: '482913' }, async () => {
  const cookie = signToken({ id: 7, tv: 2, purpose: 'elevate' }, '12h');
  const u = await finishUser(req({ hh_elev: cookie }), owner());
  assert.equal(u.role, 'superadmin');
  assert.equal(u.elevated, true);
}));

test('an elevation cookie from an older session, another account or another purpose does not', withEnv({ SUPERADMIN_PIN: '482913' }, async () => {
  for (const payload of [{ id: 7, tv: 1, purpose: 'elevate' }, { id: 8, tv: 2, purpose: 'elevate' }, { id: 7, tv: 2 }]) {
    const u = await finishUser(req({ hh_elev: signToken(payload, '12h') }), owner());
    assert.equal(u.role, 'admin', JSON.stringify(payload));
  }
}));
