/**
 * @file user.controller.js
 * @description HTTP handlers for user management (admin-only operations + profile updates).
 *
 * Routes:
 *   POST   /api/users          → createUser   (admin)
 *   GET    /api/users          → getUsers     (admin)
 *   GET    /api/users/:id      → getUserById  (admin)
 *   PATCH  /api/users/:id      → updateUser   (self or admin)
 *   DELETE /api/users/:id      → deleteUser   (admin)
 *   PATCH  /api/users/:id/role → changeUserRole (admin)
 */

const userService  = require('../services/user.service');
const authService  = require('../services/auth.service');
const { setPasswordSchema } = require('../validations/auth.schema');
const { ALL_ROLES, ADMIN_ROLES, ROLES } = require('../constants/roles');
const { isOwnerUser, normalizeRole } = require('../utils/authz');
const {
  successResponse,
  errorResponse,
  errorFromException,
  paginatedResponse,
} = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { adminMayChangeAccount, adminMayManageUser, userMayAccessEvent } = require('../services/tenantAccess.service');

/**
 * What an organiser sees of someone who is only in one of their events (and
 * not in their organisation): the account's name and contact, not the profile
 * the person filled in elsewhere. An organiser can put any existing account
 * into their event as a judge; that must not hand them its phone or age.
 * Participants' registration details reach the organiser through the
 * participants list, with the event's own questions.
 */
const EVENT_ONLY_FIELDS = ['id', 'full_name', 'email', 'role', 'avatar', 'github_link', 'linkedin', 'skills', 'created_at'];
const audit = require('../services/audit.service');
const jobs = require('../services/jobs.service');

/** Returns true if the authenticated user is a platform admin (admin or org_admin). */
const isAdmin = (user) => ADMIN_ROLES.includes(String(user?.role || '').trim());

// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/users
 * Admin creates a user account directly (bypasses invite flow).
 *
 * @type {import('express').RequestHandler}
 */
const createUser = async (req, res, next) => {
  try {
    /*
     * Platform owner only. This route accepted any role from any organiser,
     * and self-serve checkout makes any visitor an organiser — so anyone on
     * the internet could create a superadmin account and take over the
     * installation. The web app never calls it; customers add people through
     * invites, which carry tenant and seat checks.
     */
    if (!isOwnerUser(req.user)) {
      return errorResponse(res, HTTP.FORBIDDEN, 'Only the platform owner can create accounts directly', null, 'OWNER_ONLY');
    }
    const { fullName, email, password, role, githubLink } = req.body;

    if (!fullName || !email || !password) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'fullName, email and password are required');
    }
    if (!role || !ALL_ROLES.includes(role)) {
      return errorResponse(
        res, HTTP.BAD_REQUEST,
        `role must be one of: ${ALL_ROLES.join(', ')}`
      );
    }

    const user = await userService.createUserByAdmin({
      fullName,
      email: String(email).trim().toLowerCase(),
      password,
      role,
      githubLink,
    });

    return successResponse(res, HTTP.CREATED, 'User created successfully', user);
  } catch (error) {
    // Surface 409 conflict directly (duplicate email)
    if (error.statusCode === 409) {
      return errorResponse(res, HTTP.CONFLICT, error.message);
    }
    next(error);
  }
};

/**
 * GET /api/users
 * Paginated user directory for platform administrators only.
 * Query: ?role=&page=1&limit=25
 * Response: masked emails, minimal fields; never password_hash.
 *
 * @type {import('express').RequestHandler}
 */
const getUsers = async (req, res, next) => {
  try {
    const r = String(req.user?.role || '').trim();
    if (!ADMIN_ROLES.includes(r)) {
      return errorResponse(res, HTTP.FORBIDDEN, 'Forbidden. Administrator access required.');
    }
    const { role, page, limit } = req.query;
    const result = await userService.listUsersAdminPaged({
      role: role != null && String(role).trim() !== '' ? String(role).trim() : null,
      page,
      limit,
      // Organisers see the people of their own events and customer; the
      // platform owner sees everyone.
      visibleToAdminId: isOwnerUser(req.user) ? null : req.user.id,
    });
    return paginatedResponse(
      res,
      result.rows,
      result.total,
      result.page,
      result.limit,
    );
  } catch (error) {
    if (error.statusCode === 400) {
      return errorResponse(res, HTTP.BAD_REQUEST, error.message);
    }
    next(error);
  }
};

/**
 * GET /api/users/:id
 * Get a single user by their primary key.
 * Security: only admins OR the requesting user themselves can fetch this.
 *
 * @type {import('express').RequestHandler}
 */
