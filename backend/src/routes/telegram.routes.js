const express = require('express');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const telegramController = require('../controllers/telegram.controller');

const router = express.Router();

// The webhook itself is mounted in app.js, ahead of the per-user rate limiter.
router.get('/status', authMw, roleMw('admin'), telegramController.getStatus);
router.get('/me', authMw, telegramController.getMine);
router.post('/me/link', authMw, telegramController.createMyLink);
router.delete('/me', authMw, telegramController.deleteMine);

module.exports = router;
