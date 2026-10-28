/**
 * @file authRateLimit.js
 * @description Rate limiting.
 *
 *   authLimiter   — POST /api/auth/login + /register. Counts only FAILED
 *                   attempts per IP (brute-force protection) so a venue where
 *                   100 hackers sign in through one NAT is never locked out.
 *   globalLimiter — safety net for every /api route, keyed per signed-in
 *                   user (JWT cookie) and only per IP for anonymous calls.
 *
 * Env overrides:
 *   AUTH_RATE_LIMIT_WINDOW_MS   (default 15 min)   AUTH_RATE_LIMIT_MAX   (default 100 failures)
 *   GLOBAL_RATE_LIMIT_WINDOW_MS (default 1 min)    GLOBAL_RATE_LIMIT_MAX (default 1200)
 *   LOOKUP_RATE_LIMIT_WINDOW_MS (default 15 min)   LOOKUP_RATE_LIMIT_MAX (default 300 misses)
 *   EXPORT_RATE_LIMIT_WINDOW_MS (default 10 min)   EXPORT_RATE_LIMIT_MAX (default 30)
 *   QUOTE_RATE_LIMIT_WINDOW_MS  (default 15 min)   QUOTE_RATE_LIMIT_MAX  (default 100 unknown codes)
 *   INVITE_RATE_LIMIT_WINDOW_MS (default 10 min)   INVITE_RATE_LIMIT_MAX (default 60)
 */

const rl = require('express-rate-limit');
const { verifyToken } = require('../utils/jwtHelper');

const rateLimit = typeof rl === 'function' ? rl : (rl.rateLimit || rl.default);
const { ipKeyGenerator } = rl;

const intFromEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/*
 * Addresses are keyed with the library's ipKeyGenerator: IPv6 clients by
 * their /64, so one device cannot rotate through a whole block, and IPv4-mapped
 * addresses as the IPv4 address. It is called inside each keyGenerator below
 * because the library checks for it there.
 */

/** The signed-in account behind a request, or null. */
function userKey(req) {
  const token = req.cookies?.access_token;
  if (!token) return null;
  const decoded = verifyToken(token);
  return decoded && decoded.id != null ? `u:${decoded.id}` : null;
}

const AUTH_WINDOW_MS = intFromEnv('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
const AUTH_MAX       = intFromEnv('AUTH_RATE_LIMIT_MAX', 100);

const authLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  limit: AUTH_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `auth:${ipKeyGenerator(req.ip || '', 64)}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many failed attempts from this network. Please wait a few minutes and try again.',
    code: 'RATE_LIMITED',
  },
});

const GLOBAL_WINDOW_MS = intFromEnv('GLOBAL_RATE_LIMIT_WINDOW_MS', 60 * 1000);
const GLOBAL_MAX       = intFromEnv('GLOBAL_RATE_LIMIT_MAX', 1200);

const globalLimiter = rateLimit({
  windowMs: GLOBAL_WINDOW_MS,
  limit: GLOBAL_MAX,
  keyGenerator: (req) => userKey(req) || `ip:${ipKeyGenerator(req.ip || '', 64)}`,
  skip: (req) => req.method === 'OPTIONS' || req.path === '/health',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please slow down and try again in a minute.',
    code: 'RATE_LIMITED',
  },
});

/*
 * Uploads and public registrations: per signed-in user, else per address.
 * Generous enough for a form with a few attachments filled in at a venue
 * behind one NAT, tight enough that nobody fills the file store by script.
 */
const UPLOAD_WINDOW_MS = intFromEnv('UPLOAD_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
const UPLOAD_MAX       = intFromEnv('UPLOAD_RATE_LIMIT_MAX', 60);

const uploadLimiter = rateLimit({
  windowMs: UPLOAD_WINDOW_MS,
  limit: UPLOAD_MAX,
  keyGenerator: (req) => `upload:${userKey(req) || `ip:${ipKeyGenerator(req.ip || '', 64)}`}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many uploads. Please wait a few minutes and try again.',
    code: 'RATE_LIMITED',
  },
});

