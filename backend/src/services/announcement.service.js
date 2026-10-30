/**
 * @file announcement.service.js
 * @description Event announcements: written by organisers (or by the
 * automatic planner), shown in the app to their audience, and sent on by
 * e-mail and Telegram (announcementDelivery.js).
 *
 * An announcement is `sent` (visible) or `scheduled` (visible to organisers
 * only, published by a background job at scheduled_at) or `cancelled`.
 */

const db = require('../config/db');
const { AUDIENCES, segmentsFor } = require('./announcementAudience');

const CHANNELS = Object.freeze(['platform', 'telegram', 'email']);
const TYPES = Object.freeze(['info', 'update', 'reminder', 'alert', 'success']);
const PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);

/** The channels to store: always the app, plus known extras, once each. */
function normaliseChannels(list) {
  const wanted = Array.isArray(list) ? list.map((c) => String(c).toLowerCase()) : [];
  return CHANNELS.filter((c) => c === 'platform' || wanted.includes(c));
}

/**
 * Create an announcement.
 *
 * @param {object} data
 * @param {number} data.event_id
 * @param {number|null} data.author_id
 * @param {string} data.title
 * @param {string} data.content
 * @param {string} [data.type]
 * @param {string} [data.priority]
 * @param {string} [data.audience]
 * @param {number|null} [data.track_id]
 * @param {string[]} [data.channels]
 * @param {Date|string|null} [data.scheduled_at]  in the future: scheduled; otherwise sent now
 * @param {string|null} [data.auto_key]
 * @param {'app'|'auto'|'telegram'} [data.source]
 * @param {string|null} [data.external_ref]  chat:message of a post copied from Telegram
 * @param {object} [exec]  a client inside a transaction
 */
