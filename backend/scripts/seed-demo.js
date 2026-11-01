/**
 * Demo data for a staging database: one organisation on a real plan and one
 * live event with somebody in every role — organiser, judges, mentors, a
 * volunteer, twelve participants in three teams, two submissions and two
 * announcements — so every screen has something on it and every role can be
 * tried.
 *
 *   DEMO_PASSWORD='a long one' node scripts/seed-demo.js --confirm
 *
 * It refuses without --confirm, and without DEMO_PASSWORD of 10 or more
 * characters: these are real accounts on whatever database DATABASE_URL
 * names, and a password everyone knows on a server anyone can reach is an
 * open door. Nothing here touches existing rows other than the ones it
 * created itself; running it again finds them by e-mail and code.
 */

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const db = require('../src/config/db');
const { hashPassword } = require('../src/utils/hashHelper');
const { runMigrations } = require('../src/db/migrate');
const { PLANS } = require('../src/constants/plans');

const DOMAIN = 'demo.hack-os.app';
const PASSWORD = process.env.DEMO_PASSWORD || '';
const DAY = 24 * 60 * 60 * 1000;

const STAFF = [
  { key: 'organiser', full_name: 'Leyla Hüseynova', role: 'org_admin' },
  { key: 'judge1', full_name: 'Elçin Quliyev', role: 'judge' },
  { key: 'judge2', full_name: 'Nigar Rəhimova', role: 'judge' },
  { key: 'mentor1', full_name: 'Tural Babayev', role: 'mentor' },
  { key: 'mentor2', full_name: 'Sevinc Abbasova', role: 'mentor' },
  { key: 'volunteer', full_name: 'Kamran İsmayılov', role: 'volunteer' },
];

const PARTICIPANTS = [
  'Aysel Məmmədova', 'Murad Əliyev', 'Günay Həsənova', 'Rauf Kərimov',
  'Lalə Nəsibova', 'Orxan Qasımov', 'Fidan Cəfərova', 'Emil Rzayev',
  'Səbinə Novruzova', 'Ruslan Mirzəyev', 'Aytən Bağırova', 'Fərid Səfərov',
];

const TEAMS = [
  { name: 'Byte Riders', members: [0, 1, 2, 3], submission: { project_name: 'MetroFlow', description: 'Live crowd levels for Baku metro stations from open ticketing data.', tech_stack: 'Next.js, FastAPI, PostgreSQL' } },
  { name: 'Caspian Coders', members: [4, 5, 6, 7], submission: { project_name: 'GreenRoute', description: 'Route planning that weighs travel time against emissions.', tech_stack: 'Flutter, Node.js' } },
  { name: 'Neural Nomads', members: [8, 9, 10], submission: null },
];

const CRITERIA = [
  { name: 'Innovation', max_score: 10, weight: 1.5, description: 'How new the idea is' },
  { name: 'Technical depth', max_score: 10, weight: 1.0, description: 'Quality of the implementation' },
  { name: 'Impact', max_score: 10, weight: 1.0, description: 'Who it helps and how much' },
  { name: 'Presentation', max_score: 10, weight: 0.5, description: 'Clarity of the demo and pitch' },
];

const mail = (local) => `${local}@${DOMAIN}`;