const REGISTER_WINDOW_MS = intFromEnv('REGISTER_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
const REGISTER_MAX       = intFromEnv('REGISTER_RATE_LIMIT_MAX', 200);

/* Event registrations per address; only attempts that fail count. */
const registerLimiter = rateLimit({
  windowMs: REGISTER_WINDOW_MS,
  limit: REGISTER_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `register:${ipKeyGenerator(req.ip || '', 64)}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts from this network. Please wait a few minutes and try again.',
    code: 'RATE_LIMITED',
  },
});

/*
 * Lookups by a code or a token anyone may hold (certificate codes, calendar
 * feeds): only misses count, so a venue full of people opening real links is
 * never slowed, while guessing codes stops after a few hundred misses.
 */
const LOOKUP_WINDOW_MS = intFromEnv('LOOKUP_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
const LOOKUP_MAX       = intFromEnv('LOOKUP_RATE_LIMIT_MAX', 300);

const lookupLimiter = rateLimit({
  windowMs: LOOKUP_WINDOW_MS,
  limit: LOOKUP_MAX,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `lookup:${ipKeyGenerator(req.ip || '', 64)}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many lookups from this network. Please wait a few minutes and try again.',
    code: 'RATE_LIMITED',
  },
});

/*
 * Exports (the event ZIP, participant and audit CSVs) read a whole event at
 * once: a few a minute per account is plenty for a person and keeps a script
 * from loading the database.
 */
const EXPORT_WINDOW_MS = intFromEnv('EXPORT_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000);
const EXPORT_MAX       = intFromEnv('EXPORT_RATE_LIMIT_MAX', 30);

const exportLimiter = rateLimit({
  windowMs: EXPORT_WINDOW_MS,
  limit: EXPORT_MAX,
  keyGenerator: (req) => `export:${userKey(req) || `ip:${ipKeyGenerator(req.ip || '', 64)}`}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many exports. Please wait a few minutes and try again.',
    code: 'RATE_LIMITED',
  },
});

/*
 * Checkout price quotes with a discount code: only codes that do not exist
 * count (the controller marks them), so a buyer trying their code and
 * switching plans is never slowed, while guessing codes stops quickly.
 */
const QUOTE_WINDOW_MS = intFromEnv('QUOTE_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000);
const QUOTE_MAX       = intFromEnv('QUOTE_RATE_LIMIT_MAX', 100);

const quoteLimiter = rateLimit({
  windowMs: QUOTE_WINDOW_MS,
  limit: QUOTE_MAX,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode < 400 && !res.locals.unknownCode,
  keyGenerator: (req) => `quote:${ipKeyGenerator(req.ip || '', 64)}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many codes tried from this network. Please wait a few minutes and try again.',
    code: 'RATE_LIMITED',
  },
});

/*
 * Participant invitations: sending, resending and withdrawing them, per
 * account. Each request may carry hundreds of addresses; a person working
 * through a list needs a few dozen requests at most, a script far more.
 * (The invitation service also caps the e-mails one event sends a day.)
 */
const INVITE_WINDOW_MS = intFromEnv('INVITE_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000);
const INVITE_MAX       = intFromEnv('INVITE_RATE_LIMIT_MAX', 60);

const inviteLimiter = rateLimit({
  windowMs: INVITE_WINDOW_MS,
  limit: INVITE_MAX,
  keyGenerator: (req) => `invite:${userKey(req) || `ip:${ipKeyGenerator(req.ip || '', 64)}`}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many invitation requests. Please wait a few minutes and try again.',
    code: 'RATE_LIMITED',
  },
});

module.exports = { authLimiter, globalLimiter, uploadLimiter, registerLimiter, lookupLimiter, exportLimiter, quoteLimiter, inviteLimiter };
