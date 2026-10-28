/**
 * @file roles.js
 * @description Centralized role constants for the Hackathon Management System.
 *
 * Usage:
 *   const { ROLES, ADMIN_ROLES } = require('../constants/roles');
 *   if (user.role === ROLES.ADMIN) { ... }
 *   roleMw(...ADMIN_ROLES)
 */

/**
 * All possible user roles in the system.
 * @readonly
 * @enum {string}
 */
const ROLES = Object.freeze({
  /**
   * Platform owner — us, not a customer. The only role that may see every
   * event on the installation and reach the commercial endpoints.
   */
  SUPERADMIN: 'superadmin',
  /** Customer administrator — runs their own organisation's events */
  ADMIN: 'admin',
  /** Organization admin — event management access */
  ORG_ADMIN: 'org_admin',
  /** Hackathon participant — regular hacker */
  HACKER: 'hacker',
  /** Newly registered user awaiting role assignment */
  PENDING: 'pending',
  /** Mentor assigned to an event */
  MENTOR: 'mentor',
  /** Judge assigned to score submissions */
  JUDGE: 'judge',
  /** Volunteer helping with event logistics */
  VOLUNTEER: 'volunteer',
});

/**
 * Roles with administrative privileges.
 * Expands `admin` in roleMw to include both `admin` and `org_admin`.
 * @type {string[]}
 */
const ADMIN_ROLES = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.ORG_ADMIN];

/**
 * Roles that own the platform rather than rent it.
 *
 * Deliberately separate from ADMIN_ROLES: a superadmin can do everything an
 * admin can, but an admin must not be able to do everything a superadmin can.
 * @type {string[]}
 */
const OWNER_ROLES = [ROLES.SUPERADMIN];

/**
 * Roles in the hacker category (including pending registrations).
 * Expands `hacker` in roleMw to include both `hacker` and `pending`.
 * @type {string[]}
 */
const HACKER_ROLES = [ROLES.HACKER, ROLES.PENDING];

/**
 * Roles that can access event-scoped resources (non-admin participants).
 * @type {string[]}
 */
const EVENT_PARTICIPANT_ROLES = [ROLES.HACKER, ROLES.PENDING, ROLES.MENTOR, ROLES.JUDGE, ROLES.VOLUNTEER];

/**
 * All roles that are valid in the database.
 * @type {string[]}
 */
const ALL_ROLES = Object.values(ROLES);

module.exports = {
  ROLES,
  ADMIN_ROLES,
  OWNER_ROLES,
  HACKER_ROLES,
  EVENT_PARTICIPANT_ROLES,
  ALL_ROLES,
};
