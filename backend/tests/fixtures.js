/**
 * Shared set-up for the end-to-end suites: a direct database handle, a
 * platform owner, and an organisation that bought a plan and was approved.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const { Session, RUN_ID, email } = require('./helpers');

/** A one-off query straight against the test database. */
async function dbQuery(sql, params = []) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const { Client } = require('pg');
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try { return await pg.query(sql, params); } finally { await pg.end(); }
}

/**
 * A platform owner for the approval steps. Promoted in the database: through
 * the API only an owner can make one. Elevated when the server asks for the
 * second-step code and the test environment knows it.
 */
let ownerPromise = null;
function ownerSession() {
  if (!ownerPromise) {
    ownerPromise = (async () => {
      const s = new Session('owner');
      const mail = email('owner');
      await s.register({ fullName: 'E2E Owner', email: mail });
      await dbQuery("UPDATE users SET role = 'superadmin' WHERE LOWER(email) = LOWER($1)", [mail]);
      await s.login(mail);
      if (process.env.SUPERADMIN_PIN) await s.post('/api/auth/elevate', { pin: process.env.SUPERADMIN_PIN });
      return s;
    })();
  }
  return ownerPromise;
}

/** Buy a plan as a new account and have the owner approve it. */
async function approvedBuyer(label, { plan = 'starter', billingPeriod = 'per_event' } = {}) {
  const s = new Session(label);
  await s.register({ fullName: `E2E ${label}`, email: email(label) });
  let r = await s.post('/api/checkout', {
    plan, billingPeriod, organisation: `E2E ${label} Org ${RUN_ID}`,
    payment: { method: 'bank_transfer' }, acceptTerms: true,
  });
  assert.equal(r.status, 201, r.text);
  const order = r.data.order;
  const owner = await ownerSession();
  r = await owner.post(`/api/orders/${order.id}/approve`, {});
  assert.equal(r.status, 200, r.text);
  await s.login(email(label));
  return { session: s, order, customerId: order.customer_id, approval: r.data };
}

/**
 * The hackathon is over: its submission deadline and end are behind it, so
 * results may be published (they are refused while submissions are open).
 */
async function closeSubmissions(eventId) {
  await dbQuery(
    "UPDATE events SET submission_deadline = now() - interval '2 minutes', end_date = now() - interval '1 minute' WHERE id = $1",
    [eventId],
  );
}

module.exports = { dbQuery, ownerSession, approvedBuyer, closeSubmissions };
