/**
 * @file tenancy.service.js
 * @description Customers as tenants: who belongs to one, how many may, and how
 * a colleague is brought in.
 *
 * The rules, in one place because they are easy to get subtly wrong:
 *
 *   a seat  is a platform account linked to the customer, or a live invite for
 *           one. A pending invite holds its seat — otherwise ten invites can be
 *           sent against three seats and the limit means nothing at accept time.
 *   a limit of NULL is not zero. It means no limit was agreed, and the platform
 *           does not invent one.
 *   removing a member unlinks the account. It does not delete the contact, and
 *           it never touches the events they ran.
 */

const crypto = require('crypto');
const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { ROLES } = require('../constants/roles');

/** Invite links stop working after a week. Long enough to forward, short enough to matter. */
const INVITE_TTL_DAYS = 7;

/** Roles an invite may grant. `superadmin` is platform ownership, never a seat. */
const GRANTABLE_ROLES = [ROLES.ORG_ADMIN, ROLES.ADMIN];

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

// ─────────────────────────────────────────────────────────────────────────────
// Membership
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The customer a signed-in account belongs to, with its seat usage.
 *
 * Returns null rather than throwing when the account belongs to no customer:
 * that is the ordinary state for a hacker, not an error.
 */
const getCustomerForUser = async (userId) => {
  const result = await db.query(
    `SELECT c.*
       FROM customers c
       JOIN customer_contacts cc ON cc.customer_id = c.id
      WHERE cc.user_id = $1 AND c.archived_at IS NULL
      ORDER BY cc.is_primary DESC, cc.id ASC
      LIMIT 1`,
    [userId],
  );
  const customer = result.rows[0] || null;
  if (!customer) return null;
  return { ...customer, seats: await getSeatUsage(customer.id) };
};

/**
 * Seats taken and seats allowed.
 *
 * `limit: null` means unlimited, and `remaining` is null with it — deliberately
 * not `Infinity`, which JSON turns into `null` anyway, and not a large number,
 * which a UI would render as a countdown that does not exist.
 */
const getSeatUsage = async (customerId) => {
  const result = await db.query(
    `SELECT
       (SELECT seat_limit FROM customers WHERE id = $1)                       AS seat_limit,
       (SELECT COUNT(DISTINCT user_id) FROM customer_contacts
         WHERE customer_id = $1 AND user_id IS NOT NULL)                      AS linked,
       (SELECT COUNT(*) FROM customer_invites
         WHERE customer_id = $1
           AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()) AS pending`,
    [customerId],
  );
  const row = result.rows[0] || {};
  const limit = row.seat_limit == null ? null : Number(row.seat_limit);
  const linked = Number(row.linked || 0);
  const pending = Number(row.pending || 0);
  const used = linked + pending;
  return {
    limit,
    used,
    linked,
    pending,
    remaining: limit == null ? null : Math.max(0, limit - used),
  };
};

/** @throws 409 when the customer has no seat left for one more person. */
const assertSeatAvailable = async (customerId) => {
  const seats = await getSeatUsage(customerId);
  if (seats.limit != null && seats.used >= seats.limit) {
    throw httpError(
      409,
      `All ${seats.limit} seats on this plan are taken (${seats.linked} in use, ${seats.pending} invited). Remove a member or revoke an invite first.`,
      'SEAT_LIMIT_REACHED',
    );
  }
  return seats;
};

/** Everyone attached to a customer — accounts and billing-only contacts alike. */
const listMembers = async (customerId) => {
  const result = await db.query(
    `SELECT cc.id, cc.customer_id, cc.user_id, cc.email, cc.role_title, cc.is_primary,
            cc.created_at,
            COALESCE(u.full_name, cc.full_name) AS full_name,
            u.role AS platform_role
       FROM customer_contacts cc
       LEFT JOIN users u ON u.id = cc.user_id
      WHERE cc.customer_id = $1
      ORDER BY cc.is_primary DESC, cc.created_at ASC`,
    [customerId],
  );
  return result.rows;
};

/**
 * Release a seat.
 *
 * Unlinks the account and keeps the contact row, so the billing history still
 * says who the invoice went to. The person's own account, and every event they
 * ran, are untouched — this is a membership change, not a deletion.
 */
