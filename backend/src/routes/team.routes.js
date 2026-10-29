const express = require('express');
const teamController = require('../controllers/team.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { byIdEventAccess } = require('../middlewares/eventAccess');

// Organisers act only on teams of events they may manage (hackers are
// checked by membership in the controller).
const teamInScope = byIdEventAccess('teams', { label: 'Team' });

const router = express.Router();

router.get('/', authMw, roleMw('admin', 'mentor', 'judge', 'volunteer'), teamController.getAllTeams);
router.get('/mine', authMw, roleMw('hacker'), teamController.getMyTeam);
router.post('/join', authMw, roleMw('hacker'), teamController.joinTeam);
// Join requests (before '/:id' so "requests" is not read as a team id).
router.get('/requests/mine', authMw, roleMw('hacker'), teamController.myRequests);
router.post('/requests/:rid/accept', authMw, roleMw('hacker', 'admin'), teamController.acceptRequest);
router.post('/requests/:rid/decline', authMw, roleMw('hacker', 'admin'), teamController.declineRequest);
router.delete('/requests/:rid', authMw, roleMw('hacker'), teamController.cancelRequest);
router.get('/:id', authMw, roleMw('admin', 'mentor', 'judge', 'hacker', 'volunteer'), teamController.getTeamById);
// Hackers create their own team; organisers create teams for participants.
router.post('/', authMw, roleMw('hacker', 'admin'), teamController.createTeam);
// Controller enforces leader/admin ownership check (IDOR protection)
router.put('/:id', authMw, roleMw('hacker', 'admin'), teamInScope, teamController.updateTeam);
router.delete('/:id', authMw, roleMw('admin'), teamInScope, teamController.deleteTeam);
router.get('/:id/members', authMw, roleMw('admin', 'mentor', 'judge', 'hacker', 'volunteer'), teamInScope, teamController.getTeamMembers);
// Controller enforces leader/admin ownership check (IDOR protection)
router.post('/:id/members', authMw, roleMw('hacker', 'admin'), teamInScope, teamController.addTeamMember);
router.delete('/:id/members/:userId', authMw, roleMw('hacker', 'admin'), teamInScope, teamController.removeTeamMember);
router.patch('/:id/members/:userId/lead', authMw, roleMw('hacker', 'admin'), teamInScope, teamController.transferLead);
router.patch('/:id/recruiting', authMw, roleMw('hacker', 'admin'), teamInScope, teamController.setRecruiting);
router.post('/:id/requests', authMw, roleMw('hacker'), teamController.requestToJoin);
router.get('/:id/requests', authMw, roleMw('hacker', 'admin'), teamInScope, teamController.listRequests);

// Problem 11: admin-only team elimination/restore. Controller double-checks
// the role but we also gate at the router level for belt-and-suspenders.
router.patch('/:id/status', authMw, roleMw('admin'), teamInScope, teamController.setTeamStatus);

module.exports = router;
