/**
 * @file eventAccess.js
 * @description Tenant guards. See services/tenantAccess.service.js for the
 * rule; this file only wires it to Express.
 *
 *   eventAccess        — for app.js mounts under /api/events/:eventId/...
 *                        Runs before the sub-router, so it loads the session
 *                        itself (optionally; the sub-router's authMw still
 *                        decides whether a session is required at all).
 *   eventAccessById    — for event.routes.js, where the event id is `:id`.
 *                        Runs after authMw.
 *   byIdEventAccess(t) — for resources that carry an event_id in table `t`
 *                        (announcements, submissions, help_tickets, teams),
 *                        keyed by req.params.id. Runs after authMw.
 */

const db = require('../config/db');
const { optionalAuthMw } = require('./authMw');
const { userMayAccessEvent } = require('../services/tenantAccess.service');
const { isAdminUser } = require('../utils/authz');

const notFound = (res, what = 'Event') =>
  res.status(404).json({ success: false, message: `${what} not found`, code: 'NOT_FOUND' });

const run = (mw, req, res) =>
  new Promise((resolve, reject) => mw(req, res, (err) => (err ? reject(err) : resolve())));

const eventAccess = async (req, res, next) => {
  try {
    if (req.user === undefined) await run(optionalAuthMw, req, res);
    if (!(await userMayAccessEvent(req.user, req.params.eventId))) return notFound(res);
    return next();
  } catch (err) {
    return next(err);
  }
};

const eventAccessById = async (req, res, next) => {
  try {
    if (!(await userMayAccessEvent(req.user, req.params.id))) return notFound(res);
    return next();
  } catch (err) {
    return next(err);
  }
};

const ALLOWED_TABLES = new Set(['announcements', 'submissions', 'help_tickets', 'teams']);

const byIdEventAccess = (table, { gateHackers = false, label = 'Resource' } = {}) => {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`byIdEventAccess: unknown table ${table}`);
  return async (req, res, next) => {
    try {
      // Judges, mentors and volunteers are already checked against their
      // assignment inside each controller (and answer 403 there); this guard
      // closes the gap for organisers, who had no such check.
      if (!isAdminUser(req.user)) return next();
      const id = Number(req.params.id);
      if (!Number.isFinite(id) || id <= 0) return notFound(res, label);
      const r = await db.query(`SELECT event_id FROM ${table} WHERE id = $1`, [id]);
      if (!r.rows[0]) return notFound(res, label);
      if (!(await userMayAccessEvent(req.user, r.rows[0].event_id, { gateHackers }))) {
        return notFound(res, label);
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
};

/**
 * For routes mounted under /api/events/:eventId/<things>/:id — the row named
 * by :id must belong to :eventId.
 *
 * The mount's eventAccess checks the caller may act on :eventId, but several
 * services update or delete by id alone, so an organiser of event A could
 * edit or delete event B's prizes, sponsors, tracks, mentors, presentations,
 * certificates, feedback or settings by putting B's ids under A's URL.
 * Requires the router to be created with { mergeParams: true }.
 */
const SCOPED_TABLES = new Set([
  'prizes', 'sponsors', 'tracks', 'mentor_assignments', 'presentations',
  'certificates', 'feedback', 'event_settings', 'volunteers', 'event_resources',
]);
const rowInEvent = (table, label = 'Resource') => {
  if (!SCOPED_TABLES.has(table)) throw new Error(`rowInEvent: unknown table ${table}`);
  return async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const eventId = Number(req.params.eventId);
      if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(eventId)) return notFound(res, label);
      const r = await db.query(`SELECT 1 FROM ${table} WHERE id = $1 AND event_id = $2`, [id, eventId]);
      return r.rows[0] ? next() : notFound(res, label);
    } catch (err) {
      return next(err);
    }
  };
};

/**
 * For reads a participant may make only on events they are registered for.
 *
 * The mount-level eventAccess lets hackers through on purpose (they read
 * public event information before joining), so judges and mentors with their
 * e-mail addresses, the leaderboard, resources and the presentation order of
 * ANY event were readable by any signed-in hacker. Everyone else is decided
 * exactly as by eventAccess.
 */
const participantsOnly = async (req, res, next) => {
  try {
    if (!(await userMayAccessEvent(req.user, req.params.eventId, { gateHackers: true }))) return notFound(res);
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = { eventAccess, eventAccessById, byIdEventAccess, rowInEvent, participantsOnly };