const getUserById = async (req, res, next) => {
  try {
    // IDOR protection: non-admins can only view their own profile
    if (!isAdmin(req.user) && String(req.user.id) !== String(req.params.id)) {
      return errorResponse(res, HTTP.FORBIDDEN, 'Forbidden. You can only view your own profile.');
    }
    if (!(await adminMayManageUser(req.user, req.params.id))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'User not found');
    }
    const user = await userService.getUserById(req.params.id);
    if (!user) return errorResponse(res, HTTP.NOT_FOUND, 'User not found');
    if (!(await adminMayChangeAccount(req.user, req.params.id))) {
      return successResponse(res, HTTP.OK, 'OK', Object.fromEntries(EVENT_ONLY_FIELDS.map((k) => [k, user[k] ?? null])));
    }
    return successResponse(res, HTTP.OK, 'OK', user);
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/users/:id
 * Update profile fields (full_name, avatar, github_link).
 * Security: only admins OR the account owner can make updates.
 *
 * @type {import('express').RequestHandler}
 */
const updateUser = async (req, res, next) => {
  try {
    // IDOR protection: non-admins can only update their own profile
    if (!isAdmin(req.user) && String(req.user.id) !== String(req.params.id)) {
      return errorResponse(res, HTTP.FORBIDDEN, 'Forbidden. You can only update your own profile.');
    }
    if (!(await adminMayChangeAccount(req.user, req.params.id))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'User not found');
    }

    // Sanitize field lengths to prevent oversized payloads reaching the DB
    const safeBody = { ...req.body };
    if (safeBody.fullName   && String(safeBody.fullName).length   > 120) delete safeBody.fullName;
    if (safeBody.full_name  && String(safeBody.full_name).length  > 120) delete safeBody.full_name;
    if (safeBody.githubLink && String(safeBody.githubLink).length > 255) delete safeBody.githubLink;
    if (safeBody.avatar     && String(safeBody.avatar).length     > 500) delete safeBody.avatar;

    const updated = await userService.updateUser(req.params.id, safeBody);
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'User not found');
    return successResponse(res, HTTP.OK, 'User updated successfully', updated);
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/users/:id
 * Permanently delete a user (admin only).
 *
 * @type {import('express').RequestHandler}
 */
const deleteUser = async (req, res, next) => {
  try {
    if (!(await adminMayChangeAccount(req.user, req.params.id))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'User not found');
    }
    await userService.deleteUser(req.params.id);
    audit.record(req, 'user.delete', { targetType: 'user', targetId: req.params.id });
    return successResponse(res, HTTP.OK, 'User deleted successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/users/:id/role
 * Change a user's role (admin only).
 *
 * @type {import('express').RequestHandler}
 */
const changeUserRole = async (req, res, next) => {
  try {
    const { role } = req.body;

    if (!role || !ALL_ROLES.includes(role)) {
      return errorResponse(
        res, HTTP.BAD_REQUEST,
        `role must be one of: ${ALL_ROLES.join(', ')}`
      );
    }

    /*
     * Only the platform owner may hand out or take away platform ownership.
     *
     * This route is behind roleMw('admin'), which now includes superadmin —
     * without this check any customer administrator could promote themselves
     * to superadmin and reach every event and every order on the installation.
     * The same guard covers demotion, so an admin cannot strip the owner.
     */
    if (!(await adminMayChangeAccount(req.user, req.params.id))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'User not found');
    }
    const target = await userService.getUserById(req.params.id);
    const grantingOwner = normalizeRole(role) === ROLES.SUPERADMIN;
    const removingOwner = target && normalizeRole(target.role) === ROLES.SUPERADMIN;
    if ((grantingOwner || removingOwner) && !isOwnerUser(req.user)) {
      return errorResponse(
        res, HTTP.FORBIDDEN,
        'Only the platform owner can change platform-owner access',
        null, 'OWNER_ROLE_PROTECTED',
      );
    }

    const updated = await userService.changeUserRole(req.params.id, role);
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'User not found');
    audit.record(req, 'user.role.change', { targetType: 'user', targetId: req.params.id, meta: { role } });
    return successResponse(res, HTTP.OK, 'User role updated successfully', updated);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/users/bulk-import
 * Import multiple users from CSV data (admin only).
 * Creates user accounts + participant records.
 *
 * Body: { users: [...], eventId: number, defaultPassword?: string }
 *
 * @type {import('express').RequestHandler}
 */
const bulkImport = async (req, res, next) => {
  try {
    const { users, eventId, defaultPassword } = req.body;

    if (!Array.isArray(users) || users.length === 0) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'users array is required and must not be empty');
    }
    if (!eventId) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'eventId is required');
    }
    // The event must be one this organiser manages; the import used to accept
    // any event id, including other customers'.
    if (!(await userMayAccessEvent(req.user, eventId))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Event not found');
    }

    const result = await userService.bulkImportUsers(users, eventId, defaultPassword);
    // New accounts choose their own password from an e-mail; nobody else sees one.
    for (const acc of result.newAccounts) {
      // eslint-disable-next-line no-await-in-loop
      await jobs.enqueue('account.welcome', { userId: acc.userId, eventId: Number(eventId) }, { dedupeKey: `welcome:${acc.userId}:${eventId}` });
    }
    audit.record(req, 'participant.imported', { eventId: Number(eventId), targetType: 'event', targetId: eventId, meta: { created: result.created, skipped: result.skipped } });
    return successResponse(res, HTTP.CREATED, `Import complete: ${result.created} created, ${result.skipped} skipped`, {
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
      welcomed: result.newAccounts.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/users/:id/password   { password }
 * Sets a new (temporary) password: the platform owner for anyone, an
 * organisation's owner or admin for its own members.
 */
const setPassword = async (req, res, next) => {
  try {
    const { password } = setPasswordSchema.parse(req.body);
    // Only the owner, or the owner/an admin of the person's own organisation.
    // Being in an organiser's event is not enough: anyone can be added to an
    // event as a judge. People who never chose a password use "Forgot
    // password" (imports send them a link to set one).
    if (!(await adminMayChangeAccount(req.user, req.params.id))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'User not found');
    }
    const updated = await authService.setPasswordByAdmin(req.params.id, password);
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'User not found');
    audit.record(req, 'user.password.set', { targetType: 'user', targetId: req.params.id });
    return successResponse(res, HTTP.OK, 'Password updated', updated);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

module.exports = {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  changeUserRole,
  bulkImport,
  setPassword,
};
