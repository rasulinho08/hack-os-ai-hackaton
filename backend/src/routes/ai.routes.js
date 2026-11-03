const express = require('express');
const ctrl = require('../controllers/ai.controller');
const authMw = require('../middlewares/authMw');
const roleMw = require('../middlewares/roleMw');
const { aiLimiter } = require('../middlewares/authRateLimit');

// Mounted at /api/ai. Organisers only: every call spends the platform's AI credits.
const router = express.Router();
router.use(authMw, roleMw('admin'));

router.get('/status', ctrl.status);
router.post('/event-draft', aiLimiter, ctrl.eventDraft);

module.exports = router;
