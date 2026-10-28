/**
 * @file effectiveRole.service.js
 * @description A person's role for THIS request, from their memberships.
 *
 * users.role is one value per account, so a person could not judge one
 * hackathon and take part in another: invites rewrote the role, or were only
 * honoured at first registration. The platform now works the role out per
 * request:
 *
 *   1. The platform owner stays the owner (see authMw for its extra checks).
 *   2. If the request is about an event — :eventId in the route, ?eventId=,
 *      eventId in the body, or the hh_event cookie the workspace picker sets —
 *      and the person has a role in that event, that role applies:
 *        organiser (created it, or owner/admin/organizer of its organisation)
 *          → org_admin;  judge → judge;  mentor → mentor;
 *        volunteer → volunteer;  participant → hacker.
 *   3. Otherwise, a member of an organisation acts as org_admin.
 *   4. Otherwise users.role, as before.
 *
 * Nothing here grants more than a membership the person actually has; every
 * tenancy check (userMayAccessEvent and the rest) still runs on top.
 */

const db = require('../config/db');
const { isAdminRole, normalizeRole } = require('../utils/authz');

const ORG_MANAGER_ROLES = ['owner', 'admin', 'organizer'];
const ROLE_FOR = { organizer: 'org_admin', judge: 'judge', mentor: 'mentor', volunteer: 'volunteer', participant: 'hacker' };
const PRIORITY = ['organizer', 'judge', 'mentor', 'volunteer', 'participant'];

function toEventId(v) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The event the request itself names (route, query or body), if any. */
function namedEventId(req) {
  if (!req) return null;
  return (
    toEventId(req.params?.eventId) ||
    toEventId(req.query?.eventId) ||
    toEventId(req.query?.event_id) ||
    toEventId(req.body?.eventId) ||
    toEventId(req.body?.event_id)
  );
}

/** The event this request is about, if it names one, else the workspace entered. */
function contextEventId(req) {
  if (!req) return null;
  return namedEventId(req) || toEventId(req.cookies?.hh_event);
}

/**
 * The event a participant acts in, the same way on every participant route
 * (their event, team, project, help requests, progress): the event the
 * request names, else the workspace they entered (hh_event, as for their
 * role), else their default registration (eventService.defaultParticipation).
 * Only an event they are registered for: a request naming another one gets
 * null, so the route refuses rather than acting in some other event; a stale
 * workspace cookie falls back to the default.
 *
 * @returns {Promise<number|null>}
 */
async function participantEventId(req) {
  const named = namedEventId(req);
  const picked = named || toEventId(req.cookies?.hh_event);
  if (picked) {
    const r = await db.query('SELECT 1 FROM participants WHERE event_id = $1 AND user_id = $2', [picked, req.user.id]);
    if (r.rows[0]) return picked;
    if (named) return null;
  }
  // eslint-disable-next-line global-require
  const own = await require('./event.service').getDefaultEventForUser(req.user.id);
  return own ? Number(own.id) : null;
}

/**
 * The person's strongest role in one event, or null.
 * @returns {Promise<{ role: string, participantStatus: string|null } | null>}
 */
async function eventRoleOf(userId, eventId) {
  const r = await db.query(
    `SELECT
       EXISTS (SELECT 1 FROM events e
                WHERE e.id = $2
                  AND (e.created_by = $1
                       OR EXISTS (SELECT 1 FROM customer_contacts cc
                                   WHERE cc.user_id = $1 AND cc.customer_id = e.customer_id
                                     AND cc.member_role = ANY($3::text[])))) AS organizer,
       EXISTS (SELECT 1 FROM judges             WHERE event_id = $2 AND user_id = $1) AS judge,
       EXISTS (SELECT 1 FROM mentor_assignments WHERE event_id = $2 AND user_id = $1) AS mentor,
       EXISTS (SELECT 1 FROM volunteers         WHERE event_id = $2 AND user_id = $1) AS volunteer,
       (SELECT LOWER(TRIM(COALESCE(status::text, 'pending'))) FROM participants
         WHERE event_id = $2 AND user_id = $1 LIMIT 1) AS participant_status`,
    [userId, eventId, ORG_MANAGER_ROLES],
  );
  const row = r.rows[0] || {};
  const has = { ...row, participant: row.participant_status != null };
  const role = PRIORITY.find((k) => has[k]) || null;
  return role ? { role, participantStatus: row.participant_status ?? null } : null;
}

