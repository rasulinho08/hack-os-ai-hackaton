/**
 * Grant (or revoke) the platform-owner role.
 *
 * `superadmin` is the only role that sees every event on the installation and
 * can reach the commercial endpoints. Nobody holds it until it is granted here,
 * and the API refuses to grant it over HTTP unless the caller already has it —
 * so this script is how the first one comes into existence.
 *
 * Usage:
 *   node scripts/grant-superadmin.js <email>            # promote
 *   node scripts/grant-superadmin.js <email> --revoke   # demote to admin
 *
 * Run it once, for yourself, before relying on the owner console: the browser
 * gate on /workspace is convenience, and the server now checks the role.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const db = require('../src/config/db');
const { runMigrations } = require('../src/db/migrate');
const { ROLES } = require('../src/constants/roles');

const email = String(process.argv[2] || '').trim().toLowerCase();
const revoke = process.argv.includes('--revoke');

if (!email) {
  console.error('\n  Usage: node scripts/grant-superadmin.js <email> [--revoke]\n');
  process.exit(1);
}

(async () => {
  // The role only became legal in migration 0006; applying first means this
  // works on a database that has not booted the new server yet.
  await runMigrations();

  const found = await db.query(
    'SELECT id, full_name, email, role FROM users WHERE LOWER(email) = $1',
    [email],
  );
  const user = found.rows[0];
  if (!user) {
    console.error(`\n  No account with the address ${email}.\n`);
    process.exit(1);
  }

  const target = revoke ? ROLES.ADMIN : ROLES.SUPERADMIN;
  if (user.role === target) {
    console.log(`\n  ${user.email} is already ${target}. Nothing to do.\n`);
    return;
  }

  const updated = await db.query(
    'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, full_name, email, role',
    [target, user.id],
  );
  const u = updated.rows[0];
  console.log(`\n  ${u.full_name || u.email}: ${user.role} → ${u.role}\n`);

  if (!revoke) {
    console.log('  They can now open /workspace and see every event on the platform.');
    console.log('  The API reads the role from the database on every request, so this');
    console.log('  takes effect immediately — no sign-out needed. The browser keeps a');
    console.log('  stale hh_role cookie until the next sign-in, but that only decides');
    console.log('  which menu items are drawn, not what the API will answer.\n');
  }
})()
  .catch((err) => {
    console.error('\n  Failed:', err.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
