const express = require('express');
const rl = require('express-rate-limit');
const chat = require('../controllers/chat.controller');
const authMw = require('../middlewares/authMw');

const rateLimit = typeof rl === 'function' ? rl : (rl.rateLimit || rl.default);

// Writing: a quick conversation is fine, a flood is not (per account).
const postLimiter = rateLimit({
  windowMs: 30_000,
  limit: Number(process.env.CHAT_POST_LIMIT_PER_30S) || 20,
  keyGenerator: (req) => `chat-post:u:${req.user.id}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'You are writing too fast. Wait a few seconds.', code: 'RATE_LIMITED' },
});
// Reports: a handful a minute per account.
const reportLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  keyGenerator: (req) => `chat-report:u:${req.user.id}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many reports. Wait a minute.', code: 'RATE_LIMITED' },
});

const router = express.Router({ mergeParams: true });

router.get('/', authMw, chat.list);
router.get('/tickets/:ticketId', authMw, chat.ticket);
router.get('/channels/:id', authMw, chat.channel);
router.get('/channels/:id/messages', authMw, chat.messages);
router.post('/channels/:id/messages', authMw, postLimiter, chat.post);
router.post('/channels/:id/read', authMw, chat.read);
router.post('/channels/:id/lock', authMw, chat.lock);
router.post('/channels/:id/unlock', authMw, chat.unlock);
router.delete('/messages/:id', authMw, chat.remove);
router.post('/messages/:id/report', authMw, reportLimiter, chat.report);
router.get('/reports', authMw, chat.reports);
router.post('/reports/:messageId/resolve', authMw, chat.resolve);
router.get('/mutes', authMw, chat.mutes);
router.post('/mutes', authMw, chat.mute);
router.delete('/mutes/:userId', authMw, chat.unmute);

module.exports = router;
