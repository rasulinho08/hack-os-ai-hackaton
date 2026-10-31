/**
 * @file audit.service.js
 * @description Who did what — recorded by id, never by personal data.
 *
 * `record` never throws: an audit row that fails to write must not undo the
 * action it describes. Failures are logged and the request carries on.
 */

const db = require('../config/db');

/** First hop of X-Forwarded-For when the proxy is trusted, else the socket. */
function clientIp(req) {
  if (!req) return null;
  return String(req.ip || req.socket?.remoteAddress || '').slice(0, 64) || null;
}

/**
 * @param {import('express').Request|null} req   the request, for actor and IP
 * @param {string} action                        e.g. "user.role.change"
 * @param {{ customerId?: number|null, eventId?: number|null, targetType?: string, targetId?: string|number, meta?: object, actorId?: number|null }} [details]
 */
async function record(req, action, details = {}) {
  try {
    const actorId = details.actorId ?? req?.user?.id ?? null;
    await db.query(
      `INSERT INTO audit_log (actor_user_id, customer_id, event_id, action, target_type, target_id, meta, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        actorId,
        details.customerId ?? null,
        details.eventId ?? null,
        String(action).slice(0, 80),
        details.targetType ? String(details.targetType).slice(0, 40) : null,
        details.targetId != null ? String(details.targetId).slice(0, 64) : null,
        JSON.stringify(details.meta || {}),
        clientIp(req),
      ],
    );
  } catch (err) {
    console.error('[audit] not recorded:', action, err.message);
  }
}

/**
 * The same action on many targets in one insert (a bulk action on 300
 * invitations writes 300 rows, one per target). Never throws.
 * @param {import('express').Request|null} req
 * @param {string} action
 * @param {{ eventId?: number|null, customerId?: number|null, targetType: string, items: Array<{ targetId: string|number, meta?: object }> }} details
 */
async function recordMany(req, action, details) {
  const items = Array.isArray(details?.items) ? details.items : [];
  if (!items.length) return;
  try {
    const actorId = req?.user?.id ?? null;
    const ip = clientIp(req);
    const params = [];
    const rows = items.map((it) => {
      params.push(
        actorId,
        details.customerId ?? null,
        details.eventId ?? null,
        String(action).slice(0, 80),
        String(details.targetType).slice(0, 40),
        it.targetId != null ? String(it.targetId).slice(0, 64) : null,
        JSON.stringify(it.meta || {}),
        ip,
      );
      const b = params.length - 8;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}::jsonb, $${b + 8})`;
    });
    await db.query(
      `INSERT INTO audit_log (actor_user_id, customer_id, event_id, action, target_type, target_id, meta, ip) VALUES ${rows.join(', ')}`,
      params,
    );
  } catch (err) {
    console.error('[audit] not recorded:', action, err.message);
  }
}

/** Newest first, optionally for one customer. For the owner console. */
async function list({ customerId = null, limit = 100, before = null } = {}) {
  const params = [];
  const where = [];
  if (customerId != null) { params.push(customerId); where.push(`a.customer_id = $${params.length}`); }
  if (before != null) { params.push(before); where.push(`a.id < $${params.length}`); }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500));
  const r = await db.query(
    `SELECT a.id, a.actor_user_id, u.full_name AS actor_name, a.customer_id, c.name AS customer_name,
            a.event_id, a.action, a.target_type, a.target_id, a.meta, a.created_at
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
       LEFT JOIN customers c ON c.id = a.customer_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.id DESC
      LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

module.exports = { record, recordMany, list };
