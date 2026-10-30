/**
 * @file autoAnnouncementPlanner.js
 * @description Sends the automatic announcements an organiser switched on in
 * the builder (Messages, decision F8), each once per event.
 *
 * The worker calls `planDue` on every pass; it looks at most once a minute
 * for published events with a moment (registration close, start, deadline,
 * presentations) near enough, and sends whatever has become due. `trigger`
 * sends the two that are not on the clock — results and certificates — when
 * results are published or certificates issued.
 *
 * "Once" holds across instances: the row in event_auto_announcements is
 * claimed in the same transaction that creates the announcement.
 *
 * Events from before automatic announcements existed had them switched off
 * by migration 0014: their organisers never chose them.
 */

const db = require('../config/db');
const jobs = require('./jobs.service');
const auto = require('./autoAnnouncements');
const { withDefaults } = require('./eventBuilderInput');
const { forEvent } = require('./entitlement.service');
const { createAnnouncement } = require('./announcement.service');

// How often to look (AUTO_ANNOUNCE_EVERY_MS; tests shorten it). The windows are 30 minutes or more.
const PLAN_EVERY_MS = Number(process.env.AUTO_ANNOUNCE_EVERY_MS) || 60e3;
let lastPlan = 0;

const EVENT_COLUMNS = `e.id, e.name, e.language, e.timezone, e.registration_end, e.start_date, e.end_date,
  e.submission_deadline, e.demo_day, e.comms_config`;

/** Published events with a moment in the windows the announcements use. */
async function eventsNearAMoment() {
  const r = await db.query(
    `SELECT ${EVENT_COLUMNS}
       FROM events e
      WHERE e.is_published = true
        AND LOWER(TRIM(COALESCE(e.status::text, ''))) NOT IN ('archived', 'draft')
        AND (e.registration_end BETWEEN now() - interval '7 hours' AND now() + interval '25 hours'
          OR e.start_date BETWEEN now() - interval '3 hours' AND now() + interval '1 hour'
          OR COALESCE(e.submission_deadline, e.end_date) BETWEEN now() - interval '7 hours' AND now() + interval '25 hours'
          OR e.demo_day BETWEEN now() - interval '1 hour' AND now() + interval '2 hours')`,
  );
  return r.rows;
}

async function automationsAllowed(eventId) {
  const scope = await forEvent(eventId);
  return !scope || scope.modules.has('automations');
}

/**
 * Send automatic announcement `key` of event `e`, unless it went out before.
 * @returns {Promise<object|null>} the announcement, or null when already sent
 */
async function fire(e, key) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const claim = await client.query(
      `INSERT INTO event_auto_announcements (event_id, key) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING event_id`,
      [e.id, key],
    );
    if (!claim.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const words = auto.render(key, e);
    const a = await createAnnouncement({
      event_id: e.id,
      author_id: null,
      title: words.title,
      content: words.body,
      type: words.urgent ? 'alert' : 'reminder',
      priority: words.urgent ? 'urgent' : 'normal',
      audience: auto.AUDIENCE[key] || 'everyone',
      channels: ['platform', 'telegram', ...(words.email ? ['email'] : [])],
      auto_key: key,
      source: 'auto',
    }, client);
    await client.query(
      'UPDATE event_auto_announcements SET announcement_id = $3 WHERE event_id = $1 AND key = $2',
      [e.id, key, a.id],
    );
    await jobs.enqueue('announcement.publish', { announcementId: a.id }, { dedupeKey: `ann:${a.id}:publish:now`, exec: client });
    await client.query('COMMIT');
    return a;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Plan what is due now. Returns how many announcements went out.
 * @param {number} [now]
 * @param {{ force?: boolean }} [opts]  force: skip the once-a-minute throttle (tests)
 */
async function planDue(now = Date.now(), { force = false } = {}) {
  if (!force && now - lastPlan < PLAN_EVERY_MS) return 0;
  lastPlan = now;
  let sent = 0;
  for (const e of await eventsNearAMoment()) {
    const enabled = withDefaults('comms_config', e.comms_config).auto || {};
    const keys = auto.due(e, enabled, now);
    if (!keys.length) continue;
    // eslint-disable-next-line no-await-in-loop
    const done = new Set((await db.query(
      'SELECT key FROM event_auto_announcements WHERE event_id = $1',
      [e.id],
    )).rows.map((r) => r.key));
    const pending = keys.filter((k) => !done.has(k));
    // eslint-disable-next-line no-await-in-loop
    if (!pending.length || !(await automationsAllowed(e.id))) continue;
    for (const key of pending) {
      try {
        // eslint-disable-next-line no-await-in-loop
        if (await fire(e, key)) sent += 1;
      } catch (err) {
        console.error(`[auto-announcements] event ${e.id} ${key}: ${err.message}`);
      }
    }
  }
  return sent;
}

/**
 * Send `results` or `certs` for an event now (results published,
 * certificates issued), if the organiser left it on.
 * @returns {Promise<object|null>}
 */
async function trigger(eventId, key) {
  if (!['results', 'certs'].includes(key)) throw new Error(`Not a triggered announcement: ${key}`);
  const r = await db.query(`SELECT ${EVENT_COLUMNS} FROM events e WHERE e.id = $1`, [eventId]);
  const e = r.rows[0];
  if (!e) return null;
  const enabled = withDefaults('comms_config', e.comms_config).auto || {};
  if (!enabled[key] || !(await automationsAllowed(eventId))) return null;
  return fire(e, key);
}

module.exports = { planDue, trigger, fire };
