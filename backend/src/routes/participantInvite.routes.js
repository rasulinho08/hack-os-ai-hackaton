const express = require('express');
const ctrl = require('../controllers/participantInvite.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { exportLimiter, inviteLimiter } = require('../middlewares/authRateLimit');

// Mounted under /api/events/:eventId/participant-invites, behind eventExists
// and eventAccess: only the event's own organisers get this far.
const router = express.Router({ mergeParams: true });

router.get('/', authMw, roleMw('admin'), ctrl.list);
router.post('/', authMw, roleMw('admin'), inviteLimiter, ctrl.create);
router.get('/export.csv', authMw, roleMw('admin'), exportLimiter, ctrl.exportCsv);
router.post('/resend', authMw, roleMw('admin'), inviteLimiter, ctrl.resend);
router.post('/revoke', authMw, roleMw('admin'), inviteLimiter, ctrl.revoke);
router.get('/:id/link', authMw, roleMw('admin'), ctrl.link);

module.exports = router;
