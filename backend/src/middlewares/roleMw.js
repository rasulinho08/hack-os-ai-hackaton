/**
 * @file roleMw.js
 * @description Role-Based Access Control (RBAC) middleware factory.
 *
 * Accepts one or more role aliases and returns a middleware that checks
 * whether `req.user.role` is among the allowed roles.
 *
 * Shorthand aliases:
 *   - `'admin'`  → expands to `['superadmin', 'admin', 'org_admin']`
 *   - `'superadmin'` → exact; nothing else satisfies it
 *   - `'hacker'` → expands to `['hacker', 'pending']`
 *
 * Usage:
 *   router.get('/admin-only', authMw, roleMw('admin'), handler);
 *   router.get('/mentors-or-admin', authMw, roleMw('admin', 'mentor'), handler);
 */

const { ROLES, ADMIN_ROLES } = require('../constants/roles');

/**
 * Middleware factory for role-based access control.
 *
 * @param {...string} roles - Allowed role(s). Supports shorthand aliases.
 * @returns {import('express').RequestHandler}
 */
const roleMw = (...roles) => {
  // Expand shorthand aliases to concrete role strings
  const allowed = roles.flatMap((r) => {
    // A superadmin can do anything an admin can; the reverse is not true, so
    // `roleMw(ROLES.SUPERADMIN)` stays exact.
    if (r === ROLES.ADMIN)  return ADMIN_ROLES;
    if (r === ROLES.HACKER) return [ROLES.HACKER, ROLES.PENDING];
    return [r];
  });

  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. Insufficient permissions.',
      });
    }
    next();
  };
};

module.exports = roleMw;
