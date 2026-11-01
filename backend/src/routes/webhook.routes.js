const express = require('express');
const rl = require('express-rate-limit');
const webhooks = require('../controllers/webhook.controller');
const authMw = require('../middlewares/authMw');

const rateLimit = typeof rl === 'function' ? rl : (rl.rateLimit || rl.default);

// Mounted at /api/account/webhooks (app.js); see webhook.controller for the list.

// Saving an endpoint looks its host up in DNS; a test or a redelivery sends a request.
const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.WEBHOOK_WRITE_LIMIT_PER_MIN) || 30,
  keyGenerator: (req) => `webhook-write:u:${req.user.id}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many changes. Wait a minute.', code: 'RATE_LIMITED' },
});
const sendLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.WEBHOOK_SEND_LIMIT_PER_MIN) || 20,
  keyGenerator: (req) => `webhook-send:u:${req.user.id}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many test sends. Wait a minute.', code: 'RATE_LIMITED' },
});

const router = express.Router();

router.get('/', authMw, webhooks.list);
router.post('/', authMw, writeLimiter, webhooks.create);
router.patch('/:id', authMw, writeLimiter, webhooks.update);
router.delete('/:id', authMw, webhooks.remove);
router.post('/:id/rotate', authMw, writeLimiter, webhooks.rotate);
router.post('/:id/test', authMw, sendLimiter, webhooks.test);
router.get('/:id/deliveries', authMw, webhooks.deliveries);
router.post('/:id/deliveries/:deliveryId/redeliver', authMw, sendLimiter, webhooks.redeliver);

module.exports = router;