/** Whether the person manages at least one active organisation. */
async function managesAnOrganisation(userId) {
  const r = await db.query(
    `SELECT 1 FROM customer_contacts cc
       JOIN customers c ON c.id = cc.customer_id
      WHERE cc.user_id = $1 AND cc.member_role = ANY($2::text[])
        AND c.status IN ('active', 'pending_setup') AND c.archived_at IS NULL
      LIMIT 1`,
    [userId, ORG_MANAGER_ROLES],
  );
  return r.rows.length > 0;
}

/**
 * Sets req.user.role to the role for this request and keeps the stored one
 * in req.user.baseRole. Never touches a platform owner.
 */
async function applyEffectiveRole(req, user) {
  if (!user) return user;
  user.baseRole = user.role;
  const base = normalizeRole(user.role);
  if (base === 'superadmin') return user;

  const eventId = contextEventId(req);
  if (eventId) {
    const found = await eventRoleOf(user.id, eventId);
    if (found) {
      user.eventRole = found.role;
      user.contextEventId = eventId;
      user.participantStatus = found.participantStatus;
      // An organiser whose stored role is already an admin one keeps it.
      if (!(found.role === 'organizer' && isAdminRole(base))) user.role = ROLE_FOR[found.role];
      return user;
    }
  }
  if (!isAdminRole(base) && (await managesAnOrganisation(user.id))) user.role = 'org_admin';
  return user;
}

/**
 * Everything a person can open: organisations they manage and events they
 * have a role in. Feeds the "My workspaces" picker.
 */
async function listWorkspaces(userId) {
  const orgs = await db.query(
    `SELECT c.id, c.name, c.slug, c.status, c.logo_url, cc.member_role AS role
       FROM customer_contacts cc
       JOIN customers c ON c.id = cc.customer_id
      WHERE cc.user_id = $1 AND c.archived_at IS NULL
      ORDER BY c.name`,
    [userId],
  );
  const events = await db.query(
    `WITH roles AS (
       SELECT e.id AS event_id, 'organizer' AS role, NULL::text AS participant_status
         FROM events e
        WHERE e.created_by = $1
           OR EXISTS (SELECT 1 FROM customer_contacts cc
                       WHERE cc.user_id = $1 AND cc.customer_id = e.customer_id
                         AND cc.member_role = ANY($2::text[]))
       UNION ALL SELECT event_id, 'judge', NULL FROM judges WHERE user_id = $1
       UNION ALL SELECT event_id, 'mentor', NULL FROM mentor_assignments WHERE user_id = $1
       UNION ALL SELECT event_id, 'volunteer', NULL FROM volunteers WHERE user_id = $1
       UNION ALL SELECT event_id, 'participant', LOWER(TRIM(COALESCE(status::text, 'pending')))
                   FROM participants WHERE user_id = $1
     )
     SELECT e.id, e.name, e.event_code, e.customer_id, e.start_date, e.end_date,
            LOWER(TRIM(COALESCE(e.status::text, ''))) AS status,
            r.role, r.participant_status
       FROM roles r
       JOIN events e ON e.id = r.event_id
      ORDER BY e.start_date DESC NULLS LAST, e.id DESC`,
    [userId, ORG_MANAGER_ROLES],
  );
  // One entry per event, strongest role first.
  const byEvent = new Map();
  for (const row of events.rows) {
    const prev = byEvent.get(row.id);
    if (!prev || PRIORITY.indexOf(row.role) < PRIORITY.indexOf(prev.role)) byEvent.set(row.id, row);
  }
  return { organizations: orgs.rows, events: [...byEvent.values()] };
}

module.exports = {
  contextEventId,
  participantEventId,
  eventRoleOf,
  managesAnOrganisation,
  applyEffectiveRole,
  listWorkspaces,
  ORG_MANAGER_ROLES,
  ROLE_FOR,
};
