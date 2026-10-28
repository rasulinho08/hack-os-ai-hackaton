/**
 * @file authz.js
 * @description Small role helpers shared by controllers/services so that
 * "is this an admin?" is answered the same way everywhere (admin + org_admin).
 */

const { ADMIN_ROLES, HACKER_ROLES, OWNER_ROLES } = require('../constants/roles');

const normalizeRole = (role) => String(role || '').trim().toLowerCase();

const isAdminRole = (role) => ADMIN_ROLES.includes(normalizeRole(role));
const isHackerRole = (role) => HACKER_ROLES.includes(normalizeRole(role));
const isAdminUser = (user) => isAdminRole(user && user.role);

/** The platform owner — not a customer who administers their own events. */
const isOwnerRole = (role) => OWNER_ROLES.includes(normalizeRole(role));
const isOwnerUser = (user) => isOwnerRole(user && user.role);

module.exports = {
  normalizeRole,
  isAdminRole,
  isHackerRole,
  isAdminUser,
  isOwnerRole,
  isOwnerUser,
};
