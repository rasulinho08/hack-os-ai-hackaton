/**
 * Create (or promote) an administrator account — the one command a fresh
 * production database needs before anyone can sign in.
 *
 * Usage:
 *   node scripts/create-admin.js <email> <password> ["Full Name"]
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/create-admin.js
 *
 * If the e-mail already exists, its role is set to admin and the password is
 * reset — which also makes this the recovery path for a locked-out organiser.
 * Migrations are applied first, so this works on an empty database.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const db = require('../src/config/db');
const { hashPassword } = require('../src/utils/hashHelper');
const { runMigrations } = require('../src/db/migrate');

const email = String(process.argv[2] || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.argv[3] || process.env.ADMIN_PASSWORD || '');
const fullName = String(process.argv[4] || process.env.ADMIN_NAME || 'Administrator').trim();

function fail(message) {
  console.error(`\n  ${message}\n`);
  console.error('  Usage: node scripts/create-admin.js <email> <password> ["Full Name"]\n');
  process.exit(1);
}

if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('A valid e-mail address is required.');
if (password.length < 8 || !/\d/.test(password)) {
  fail('Password must be at least 8 characters and contain a number.');
}

async function main() {
  await runMigrations();

  const hashed = await hashPassword(password);
  const existing = await db.query('SELECT id, role FROM users WHERE LOWER(TRIM(email)) = $1', [email]);

  if (existing.rows[0]) {
    const { id, role } = existing.rows[0];
    await db.query(
      `UPDATE users SET role = 'admin', password_hash = $1, full_name = COALESCE(NULLIF($2, ''), full_name),
              email_verified_at = COALESCE(email_verified_at, now())
        WHERE id = $3`,
      [hashed, fullName, id],
    );
    console.log(`\n  Updated ${email} (id=${id}): role ${role} -> admin, password reset.\n`);
  } else {
    const r = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, email_verified_at)
       VALUES ($1, $2, $3, 'admin', now()) RETURNING id`,
      [fullName, email, hashed],
    );
    console.log(`\n  Created admin ${email} (id=${r.rows[0].id}).\n`);
  }
  console.log('  Sign in at your frontend URL with this e-mail and password.\n');
}

main()
  .catch((err) => {
    console.error('\n  FAILED:', err.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
