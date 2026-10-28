/**
 * @file runtimeEnv.js
 * @description Whether this process is a developer's or the test suite's API.
 *
 * Debug conveniences — a confirmation or reset link handed back in the
 * response when no mail provider is configured, internal error messages,
 * Telegram update results — are switched on only by an explicit
 * NODE_ENV=development or NODE_ENV=test. A server started without NODE_ENV
 * behaves like production: before, an unset value counted as "not
 * production" and would have returned password-reset links to whoever asked.
 */

function isDevLike() {
  const env = String(process.env.NODE_ENV || '').trim().toLowerCase();
  return env === 'development' || env === 'test';
}

module.exports = { isDevLike };
