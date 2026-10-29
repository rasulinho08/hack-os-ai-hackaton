const express = require('express');
const ctrl = require('../controllers/teamInvite.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const router = express.Router();

// Send invite
router.post('/', authMw, roleMw('hacker'), ctrl.send);

// Get invites sent TO me
router.get('/incoming', authMw, roleMw('hacker'), ctrl.incoming);

// Get invites sent BY me
router.get('/outgoing', authMw, roleMw('hacker'), ctrl.outgoing);

// Accept invite
router.post('/:id/accept', authMw, roleMw('hacker'), ctrl.accept);

// Decline invite
router.post('/:id/decline', authMw, roleMw('hacker'), ctrl.decline);

// Cancel invite (by sender)
router.delete('/:id', authMw, roleMw('hacker'), ctrl.cancel);

module.exports = router;
