/**
 * @file requireModule.js
 * @description Refuses a feature the event's plan does not include.
 *
 * Mounted next to eventExists/eventAccess on the event-scoped routes, so the
 * event is known from :eventId; on routes keyed some other way it reads the
 * body's event, as their controllers do, or ?eventId= when the body names
 * none, and lets the request through when no event is named (the
 * controller's own checks still apply). A request naming two different
 * events is refused: checking one plan while the action lands on the other
 * would let any event's plan open a feature. The platform owner is never
 * stopped. The web app draws a lock from the same rule
 * (GET /api/events/:eventId/modules), but typing the address is not a way in.
 */

const { forEvent } = require('../services/entitlement.service');
const { normalizeRole } = require('../utils/authz');

const MODULE_DISABLED_MESSAGE = 'This feature is not part of the plan this event runs on.';

function idFrom(raw) {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The event a request is about; `false` when it names two different ones. */
function eventIdOf(req) {
  const fromRoute = idFrom(req.params?.eventId);
  if (fromRoute) return fromRoute;
  const fromBody = idFrom(req.body?.eventId ?? req.body?.event_id);
  const fromQuery = idFrom(req.query?.eventId ?? req.query?.event_id);
  if (fromBody && fromQuery && fromBody !== fromQuery) return false;
  return fromBody || fromQuery;
}

/** Whether an event's plan includes a module (an event without a plan is not limited). */
async function moduleEnabled(eventId, key) {
  const scope = await forEvent(eventId);
  return !scope || scope.modules.has(key);
}

function requireModule(key) {
  return async (req, res, next) => {
    try {
      if (req.user && normalizeRole(req.user.role) === 'superadmin') return next();
      const eventId = eventIdOf(req);
      if (eventId === false) {
        return res.status(400).json({
          success: false,
          message: 'The request names two different events.',
          code: 'EVENT_MISMATCH',
        });
      }
      if (!eventId || (await moduleEnabled(eventId, key))) return next();
      return res.status(403).json({
        success: false,
        message: MODULE_DISABLED_MESSAGE,
        code: 'MODULE_DISABLED',
        module: key,
      });
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = requireModule;
module.exports.moduleEnabled = moduleEnabled;
module.exports.MODULE_DISABLED_MESSAGE = MODULE_DISABLED_MESSAGE;
