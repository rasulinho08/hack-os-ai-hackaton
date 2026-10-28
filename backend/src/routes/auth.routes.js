const express = require('express');
const authController = require('../controllers/auth.controller');
const authMw = require('../middlewares/authMw');
const rateLimit = require('express-rate-limit');
const { authLimiter } = require('../middlewares/authRateLimit');

// The owner PIN is six digits: five guesses per 15 minutes per address.
const elevateLimiter = rateLimit({ windowMs: 15 * 60_000, max: 5, standardHeaders: true, legacyHeaders: false });
// New confirmation links: a few per account per 15 minutes (each also waits
// a minute after the last one, see emailVerification.service). Per account,
// not per address: a venue signs up behind one network.
const resendLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  keyGenerator: (req) => `verify-resend:u:${req.user.id}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many confirmation e-mails. Please wait a few minutes.', code: 'RATE_LIMITED' },
});

const router = express.Router();

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', authMw, authController.me);
router.post('/logout-all', authMw, authController.logoutAll);
router.post('/elevate', authMw, elevateLimiter, authController.elevate);

// E-mail confirmation
router.post('/verify-email', authLimiter, authController.verifyEmail);
router.post('/verify-email/resend', authMw, resendLimiter, authController.resendVerification);

// Password lifecycle
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.post('/reset-password', authLimiter, authController.resetPassword);
router.post('/change-password', authMw, authController.changePassword);

module.exports = router;
