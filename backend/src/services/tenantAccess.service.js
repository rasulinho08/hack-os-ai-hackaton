/**
 * @file tenantAccess.service.js
 * @description Which signed-in accounts may act on which event, and which
 * users an organiser may manage.
 *
 * One installation serves many organisations. roleMw answers what KIND of
 * account is calling; this module answers whether THIS account may touch
 * THAT event. Until it existed, any customer administrator could read,
 * change and delete another customer's event and reset the password of
 * another customer's administrator: every event-scoped route checked only
 * the role.
 *
 * Rules:
 *   - The platform owner (superadmin) may act on everything.
 *   - Organisers (admin / org_admin) may act on events they created, events
 *     of a customer they belong to, and events assigned to no customer at
 *     all (a single-tenant installation, or the changeover before events
 *     are assigned).
 *   - Judges, mentors and volunteers may act on events they are assigned to.
 *   - Hackers are not decided here: their access is gated per resource
 *     (approval, team membership) and they must be able to look at public
 *     event information before they join. Where a hacker must be a member
 *     (announcements), the caller passes { gateHackers: true } and the rule
 *     is their participant row.
 *   - An organiser may manage a user who belongs to one of their events (as
 *     participant, judge, mentor, volunteer or creator) or to the same
 *     customer, and never a platform owner.
 *
 * Refusals are 404s: whether an event exists is itself tenant data.
 */

const db = require('../config/db');
const { canUserSeeEvent, getEventsVisibleTo, getActiveEvent } = require('./event.service');
const { isAdminUser, isOwnerUser, normalizeRole } = require('../utils/authz');

/**
 * Whether an organiser also sees events that belong to no customer.
 *
 * Off by default. It was on for every organiser while 0007's changeover ran,
 * and with self-serve checkout that meant any new buyer could read and
 * change other organisations' unassigned events. LEGACY_SHARED_EVENTS=true
 * brings it back for a single-organisation installation with no public
 * checkout; never set it where strangers can become organisers.
 */
const seesUnassignedEvents = (user) =>
  isAdminUser(user) &&
  String(process.env.LEGACY_SHARED_EVENTS || '').trim().toLowerCase() === 'true';

const isHackerLike = (user) => {
  const r = normalizeRole(user && user.role);
  return r === 'hacker' || r === 'pending';
};

/**
 * @param {object|null} user  req.user (null for anonymous callers)
 * @param {number|string} eventId
 * @param {{ gateHackers?: boolean }} [opts]
 * @returns {Promise<boolean>}
 */
async function userMayAccessEvent(user, eventId, { gateHackers = false } = {}) {
  if (!user) return true; // anonymous: the route's own auth decides
  if (isOwnerUser(user)) return true;
  if (isHackerLike(user) && !gateHackers) return true;
  const id = Number(eventId);
  if (!Number.isFinite(id) || id <= 0) return false;
  return canUserSeeEvent(user.id, id, { includeUnassigned: seesUnassignedEvents(user) });
}

/** The ids of every event the user may act on (owner: null = everything). */
async function visibleEventIds(user) {
  if (!user) return new Set();
  if (isOwnerUser(user)) return null;
  const rows = await getEventsVisibleTo(user.id, { includeUnassigned: seesUnassignedEvents(user) });
  return new Set(rows.map((e) => Number(e.id)));
}

/**
 * The event to show when the caller did not name one, chosen only among the
 * events they may see. The platform-wide pick handed every organiser, judge
 * and mentor whichever event happened to be running — another customer's.
 */
async function activeEventFor(user) {
  const ids = await visibleEventIds(user);
  if (ids === null) return getActiveEvent();
  if (ids.size === 0) return null;
  return getActiveEvent({ amongIds: [...ids] });
}

/** Keeps the rows whose event the user may act on. */
async function filterByVisibleEvent(user, rows, getEventId = (r) => r.event_id) {
  const ids = await visibleEventIds(user);
  if (ids === null) return rows;
  return rows.filter((r) => ids.has(Number(getEventId(r))));
}

