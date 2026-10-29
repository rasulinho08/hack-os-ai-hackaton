const express = require('express');
const results = require('../controllers/results.controller');
const projects = require('../controllers/publicProjects.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { participantsOnly } = require('../middlewares/eventAccess');

const router = express.Router({ mergeParams: true });

router.get('/', authMw, roleMw('admin'), results.organiser);
router.post('/publish', authMw, roleMw('admin'), results.publish);
router.post('/unpublish', authMw, roleMw('admin'), results.unpublish);
router.get('/outdated', authMw, roleMw('admin'), results.outdated);
router.post('/recheck', authMw, roleMw('admin'), results.recheck);
router.patch('/prizes/:prizeId', authMw, roleMw('admin'), results.setPrizeWinner);
router.get('/me', authMw, participantsOnly, results.mine);
// The public page of the projects: the organiser opens it, a team lead can keep their project off it.
router.get('/projects', authMw, roleMw('admin'), projects.organiserState);
router.put('/projects', authMw, roleMw('admin'), projects.setPublic);
router.get('/projects/mine', authMw, participantsOnly, projects.mine);
router.put('/projects/mine', authMw, participantsOnly, projects.setHidden);

module.exports = router;
