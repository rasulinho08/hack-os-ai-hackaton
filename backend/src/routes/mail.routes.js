const express = require('express');
const rateLimit = require('express-rate-limit');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const mailController = require('../controllers/mail.controller');

const router = express.Router();

router.get('/status', authMw, roleMw('admin'), mailController.getStatus);
// A test send costs a provider call; a few a minute is plenty for a person.
const testLimiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false });

router.post('/test', authMw, roleMw('admin'), testLimiter, mailController.postTest);
router.post('/staff-invite', authMw, roleMw('admin'), mailController.postStaffInvite);

module.exports = router;
