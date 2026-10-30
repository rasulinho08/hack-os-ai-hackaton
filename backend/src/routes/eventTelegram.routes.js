/**
 * An event's Telegram channel: /api/events/:eventId/telegram (organisers).
 */
const express = require('express');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const telegramController = require('../controllers/telegram.controller');

const router = express.Router({ mergeParams: true });
const organiser = [authMw, roleMw('admin')];

router.get('/', ...organiser, telegramController.getChannel);
router.post('/code', ...organiser, telegramController.createChannelCode);
router.post('/link', ...organiser, telegramController.linkByUsername);
router.patch('/', ...organiser, telegramController.updateChannel);
router.post('/test', ...organiser, telegramController.testChannel);
router.delete('/', ...organiser, telegramController.unlinkChannel);

module.exports = router;