const removeMember = async (customerId, contactId) => {
  const result = await db.query(
    `UPDATE customer_contacts
        SET user_id = NULL, updated_at = now()
      WHERE id = $1 AND customer_id = $2
      RETURNING id, email, user_id`,
    [contactId, customerId],
  );
  if (!result.rows[0]) throw httpError(404, 'Contact not found', 'NOT_FOUND');
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// Invites
// ─────────────────────────────────────────────────────────────────────────────

const listInvites = async (customerId) => {
  const result = await db.query(
    `SELECT ci.id, ci.customer_id, ci.email, ci.full_name, ci.role_title,
            ci.grant_role, ci.expires_at, ci.accepted_at, ci.revoked_at, ci.created_at,
            inviter.full_name AS invited_by_name,
            CASE
              WHEN ci.accepted_at IS NOT NULL THEN 'accepted'
              WHEN ci.revoked_at  IS NOT NULL THEN 'revoked'
              WHEN ci.expires_at  < NOW()     THEN 'expired'
              ELSE 'pending'
            END AS state
       FROM customer_invites ci
       LEFT JOIN users inviter ON inviter.id = ci.invited_by
      WHERE ci.customer_id = $1
      ORDER BY ci.created_at DESC`,
    [customerId],
  );
  return result.rows;
};

/**
 * Invite one colleague.
 *
 * Returns the row and the raw token together, and the token is the only time it
 * exists in plaintext — the table stores its hash. The caller mails the link and
 * then lets it go.
 */
const createInvite = async ({ customerId, email, fullName, roleTitle, grantRole, invitedBy }) => {
  const address = normalizeEmail(email);
  if (!address || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw httpError(400, 'A valid email address is required', 'VALIDATION_ERROR');
  }

  const role = String(grantRole || ROLES.ORG_ADMIN).trim().toLowerCase();
  if (!GRANTABLE_ROLES.includes(role)) {
    throw httpError(400, `Role must be one of: ${GRANTABLE_ROLES.join(', ')}`, 'VALIDATION_ERROR');
  }

  const customer = await db.query('SELECT id, name FROM customers WHERE id = $1', [customerId]);
  if (!customer.rows[0]) throw httpError(404, 'Customer not found', 'NOT_FOUND');

  // Already a member: re-inviting would consume a second seat for one person.
  const member = await db.query(
    `SELECT 1 FROM customer_contacts
      WHERE customer_id = $1 AND LOWER(email) = $2 AND user_id IS NOT NULL LIMIT 1`,
    [customerId, address],
  );
  if (member.rows[0]) {
    throw httpError(409, 'That address already has a seat here', 'ALREADY_MEMBER');
  }

  await assertSeatAvailable(customerId);

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  try {
    const result = await db.query(
      `INSERT INTO customer_invites
         (customer_id, email, full_name, role_title, grant_role, token_hash, invited_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, customer_id, email, full_name, role_title, grant_role, expires_at, created_at`,
      [customerId, address, fullName || null, roleTitle || null, role,
        hashToken(token), invitedBy || null, expires],
    );
    return { invite: result.rows[0], token, customerName: customer.rows[0].name };
  } catch (err) {
    // The partial unique index on (customer_id, email) where the invite is live.
    if (err && err.code === '23505') {
      throw httpError(409, 'That address already has an invite waiting', 'INVITE_EXISTS');
    }
    throw err;
  }
};

/** Withdraw a pending invite and give its seat back. */
const revokeInvite = async (customerId, inviteId) => {
  const result = await db.query(
    `UPDATE customer_invites
        SET revoked_at = now()
      WHERE id = $1 AND customer_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
      RETURNING id, email`,
    [inviteId, customerId],
  );
  if (!result.rows[0]) throw httpError(404, 'No pending invite with that id', 'NOT_FOUND');
  return result.rows[0];
};

/** What an invite link says about itself before anyone signs in. Never the customer's data. */
const peekInvite = async (token) => {
  const result = await db.query(
    `SELECT ci.email, ci.full_name, ci.grant_role, ci.expires_at,
            ci.accepted_at, ci.revoked_at, c.name AS customer_name
       FROM customer_invites ci
       JOIN customers c ON c.id = ci.customer_id
      WHERE ci.token_hash = $1
      LIMIT 1`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    email: row.email,
    fullName: row.full_name,
    grantRole: row.grant_role,
    customerName: row.customer_name,
    state: row.accepted_at ? 'accepted'
      : row.revoked_at ? 'revoked'
        : new Date(row.expires_at) < new Date() ? 'expired'
          : 'pending',
  };
};

/**
 * Accept an invite as the signed-in user.
 *
 * Three checks, and each one is a real attack if dropped: the token must be
 * live, the signed-in address must be the invited address (a forwarded link
 * must not admit whoever opened it), and the whole thing runs in a transaction
 * so a crash cannot grant the role without recording the membership.
 *
 * It never *lowers* a role. A superadmin accepting an invite stays a
 * superadmin, and an admin is not demoted to org_admin.
 */
const acceptInvite = async (token, user) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT ci.*, c.name AS customer_name
         FROM customer_invites ci
         JOIN customers c ON c.id = ci.customer_id
        WHERE ci.token_hash = $1
        FOR UPDATE OF ci`,
      [hashToken(token)],
    );
    const invite = found.rows[0];
    if (!invite) throw httpError(404, 'This invite link is not valid', 'INVITE_INVALID');
    if (invite.accepted_at) throw httpError(409, 'This invite has already been used', 'INVITE_USED');
    if (invite.revoked_at) throw httpError(409, 'This invite was withdrawn', 'INVITE_REVOKED');
    if (new Date(invite.expires_at) < new Date()) {
      throw httpError(410, 'This invite has expired. Ask for a new one.', 'INVITE_EXPIRED');
    }
    if (normalizeEmail(user.email) !== normalizeEmail(invite.email)) {
      throw httpError(
        403,
        `This invite was sent to ${invite.email}. Sign in with that address to accept it.`,
        'INVITE_WRONG_ACCOUNT',
      );
    }

    // The seat check runs again here, inside the transaction: seats can have
    // filled up between sending the invite and opening the link.
    const seats = await client.query(
      `SELECT c.seat_limit,
              (SELECT COUNT(DISTINCT user_id) FROM customer_contacts
                WHERE customer_id = c.id AND user_id IS NOT NULL) AS linked
         FROM customers c WHERE c.id = $1`,
      [invite.customer_id],
    );
    const limit = seats.rows[0] ? seats.rows[0].seat_limit : null;
    if (limit != null && Number(seats.rows[0].linked) >= Number(limit)) {
      throw httpError(409, 'Every seat on this plan is now taken.', 'SEAT_LIMIT_REACHED');
    }

    await client.query(
      `INSERT INTO customer_contacts (customer_id, user_id, full_name, email, role_title, member_role)
       VALUES ($1,$2,$3,$4,$5,'admin')
       ON CONFLICT (customer_id, LOWER(email))
       DO UPDATE SET user_id = EXCLUDED.user_id,
                     full_name = COALESCE(customer_contacts.full_name, EXCLUDED.full_name),
                     role_title = COALESCE(customer_contacts.role_title, EXCLUDED.role_title),
                     updated_at = now()`,
      [invite.customer_id, user.id, invite.full_name || user.full_name || null,
        invite.email, invite.role_title || null],
    );

    // Promote only upwards. An existing admin or superadmin keeps what they have.
    const RANK = { [ROLES.SUPERADMIN]: 3, [ROLES.ADMIN]: 2, [ROLES.ORG_ADMIN]: 1 };
    if ((RANK[user.role] || 0) < (RANK[invite.grant_role] || 0)) {
      await client.query('UPDATE users SET role = $1 WHERE id = $2', [invite.grant_role, user.id]);
    }

    await client.query(
      'UPDATE customer_invites SET accepted_at = now(), accepted_user_id = $1 WHERE id = $2',
      [user.id, invite.id],
    );

    await client.query('COMMIT');
    return {
      customerId: invite.customer_id,
      customerName: invite.customer_name,
      grantedRole: invite.grant_role,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Event assignment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Put an event under a customer, or take it back out with `null`.
 *
 * This is the act that raises the wall: until an event has a customer, every
 * customer administrator can still see it.
 */
const assignEventToCustomer = async (eventId, customerId) => {
  if (customerId != null) {
    const exists = await db.query('SELECT 1 FROM customers WHERE id = $1', [customerId]);
    if (!exists.rows[0]) throw httpError(404, 'Customer not found', 'NOT_FOUND');
  }
  const result = await db.query(
    `UPDATE events SET customer_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, name, event_code, customer_id`,
    [customerId, eventId],
  );
  if (!result.rows[0]) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return result.rows[0];
};

/** Events belonging to one customer, for the customer detail screen. */
const listCustomerEvents = async (customerId) => {
  const result = await db.query(
    `SELECT e.id, e.event_code, e.name, e.start_date, e.end_date, e.status, e.is_published,
            (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS participant_count
       FROM events e
      WHERE e.customer_id = $1
      ORDER BY e.start_date DESC`,
    [customerId],
  );
  return result.rows;
};

module.exports = {
  INVITE_TTL_DAYS,
  GRANTABLE_ROLES,
  getCustomerForUser,
  getSeatUsage,
  assertSeatAvailable,
  listMembers,
  removeMember,
  listInvites,
  createInvite,
  revokeInvite,
  peekInvite,
  acceptInvite,
  assignEventToCustomer,
  listCustomerEvents,
};
