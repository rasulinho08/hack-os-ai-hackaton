/**
 * @file notification.service.js
 * @description The notification centre: what happened that a person should
 * know about, read in the app's bell.
 *
 * Producers call `notify` (or `notifyAudience` for an announcement's whole
 * audience) after their own change is stored. Adding a notification never
 * fails the action that caused it: errors are logged and swallowed.
 *
 * A row names its event and a `target` (chat, announcements, help, team,
 * results, certificates, home); reading the list also says the person's
 * role in each event, so the app opens the right screen for them.
 */

const db = require('../config/db');
const { eventRoleOf } = require('./effectiveRole.service');
const { isAdminRole } = require('../utils/authz');

const ORG_MANAGER_ROLES = ['owner', 'admin', 'organizer'];
const KEEP_DAYS = 90;

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

/**
 * What a repeated cause does: nothing (default), 'replace' (the row comes
 * back to the top, unread, with the new words) or 'count' (the same, and
 * the count goes up while it is unread: "3 new messages").
 */
function conflictClause(dedupeKey, collapse) {
  if (!dedupeKey) return '';
  if (!collapse) return 'ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING';
  const count = collapse === 'count'
    ? 'CASE WHEN notifications.read_at IS NULL THEN notifications.count + 1 ELSE 1 END'
    : '1';
  return `ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO UPDATE SET
            count = ${count}, read_at = NULL, created_at = now(),
            title = EXCLUDED.title, body = EXCLUDED.body, data = EXCLUDED.data`;
}

const valuesOf = (opts) => [
  opts.eventId ?? null,
  String(opts.kind).slice(0, 40),
  opts.target ?? null,
  clip(opts.title, 200),
  clip(opts.body, 300),
  JSON.stringify(opts.data || {}),
  opts.dedupeKey ? String(opts.dedupeKey).slice(0, 200) : null,
];

/**
 * One notification for each of `userIds`.
 * @param {number[]} userIds
 * @param {{ eventId?, kind, target?, title?, body?, data?, dedupeKey?, collapse?: false|'replace'|'count' }} opts
 * @returns {Promise<number>} rows added or brought back
 */
async function notify(userIds, opts) {
  const ids = [...new Set((userIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return 0;
  try {
    const r = await db.query(
      `INSERT INTO notifications (user_id, event_id, kind, target, title, body, data, dedupe_key)
       SELECT u, $2, $3, $4, $5, $6, $7::jsonb, $8 FROM unnest($1::int[]) AS u
       ${conflictClause(opts.dedupeKey, opts.collapse)}`,
      [ids, ...valuesOf(opts)],
    );
    return r.rowCount;
  } catch (err) {
    console.error(`[notify] ${opts.kind} skipped:`, err.message);
    return 0;
  }
}

/**
 * The same, for everyone a query returns (column user_id): an
 * announcement's audience. `sql` uses $1..$n of `params`.
 */
async function notifyAudience(sql, params, opts) {
  try {
    const n = params.length;
    const r = await db.query(
      `INSERT INTO notifications (user_id, event_id, kind, target, title, body, data, dedupe_key)
       SELECT DISTINCT a.user_id, $${n + 1}::int, $${n + 2}, $${n + 3}, $${n + 4}, $${n + 5}, $${n + 6}::jsonb, $${n + 7}
         FROM (${sql}) a WHERE a.user_id IS NOT NULL
       ${conflictClause(opts.dedupeKey, opts.collapse)}`,
      [...params, ...valuesOf(opts)],
    );
    return r.rowCount;
  } catch (err) {
    console.error(`[notify] ${opts.kind} skipped:`, err.message);
    return 0;
  }
}

/** The people who run an event: whoever created it and its organisation's managers. */
async function organiserIds(eventId) {
  const r = await db.query(
    `SELECT e.created_by AS user_id FROM events e WHERE e.id = $1 AND e.created_by IS NOT NULL
     UNION
     SELECT cc.user_id FROM events e
       JOIN customer_contacts cc ON cc.customer_id = e.customer_id
      WHERE e.id = $1 AND cc.user_id IS NOT NULL AND cc.member_role = ANY($2::text[])`,
    [eventId, ORG_MANAGER_ROLES],
  );
  return r.rows.map((x) => x.user_id);
}

/** The members of a team. */
async function teamMemberIds(teamId) {
  if (teamId == null) return [];
  const r = await db.query('SELECT user_id FROM team_members WHERE team_id = $1', [teamId]);
  return r.rows.map((x) => x.user_id);
}

const ROLE_NAME = { organizer: 'organizer', judge: 'judge', mentor: 'mentor', volunteer: 'volunteer', participant: 'participant' };

/** GET /api/me/notifications — the newest, how many are unread, and the caller's role per event. */
async function list(user, { limit = 30 } = {}) {
  const n = Math.min(Math.max(Number.parseInt(String(limit), 10) || 30, 1), 100);
  const [rows, unread] = await Promise.all([
    db.query(
      `SELECT n.*, e.name AS event_name
         FROM notifications n LEFT JOIN events e ON e.id = n.event_id
        WHERE n.user_id = $1
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $2`,
      [user.id, n],
    ),
    unreadCount(user.id),
  ]);
  const roles = {};
  const stored = (await db.query('SELECT role FROM users WHERE id = $1', [user.id])).rows[0]?.role;
  for (const eventId of [...new Set(rows.rows.map((x) => x.event_id).filter((x) => x != null))]) {
    // eslint-disable-next-line no-await-in-loop
    const found = await eventRoleOf(user.id, eventId);
    roles[eventId] = found ? ROLE_NAME[found.role] : (isAdminRole(stored) || String(stored).toLowerCase() === 'superadmin' ? 'organizer' : null);
  }
  return {
    unread: unread.unread,
    roles,
    items: rows.rows.map((x) => ({
      id: Number(x.id),
      eventId: x.event_id,
      eventName: x.event_name || null,
      kind: x.kind,
      target: x.target,
      title: x.title,
      body: x.body,
      data: x.data || {},
      count: x.count,
      createdAt: x.created_at,
      read: x.read_at != null,
    })),
  };
}

/** GET /api/me/notifications/unread — the bell's badge. */
async function unreadCount(userId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS unread, MAX(created_at) AS latest
       FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return { unread: r.rows[0].unread, latest: r.rows[0].latest };
}

/** POST /api/me/notifications/read { ids } | { all: true } */
async function markRead(userId, { ids, all } = {}) {
  if (all === true) {
    const r = await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
    return { marked: r.rowCount };
  }
  const list_ = (Array.isArray(ids) ? ids : []).map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, 200);
  if (!list_.length) return { marked: 0 };
  const r = await db.query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL',
    [userId, list_],
  );
  return { marked: r.rowCount };
}

/** Housekeeping: notifications older than KEEP_DAYS go. */
async function prune() {
  const r = await db.query(`DELETE FROM notifications WHERE created_at < now() - make_interval(days => $1::int)`, [KEEP_DAYS]);
  return r.rowCount;
}

module.exports = {
  notify,
  notifyAudience,
  organiserIds,
  teamMemberIds,
  list,
  unreadCount,
  markRead,
  prune,
};
