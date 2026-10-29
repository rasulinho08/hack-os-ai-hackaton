/**
 * Finding a team, or teammates: /api/events/:eventId/matchmaking (participants).
 */
const express = require('express');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const matchmaking = require('../services/matchmaking.service');
const { successResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const router = express.Router({ mergeParams: true });

router.get('/', authMw, roleMw('hacker'), async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await matchmaking.overviewFor(Number(req.params.eventId), req.user.id));
  } catch (error) {
    return errorFromException(res, next, error);
  }
});

router.patch('/me', authMw, roleMw('hacker'), async (req, res, next) => {
  try {
    const out = await matchmaking.setLooking(Number(req.params.eventId), req.user.id, {
      looking: req.body?.looking === true,
      note: req.body?.note,
    });
    return successResponse(res, HTTP.OK, 'Saved', out);
  } catch (error) {
    return errorFromException(res, next, error);
  }
});

module.exports = router;
