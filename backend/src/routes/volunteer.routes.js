const express = require('express');
const volunteerController = require('../controllers/volunteer.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

// mergeParams: true is required because this router is mounted under
// `/api/events/:eventId/volunteers` and the controller reads `req.params.eventId`.
const { rowInEvent } = require('../middlewares/eventAccess');
const router = express.Router({ mergeParams: true });

router.get('/', authMw, roleMw('admin', 'volunteer'), volunteerController.getVolunteers);
router.post('/', authMw, roleMw('admin'), volunteerController.addVolunteer);
// The calling volunteer (before '/:id').
router.get('/me', authMw, roleMw('volunteer'), volunteerController.getMine);
router.put('/:id', authMw, roleMw('admin'), rowInEvent('volunteers', 'Volunteer'), volunteerController.updateVolunteer);
router.delete('/:id', authMw, roleMw('admin'), rowInEvent('volunteers', 'Volunteer'), volunteerController.removeVolunteer);

module.exports = router;