async function upsertUser(client, hashed, { full_name, email, role }) {
  const found = await client.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1', [email]);
  if (found.rows[0]) {
    await client.query('UPDATE users SET full_name = $1, role = $2, password_hash = $3 WHERE id = $4', [full_name, role, hashed, found.rows[0].id]);
    return found.rows[0].id;
  }
  const r = await client.query(
    `INSERT INTO users (full_name, email, password_hash, role, skills, experience, email_verified_at)
     VALUES ($1, $2, $3, $4, '["JavaScript","Python"]'::jsonb, 'intermediate', now()) RETURNING id`,
    [full_name, email, hashed, role],
  );
  return r.rows[0].id;
}

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Refusing to run without --confirm. Read the header of scripts/seed-demo.js first.');
    process.exit(2);
  }
  if (PASSWORD.length < 10) {
    console.error('Set DEMO_PASSWORD (10+ characters). Every demo account signs in with it.');
    process.exit(2);
  }
  let host = '(unknown)';
  try { host = new URL(process.env.DATABASE_URL).hostname; } catch { /* printed as unknown */ }
  console.log(`Seeding demo data into ${host}`);

  await runMigrations();
  const hashed = await hashPassword(PASSWORD);
  const client = await db.pool.connect();
  const now = Date.now();
  try {
    await client.query('BEGIN');

    // ── People ───────────────────────────────────────────────────────────
    const ids = {};
    for (const s of STAFF) ids[s.key] = await upsertUser(client, hashed, { ...s, email: mail(`demo.${s.key}`) });
    const pIds = [];
    for (let i = 0; i < PARTICIPANTS.length; i += 1) {
      pIds.push(await upsertUser(client, hashed, { full_name: PARTICIPANTS[i], email: mail(`demo.p${String(i + 1).padStart(2, '0')}`), role: 'hacker' }));
    }

    // ── Organisation, order, entitlement ─────────────────────────────────
    const orgName = 'Demo Universiteti';
    let org = await client.query('SELECT id FROM customers WHERE LOWER(name) = LOWER($1)', [orgName]);
    let orgId = org.rows[0] && org.rows[0].id;
    if (!orgId) {
      org = await client.query(
        `INSERT INTO customers (name, legal_name, country, city, billing_email, status, plan_exempt,
                                onboarded_at, timezone, locale, brand_color, slug)
         VALUES ($1, $1, 'Azərbaycan', 'Bakı', $2, 'active', false, now(), 'Asia/Baku', 'az', '#C8102E', 'demo-universiteti')
         RETURNING id`,
        [orgName, mail('demo.organiser')],
      );
      orgId = org.rows[0].id;
    }
    await client.query(
      `INSERT INTO customer_contacts (customer_id, user_id, full_name, email, is_primary, member_role)
       VALUES ($1, $2, $3, $4, true, 'owner')
       ON CONFLICT (customer_id, LOWER(email)) DO UPDATE SET user_id = EXCLUDED.user_id, member_role = 'owner'`,
      [orgId, ids.organiser, STAFF[0].full_name, mail('demo.organiser')],
    );

    const plan = PLANS.professional;
    let order = await client.query("SELECT id FROM orders WHERE order_code = 'DEMO-2026-0001'");
    let orderId = order.rows[0] && order.rows[0].id;
    if (!orderId) {
      order = await client.query(
        `INSERT INTO orders (order_code, customer_id, purchaser_user_id, plan, billing_period, status, currency,
                             amount_minor, placed_at, paid_at, delivered_at, payment_method, notes)
         VALUES ('DEMO-2026-0001', $1, $2, 'professional', 'annual', 'delivered', 'AZN', $3,
                 now() - interval '10 days', now() - interval '9 days', now() - interval '9 days',
                 'bank_transfer', 'Demo data (scripts/seed-demo.js).')
         RETURNING id`,
        [orgId, ids.organiser, plan.annual],
      );
      orderId = order.rows[0].id;
    }
    let ent = await client.query('SELECT id FROM entitlements WHERE order_id = $1', [orderId]);
    let entId = ent.rows[0] && ent.rows[0].id;
    if (!entId) {
      ent = await client.query(
        `INSERT INTO entitlements (customer_id, order_id, plan, kind, starts_at, ends_at, events_allowed,
                                   events_used, participant_limit, seat_limit, storage_gb)
         VALUES ($1, $2, 'professional', 'annual', now() - interval '9 days', now() + interval '356 days', $3, 0, $4, $5, $6)
         RETURNING id`,
        [orgId, orderId, plan.eventsPerYear, plan.participants, plan.seats, plan.storageGb],
      );
      entId = ent.rows[0].id;
    }
    await client.query('UPDATE customers SET seat_limit = GREATEST(COALESCE(seat_limit, 0), $1) WHERE id = $2', [plan.seats, orgId]);

    // ── The event: running now ───────────────────────────────────────────
    const code = 'DEMO2026';
    let ev = await client.query('SELECT id FROM events WHERE event_code = $1', [code]);
    let eventId = ev.rows[0] && ev.rows[0].id;
    if (!eventId) {
      ev = await client.query(
        `INSERT INTO events (event_code, name, description, registration_start, registration_end,
                             start_date, end_date, submission_deadline, demo_day, status,
                             team_size_limit, min_team_size, is_published, created_by, customer_id, entitlement_id)
         VALUES ($1, 'Demo Hackathon 2026', 'Mobility, telecom and AI: 48 hours to build something Baku would use.',
                 $2, $3, $4, $5, $5, $6, 'upcoming', 4, 2, true, $7, $8, $9)
         RETURNING id`,
        [code, new Date(now - 14 * DAY), new Date(now - 2 * DAY), new Date(now - DAY), new Date(now + DAY),
          new Date(now + 2 * DAY), ids.organiser, orgId, entId],
      );
      eventId = ev.rows[0].id;
      await client.query('UPDATE entitlements SET events_used = events_used + 1 WHERE id = $1', [entId]);
    }

    for (const c of CRITERIA) {
      await client.query(
        `INSERT INTO scoring_criteria (event_id, name, description, max_score, weight)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [eventId, c.name, c.description, c.max_score, c.weight],
      );
    }
    for (const k of ['judge1', 'judge2']) {
      await client.query('INSERT INTO judges (event_id, user_id) VALUES ($1, $2) ON CONFLICT (event_id, user_id) DO NOTHING', [eventId, ids[k]]);
    }
    await client.query(
      `INSERT INTO mentor_assignments (event_id, user_id, expertise, availability) VALUES
         ($1, $2, 'Backend, data', 'Saturday 10:00–18:00'), ($1, $3, 'Design, pitching', 'Sunday 10:00–16:00')
       ON CONFLICT (event_id, user_id) DO NOTHING`,
      [eventId, ids.mentor1, ids.mentor2],
    );
    await client.query(
      `INSERT INTO volunteers (event_id, user_id, assigned_tasks) VALUES ($1, $2, 'Registration desk, catering')
       ON CONFLICT (event_id, user_id) DO NOTHING`,
      [eventId, ids.volunteer],
    );

    // ── Participants, teams, submissions ─────────────────────────────────
    for (const pid of pIds) {
      await client.query(
        `INSERT INTO participants (user_id, event_id, status, is_solo, is_team_lead)
         VALUES ($1, $2, 'approved', false, false)
         ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'approved'`,
        [pid, eventId],
      );
    }
    for (const t of TEAMS) {
      let team = await client.query('SELECT id FROM teams WHERE event_id = $1 AND name = $2', [eventId, t.name]);
      let teamId = team.rows[0] && team.rows[0].id;
      const leader = pIds[t.members[0]];
      if (!teamId) {
        team = await client.query(
          'INSERT INTO teams (name, event_id, leader_id, join_code) VALUES ($1, $2, $3, $4) RETURNING id',
          [t.name, eventId, leader, crypto.randomBytes(4).toString('hex').toUpperCase()],
        );
        teamId = team.rows[0].id;
      }
      for (const idx of t.members) {
        const uid = pIds[idx];
        await client.query(
          `INSERT INTO team_members (team_id, user_id, is_leader) VALUES ($1, $2, $3)
           ON CONFLICT (team_id, user_id) DO NOTHING`,
          [teamId, uid, uid === leader],
        );
        await client.query(
          'UPDATE participants SET team_id = $1, is_team_lead = $2 WHERE user_id = $3 AND event_id = $4',
          [teamId, uid === leader, uid, eventId],
        );
      }
      if (t.submission) {
        const has = await client.query('SELECT 1 FROM submissions WHERE team_id = $1', [teamId]);
        if (!has.rows[0]) {
          await client.query(
            `INSERT INTO submissions (team_id, event_id, project_name, description, tech_stack, repo_link)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [teamId, eventId, t.submission.project_name, t.submission.description, t.submission.tech_stack,
              `https://github.com/example/${t.submission.project_name.toLowerCase()}`],
          );
        }
      }
    }

    const ann = await client.query('SELECT 1 FROM announcements WHERE event_id = $1 LIMIT 1', [eventId]);
    if (!ann.rows[0]) {
      await client.query(
        `INSERT INTO announcements (event_id, author_id, title, content, type, priority) VALUES
           ($1, $2, 'Welcome to Demo Hackathon 2026', 'Opening ceremony at 10:00 in the main hall. Wi-Fi: Demo-Guest.', 'info', 'normal'),
           ($1, $2, 'Submissions close tomorrow at 18:00', 'Team leads submit the project; one submission per team.', 'warning', 'high')`,
        [eventId, ids.organiser],
      );
    }

    await client.query('COMMIT');

    console.log('\nDemo data ready. Every account below signs in with DEMO_PASSWORD.\n');
    console.log(`  Organisation  ${orgName} (id ${orgId}) — Professional, annual`);
    console.log(`  Event         Demo Hackathon 2026 (id ${eventId}, code ${code}) — running now`);
    console.log(`  Organiser     ${mail('demo.organiser')}`);
    console.log(`  Judges        ${mail('demo.judge1')}, ${mail('demo.judge2')}`);
    console.log(`  Mentors       ${mail('demo.mentor1')}, ${mail('demo.mentor2')}`);
    console.log(`  Volunteer     ${mail('demo.volunteer')}`);
    console.log(`  Participants  ${mail('demo.p01')} … ${mail('demo.p12')} (p01, p05, p09 lead the teams; p12 has no team)`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((err) => {
  console.error('Demo seed failed:', err.message);
  process.exit(1);
});
