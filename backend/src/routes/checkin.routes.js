const express = require('express');
const checkin = require('../controllers/checkin.controller');
const authMw = require('../middlewares/authMw');

// Mounted at /api/events/:eventId/checkin behind eventExists, eventAccess and
// the plan's 'checkin' module (app.js). Who may do what is decided in the service.
const router = express.Router({ mergeParams: true });

router.get('/', authMw, checkin.list);
router.get('/me', authMw, checkin.mine);
router.get('/stats', authMw, checkin.stats);
router.get('/export.csv', authMw, checkin.exportCsv);
router.post('/scan', authMw, checkin.scan);
router.post('/participants/:participantId(\\d+)', authMw, checkin.checkInById);
router.delete('/participants/:participantId(\\d+)', authMw, checkin.undo);

module.exports = router;
