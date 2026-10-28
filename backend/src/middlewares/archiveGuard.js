/**
 * @file archiveGuard.js
 * @description An archived event is read-only (decision E13): every request
 * that would change something in it is refused with 409 EVENT_ARCHIVED.
 *
 * One guard in front of every router, so no route can forget it. It looks at
 * writes only (POST, PUT, PATCH, DELETE) on the paths that belong to an
 * event, and finds the event the way each family of routes names it:
 *
 *   /api/events/:id/...                    the id in the path
 *   /api/teams/:id, /api/submissions/:id,  the row's event
 *   /api/tickets/:id, /api/announcements/:id,
 *   /api/team-invites/:id, /api/teams/requests/:id, /api/files/:id
 *   eventId / event_id in the body or query  creates (a team, a project, a
 *                                            help request, an upload…)
 *   joinCode                               joining a team by its code
 *   eventCode                              signing up for an event
 *   /api/public/events/:slug/register      registering on the event page
 *
 * What stays possible on an archived event: bringing it back (unarchive),
 * archiving it again, deleting it, sending its certificates again and a
 * mentor's presence ping. Reading — including the ZIP export — is never
 * affected.
 *
 * The 409 is only told to people who may see the event; anyone else goes on
 * to the route, which answers them as it would for any event they cannot
 * reach (404), so the guard does not reveal which events exist. Signing up
 * for an archived event is refused for everyone: its page says it is over.
 */

const db = require('../config/db');
const { optionalAuthMw } = require('./authMw');
const { userMayAccessEvent } = require('../services/tenantAccess.service');

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const ALLOWED = [
  ['POST', /^\/api\/events\/\d+\/(archive|unarchive)\/?$/],
  ['DELETE', /^\/api\/events\/\d+\/?$/],
  ['POST', /^\/api\/events\/\d+\/certificates\/email\/?$/],
  ['POST', /^\/api\/events\/\d+\/mentors\/me\/heartbeat\/?$/],
  // Reading an archived chat moves one's own read mark; nothing else changes.
  ['POST', /^\/api\/events\/\d+\/chat\/channels\/\d+\/read\/?$/],
];

/* Paths that never touch an event's content: sessions, accounts, billing. */
const SCOPED = /^\/api\/(events|teams|team-invites|submissions|tickets|announcements|files|mail\/staff-invite|auth\/register|public\/events)(\/|$)/;

const BY_ROW = [
  [/^\/api\/teams\/requests\/(\d+)/, 'SELECT t.event_id FROM team_join_requests r JOIN teams t ON t.id = r.team_id WHERE r.id = $1'],
  [/^\/api\/teams\/(\d+)/, 'SELECT event_id FROM teams WHERE id = $1'],
  [/^\/api\/submissions\/(\d+)/, 'SELECT event_id FROM submissions WHERE id = $1'],
  [/^\/api\/tickets\/(\d+)/, 'SELECT event_id FROM help_tickets WHERE id = $1'],
  [/^\/api\/announcements\/(\d+)/, 'SELECT event_id FROM announcements WHERE id = $1'],
  [/^\/api\/team-invites\/(\d+)/, 'SELECT event_id FROM team_invites WHERE id = $1'],
  [/^\/api\/files\/([0-9a-f-]{36})/i, 'SELECT event_id FROM files WHERE id = $1'],
];

const asId = (v) => {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 && String(n) === String(v ?? '').trim() ? n : null;
};

/**
 * The events a request would write to: SQL that yields event ids, and
 * whether the refusal is for everyone (`open`, signing up) or only for those
 * who may see the event. Exported for the unit test.
 * @returns {Array<{ sql: string, params: Array, open?: boolean }>}
 */
function targets(method, path, body = {}, query = {}) {
  if (!WRITES.has(method) || !SCOPED.test(path)) return [];
  if (ALLOWED.some(([m, re]) => m === method && re.test(path))) return [];
  const out = [];
  const byId = (id) => out.push({ sql: 'SELECT $1::int AS event_id', params: [id] });
  const inPath = path.match(/^\/api\/events\/(\d+)(\/|$)/);
  if (inPath) byId(Number(inPath[1]));
  for (const [re, sql] of BY_ROW) {
    const m = path.match(re);
    if (m) { out.push({ sql, params: [m[1]] }); break; }
  }
  const b = body && typeof body === 'object' ? body : {};
  const q = query && typeof query === 'object' ? query : {};
  for (const v of [b.eventId, b.event_id, q.eventId, q.event_id]) {
    const id = asId(v);
    if (id) byId(id);
  }
  const joinCode = String(b.joinCode ?? b.join_code ?? '').trim();
  if (/^\/api\/teams\/join\/?$/.test(path) && joinCode) {
    out.push({ sql: 'SELECT event_id FROM teams WHERE join_code = $1', params: [joinCode] });
  }
  if (/^\/api\/auth\/register\/?$/.test(path)) {
    const eventCode = String(b.eventCode ?? b.event_code ?? '').trim();
    if (eventCode) out.push({ sql: 'SELECT id AS event_id FROM events WHERE event_code = $1', params: [eventCode], open: true });
    for (const o of out) o.open = true;
  }
  const slug = path.match(/^\/api\/public\/events\/([^/]+)\/register\/?$/);
  if (slug) {
    let s = slug[1];
    try { s = decodeURIComponent(s); } catch (_) { /* keep as typed */ }
    out.push({ sql: 'SELECT id AS event_id FROM events WHERE slug = $1', params: [s], open: true });
  }
  return out;
}

/** The first archived event among the targets, with whether its refusal is for everyone. */
async function archivedAmong(queries) {
  for (const { sql, params, open } of queries) {
    // eslint-disable-next-line no-await-in-loop
    const r = await db.query(
      `SELECT e.id FROM events e
        WHERE e.id IN (${sql})
          AND (e.archived_at IS NOT NULL OR LOWER(TRIM(COALESCE(e.status::text, ''))) = 'archived')
        LIMIT 1`,
      params,
    );
    if (r.rows[0]) return { id: Number(r.rows[0].id), open: Boolean(open) };
  }
  return null;
}

const run = (mw, req, res) => new Promise((resolve, reject) => mw(req, res, (err) => (err ? reject(err) : resolve())));

const archiveGuard = async (req, res, next) => {
  try {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    const queries = targets(req.method, path, req.body, req.query);
    if (!queries.length) return next();
    const hit = await archivedAmong(queries);
    if (!hit) return next();
    if (!hit.open) {
      if (req.user === undefined) await run(optionalAuthMw, req, res);
      if (!req.user || !(await userMayAccessEvent(req.user, hit.id))) return next();
    }
    return res.status(409).json({
      success: false,
      message: 'This event is archived and can only be read. Restore it to make changes.',
      code: 'EVENT_ARCHIVED',
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = { archiveGuard, targets };
