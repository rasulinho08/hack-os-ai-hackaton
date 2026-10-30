/**
 * Volunteer tasks of an event: /api/events/:eventId/volunteer-tasks
 * (organisers manage them; volunteers take free ones and move their own).
 */
const express = require('express');
const ctrl = require('../controllers/volunteer.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');

const router = express.Router({ mergeParams: true });

router.get('/', authMw, roleMw('admin', 'volunteer'), ctrl.listTasks);
router.post('/', authMw, roleMw('admin'), ctrl.createTask);
router.patch('/:taskId', authMw, roleMw('admin', 'volunteer'), ctrl.updateTask);
router.delete('/:taskId', authMw, roleMw('admin'), ctrl.deleteTask);

module.exports = router;
