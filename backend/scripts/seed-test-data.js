/**
 * Seed script: creates test users (admin, mentor, judge, 3 hackers) + one
 * upcoming event with judging criteria and staff assignments.
 *
 * Usage:
 *   npm run seed            (reads DATABASE_URL from .env)
 *
 * Safe to re-run: users/events are matched by email/event_code.
 * Migrations are applied first automatically.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const db = require('../src/config/db');
const { hashPassword } = require('../src/utils/hashHelper');
const { runMigrations } = require('../src/db/migrate');

const TEST_PASSWORD = process.env.SEED_PASSWORD || 'Test1234!';

const USERS = [
  { full_name: 'Admin Test',     email: 'admin@test.com',   role: 'admin'  },
  { full_name: 'Mentor Test',    email: 'mentor@test.com',  role: 'mentor' },
  { full_name: 'Judge Test',     email: 'judge@test.com',   role: 'judge'  },
  { full_name: 'Hacker One',     email: 'hacker@test.com',  role: 'hacker', participant: 'approved', is_solo: true },
  { full_name: 'Hacker Two',     email: 'hacker2@test.com', role: 'hacker', participant: 'approved', is_solo: true },
  { full_name: 'Hacker Pending', email: 'hacker3@test.com', role: 'hacker', participant: 'pending',  is_solo: true },
];

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const EVENT = {
  event_code: 'HACKOS2026',
  name: 'HackOS 2026',
  description: 'Seeded test hackathon — team formation is open, the event starts in 3 days.',
  registration_start: new Date(now - 7 * DAY),
  registration_end:   new Date(now + 2 * DAY),
  start_date:         new Date(now + 3 * DAY),
  end_date:           new Date(now + 5 * DAY),
  submission_deadline: new Date(now + 5 * DAY),
  demo_day:           new Date(now + 6 * DAY),
  status: 'upcoming',
  team_size_limit: 4,
  min_team_size: 1,
  is_published: true,
};

const CRITERIA = [
  { name: 'Innovation',      max_score: 10, weight: 1.5, description: 'Originality of the idea' },
  { name: 'Technical Depth', max_score: 10, weight: 1.0, description: 'Quality of the implementation' },
  { name: 'Presentation',    max_score: 10, weight: 1.0, description: 'Clarity of the demo / pitch' },
];

async function main() {
  await runMigrations();

  const client = await db.pool.connect();
  try {
    const hashed = await hashPassword(TEST_PASSWORD);

    console.log('=== Users ===');
    const created = [];
    for (const u of USERS) {
      const existing = await client.query(
        'SELECT id FROM users WHERE LOWER(TRIM(email)) = $1',
        [u.email],
      );
      let id;
      if (existing.rows[0]) {
        id = existing.rows[0].id;
        await client.query('UPDATE users SET role = $1, password_hash = $2 WHERE id = $3', [u.role, hashed, id]);
        console.log(`  [exists ] ${u.email} (id=${id}, role=${u.role})`);
      } else {
        const r = await client.query(
          `INSERT INTO users (full_name, email, password_hash, role, skills, experience, email_verified_at)
           VALUES ($1, $2, $3, $4, '["JavaScript","Python"]'::jsonb, 'intermediate', now()) RETURNING id`,
          [u.full_name, u.email, hashed, u.role],
        );
        id = r.rows[0].id;
        console.log(`  [created] ${u.email} (id=${id}, role=${u.role})`);
      }
      created.push({ ...u, id });
    }

    console.log('\n=== Event ===');
    const admin = created.find((u) => u.role === 'admin');
    let ev = await client.query('SELECT id FROM events WHERE event_code = $1', [EVENT.event_code]);
    let eventId;
    if (ev.rows[0]) {
      eventId = ev.rows[0].id;
      console.log(`  [exists ] ${EVENT.name} (id=${eventId})`);
    } else {
      ev = await client.query(
        `INSERT INTO events (
           event_code, name, description, registration_start, registration_end,
           start_date, end_date, submission_deadline, demo_day,
           status, team_size_limit, min_team_size, is_published, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [
          EVENT.event_code, EVENT.name, EVENT.description,
          EVENT.registration_start, EVENT.registration_end,
          EVENT.start_date, EVENT.end_date, EVENT.submission_deadline, EVENT.demo_day,
          EVENT.status, EVENT.team_size_limit, EVENT.min_team_size, EVENT.is_published, admin.id,
        ],
      );
      eventId = ev.rows[0].id;
      console.log(`  [created] ${EVENT.name} (id=${eventId})`);
    }

    console.log('\n=== Staff / participants ===');
    for (const u of created) {
      if (u.role === 'hacker') {
        await client.query(
          `INSERT INTO participants (user_id, event_id, status, is_solo, is_team_lead)
           VALUES ($1, $2, $3, $4, false)
           ON CONFLICT (user_id, event_id) DO UPDATE SET status = EXCLUDED.status`,
          [u.id, eventId, u.participant, Boolean(u.is_solo)],
        );
        console.log(`  [participant ${u.participant.padEnd(8)}] ${u.email}`);
      } else if (u.role === 'judge') {
        await client.query(
          `INSERT INTO judges (event_id, user_id) VALUES ($1, $2)
           ON CONFLICT (event_id, user_id) DO NOTHING`,
          [eventId, u.id],
        );
        console.log(`  [judge              ] ${u.email}`);
      } else if (u.role === 'mentor') {
        await client.query(
          `INSERT INTO mentor_assignments (event_id, user_id, expertise, availability)
           VALUES ($1, $2, 'Backend, DevOps', 'All day')
           ON CONFLICT (event_id, user_id) DO NOTHING`,
          [eventId, u.id],
        );
        console.log(`  [mentor             ] ${u.email}`);
      }
    }

    console.log('\n=== Scoring criteria ===');
    for (const c of CRITERIA) {
      await client.query(
        `INSERT INTO scoring_criteria (event_id, name, description, max_score, weight)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [eventId, c.name, c.description, c.max_score, c.weight],
      );
      console.log(`  ${c.name} (max ${c.max_score}, weight ${c.weight})`);
    }

    console.log('\n========================================');
    console.log('SEED COMPLETE');
    console.log('========================================');
    console.log(`Password for every user: ${TEST_PASSWORD}`);
    for (const u of created) {
      console.log(`  ${u.role.padEnd(7)} ${u.email}`);
    }
    console.log(`\nEvent code: ${EVENT.event_code}   Join URL: /join/${EVENT.event_code}`);
    console.log('========================================');
  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch((err) => {
  console.error('SEED FAILED:', err.message);
  process.exit(1);
});
