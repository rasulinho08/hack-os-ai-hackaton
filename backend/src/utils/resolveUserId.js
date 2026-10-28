const db = require('../config/db');

/** Refused: the account behind an address nobody has confirmed (see emailVerification.service). */
function notVerifiedError() {
  const err = new Error('This account has not confirmed its e-mail address yet. Invite the address instead: the role is handed over once it is confirmed.');
  err.statusCode = 409;
  err.code = 'EMAIL_NOT_VERIFIED';
  return err;
}

/**
 * Body-dən userId və ya email ilə istifadəçi tapır.
 * An address is a claim about someone outside the platform, so it only
 * names an account that confirmed it: anyone can sign up with any address.
 * @param {{ userId?: number, email?: string }} body
 * @returns {Promise<number>}
 */
async function resolveUserIdFromBody(body) {
  const { userId, email } = body;
  if (userId != null && userId !== '') {
    return Number(userId);
  }
  if (email && String(email).trim()) {
    const r = await db.query('SELECT id, email_verified_at FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))', [
      String(email).trim(),
    ]);
    if (!r.rows.length) {
      const err = new Error('Bu email ilə istifadəçi tapılmadı. Əvvəl qeydiyyatdan keçin.');
      err.statusCode = 404;
      throw err;
    }
    if (!r.rows[0].email_verified_at) throw notVerifiedError();
    return r.rows[0].id;
  }
  const err = new Error('userId və ya email göndərin');
  err.statusCode = 400;
  throw err;
}

module.exports = { resolveUserIdFromBody, notVerifiedError };
