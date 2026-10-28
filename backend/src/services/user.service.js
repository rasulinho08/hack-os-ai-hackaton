/**
 * @file user.service.js
 * @description Business logic for user management.
 *
 * Functions here are called by user.controller.js.
 * Admin-only operations (create, delete, role change) are gated at the controller level.
 */

const crypto         = require('crypto');
const db             = require('../config/db');
const { ALL_ROLES }  = require('../constants/roles');
const { hashPassword } = require('../utils/hashHelper');
const { MANAGEABLE_USER_SQL } = require('./tenantAccess.service');

/**
 * Mask email for directory responses (e.g. j***@example.com).
 * @param {string|null|undefined} email
 * @returns {string|null}
 */
function maskEmail(email) {
  if (email == null || typeof email !== 'string') return null;
  const e = email.trim();
  const at = e.indexOf('@');
  if (at < 1) return '***';
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (!domain) return '***';
  const first = local.slice(0, 1);
  return `${first}***@${domain}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new user directly (admin panel — bypasses email invitation flow).
 *
 * @param {{ fullName: string, email: string, password: string, role: string, githubLink?: string }} param0
 * @returns {Promise<object>} Created user row (no password_hash)
 * @throws {Error} 409 if email is already registered
 */
const createUserByAdmin = async ({ fullName, email, password, role, githubLink }) => {
  const normalized = String(email).trim().toLowerCase();

  const existing = await db.query(
    'SELECT id FROM users WHERE LOWER(TRIM(email)) = $1',
    [normalized]
  );
  if (existing.rows.length > 0) {
    throw Object.assign(new Error('Email already registered'), { statusCode: 409 });
  }

  const hashedPwd = await hashPassword(password);
  const result = await db.query(
    `INSERT INTO users (full_name, email, password_hash, role, github_link)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, full_name, email, role, github_link, created_at`,
    [fullName, normalized, hashedPwd, role, githubLink || null]
  );
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// Read Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paginated admin user list — minimal columns + masked email.
 * Replaces the old unbounded `getAllUsers` that exposed full PII to any caller
 * that bypassed route-level checks.
 *
 * @param {{ role?: string|null, page?: number|string, limit?: number|string }} opts
 * @returns {Promise<{ rows: object[], total: number, page: number, limit: number }>}
 */
const listUsersAdminPaged = async ({ role, page, limit, visibleToAdminId = null }) => {
  let safeLimit = parseInt(String(limit ?? '25'), 10);
  if (!Number.isFinite(safeLimit) || safeLimit < 1) safeLimit = 25;
  if (safeLimit > 100) safeLimit = 100;

  let safePage = parseInt(String(page ?? '1'), 10);
  if (!Number.isFinite(safePage) || safePage < 1) safePage = 1;

  const offset = (safePage - 1) * safeLimit;

  let roleFilter = null;
  if (role != null && String(role).trim() !== '') {
    const r = String(role).trim();
    if (!ALL_ROLES.includes(r)) {
      throw Object.assign(new Error(`Invalid role filter. Allowed: ${ALL_ROLES.join(', ')}`), {
        statusCode: 400,
      });
    }
    roleFilter = r;
  }

  // Scope: an organiser sees only people of their own events and customer
  // (tenantAccess.service); the platform owner sees everyone.
  const conditions = [];
  const params = [];
  if (visibleToAdminId != null) {
    params.push(visibleToAdminId);
    conditions.push(MANAGEABLE_USER_SQL);
  }
  if (roleFilter) {
    params.push(roleFilter);
    conditions.push(`u.role = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countResult = await db.query(`SELECT COUNT(*)::int AS c FROM users u ${where}`, params);
  const total = countResult.rows[0]?.c ?? 0;
  const dataSql = `SELECT u.id, u.full_name, u.email, u.role, u.github_link, u.created_at
       FROM users u ${where}
       ORDER BY u.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const dataParams = [...params, safeLimit, offset];
  const result = await db.query(dataSql, dataParams);

  const rows = result.rows.map((row) => ({
    id: row.id,
    full_name: row.full_name,
    email_masked: maskEmail(row.email),
    role: row.role,
    github_link: row.github_link || null,
    created_at: row.created_at,
  }));

  return { rows, total, page: safePage, limit: safeLimit };
};

/**
 * Fetch a single user by primary key.
 *
 * @param {number|string} id - User ID
 * @returns {Promise<object|undefined>} User row, or undefined if not found
 */
const getUserById = async (id) => {
  const result = await db.query(
    `SELECT id, full_name, email, role, avatar, github_link,
            phone, age, country, timezone, linkedin, attendance_mode,
            university, cohort, skills, experience, role_preference,
            dietary, tshirt_size, motivation, how_heard, created_at
     FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// Write Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update profile fields of an existing user.
 * Only `full_name`, `avatar`, and `github_link` are updatable via this function.
 *
 * @param {number|string} id   - User ID
 * @param {object}        data - Fields to update (camelCase or snake_case accepted)
 * @returns {Promise<object|undefined>} Updated user row
 */
const updateUser = async (id, data) => {
  const full_name       = data.full_name   ?? data.fullName ?? data.name;
  const avatar          = data.avatar;
  const github_link     = data.github_link ?? data.githubLink ?? data.github;
  const phone           = data.phone;
  const age             = data.age != null ? parseInt(String(data.age), 10) : undefined;
  const country         = data.country;
  const timezone        = data.timezone;
  const linkedin        = data.linkedin;
  const attendance_mode = data.attendance_mode ?? data.attendanceMode;
  const university      = data.university;
  const cohort          = data.cohort;
  const skills          = data.skills != null ? (Array.isArray(data.skills) ? JSON.stringify(data.skills) : data.skills) : undefined;
  const experience      = data.experience;
  const role_preference = data.role_preference ?? data.rolePreference;
  const dietary         = data.dietary;
  const tshirt_size     = data.tshirt_size ?? data.tshirtSize;
  const motivation      = data.motivation;
  const how_heard       = data.how_heard ?? data.howHeard;

  const result = await db.query(
    `UPDATE users
     SET full_name       = COALESCE($1, full_name),
         avatar          = COALESCE($2, avatar),
         github_link     = COALESCE($3, github_link),
         phone           = COALESCE($4, phone),
         age             = COALESCE($5, age),
         country         = COALESCE($6, country),
         timezone        = COALESCE($7, timezone),
         linkedin        = COALESCE($8, linkedin),
         attendance_mode = COALESCE($9, attendance_mode),
         university      = COALESCE($10, university),
         cohort          = COALESCE($11, cohort),
         skills          = COALESCE($12::jsonb, skills),
         experience      = COALESCE($13, experience),
         role_preference = COALESCE($14, role_preference),
         dietary         = COALESCE($15, dietary),
         tshirt_size     = COALESCE($16, tshirt_size),
         motivation      = COALESCE($17, motivation),
         how_heard       = COALESCE($18, how_heard),
         updated_at      = CURRENT_TIMESTAMP
     WHERE id = $19
     RETURNING id, full_name, email, role, avatar, github_link,
       phone, age, country, timezone, linkedin, attendance_mode,
       university, cohort, skills, experience, role_preference,
       dietary, tshirt_size, motivation, how_heard`,
    [
      full_name, avatar, github_link,
      phone, age !== undefined && !isNaN(age) ? age : null, country, timezone, linkedin, attendance_mode,
      university, cohort, skills, experience, role_preference,
      dietary, tshirt_size, motivation, how_heard, id,
    ]
  );
  return result.rows[0];
};

/**
 * Permanently delete a user by ID.
 *
 * @param {number|string} id - User ID
 * @returns {Promise<void>}
 */
const deleteUser = async (id) => {
  await db.query('DELETE FROM users WHERE id = $1', [id]);
};

/**
 * Change a user's role (admin action only).
 *
 * @param {number|string} id   - User ID
 * @param {string}        role - New role (must be a valid ROLES value)
 * @returns {Promise<object|undefined>} Updated user row
 */
const changeUserRole = async (id, role) => {
  const result = await db.query(
    `UPDATE users
     SET role = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING id, full_name, email, role`,
    [role, id]
  );
  return result.rows[0];
};

/**
 * Bulk import users from CSV data.
 * Creates user accounts + participant records in a single transaction.
 * Skips duplicate emails (does not error).
 *
 * Passwords: a row may carry its own, otherwise the caller's `defaultPassword`
 * is used, otherwise each account gets its own random one. There is
 * deliberately no built-in default — the previous constant was published in
 * this repository, so every account imported without a password column shared a
 * publicly known credential.
 *
 * Accounts created without a password get a random one nobody sees and are
 * returned in `newAccounts`; the controller queues a "set your password"
 * e-mail for each (account.welcome), so the organiser never handles anyone's
 * password.
 *
 * @param {object[]} users  - Array of user objects from CSV
 * @param {number}   eventId - Event to add participants to
 * @param {string}   [defaultPassword] - Applied to rows without their own password
 * @returns {Promise<{ created, skipped, errors, newAccounts }>}
 */
const bulkImportUsers = async (users, eventId, defaultPassword) => {
  const client = await db.pool.connect();
  let created = 0;
  let skipped = 0;
  const errors = [];
  /*
   * Accounts this run created without a password of their own. They get a
   * random password nobody sees and a "set your password" e-mail (queued by
   * the controller) — the organiser never handles anyone's password.
   */
  const newAccounts = [];

  try {
    await client.query('BEGIN');

    for (const row of users) {
      const email = String(row.email || '').trim().toLowerCase();
      if (!email) { skipped++; continue; }

      const fullName = row.full_name || row.fullName || row.name || 'Participant';

      // Check if user already exists
      const existing = await client.query(
        'SELECT id FROM users WHERE LOWER(TRIM(email)) = $1',
        [email]
      );

      let userId;
      if (existing.rows.length > 0) {
        userId = existing.rows[0].id;
        skipped++;
      } else {
        const ownPassword = row.password || defaultPassword || null;
        const pwd = ownPassword || crypto.randomBytes(32).toString('base64url');
        const hashed = await hashPassword(pwd);
        const skillsJson = row.skills
          ? (Array.isArray(row.skills) ? JSON.stringify(row.skills) : row.skills)
          : '[]';

        const ins = await client.query(
          `INSERT INTO users (
             full_name, email, password_hash, role, github_link,
             phone, age, country, timezone, linkedin, attendance_mode,
             university, cohort, skills, experience, role_preference,
             dietary, tshirt_size, motivation, how_heard
           ) VALUES (
             $1, $2, $3, 'hacker', $4,
             $5, $6, $7, $8, $9, $10,
             $11, $12, $13::jsonb, $14, $15,
             $16, $17, $18, $19
           ) RETURNING id`,
          [
            fullName, email, hashed, row.github_link || row.github || null,
            row.phone || null,
            row.age ? parseInt(String(row.age), 10) : null,
            row.country || null, row.timezone || null,
            row.linkedin || null, row.attendance_mode || 'online',
            row.university || null, row.cohort || null,
            skillsJson, row.experience || null, row.role_preference || null,
            row.dietary || null, row.tshirt_size || null,
            row.motivation || null, row.how_heard || null,
          ]
        );
        userId = ins.rows[0].id;
        created++;
        if (!ownPassword) newAccounts.push({ userId, email });
      }

      // Add participant record for the event
      if (eventId && userId) {
        const isSolo = row.is_solo === true || row.is_solo === 'true' || row.solo === 'true' || row.solo === true;
        await client.query(
          `INSERT INTO participants (user_id, event_id, status, is_solo, is_team_lead)
           VALUES ($1, $2, 'approved', $3, false)
           ON CONFLICT (user_id, event_id) DO NOTHING`,
          [userId, eventId, isSolo !== false]
        );
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }

  return { created, skipped, errors, newAccounts };
};

module.exports = {
  createUserByAdmin,
  listUsersAdminPaged,
  getUserById,
  updateUser,
  deleteUser,
  changeUserRole,
  bulkImportUsers,
};
