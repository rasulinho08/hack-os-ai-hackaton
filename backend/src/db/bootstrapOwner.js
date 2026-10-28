/**
 * @file bootstrapOwner.js
 * @description Creates the first platform owner from an environment variable.
 *
 * `scripts/grant-superadmin.js` needs a shell, and a free Render instance does
 * not have one. This does the same job at boot, from a variable that can be set
 * in a hosting dashboard.
 *
 * It is safe to leave set, because it cannot escalate anyone:
 *
 *   - it does nothing once a superadmin exists. The window in which it can act
 *     closes the first time it acts, so it cannot be used later to promote a
 *     second account.
 *   - it only ever promotes an account that already exists. It does not create
 *     users, and it does not touch passwords.
 *   - it never demotes anybody.
 *
 * Once the owner exists, remove the variable anyway — a setting that does
 * nothing is a setting somebody will eventually misread.
 */

const db = require('../config/db');
const { ROLES } = require('../constants/roles');

/**
 * @returns {Promise<{ status: string, email?: string }>} what it did, for the log
 */
async function bootstrapOwner(log = console) {
  const email = String(process.env.BOOTSTRAP_SUPERADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) return { status: 'not-configured' };

  const existing = await db.query(
    'SELECT id, email FROM users WHERE role = $1 LIMIT 1',
    [ROLES.SUPERADMIN],
  );
  if (existing.rows.length > 0) {
    // The one-shot has already fired. Say so, so a leftover variable does not
    // read as a promotion that silently failed.
    log.info?.(
      `[owner] ${existing.rows[0].email} is already the platform owner; BOOTSTRAP_SUPERADMIN_EMAIL ignored.`,
    );
    return { status: 'already-set', email: existing.rows[0].email };
  }

  const found = await db.query(
    'SELECT id, email, role FROM users WHERE LOWER(email) = $1',
    [email],
  );
  if (found.rows.length === 0) {
    log.error?.(
      `[owner] BOOTSTRAP_SUPERADMIN_EMAIL is ${email}, but no account has that address. Sign up first, then restart.`,
    );
    return { status: 'no-such-user', email };
  }

  const user = found.rows[0];
  await db.query('UPDATE users SET role = $1 WHERE id = $2', [ROLES.SUPERADMIN, user.id]);
  log.info?.(
    `[owner] ${user.email}: ${user.role} → ${ROLES.SUPERADMIN}. Remove BOOTSTRAP_SUPERADMIN_EMAIL now.`,
  );
  return { status: 'promoted', email: user.email };
}

module.exports = { bootstrapOwner };
