/**
 * @file setup.service.js
 * @description The one-time link an approved organisation is set up through.
 *
 * Approval e-mails the buyer a link valid for 72 hours. Opening it shows the
 * organisation's name and nothing personal; finishing it needs the buyer's
 * own account. Only the SHA-256 of the token is stored, so the table cannot
 * be replayed, and issuing a new link revokes the old ones.
 */

const crypto = require('crypto');
const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');

const SETUP_TTL_HOURS = 72;
const LOCALES = ['az', 'en', 'ru'];

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** "rasul@example.com" → "ra***@example.com". */
function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return '';
  return `${user.slice(0, 2)}${user.length > 2 ? '***' : ''}@${domain}`;
}

/**
 * A new link for this organisation; earlier unused ones stop working.
 * Pass the transaction's client when called inside one.
 */
async function issue(client, { customerId, orderId = null, email, actorId = null }) {
  const exec = client || db;
  await exec.query(
    `UPDATE setup_tokens SET revoked_at = now()
      WHERE customer_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
    [customerId],
  );
  const token = crypto.randomBytes(32).toString('base64url');
  const result = await exec.query(
    `INSERT INTO setup_tokens (customer_id, order_id, email, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval, $6)
     RETURNING expires_at`,
    [customerId, orderId, String(email).trim().toLowerCase(), hashToken(token), String(SETUP_TTL_HOURS), actorId],
  );
  return { token, expiresAt: result.rows[0].expires_at };
}

function stateOf(row) {
  if (row.revoked_at) return 'revoked';
  if (row.used_at) return 'used';
  if (new Date(row.expires_at) <= new Date()) return 'expired';
  return 'valid';
}

const ORG_COLUMNS = 'c.id, c.name, c.slug, c.timezone, c.locale, c.logo_url, c.brand_color, c.website, c.status';

function organisationOf(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    locale: row.locale,
    logoUrl: row.logo_url,
    brandColor: row.brand_color,
    website: row.website,
    status: row.status,
  };
}

/** What the setup page may show before anyone signs in. */
async function describe(token) {
  const result = await db.query(
    `SELECT st.email, st.expires_at, st.used_at, st.revoked_at, ${ORG_COLUMNS}
       FROM setup_tokens st JOIN customers c ON c.id = st.customer_id
      WHERE st.token_hash = $1`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    state: stateOf(row),
    email: maskEmail(row.email),
    expiresAt: row.expires_at,
    organisation: organisationOf(row),
  };
}

function isTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function cleanUrl(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const value = String(raw).trim().slice(0, 500);
  let url;
  try { url = new URL(value); } catch { throw httpError(400, 'Links must be full addresses starting with https://', 'VALIDATION_ERROR'); }
  if (url.protocol !== 'https:') throw httpError(400, 'Links must start with https://', 'VALIDATION_ERROR');
  return url.toString();
}

/**
 * Finish setup: the organisation's profile, then the link is spent. Only the
 * account the link was sent to, or an owner of the organisation, may do it.
 */
async function complete(token, user, profile = {}) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT st.id AS token_id, st.customer_id, st.email, st.expires_at, st.used_at, st.revoked_at
         FROM setup_tokens st WHERE st.token_hash = $1 FOR UPDATE`,
      [hashToken(token)],
    );
    const row = found.rows[0];
    if (!row) throw httpError(404, 'This setup link does not exist.', 'SETUP_NOT_FOUND');
    const state = stateOf(row);
    if (state !== 'valid') {
      throw httpError(410, state === 'used'
        ? 'This setup link has already been used.'
        : 'This setup link has expired. Ask us for a new one.', state === 'used' ? 'SETUP_USED' : 'SETUP_EXPIRED');
    }

    const sameEmail = String(user.email || '').trim().toLowerCase() === row.email;
    const owner = await client.query(
      `SELECT 1 FROM customer_contacts
        WHERE customer_id = $1 AND user_id = $2 AND member_role = 'owner'`,
      [row.customer_id, user.id],
    );
    if (!sameEmail && owner.rows.length === 0) {
      throw httpError(403, 'This link was sent to a different account. Sign in with the address it was sent to.', 'SETUP_WRONG_ACCOUNT');
    }

    const sets = [];
    const values = [];
    const set = (column, value) => { values.push(value); sets.push(`${column} = $${values.length}`); };

    if (profile.name != null) {
      const name = String(profile.name).trim();
      if (name.length < 2 || name.length > 200) throw httpError(400, 'The organisation name must be 2–200 characters.', 'VALIDATION_ERROR');
      set('name', name);
    }
    if (profile.timezone != null) {
      if (!isTimeZone(profile.timezone)) throw httpError(400, 'Unknown time zone.', 'VALIDATION_ERROR');
      set('timezone', String(profile.timezone));
    }
    if (profile.locale != null) {
      if (!LOCALES.includes(profile.locale)) throw httpError(400, `Language must be one of: ${LOCALES.join(', ')}`, 'VALIDATION_ERROR');
      set('locale', profile.locale);
    }
    if (profile.brandColor != null) {
      const color = String(profile.brandColor).trim();
      if (color !== '' && !/^#[0-9a-fA-F]{6}$/.test(color)) throw httpError(400, 'The brand colour must look like #C8102E.', 'VALIDATION_ERROR');
      set('brand_color', color || null);
    }
    if (profile.logoUrl !== undefined) set('logo_url', cleanUrl(profile.logoUrl));
    if (profile.website !== undefined) set('website', cleanUrl(profile.website));
    set('onboarded_at', new Date());
    values.push(row.customer_id);

    try {
      await client.query(
        `UPDATE customers SET ${sets.join(', ')},
                status = CASE WHEN status = 'pending_setup' THEN 'active' ELSE status END,
                updated_at = now()
          WHERE id = $${values.length}`,
        values,
      );
    } catch (err) {
      if (err && err.code === '23505') throw httpError(409, 'Another organisation already uses that name.', 'NAME_TAKEN');
      throw err;
    }
    await client.query('UPDATE setup_tokens SET used_at = now() WHERE id = $1', [row.token_id]);
    const updated = await client.query(`SELECT ${ORG_COLUMNS} FROM customers c WHERE c.id = $1`, [row.customer_id]);
    await client.query('COMMIT');
    return organisationOf(updated.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** How soon after one link another may be asked for, by the buyer. */
const RENEW_GAP_MINUTES = 5;

async function recentlyIssued(customerId) {
  const r = await db.query(
    `SELECT 1 FROM setup_tokens WHERE customer_id = $1 AND created_at > now() - ($2 || ' minutes')::interval LIMIT 1`,
    [customerId, String(RENEW_GAP_MINUTES)],
  );
  return r.rows.length > 0;
}

const tooSoon = () => httpError(429, `A link was sent a moment ago. Check your inbox (and spam); you can ask again in ${RENEW_GAP_MINUTES} minutes.`, 'SETUP_RECENT');
const alreadyDone = () => httpError(409, 'This organisation is already set up. Sign in to change its details in Settings.', 'SETUP_DONE');

/**
 * The buyer asks for a new link from an expired or replaced one. It goes to
 * the address the old link was sent to — never to one given here — so the
 * old link proves nothing beyond "send it to them again".
 */
async function renew(token) {
  const found = await db.query(
    `SELECT st.customer_id, st.order_id, st.email, st.used_at, c.name, c.onboarded_at,
            COALESCE((SELECT o.locale FROM orders o WHERE o.id = st.order_id), c.locale) AS locale
       FROM setup_tokens st JOIN customers c ON c.id = st.customer_id
      WHERE st.token_hash = $1`,
    [hashToken(token)],
  );
  const row = found.rows[0];
  if (!row) return null;
  if (row.used_at || row.onboarded_at) throw alreadyDone();
  if (await recentlyIssued(row.customer_id)) throw tooSoon();
  const fresh = await issue(null, { customerId: row.customer_id, orderId: row.order_id, email: row.email });
  return { ...fresh, email: row.email, organisation: row.name, locale: row.locale };
}

/**
 * A signed-in owner of the organisation asks for a new link from their
 * account. Sent to their own address; only while the organisation is
 * approved and not yet set up.
 */
async function issueForMember(customerId, user) {
  const found = await db.query(
    `SELECT c.id, c.name, c.locale, c.onboarded_at, c.status,
            (SELECT o.id FROM orders o WHERE o.customer_id = c.id AND o.status = 'delivered'
              ORDER BY o.delivered_at DESC NULLS LAST, o.id DESC LIMIT 1) AS order_id
       FROM customers c
       JOIN customer_contacts cc ON cc.customer_id = c.id AND cc.user_id = $2 AND cc.member_role = 'owner'
      WHERE c.id = $1 AND c.archived_at IS NULL`,
    [customerId, user.id],
  );
  const row = found.rows[0];
  if (!row) return null;
  if (row.onboarded_at) throw alreadyDone();
  if (!row.order_id) throw httpError(409, 'Setup opens once we approve your order.', 'NOT_APPROVED');
  if (await recentlyIssued(row.id)) throw tooSoon();
  const fresh = await issue(null, { customerId: row.id, orderId: row.order_id, email: user.email, actorId: user.id });
  const lang = await db.query('SELECT locale FROM orders WHERE id = $1', [row.order_id]);
  return {
    ...fresh, email: String(user.email).trim().toLowerCase(), organisation: row.name,
    locale: (lang.rows[0] && lang.rows[0].locale) || row.locale,
  };
}

module.exports = {
  SETUP_TTL_HOURS, RENEW_GAP_MINUTES, issue, describe, complete, renew, issueForMember, maskEmail, hashToken,
};
