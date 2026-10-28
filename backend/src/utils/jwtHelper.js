const jwt = require('jsonwebtoken');

/**
 * Default session lifetime. Hackathons run for days, so a 24h token
 * was logging participants out mid-event (problem 14). 30 days lets
 * them stay signed in for the whole event without forcing re-login
 * just because the laptop slept overnight. Override with `JWT_EXPIRES_IN`.
 */
const DEFAULT_JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

/**
 * Cookie max-age (ms) that should mirror the JWT lifetime so the
 * browser doesn't drop the cookie before the token expires. Override
 * with `SESSION_COOKIE_MAX_AGE_MS`.
 */
const SESSION_COOKIE_MAX_AGE_MS = (() => {
  const raw = Number(process.env.SESSION_COOKIE_MAX_AGE_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 30 * 24 * 60 * 60 * 1000;
})();

/**
 * Sign a JWT with HS256 algorithm.
 * Algorithm is explicit to prevent algorithm confusion/downgrade attacks.
 */
const signToken = (payload, expiresIn = DEFAULT_JWT_EXPIRES_IN) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn,
    algorithm: 'HS256', // explicit — prevents 'none' or RS256 downgrade attacks
  });
};

/**
 * Verify a JWT, only accepting HS256-signed tokens.
 */
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'], // whitelist — rejects tokens signed with other algorithms
    });
  } catch (err) {
    return null;
  }
};

module.exports = {
  signToken,
  verifyToken,
  DEFAULT_JWT_EXPIRES_IN,
  SESSION_COOKIE_MAX_AGE_MS,
};

