/**
 * @file authMw.js
 * @description JWT authentication middleware.
 *
 * Reads the `access_token` HTTP-only cookie (or an `Authorization: Bearer`
 * header for non-browser clients), verifies the JWT and then loads the
 * account from the database so that:
 *   - role changes (promote / demote) apply immediately, not after the
 *     30-day token expires,
 *   - deleted accounts are locked out instantly.
 *
 * `req.user` shape after successful auth:
 *   { id, role, email, full_name, token_version,
 *     dbRole      — users.role as stored,
 *     role        — the role THIS request runs under (see effectiveRole.service),
 *     eventRole, contextEventId, participantStatus — when the request names an event,
 *     platformRole, elevated, elevationRequired — for the platform owner }
 *
 * Usage:
 *   router.get('/protected', authMw, handler);
 *   router.get('/public-or-personalised', authMw.optionalAuthMw, handler);
 */

const { verifyToken } = require('../utils/jwtHelper');
const db = require('../config/db');
const { normalizeRole } = require('../utils/authz');
const { applyEffectiveRole } = require('../services/effectiveRole.service');

const parseList = (v) => String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

function extractToken(req) {
  const cookie = req.cookies?.access_token;
  if (cookie) return cookie;
  const header = req.headers.authorization || '';
  if (/^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
  return null;
}

async function loadUserFromToken(token) {
  const decoded = verifyToken(token);
  if (!decoded || decoded.id == null) return null;
  const result = await db.query(
    'SELECT id, role, email, full_name, token_version, email_verified_at FROM users WHERE id = $1',
    [decoded.id],
  );
  const user = result.rows[0];
  if (!user) return null;
  // Bumping users.token_version (password change, reset, "sign out
  // everywhere") ends every session issued before it. Tokens from before
  // versions existed carry none and count as version 0.
  if (Number(decoded.tv ?? 0) !== Number(user.token_version || 0)) return null;
  return user;
}

/**
 * The platform owner needs more than the stored role:
 *   - SUPERADMIN_EMAILS (comma list), when set, names the only accounts that
 *     may hold it — a superadmin row for anyone else is treated as admin;
 *   - SUPERADMIN_PIN, when set, is a second step after the password. Until
 *     the hh_elev cookie proves it was entered (12 h, tied to the session
 *     version), the account works as a plain admin.
 */
function applyOwnerChecks(req, user) {
  user.dbRole = user.role;
  if (normalizeRole(user.role) !== 'superadmin') return;
  const allow = parseList(process.env.SUPERADMIN_EMAILS);
  if (allow.length && !allow.includes(String(user.email || '').toLowerCase())) {
    user.role = 'admin';
    user.ownerDenied = true;
    return;
  }
  user.platformRole = 'superadmin';
  if (!String(process.env.SUPERADMIN_PIN || '').trim()) {
    user.elevated = true;
    return;
  }
  const elev = verifyToken(req.cookies?.hh_elev || '');
  const ok = Boolean(elev && elev.purpose === 'elevate' && elev.id === user.id
    && Number(elev.tv ?? 0) === Number(user.token_version || 0));
  user.elevated = ok;
  if (!ok) {
    user.role = 'admin';
    user.elevationRequired = true;
  }
}

/** Owner checks, then the role this request runs under. */
async function finishUser(req, user) {
  if (!user) return null;
  applyOwnerChecks(req, user);
  await applyEffectiveRole(req, user);
  return user;
}

const authMw = async (req, res, next) => {
  try {
    // The tenant guard on event-scoped mounts may already have loaded the
    // account; do not look it up twice.
    if (req.user) return next();
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
        code: 'UNAUTHENTICATED',
      });
    }

    const user = await finishUser(req, await loadUserFromToken(token));
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token.',
        code: 'UNAUTHENTICATED',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/** Like authMw but never rejects — `req.user` is null for anonymous callers. */
const optionalAuthMw = async (req, res, next) => {
  try {
    const token = extractToken(req);
    req.user = token ? await finishUser(req, await loadUserFromToken(token)) : null;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = authMw;
module.exports.optionalAuthMw = optionalAuthMw;
module.exports.loadUserFromToken = loadUserFromToken;
module.exports.finishUser = finishUser;
