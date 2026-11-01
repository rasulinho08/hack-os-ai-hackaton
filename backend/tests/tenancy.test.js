/**
 * Tenancy rules, tested without a database or a running server.
 *
 * Three things are checked here, and each one is a real hole if it regresses:
 *
 *   1. An invite can never grant platform ownership. The invite flow is the one
 *      place in the product where one customer's administrator hands out a role
 *      to somebody else, so it is exactly where an escalation would live.
 *   2. The event-to-customer switch is owner-only. It decides who can see an
 *      event; a customer administrator who could set it could claim any event
 *      on the installation.
 *   3. The scope comes from the session. A customer administrator must not be
 *      able to name a different customer in a query string.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tenancy = require('../src/services/tenancy.service');
const { ROLES } = require('../src/constants/roles');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

// ─── 1. Invites cannot grant ownership ───────────────────────────────────────

test('an invite may only grant the two customer-admin roles', () => {
  assert.deepEqual(tenancy.GRANTABLE_ROLES, [ROLES.ORG_ADMIN, ROLES.ADMIN]);
  assert.ok(
    !tenancy.GRANTABLE_ROLES.includes(ROLES.SUPERADMIN),
    'superadmin is platform ownership and must never be reachable through an invite',
  );
});

test('createInvite refuses superadmin before it touches the database', async () => {
  // The role check runs ahead of every query, so this asserts the guard itself
  // rather than the behaviour of some connection that is not there.
  await assert.rejects(
    () => tenancy.createInvite({
      customerId: 1,
      email: 'someone@example.com',
      grantRole: 'superadmin',
      invitedBy: 1,
    }),
    (err) => err.statusCode === 400 && /Role must be one of/.test(err.message),
  );
});

test('createInvite refuses an address that is not one', async () => {
  for (const bad of ['', '   ', 'not-an-email', 'a@b', '@example.com', 'two@@at.com']) {
    await assert.rejects(
      () => tenancy.createInvite({ customerId: 1, email: bad, invitedBy: 1 }),
      (err) => err.statusCode === 400,
      `"${bad}" should be rejected`,
    );
  }
});

test('the database agrees: the invite table cannot hold superadmin', () => {
  const sql = read('db', 'migrations', '0007_tenancy.sql');
  assert.match(
    sql,
    /customer_invites_role_chk[\s\S]*CHECK \(grant_role IN \('org_admin', 'admin'\)\)/,
    'a CHECK constraint must back the application-level guard',
  );
});

// ─── 2. Event ownership is owner-only ────────────────────────────────────────

test('assigning an event to a customer is mounted superadmin-only', () => {
  const source = read('src', 'routes', 'event.routes.js');
  assert.match(
    source,
    /router\.put\('\/:id\/customer',\s*authMw,\s*roleMw\(ROLES\.SUPERADMIN\)/,
    'PUT /api/events/:id/customer must be owner-only',
  );
});

test('seat limits are set by the owner, not by the customer', () => {
  const source = read('src', 'routes', 'customer.routes.js');
  assert.match(source, /router\.put\('\/:id\/seats',\s*authMw,\s*roleMw\(ROLES\.SUPERADMIN\)/);
});

// ─── 3. Scope comes from the session ─────────────────────────────────────────

test('only an owner may name a customer in the request', () => {
  const source = read('src', 'controllers', 'tenancy.controller.js');
  const scope = source.slice(
    source.indexOf('async function resolveScope'),
    source.indexOf('/** Everything the team screen needs'),
  );
  assert.ok(scope.length > 0, 'resolveScope should be findable');

  // The only read of a caller-supplied customerId must sit inside the owner
  // branch. If that guard is ever loosened, this fails.
  const ownerGuard = scope.indexOf('isOwnerUser(req.user)');
  const askedRead = scope.indexOf('req.query.customerId');
  assert.ok(ownerGuard !== -1, 'resolveScope must check for an owner');
  assert.ok(askedRead !== -1, 'resolveScope must read a supplied customerId somewhere');
  assert.ok(
    ownerGuard < askedRead,
    'a caller-supplied customerId must only be read after the owner check',
  );
  assert.ok(
    scope.includes('getCustomerForUser(req.user.id)'),
    'a non-owner must fall through to the customer their session belongs to',
  );
});

test('the team routes require an admin-shaped role', () => {
  const source = read('src', 'routes', 'accountTeam.routes.js');
  const guarded = source
    .split('\n')
    .filter((l) => /^router\.(get|post|delete|put|patch)\(/.test(l.trim()));

  assert.ok(guarded.length >= 8, 'expected the full set of team routes');

  let sawPeek = false;
  let sawAccept = false;

  for (const line of guarded) {
    // The invite pair is the one deliberate exception, and the two halves are
    // told apart by method rather than path: reading an invitation is open,
    // accepting it is not.
    if (line.includes("'/invites/:token'")) {
      if (line.includes('router.get(')) {
        sawPeek = true;
        assert.ok(!line.includes('authMw'), 'peeking at an invite must not require a session');
        assert.ok(!line.includes('roleMw'), 'peeking at an invite must not require a role');
      } else {
        sawAccept = true;
        assert.ok(line.includes('authMw'), 'accepting an invite must require a session');
        assert.ok(
          !line.includes('roleMw'),
          'accepting must not require a role — the invitee does not have one yet',
        );
      }
      continue;
    }
    assert.ok(line.includes('authMw'), `${line.trim()} is missing authMw`);
    assert.ok(line.includes('roleMw(ROLES.ADMIN)'), `${line.trim()} is missing its role gate`);
  }

  // Guards against the exemption silently covering everything: if the invite
  // routes were renamed, the loop above would pass by never matching them.
  assert.ok(sawPeek, 'the public invite-peek route should exist');
  assert.ok(sawAccept, 'the authenticated invite-accept route should exist');
});

// ─── The migration is safe to run against live data ──────────────────────────

test('the tenancy migration adds and backfills but never destroys', () => {
  const sql = read('db', 'migrations', '0007_tenancy.sql');

  for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bDROP\s+COLUMN\b/i]) {
    assert.ok(!forbidden.test(sql), `0007 must not contain ${forbidden}`);
  }

  // The one UPDATE it does run must only ever fill a NULL.
  assert.match(
    sql,
    /UPDATE events e[\s\S]*AND e\.customer_id IS NULL;/,
    'the backfill must be guarded so it never overwrites an existing link',
  );

  // Losing a customer record must not take the hackathon with it.
  assert.match(sql, /customer_id INT REFERENCES customers\(id\) ON DELETE SET NULL/);
});

// ─── Checkout: the price is ours, not the buyer's ────────────────────────────

test('the browser cannot name the price', () => {
  const source = read('src', 'services', 'checkout.service.js');

  // The amount must come from the catalogue and the server's discount and
  // nowhere else. If a future edit ever reads an amount off the request,
  // this fails.
  assert.match(
    source,
    /const priceMinor = catalogue\.priceIn\(entry, period\);/,
    'the price must be looked up in the price catalogue',
  );
  assert.match(
    source,
    /const amountMinor = priced\.amountMinor;/,
    'the amount must be the server-side quote',
  );
  // Every `amount_minor:` in the file must be assigned the looked-up value.
  // Written as a scan rather than a negative-lookahead regex, because `\s*`
  // backtracks to zero width and makes such a pattern match its own negation.
  // `list_amount_minor` (the price before a discount) is a different column.
  const assignments = [...source.matchAll(/(?<!\w)amount_minor:\s*([A-Za-z0-9_.]+)/g)].map((m) => m[1]);
  assert.ok(assignments.length > 0, 'expected the order to carry an amount');
  for (const value of assignments) {
    assert.equal(value, 'amountMinor', 'amount_minor must be the server-side price');
  }
  assert.match(source, /list_amount_minor: priced\.priceMinor,/, 'the price before the discount is the catalogue\'s too');
  for (const forbidden of [/req\.body\.amount/, /body\.amountMinor/, /body\.discountMinor/]) {
    assert.ok(!forbidden.test(source), `checkout must not read an amount from the caller (${forbidden})`);
  }

  const controller = read('src', 'controllers', 'checkout.controller.js');
  assert.ok(
    !/amount/i.test(controller.split('const placeOrder')[1] || ''),
    'the controller must not forward an amount either',
  );
});

test('checkout never joins a buyer to a customer by name', () => {
  const source = read('src', 'services', 'checkout.service.js');

  // Reuse happens only through customer_contacts — a row that says this person
  // belongs here. Matching on the organisation name would hand whoever types
  // "Azercell" the real Azercell's orders.
  const finder = source.slice(
    source.indexOf('async function findExistingCustomer'),
    source.indexOf('async function createCustomerFor'),
  );
  assert.ok(finder.includes('customer_contacts'), 'reuse must go through the contact table');
  assert.ok(
    !/c\.name\s*=|LOWER\(c\.name\)/.test(finder),
    'an existing customer must never be found by organisation name',
  );
});

test('a plan sold only by quote cannot be self-served', () => {
  const { SELF_SERVE_PLAN_IDS, PLANS } = require('../src/constants/plans');
  assert.ok(!SELF_SERVE_PLAN_IDS.includes('enterprise'));
  assert.ok(!SELF_SERVE_PLAN_IDS.includes('community'), 'Community is granted by the owner');
  assert.equal(PLANS.enterprise.annual, null);
  assert.equal(PLANS.enterprise.per_event, null);
});

test('every self-serve plan has a price on at least one period', () => {
  const { SELF_SERVE_PLAN_IDS, priceOf } = require('../src/constants/plans');
  for (const id of SELF_SERVE_PLAN_IDS) {
    const annual = priceOf(id, 'annual');
    const perEvent = priceOf(id, 'per_event');
    assert.ok(
      (annual != null && annual > 0) || (perEvent != null && perEvent > 0),
      `${id} is on sale with no price`,
    );
  }
});

test('the invoice migration adds without destroying', () => {
  const sql = read('db', 'migrations', '0008_invoices.sql');
  for (const forbidden of [/\bDROP\s+TABLE\b/i, /\bTRUNCATE\b/i, /\bDELETE\s+FROM\b/i, /\bDROP\s+COLUMN\b/i]) {
    assert.ok(!forbidden.test(sql), `0008 must not contain ${forbidden}`);
  }
  assert.match(sql, /ADD COLUMN IF NOT EXISTS invoice_number/);
});