/* SQL fragments: `u` is the users row under test, $1 the acting organiser. */
const ADMIN_EVENT_SCOPE_SQL = `(e.created_by = $1
      OR EXISTS (SELECT 1 FROM customer_contacts cc
                  WHERE cc.user_id = $1 AND cc.customer_id = e.customer_id))`;

const USER_IN_EVENT_SQL = `(e.created_by = u.id
      OR EXISTS (SELECT 1 FROM participants       m WHERE m.event_id = e.id AND m.user_id = u.id)
      OR EXISTS (SELECT 1 FROM judges             m WHERE m.event_id = e.id AND m.user_id = u.id)
      OR EXISTS (SELECT 1 FROM mentor_assignments m WHERE m.event_id = e.id AND m.user_id = u.id)
      OR EXISTS (SELECT 1 FROM volunteers         m WHERE m.event_id = e.id AND m.user_id = u.id))`;

/** `u.role`, `u.id` must be in scope; $1 = acting organiser's user id. */
const MANAGEABLE_USER_SQL = `(LOWER(u.role) <> 'superadmin' AND (
      u.id = $1
      OR EXISTS (SELECT 1 FROM customer_contacts a
                   JOIN customer_contacts b ON b.customer_id = a.customer_id
                  WHERE a.user_id = $1 AND b.user_id = u.id)
      OR EXISTS (SELECT 1 FROM events e WHERE ${ADMIN_EVENT_SCOPE_SQL} AND ${USER_IN_EVENT_SQL})))`;

/**
 * May this organiser read or change this user?
 * Non-organisers may only manage themselves; owners may manage anyone.
 */
async function adminMayManageUser(actor, targetUserId) {
  if (!actor) return false;
  if (isOwnerUser(actor)) return true;
  if (String(actor.id) === String(targetUserId)) return true;
  if (!isAdminUser(actor)) return false;
  const id = Number(targetUserId);
  if (!Number.isFinite(id) || id <= 0) return false;
  const r = await db.query(
    `SELECT 1 FROM users u WHERE u.id = $2 AND ${MANAGEABLE_USER_SQL} LIMIT 1`,
    [actor.id, id],
  );
  return r.rows.length > 0;
}

/**
 * May this organiser change this account — its profile, role, password, or
 * delete it?
 *
 * Stricter than adminMayManageUser. Appearing in an organiser's event is not
 * authority over someone's account: an organiser can put any existing account
 * into their event by adding it as a judge, and that used to be enough to
 * reset the password of another organisation's administrator. Only the
 * platform owner, the person themselves, and the owner or an admin of an
 * organisation the person belongs to (never its owner, unless the actor is
 * the owner) may change an account.
 */
async function adminMayChangeAccount(actor, targetUserId) {
  if (!actor) return false;
  if (isOwnerUser(actor)) return true;
  if (String(actor.id) === String(targetUserId)) return true;
  if (!isAdminUser(actor)) return false;
  const id = Number(targetUserId);
  if (!Number.isFinite(id) || id <= 0) return false;
  const r = await db.query(
    `SELECT 1 FROM users u
      WHERE u.id = $2 AND LOWER(u.role) <> 'superadmin'
        AND EXISTS (SELECT 1 FROM customer_contacts a
                      JOIN customer_contacts b ON b.customer_id = a.customer_id
                     WHERE a.user_id = $1 AND b.user_id = u.id
                       AND a.member_role IN ('owner', 'admin')
                       AND (b.member_role <> 'owner' OR a.member_role = 'owner'))
      LIMIT 1`,
    [actor.id, id],
  );
  return r.rows.length > 0;
}

module.exports = {
  activeEventFor,
  adminMayChangeAccount,
  seesUnassignedEvents,
  userMayAccessEvent,
  visibleEventIds,
  filterByVisibleEvent,
  adminMayManageUser,
  MANAGEABLE_USER_SQL,
};
