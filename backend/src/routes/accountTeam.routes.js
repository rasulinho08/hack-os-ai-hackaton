/**
 * @file accountTeam.routes.js
 * @description The colleagues on a customer's account, managed by that customer.
 *
 *   GET    /api/account/team                     → seats, members, invites (admin)
 *   GET    /api/account/team/seats               → seat usage              (admin)
 *   GET    /api/account/team/members             → members                 (admin)
 *   DELETE /api/account/team/members/:contactId  → release a seat          (admin)
 *   GET    /api/account/team/invites             → invites                 (admin)
 *   POST   /api/account/team/invites             → invite a colleague      (admin)
 *   DELETE /api/account/team/invites/:inviteId   → withdraw an invite      (admin)
 *   GET    /api/account/invites/:token           → what this invite is     (public)
 *   POST   /api/account/invites/:token           → accept it               (signed in)
 *
 * Mounted under `/api/account` rather than `/api/team`, because `/api/teams`
 * already means something else entirely — the hackathon teams participants
 * form. These are seats on a customer's subscription. Two different nouns that
 * happen to share a word, and putting them at neighbouring paths would be a
 * standing invitation to call the wrong one.
 *
 * `roleMw(ROLES.ADMIN)` expands to admin + org_admin + superadmin, which is the
 * right audience: this is a customer administering itself, not the commercial
 * record, so unlike `/api/customers` it is not owner-only. The customer being
 * acted on still comes from the session — see `resolveScope`.
 *
 * The two invite routes differ on purpose. `GET` is open: somebody has to be
 * able to read an invitation before they have an account to read it with.
 * `POST` requires a session, because accepting is what grants access, and the
 * address on that session is checked against the address invited.
 */

const express = require('express');
const tenancy = require('../controllers/tenancy.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { ROLES } = require('../constants/roles');

const router = express.Router();

router.get('/team', authMw, roleMw(ROLES.ADMIN), tenancy.getTeam);
router.get('/team/seats', authMw, roleMw(ROLES.ADMIN), tenancy.getSeats);

router.get('/team/members', authMw, roleMw(ROLES.ADMIN), tenancy.listMembers);
router.delete('/team/members/:contactId', authMw, roleMw(ROLES.ADMIN), tenancy.removeMember);

router.get('/team/invites', authMw, roleMw(ROLES.ADMIN), tenancy.listInvites);
router.post('/team/invites', authMw, roleMw(ROLES.ADMIN), tenancy.createInvite);
router.delete('/team/invites/:inviteId', authMw, roleMw(ROLES.ADMIN), tenancy.revokeInvite);

router.get('/invites/:token', tenancy.peekInvite);
router.post('/invites/:token', authMw, tenancy.acceptInvite);

module.exports = router;
