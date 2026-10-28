/**
 * @file emailVerification.service.js
 * @description Proving an account's e-mail address, and what waits for it.
 *
 * A new account starts unconfirmed and gets a link by e-mail. Opening it, or
 * a password reset link (also sent to the address), confirms the address.
 * Accounts made before the check were taken as confirmed (migration 0022).
 *
 * What the confirmation unlocks: the event invitations for the address. An
 * invitation used to go to whoever signed up with the invited address and
 * the event's public code; now it waits until the address is proven, unless
 * the person signs up through the invitation's own link (inviteToken.js).
 */

const crypto = require('crypto');
const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { LIVE_INVITE } = require('./invite.service');

const TTL_HOURS = 72;
const RESEND_COOLDOWN_SECONDS = 60;
const STAFF_ROLES = ['judge', 'mentor', 'volunteer'];

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const execOf = (client) => (client && typeof client.query === 'function' ? client : db);

/** A new link token for the account's address. Older links keep working until they expire. */
async function createToken(userId, email, client) {
  const token = crypto.randomBytes(32).toString('base64url');
  await execOf(client).query(
    `INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at)
     VALUES ($1, LOWER(TRIM($2)), $3, now() + make_interval(hours => $4::int))`,
    [userId, email, hashToken(token), TTL_HOURS],
  );
  return { token, expiresInHours: TTL_HOURS };
}

/** Seconds before another link may be sent to the account (0: now). */
async function cooldownLeft(userId) {
  const r = await db.query(
    `SELECT GREATEST(0, CEIL($2::int - EXTRACT(EPOCH FROM (now() - MAX(created_at)))))::int AS wait
       FROM email_verification_tokens WHERE user_id = $1`,
    [userId, RESEND_COOLDOWN_SECONDS],
  );
  return Number(r.rows[0]?.wait || 0);
}

/**
 * Gives one invitation to an account, inside the caller's transaction: the
 * row for its role, and the invitation marked used. False when someone else
 * took it in the meantime.
 */
async function applyInvite(client, invite, userId, { solo = true } = {}) {
  const taken = await client.query(
    `UPDATE event_invites SET used_at = now(), user_id = $2 WHERE id = $1 AND ${LIVE_INVITE()} RETURNING id`,
    [invite.id, userId],
  );
  if (!taken.rows[0]) return false;
  const eventId = invite.event_id;
  if (invite.role === 'mentor') {
    await client.query(
      `INSERT INTO mentor_assignments (event_id, user_id, expertise) VALUES ($1, $2, $3)
       ON CONFLICT (event_id, user_id) DO NOTHING`,
      [eventId, userId, invite.meta?.expertise || null],
    );
  } else if (invite.role === 'judge') {
    await client.query(
      'INSERT INTO judges (event_id, user_id) VALUES ($1, $2) ON CONFLICT (event_id, user_id) DO NOTHING',
      [eventId, userId],
    );
  } else if (invite.role === 'volunteer') {
    await client.query(
      `INSERT INTO volunteers (event_id, user_id, assigned_tasks) VALUES ($1, $2, $3)
       ON CONFLICT (event_id, user_id) DO NOTHING`,
      [eventId, userId, invite.meta?.tasks || null],
    );
  } else if (invite.role === 'hacker') {
    // Invited participants are approved by the organiser; one already
    // waiting for review or on the waiting list is let in.
    await client.query(
      `INSERT INTO participants (user_id, event_id, status, is_solo, is_team_lead)
       VALUES ($1, $2, 'approved', $3, false)
       ON CONFLICT (user_id, event_id) DO UPDATE SET status = 'approved'
        WHERE LOWER(participants.status::text) IN ('pending', 'waitlisted')`,
      [userId, eventId, solo],
    );
  }
  return true;
}

/**
 * Every unused invitation for the account's address on events that are not
 * archived. An account that is nothing else yet takes the first staff role
 * as its own, as a sign-up with the invitation did.
 */
async function applyPendingInvites(client, user) {
  const invites = (await client.query(
    `SELECT i.*, e.name AS event_name FROM event_invites i
       JOIN events e ON e.id = i.event_id
      WHERE LOWER(TRIM(i.email)) = LOWER(TRIM($1)) AND ${LIVE_INVITE('i.')}
        AND LOWER(TRIM(COALESCE(e.status::text, ''))) <> 'archived'
      ORDER BY i.created_at, i.id`,
    [user.email],
  )).rows;
  const applied = [];
  for (const invite of invites) {
    // eslint-disable-next-line no-await-in-loop
    if (await applyInvite(client, invite, user.id)) {
      applied.push({ eventId: invite.event_id, role: invite.role, eventName: invite.event_name || null });
    }
  }
  const staff = applied.find((a) => STAFF_ROLES.includes(a.role));
  if (staff) {
    await client.query(
      `UPDATE users SET role = $2
        WHERE id = $1 AND role = 'hacker' AND NOT EXISTS (SELECT 1 FROM participants WHERE user_id = $1)`,
      [user.id, staff.role],
    );
  }
  return applied;
}

/** The address is proven: mark it, retire its links, hand over its invitations. */
async function markVerified(client, userId) {
  const user = (await client.query(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now())
      WHERE id = $1 RETURNING id, email, role`,
    [userId],
  )).rows[0];
  if (!user) return { applied: [] };
  await client.query('UPDATE email_verification_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  return { applied: await applyPendingInvites(client, user) };
}

/**
 * POST /api/auth/verify-email: the link from the e-mail. Opening it twice is
 * fine; a link for an address the account no longer has is not.
 */
async function verifyWithToken(token) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(
      `SELECT t.id, t.user_id, t.email, t.used_at, t.expires_at > now() AS live,
              u.email AS current_email, u.email_verified_at
         FROM email_verification_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1
        FOR UPDATE OF t, u`,
      [hashToken(token)],
    )).rows[0];
    const sameAddress = row && String(row.email).toLowerCase() === String(row.current_email).trim().toLowerCase();
    if (row && sameAddress && row.used_at && row.email_verified_at) {
      await client.query('COMMIT');
      return { userId: row.user_id, email: row.current_email, alreadyVerified: true, applied: [] };
    }
    if (!row || !sameAddress || row.used_at || !row.live) {
      throw httpError(400, 'This confirmation link is invalid or has expired. Sign in and ask for a new one.', 'INVALID_VERIFY_TOKEN');
    }
    const { applied } = await markVerified(client, row.user_id);
    await client.query('COMMIT');
    return { userId: row.user_id, email: row.current_email, alreadyVerified: Boolean(row.email_verified_at), applied };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** The invitations waiting for an unconfirmed address, for the "confirm your e-mail" notice. */
async function pendingInvitesFor(email) {
  const r = await db.query(
    `SELECT i.event_id, i.role, e.name AS event_name
       FROM event_invites i
       JOIN events e ON e.id = i.event_id
      WHERE LOWER(TRIM(i.email)) = LOWER(TRIM($1)) AND ${LIVE_INVITE('i.')}
        AND LOWER(TRIM(COALESCE(e.status::text, ''))) <> 'archived'
      ORDER BY i.created_at, i.id`,
    [email],
  );
  return r.rows.map((x) => ({ eventId: x.event_id, role: x.role, eventName: x.event_name }));
}

module.exports = {
  TTL_HOURS,
  RESEND_COOLDOWN_SECONDS,
  createToken,
  cooldownLeft,
  applyInvite,
  applyPendingInvites,
  markVerified,
  verifyWithToken,
  pendingInvitesFor,
};
