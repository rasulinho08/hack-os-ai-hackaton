/**
 * Mentor-scoped routes that are not nested under /api/events/:eventId/mentors.
 */

const express = require('express');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const mentorController = require('../controllers/mentor.controller');

const router = express.Router();

router.get('/events', authMw, roleMw('mentor'), mentorController.getMyMentorEventIds);

module.exports = router;
