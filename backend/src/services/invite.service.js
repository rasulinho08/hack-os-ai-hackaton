/**
 * @file invite.service.js
 * @description Business logic for event-level invitations (admin → specific email + role).
 *
 * These are admin-sent invites that pre-assign a role (judge, mentor, hacker)
 * to an email address before the user registers.
 */

const db = require('../config/db');

/**
 * An invitation that still works: not used, not withdrawn, not expired.
 * `a` is the table's alias with its dot ("i."), or nothing.
 */
const LIVE_INVITE = (a = '') => `${a}used_at IS NULL AND ${a}revoked_at IS NULL AND (${a}expires_at IS NULL OR ${a}expires_at > now())`;

/** Where one invitation row stands: 'revoked', 'used', 'expired' or 'live'. */
function inviteState(row, now = Date.now()) {
  if (!row) return null;
  if (row.revoked_at) return 'revoked';
  if (row.used_at) return 'used';
  if (row.expires_at && new Date(row.expires_at).getTime() <= now) return 'expired';
  return 'live';
}

const listInvites = async (eventId) => {
  const result = await db.query(
    `SELECT ei.id, ei.event_id, ei.email, ei.role, ei.used_at, ei.user_id, ei.created_at, ei.meta, ei.sent_at,
            ei.expires_at, ei.revoked_at, e.event_code, e.name AS event_name
     FROM event_invites ei
     JOIN events e ON e.id = ei.event_id
     WHERE ei.event_id = $1
     ORDER BY ei.created_at DESC`,
    [eventId]
  );
  return result.rows;
};

/**
 * Notes the organiser keeps with an invitation: the tracks a judge covers,
 * a mentor's expertise, a volunteer's first tasks. Unknown keys are dropped.
 */
const cleanMeta = (meta) => {
  const m = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  const out = {};
  if (Array.isArray(m.tracks)) out.tracks = m.tracks.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 30);
  if (typeof m.expertise === 'string' && m.expertise.trim()) out.expertise = m.expertise.trim().slice(0, 200);
  if (typeof m.tasks === 'string' && m.tasks.trim()) out.tasks = m.tasks.trim().slice(0, 500);
  return out;
};

const addInvite = async (eventId, email, role, meta = {}) => {
  const normalized = String(email).trim().toLowerCase();
  const result = await db.query(
    `INSERT INTO event_invites (event_id, email, role, meta)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (event_id, email) DO UPDATE SET role = EXCLUDED.role, meta = EXCLUDED.meta,
       -- A staff invitation does not expire; one withdrawn before is live again.
       expires_at = NULL, revoked_at = NULL, revoked_by = NULL,
       token_nonce = CASE WHEN event_invites.role = EXCLUDED.role THEN event_invites.token_nonce END
     RETURNING *`,
    [eventId, normalized, role, JSON.stringify(cleanMeta(meta))]
  );
  return result.rows[0];
};

/** Marks an invite as used by an existing account that was added directly. */
const markInviteUsed = async (inviteId, userId) => {
  await db.query(
    'UPDATE event_invites SET used_at = COALESCE(used_at, CURRENT_TIMESTAMP), user_id = $2 WHERE id = $1',
    [inviteId, userId]
  );
};

/** The unused invite for this address on this event, if there is one. */
const findPendingInvite = async (eventId, email) => {
  const result = await db.query(
    `SELECT * FROM event_invites
     WHERE event_id = $1 AND LOWER(TRIM(email)) = $2 AND ${LIVE_INVITE()}`,
    [eventId, String(email || '').trim().toLowerCase()]
  );
  return result.rows[0] || null;
};

const getEventInfo = async (eventId) => {
  const result = await db.query(
    `SELECT id, name, event_code, language FROM events WHERE id = $1`,
    [eventId]
  );
  return result.rows[0] || null;
};

const deleteInvite = async (eventId, id) => {
  const result = await db.query(
    'DELETE FROM event_invites WHERE id = $1 AND event_id = $2 RETURNING id',
    [id, eventId]
  );
  return result.rows[0];
};

module.exports = {
  LIVE_INVITE,
  inviteState,
  listInvites,
  addInvite,
  getEventInfo,
  findPendingInvite,
  markInviteUsed,
  deleteInvite,
};