async function createAnnouncement(data, exec = db) {
  const scheduledAt = data.scheduled_at ? new Date(data.scheduled_at) : null;
  const scheduled = Boolean(scheduledAt && scheduledAt.getTime() > Date.now());
  const result = await exec.query(
    `INSERT INTO announcements
       (event_id, author_id, title, content, type, priority, audience, track_id, channels,
        status, scheduled_at, sent_at, auto_key, source, external_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      data.event_id,
      data.author_id ?? null,
      data.title,
      data.content,
      data.type || 'info',
      data.priority || 'normal',
      AUDIENCES.includes(data.audience) ? data.audience : 'everyone',
      data.audience === 'track' ? data.track_id ?? null : null,
      JSON.stringify(normaliseChannels(data.channels)),
      scheduled ? 'scheduled' : 'sent',
      scheduled ? scheduledAt.toISOString() : null,
      scheduled ? null : new Date().toISOString(),
      data.auto_key || null,
      data.source || (data.auto_key ? 'auto' : 'app'),
      data.external_ref || null,
    ],
  );
  return result.rows[0];
}

async function getById(id, exec = db) {
  const r = await exec.query('SELECT * FROM announcements WHERE id = $1', [id]);
  return r.rows[0] || null;
}

/** Delivery counts per channel and state, keyed by announcement id. */
async function deliveryReport(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const r = await db.query(
    `SELECT announcement_id, channel, status, COUNT(*)::int AS n
       FROM announcement_deliveries
      WHERE announcement_id = ANY($1::int[])
      GROUP BY 1, 2, 3`,
    [ids],
  );
  for (const row of r.rows) {
    const byChannel = out.get(row.announcement_id) || {};
    const c = byChannel[row.channel] || { sent: 0, failed: 0, pending: 0, skipped: 0 };
    if (row.status === 'sent') c.sent += row.n;
    else if (row.status === 'failed') c.failed += row.n;
    else if (row.status === 'skipped') c.skipped += row.n;
    else c.pending += row.n;
    byChannel[row.channel] = c;
    out.set(row.announcement_id, byChannel);
  }
  return out;
}

const SELECT_WITH_NAMES = `
  SELECT a.*, u.full_name AS author_name, tr.name AS track_name
    FROM announcements a
    LEFT JOIN users u ON u.id = a.author_id
    LEFT JOIN tracks tr ON tr.id = a.track_id`;

/**
 * Every announcement of an event, for its organisers: scheduled and
 * cancelled ones too, newest first, each with its delivery report.
 */
async function listForManager(eventId) {
  const r = await db.query(
    `${SELECT_WITH_NAMES}
      WHERE a.event_id = $1
      ORDER BY COALESCE(a.sent_at, a.scheduled_at, a.created_at) DESC, a.id DESC`,
    [eventId],
  );
  const report = await deliveryReport(r.rows.map((a) => a.id));
  return r.rows.map((a) => ({ ...a, deliveries: report.get(a.id) || {} }));
}

/** The announcements one person of the event may read: sent, and meant for them. */
async function listForMember(eventId, userId) {
  const { segments, trackId } = await segmentsFor(userId, eventId);
  if (!segments.length) return [];
  const r = await db.query(
    `${SELECT_WITH_NAMES}
      WHERE a.event_id = $1 AND a.status = 'sent'
        AND (a.audience = ANY($2::text[]) OR (a.audience = 'track' AND $3::int IS NOT NULL AND a.track_id = $3))
      ORDER BY a.sent_at DESC NULLS LAST, a.id DESC`,
    [eventId, segments, trackId],
  );
  // Members do not need the organisers' delivery bookkeeping; whether it is
  // one of the automatic timeline posts helps a staff page leave out the
  // participants' reminders ("tell friends who have not registered").
  return r.rows.map(({ channels, auto_key, scheduled_at, ...a }) => ({ ...a, automatic: Boolean(auto_key) }));
}

/** The older all-events listing (organisers without an event filter). */
async function getAnnouncements(eventId) {
  if (eventId) return listForManager(eventId);
  const r = await db.query(`${SELECT_WITH_NAMES} ORDER BY a.created_at DESC`);
  return r.rows;
}

/**
 * Change an announcement. Words and look can always change (a sent one is
 * corrected in the app; e-mails and messages already sent stay as they
 * were). Who, where and when can change only while it is still scheduled.
 */
async function updateAnnouncement(id, data, exec = db) {
  const current = await getById(id, exec);
  if (!current) return null;
  const isScheduled = current.status === 'scheduled';
  const next = {
    title: data.title ?? current.title,
    content: data.content ?? current.content,
    type: data.type ?? current.type,
    priority: data.priority ?? current.priority,
    audience: isScheduled && data.audience ? data.audience : current.audience,
    track_id: current.track_id,
    channels: isScheduled && data.channels ? normaliseChannels(data.channels) : current.channels,
    scheduled_at: current.scheduled_at,
  };
  if (isScheduled && data.audience) next.track_id = data.audience === 'track' ? data.track_id ?? null : null;
  if (isScheduled && data.scheduled_at !== undefined) next.scheduled_at = data.scheduled_at;
  const r = await exec.query(
    `UPDATE announcements
        SET title = $1, content = $2, type = $3, priority = $4, audience = $5, track_id = $6,
            channels = $7::jsonb, scheduled_at = $8, updated_at = now()
      WHERE id = $9
      RETURNING *`,
    [next.title, next.content, next.type, next.priority, next.audience, next.track_id,
      JSON.stringify(next.channels), next.scheduled_at, id],
  );
  return r.rows[0];
}

/** Scheduled → cancelled. Returns the row, or null when it was not scheduled. */
async function cancelAnnouncement(id, exec = db) {
  const r = await exec.query(
    `UPDATE announcements SET status = 'cancelled', updated_at = now()
      WHERE id = $1 AND status = 'scheduled' RETURNING *`,
    [id],
  );
  return r.rows[0] || null;
}

/**
 * Publish a scheduled announcement (or one being sent now): it becomes
 * visible. Returns the row when this call published it, null when it was
 * cancelled, deleted or already sent.
 */
async function markSent(id, exec = db) {
  const r = await exec.query(
    `UPDATE announcements SET status = 'sent', sent_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'scheduled' RETURNING *`,
    [id],
  );
  return r.rows[0] || null;
}

/** Channel posts of an announcement, so a deleted announcement can be taken down. */
async function channelPosts(id) {
  const r = await db.query(
    `SELECT d.external_id, c.chat_id
       FROM announcement_deliveries d
       JOIN announcements a ON a.id = d.announcement_id
       JOIN event_telegram_channels c ON c.event_id = a.event_id
      WHERE d.announcement_id = $1 AND d.channel = 'telegram_channel' AND d.status = 'sent'
        AND d.external_id IS NOT NULL`,
    [id],
  );
  return r.rows;
}

async function deleteAnnouncement(id) {
  await db.query('DELETE FROM announcements WHERE id = $1', [id]);
}

/** Failed and skipped deliveries of one announcement, with who and why. */
async function failedDeliveries(id) {
  const r = await db.query(
    `SELECT d.id, d.channel, d.status, d.attempts, d.last_error, d.created_at,
            u.full_name, u.email
       FROM announcement_deliveries d
       LEFT JOIN users u ON u.id = d.user_id
      WHERE d.announcement_id = $1 AND d.status IN ('failed', 'skipped')
      ORDER BY d.channel, u.full_name NULLS FIRST
      LIMIT 500`,
    [id],
  );
  return r.rows;
}

/** E-mail announcements an event sent in the last day (the anti-spam limit counts these). */
async function emailAnnouncementsToday(eventId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM announcements
      WHERE event_id = $1 AND auto_key IS NULL AND status <> 'cancelled'
        AND channels ? 'email' AND created_at > now() - interval '1 day'`,
    [eventId],
  );
  return r.rows[0].n;
}

module.exports = {
  CHANNELS,
  TYPES,
  PRIORITIES,
  normaliseChannels,
  createAnnouncement,
  getById,
  getAnnouncements,
  listForManager,
  listForMember,
  updateAnnouncement,
  cancelAnnouncement,
  markSent,
  channelPosts,
  deleteAnnouncement,
  failedDeliveries,
  emailAnnouncementsToday,
  deliveryReport,
};
