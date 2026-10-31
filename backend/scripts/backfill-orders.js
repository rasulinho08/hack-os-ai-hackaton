/**
 * Record the events already run on the platform as customers and orders.
 *
 * The commercial tables were added after the fact, so the two events that have
 * actually been delivered exist only as `events` rows. This writes the missing
 * half: an organisation to bill, a contact if the event's creator can be found,
 * and an order linked to the event.
 *
 * Usage:
 *   node scripts/backfill-orders.js              # dry run — prints the plan
 *   node scripts/backfill-orders.js --apply      # write it
 *   node scripts/backfill-orders.js --apply --all
 *
 * Dry run is the default deliberately: this touches a live database and you
 * should read what it intends to do before it does it.
 *
 * What it will not do:
 *   - modify or delete any existing row. Events, participants, teams, scores
 *     and users are read-only here; the script only inserts into the four
 *     tables migration 0005 added.
 *   - run twice. An event that already has an order is skipped, and customers
 *     are matched on name, so re-running is a no-op rather than a duplicate.
 *   - invent a price. `amount_minor` is left NULL — "not recorded" — because
 *     nothing in this repository knows what these events were sold for, and a
 *     made-up figure in a billing table is worse than an empty one. Fill the
 *     amounts in from the owner console once the real numbers are to hand.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const db = require('../src/config/db');

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

/**
 * Events we know the buyer for, matched case-insensitively on the event name.
 *
 * Anything not listed here is only handled with --all, and then as a draft
 * order against an organisation named after the event — a placeholder for
 * somebody to correct, not a guess presented as fact.
 */
const KNOWN = [
  {
    match: /azcon/i,
    customer: { name: 'AZCON Holding', sector: 'Holding', country: 'Azerbaijan', city: 'Baku' },
    plan: 'business',
    billing_period: 'per_event',
  },
  {
    match: /buildathon/i,
    customer: {
      name: 'Azerbaijan State Oil and Industry University',
      legal_name: 'ASOIU',
      sector: 'University',
      country: 'Azerbaijan',
      city: 'Baku',
    },
    plan: 'professional',
    billing_period: 'per_event',
  },
];

const log = (...a) => console.log('   ', ...a);

/** Finished events are delivered; anything still to come is only pending. */
function statusForEvent(event) {
  const end = event.end_date ? new Date(event.end_date).getTime() : NaN;
  if (Number.isFinite(end) && end < Date.now()) return 'delivered';
  return 'pending';
}

async function findOrCreateCustomer(client, spec) {
  const existing = await client.query(
    'SELECT id, name FROM customers WHERE LOWER(name) = LOWER($1)', [spec.name],
  );
  if (existing.rows.length > 0) return { ...existing.rows[0], created: false };
  if (!APPLY) return { id: null, name: spec.name, created: true };

  const inserted = await client.query(
    `INSERT INTO customers (name, legal_name, sector, country, city)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, name`,
    [spec.name, spec.legal_name || null, spec.sector || null,
     spec.country || null, spec.city || null],
  );
  return { ...inserted.rows[0], created: true };
}

/**
 * Link the person who created the event as a contact, so that account sees the
 * order on their own page. Skipped silently when the event has no creator.
 */
async function linkCreatorContact(client, customerId, event) {
  if (!event.created_by || !APPLY) return null;
  const user = await client.query(
    'SELECT id, full_name, email FROM users WHERE id = $1', [event.created_by],
  );
  const u = user.rows[0];
  if (!u || !u.email) return null;
  await client.query(
    `INSERT INTO customer_contacts (customer_id, user_id, full_name, email, is_primary)
     VALUES ($1,$2,$3,$4,true)
     ON CONFLICT (customer_id, LOWER(email)) DO UPDATE
       SET user_id = COALESCE(EXCLUDED.user_id, customer_contacts.user_id)`,
    [customerId, u.id, u.full_name || null, u.email],
  );
  return u.email;
}

