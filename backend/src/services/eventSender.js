/**
 * @file eventSender.js
 * @description How one event signs the e-mail it sends participants and
 * staff: the sender name and reply-to address set in the builder
 * (Communication), the event's name when no sender name is set.
 *
 * Never throws: a missing event or a database hiccup means the platform's
 * own signature, not a lost e-mail.
 */

const db = require('../config/db');
const { withDefaults } = require('./eventBuilderInput');

/** @returns {Promise<{ fromName?: string, replyTo?: string }>} */
async function eventSender(eventId) {
  try {
    const r = await db.query('SELECT name, comms_config FROM events WHERE id = $1', [eventId]);
    const e = r.rows[0];
    if (!e) return {};
    const cc = withDefaults('comms_config', e.comms_config);
    const fromName = String(cc.senderName || e.name || '').trim();
    const replyTo = String(cc.replyTo || '').trim();
    return { ...(fromName ? { fromName } : {}), ...(replyTo ? { replyTo } : {}) };
  } catch (err) {
    console.error('[mail] event sender lookup failed:', err.message);
    return {};
  }
}

module.exports = { eventSender };
