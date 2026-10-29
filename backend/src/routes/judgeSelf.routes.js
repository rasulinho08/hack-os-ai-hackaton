/**
 * Judge-scoped routes that are not nested under /api/events/:eventId/judging.
 *
 * Mirrors mentorSelf.routes.js so the judge dashboard can ask the
 * backend "which events am I assigned to?" without having to loop
 * over every event (problem 9).
 */

const express = require('express');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const judgeController = require('../controllers/judge.controller');

const router = express.Router();

router.get('/events', authMw, roleMw('judge'), judgeController.getMyJudgeEventIds);

module.exports = router;
