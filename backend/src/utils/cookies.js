/**
 * @file cookies.js
 * @description Session cookie helpers — one place that decides the
 * SameSite / Secure / Domain attributes of the `access_token` cookie.
 *
 * Env:
 *   COOKIE_SAME_SITE  lax (default) | strict | none
 *                     Use `none` only when the web app and the API live on
 *                     different sites (then the cookie must also be Secure).
 *   COOKIE_SECURE     true | false — defaults to true in production.
 *                     Set to false only for plain-http staging setups.
 *   COOKIE_DOMAIN     optional, e.g. ".hack-os.app" to share across subdomains.
 *                     Setting and clearing a cookie then also expires its
 *                     host-only shape (see dropHostOnly).
 */

const { SESSION_COOKIE_MAX_AGE_MS } = require('./jwtHelper');

const SESSION_COOKIE = 'access_token';

function sessionCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const rawSameSite = String(process.env.COOKIE_SAME_SITE || 'lax').trim().toLowerCase();
  const sameSite = ['lax', 'strict', 'none'].includes(rawSameSite) ? rawSameSite : 'lax';

  const secureEnv = process.env.COOKIE_SECURE;
  const secure = secureEnv != null && secureEnv !== ''
    ? String(secureEnv).trim().toLowerCase() === 'true'
    : isProd || sameSite === 'none';

  const domain = (process.env.COOKIE_DOMAIN || '').trim();

  return {
    httpOnly: true,
    path: '/',
    secure,
    sameSite,
    ...(domain ? { domain } : {}),
  };
}

/*
 * When COOKIE_DOMAIN is introduced (or changed) after people have signed in,
 * their browsers still hold the host-only cookie. A browser only drops a
 * cookie whose Domain matches the clearing header, and it sends both shapes,
 * the older first: the API reads the first, so a new sign-in seemed to fail
 * (the old token no longer verified) or ran as the account signed in before.
 * Every set and clear therefore expires the host-only shape as well.
 */
function dropHostOnly(res, name, options) {
  if (!options.domain) return;
  const { domain: _unused, ...hostOnly } = options;
  res.clearCookie(name, hostOnly);
}

function setSessionCookie(res, token) {
  const options = sessionCookieOptions();
  dropHostOnly(res, SESSION_COOKIE, options);
  res.cookie(SESSION_COOKIE, token, { ...options, maxAge: SESSION_COOKIE_MAX_AGE_MS });
}

function clearSessionCookie(res) {
  const options = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE, options);
  dropHostOnly(res, SESSION_COOKIE, options);
}

/** Proof that the platform owner entered the second-step PIN (12 hours). */
const ELEVATION_COOKIE = 'hh_elev';
const ELEVATION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function setElevationCookie(res, token) {
  const options = sessionCookieOptions();
  dropHostOnly(res, ELEVATION_COOKIE, options);
  res.cookie(ELEVATION_COOKIE, token, { ...options, maxAge: ELEVATION_MAX_AGE_MS });
}

function clearElevationCookie(res) {
  const options = sessionCookieOptions();
  res.clearCookie(ELEVATION_COOKIE, options);
  dropHostOnly(res, ELEVATION_COOKIE, options);
}

module.exports = {
  SESSION_COOKIE, sessionCookieOptions, setSessionCookie, clearSessionCookie,
  ELEVATION_COOKIE, setElevationCookie, clearElevationCookie,
};
