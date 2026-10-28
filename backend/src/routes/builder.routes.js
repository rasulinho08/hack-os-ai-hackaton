const express = require('express');
const ctrl = require('../controllers/eventBuilder.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const requireModule = require('../middlewares/requireModule');

// Mounted at /api/events/:eventId/builder behind eventExists + eventAccess.
const router = express.Router({ mergeParams: true });
router.use(authMw, roleMw('admin'));

router.get('/', ctrl.getBuilder);
router.patch('/', ctrl.patch);
router.get('/checklist', ctrl.checklist);
router.put('/tracks', ctrl.syncList('tracks'));
router.put('/prizes', ctrl.syncList('prizes'));
router.put('/sponsors', ctrl.syncList('sponsors'));
router.put('/criteria', requireModule('judging'), ctrl.syncList('criteria'));
router.put('/form', ctrl.syncList('form'));
router.post('/publish', ctrl.publish);
router.post('/unpublish', ctrl.unpublish);

module.exports = router;