(async () => {
  console.log(`\n  Backfilling orders — ${APPLY ? 'APPLYING' : 'dry run'}\n`);

  const client = await db.pool.connect();
  try {
    const { rows: events } = await client.query(
      'SELECT id, name, event_code, start_date, end_date, status, created_by FROM events ORDER BY start_date ASC',
    );
    if (events.length === 0) {
      console.log('  No events on this database. Nothing to do.\n');
      return;
    }

    const { rows: existingOrders } = await client.query(
      'SELECT event_id FROM orders WHERE event_id IS NOT NULL',
    );
    const alreadyOrdered = new Set(existingOrders.map((r) => r.event_id));

    let planned = 0;
    for (const event of events) {
      if (alreadyOrdered.has(event.id)) {
        log(`skip   ${event.name} — already has an order`);
        continue;
      }

      const known = KNOWN.find((k) => k.match.test(event.name || ''));
      if (!known && !ALL) {
        log(`skip   ${event.name} — no known buyer (use --all to add a draft)`);
        continue;
      }

      const spec = known
        ? known.customer
        : { name: event.name, sector: null, country: null, city: null };
      const plan = known ? known.plan : 'starter';
      const period = known ? known.billing_period : 'per_event';
      const status = known ? statusForEvent(event) : 'draft';

      if (!APPLY) {
        log(`would   ${event.name}`);
        log(`          customer: ${spec.name}`);
        log(`          order:    ${plan} / ${period} / ${status} / amount not recorded`);
        planned += 1;
        continue;
      }

      await client.query('BEGIN');
      try {
        const customer = await findOrCreateCustomer(client, spec);
        const contact = await linkCreatorContact(client, customer.id, event);

        const inserted = await client.query(
          `INSERT INTO orders
             (order_code, customer_id, event_id, purchaser_user_id, plan,
              billing_period, status, currency, notes)
           VALUES ('', $1, $2, $3, $4, $5, 'draft', 'AZN', $6)
           RETURNING id, created_at`,
          [customer.id, event.id, event.created_by || null, plan, period,
           'Backfilled from an event that ran before orders were recorded.'],
        );
        const { id, created_at } = inserted.rows[0];
        const code = `HS-${new Date(created_at).getUTCFullYear()}-${String(id).padStart(4, '0')}`;
        await client.query('UPDATE orders SET order_code = $1 WHERE id = $2', [code, id]);
        await client.query(
          `INSERT INTO order_status_history (order_id, from_status, to_status, note)
           VALUES ($1, NULL, 'draft', 'Created by backfill-orders')`,
          [id],
        );

        /*
         * Set the state directly rather than walking it through `paid`.
         *
         * That the event ran is a fact — the participants and scores are in
         * the database. That somebody paid for it is not something this
         * script knows, and stepping through `paid` would write that claim
         * into the history along with an invented payment date. So
         * `delivered_at` gets the event's real end date and `paid_at` stays
         * empty until a human fills it in.
         */
        if (status !== 'draft') {
          await client.query(
            `UPDATE orders SET status = $1, placed_at = COALESCE(placed_at, $2),
                    delivered_at = CASE WHEN $1 = 'delivered' THEN $3 ELSE delivered_at END
              WHERE id = $4`,
            [status, event.start_date || null, event.end_date || null, id],
          );
          await client.query(
            `INSERT INTO order_status_history (order_id, from_status, to_status, note)
             VALUES ($1, 'draft', $2, $3)`,
            [id, status,
             status === 'delivered'
               ? 'Backfilled: the event ran, so the order is delivered. Whether it was paid was not recorded at the time — paid_at is deliberately empty.'
               : 'Backfilled from an event that has not finished yet.'],
          );
        }

        await client.query('COMMIT');
        log(`wrote  ${event.name} → ${code} (${spec.name}, ${plan}, ${status})`);
        if (contact) log(`          contact linked: ${contact}`);
        planned += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        log(`FAILED ${event.name}: ${err.message}`);
      }
    }

    console.log(
      APPLY
        ? `\n  Done. ${planned} order(s) written. Amounts are blank — set them in the owner console.\n`
        : `\n  ${planned} order(s) would be written. Re-run with --apply to do it.\n`,
    );
  } finally {
    client.release();
    await db.pool.end();
  }
})().catch((err) => {
  console.error('\n  Backfill failed:', err.message, '\n');
  process.exit(1);
});
