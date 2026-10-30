/**
 * @file announcementDelivery.js
 * @description Getting a published announcement to people outside the app:
 * e-mail, Telegram messages to people who connected their chat, and a post
 * in the event's Telegram channel.
 *
 * Publishing plans one announcement_deliveries row per message, then
 * `announcement.deliver` jobs work through them in batches of 25 per
 * channel: a failure is recorded on its own row and retried (1, 5, 30
 * minutes, or when Telegram says), so one bad address never holds up the
 * rest and a restart never sends twice. The organiser's announcement page
 * reads the counts back.
 *
 * Who gets what is the announcement's audience (announcementAudience.js).
 * A channel post goes out only for announcements meant for everyone or for
 * all participants — a note to the judges does not belong in a public
 * channel.
 */

const db = require('../config/db');
const jobs = require('./jobs.service');
const { recipients } = require('./announcementAudience');
const telegram = require('./telegram.service');
const emailService = require('./email.service');
const { eventSender } = require('./eventSender');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const notifications = require('./notification.service');

const BATCH = 25;
const MAX_ATTEMPTS = 4;
const RETRY_MINUTES = [1, 5, 30];
const STALE_MINUTES = 10;
const CHANNEL_AUDIENCES = new Set(['everyone', 'participants']);
const KINDS = ['email', 'telegram', 'telegram_channel'];

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function loadAnnouncement(id) {
  const r = await db.query(
    `SELECT a.*, e.name AS event_name, e.language AS event_language, e.slug AS event_slug,
            e.customer_id AS event_customer_id
       FROM announcements a JOIN events e ON e.id = a.event_id
      WHERE a.id = $1`,
    [id],
  );
  return r.rows[0] || null;
}

/**
 * Where an event's channel posts go: the channel its organiser connected,
 * or — for the platform's own events from before organisations existed —
 * the single channel in TELEGRAM_CHAT_ID. An organisation's event never
 * falls back to that shared channel.
 */
async function channelFor(a) {
  const r = await db.query('SELECT chat_id FROM event_telegram_channels WHERE event_id = $1', [a.event_id]);
  if (r.rows[0]) return { chatId: String(r.rows[0].chat_id), linked: true };
  if (!a.event_customer_id) {
    const legacy = telegram.normalizeChatId(process.env.TELEGRAM_CHAT_ID || '');
    if (legacy) return { chatId: legacy, linked: false };
  }
  return null;
}

/**
 * Plan the deliveries of a sent announcement and queue their first batches.
 * Safe to repeat: rows are unique per person and channel, jobs per batch.
 * @returns {Promise<{ email?: number, telegram?: number, telegram_channel?: number }>} rows added
 */
/**
 * The bell: one notification per person in the audience (whatever the
 * channels), once per announcement even when planning runs again. The
 * author does not need to hear about their own words.
 */
async function notifyInApp(announcementId) {
  const a = await loadAnnouncement(announcementId);
  if (!a || a.status !== 'sent') return 0;
  const { sql, params } = recipients(a.audience, a.event_id, a.track_id);
  const authorParam = `$${params.length + 1}`;
  return notifications.notifyAudience(
    `SELECT r.user_id FROM (${sql}) r WHERE r.user_id IS DISTINCT FROM ${authorParam}::int`,
    [...params, a.author_id ?? null],
    {
      eventId: a.event_id,
      kind: 'announcement',
      target: 'announcements',
      title: a.title,
      body: String(a.content || '').replace(/\s+/g, ' ').trim().slice(0, 280),
      data: { announcementId: a.id, priority: a.priority || 'normal' },
      dedupeKey: `ann:${a.id}`,
    },
  );
}

async function plan(announcementId) {
  const a = await loadAnnouncement(announcementId);
  if (!a || a.status !== 'sent') return {};
  const channels = new Set(Array.isArray(a.channels) ? a.channels : []);
  const planned = {};
  if (channels.has('email') || channels.has('telegram')) {
    const { sql, params } = recipients(a.audience, a.event_id, a.track_id);
    const idParam = `$${params.length + 1}`;
    if (channels.has('email')) {
      const r = await db.query(
        `INSERT INTO announcement_deliveries (announcement_id, channel, user_id)
         SELECT ${idParam}, 'email', u.id
           FROM (${sql}) r JOIN users u ON u.id = r.user_id
          WHERE COALESCE(TRIM(u.email), '') <> ''
         ON CONFLICT DO NOTHING`,
        [...params, a.id],
      );
      planned.email = r.rowCount;
    }
    if (channels.has('telegram')) {
      const r = await db.query(
        `INSERT INTO announcement_deliveries (announcement_id, channel, user_id)
         SELECT ${idParam}, 'telegram', l.user_id
           FROM (${sql}) r JOIN telegram_links l ON l.user_id = r.user_id
          WHERE l.blocked_at IS NULL
         ON CONFLICT DO NOTHING`,
        [...params, a.id],
      );
      planned.telegram = r.rowCount;
    }
  }
  if (channels.has('telegram') && CHANNEL_AUDIENCES.has(a.audience) && (await channelFor(a))) {
    const r = await db.query(
      `INSERT INTO announcement_deliveries (announcement_id, channel) VALUES ($1, 'telegram_channel')
       ON CONFLICT DO NOTHING`,
      [a.id],
    );
    planned.telegram_channel = r.rowCount;
  }
  // Queue every channel that has work waiting — also after a crash between
  // planning and queueing, when the rows exist but no job does.
  const waiting = await db.query(
    `SELECT DISTINCT channel FROM announcement_deliveries
      WHERE announcement_id = $1 AND status IN ('queued', 'retry')`,
    [a.id],
  );
  for (const { channel } of waiting.rows) {
    // eslint-disable-next-line no-await-in-loop
    await jobs.enqueue('announcement.deliver', { announcementId: a.id, channel, seq: 0 }, { dedupeKey: `ann:${a.id}:${channel}:0` });
  }
  return planned;
}

/** Which portal each recipient reads announcements in, for the link in the message. */
async function portalPaths(eventId, userIds) {
  const paths = new Map();
  if (!userIds.length) return paths;
  const r = await db.query(
    `SELECT u.id,
            EXISTS (SELECT 1 FROM participants p WHERE p.event_id = $1 AND p.user_id = u.id) AS participant,
            EXISTS (SELECT 1 FROM mentor_assignments m WHERE m.event_id = $1 AND m.user_id = u.id) AS mentor,
            EXISTS (SELECT 1 FROM volunteers v WHERE v.event_id = $1 AND v.user_id = u.id) AS volunteer,
            EXISTS (SELECT 1 FROM judges j WHERE j.event_id = $1 AND j.user_id = u.id) AS judge
       FROM unnest($2::int[]) AS u(id)`,
    [eventId, userIds],
  );
  for (const row of r.rows) {
    let path = '/';
    if (row.participant) path = '/hacker/announcements';
    else if (row.mentor) path = '/mentor/announcements';
    else if (row.volunteer) path = '/volunteer/announcements';
    else if (row.judge) path = '/judge';
    paths.set(row.id, path);
  }
  return paths;
}

/** What one batch needs besides the rows: addresses, chats, links, the event's signature. */
async function contextFor(a, channel, rows) {
  const base = resolveFrontendBaseUrl();
  const userIds = rows.map((d) => d.user_id).filter(Boolean);
  const ctx = { base, users: new Map(), links: new Map(), paths: new Map(), sender: {}, channel: null };
  if (channel === 'email') {
    const u = await db.query('SELECT id, full_name, email FROM users WHERE id = ANY($1::int[])', [userIds]);
    for (const row of u.rows) ctx.users.set(row.id, row);
    ctx.sender = await eventSender(a.event_id);
  }
  if (channel === 'telegram') {
    const l = await db.query('SELECT user_id, chat_id, blocked_at FROM telegram_links WHERE user_id = ANY($1::int[])', [userIds]);
    for (const row of l.rows) ctx.links.set(row.user_id, row);
  }
  if (channel === 'telegram_channel') ctx.channel = await channelFor(a);
  if (channel !== 'telegram_channel') ctx.paths = await portalPaths(a.event_id, userIds);
  return ctx;
}

const urlFor = (ctx, userId) => `${ctx.base}${ctx.paths.get(userId) || '/'}`;

/*
 * Each sender answers one of:
 *   { ok: true, externalId }       delivered
 *   { skip: reason }               not deliverable now, and not an error (no address, no bot)
 *   { error, permanent?, retryAfter? }
 */
const SENDERS = {
  async email(d, a, ctx) {
    const user = ctx.users.get(d.user_id);
    if (!user || !user.email) return { skip: 'No e-mail address' };
    const out = await emailService.sendAnnouncementEmail({
      to: user.email,
      eventName: a.event_name,
      title: a.title,
      content: a.content,
      priority: a.priority,
      url: urlFor(ctx, d.user_id),
      lang: a.event_language,
      sender: ctx.sender,
    });
    if (out.ok && out.logged) return { skip: 'No mail provider configured: written to the server log only' };
    if (out.ok) return { ok: true, externalId: out.id || null };
    return { error: out.message, permanent: out.status === 400 };
  },

  async telegram(d, a, ctx) {
    const link = ctx.links.get(d.user_id);
    if (!link) return { skip: 'Telegram is no longer connected' };
    if (link.blocked_at) return { skip: 'The person blocked the bot' };
    const { text, extra } = telegram.announcementMessage({
      title: a.title, content: a.content, priority: a.priority, eventName: a.event_name,
      withEvent: true, url: urlFor(ctx, d.user_id), lang: a.event_language,
    });
    const r = await telegram.sendMessage(String(link.chat_id), text, extra);
    if (r.ok) return { ok: true, externalId: String(r.result?.message_id ?? '') || null };
    if (r.notConfigured) return { skip: 'The Telegram bot is not configured' };
    if (r.error_code === 403) {
      await db.query('UPDATE telegram_links SET blocked_at = now() WHERE user_id = $1', [d.user_id]);
    }
    return { error: r.description, permanent: r.permanent, retryAfter: r.retryAfter };
  },

  async telegram_channel(d, a, ctx) {
    if (!ctx.channel) return { skip: 'No Telegram channel is connected' };
    const pageUrl = a.event_slug ? `${ctx.base}/e/${encodeURIComponent(a.event_slug)}` : null;
    const { text, extra } = telegram.announcementMessage({
      title: a.title, content: a.content, priority: a.priority, eventName: a.event_name,
      withEvent: !ctx.channel.linked, url: pageUrl, lang: a.event_language,
    });
    const r = await telegram.sendMessage(ctx.channel.chatId, text, extra);
    if (r.ok) {
      if (ctx.channel.linked) {
        await db.query('UPDATE event_telegram_channels SET last_post_at = now(), last_error = NULL WHERE event_id = $1', [a.event_id]);
      }
      return { ok: true, externalId: String(r.result?.message_id ?? '') || null };
    }
    if (r.notConfigured) return { skip: 'The Telegram bot is not configured' };
    if (r.permanent && ctx.channel.linked) {
      await db.query('UPDATE event_telegram_channels SET last_error = $2 WHERE event_id = $1', [a.event_id, r.description]);
    }
    return { error: r.description, permanent: r.permanent, retryAfter: r.retryAfter };
  },
};

async function record(d, out) {
  if (out.ok) {
    await db.query(
      `UPDATE announcement_deliveries
          SET status = 'sent', sent_at = now(), locked_at = NULL, external_id = $2, last_error = NULL
        WHERE id = $1`,
      [d.id, out.externalId ? String(out.externalId).slice(0, 64) : null],
    );
    return 'sent';
  }
  if (out.skip) {
    await db.query(
      `UPDATE announcement_deliveries SET status = 'skipped', locked_at = NULL, last_error = $2 WHERE id = $1`,
      [d.id, String(out.skip).slice(0, 500)],
    );
    return 'skipped';
  }
  const error = String(out.error || 'Delivery failed').slice(0, 500);
  if (out.permanent || d.attempts >= MAX_ATTEMPTS) {
    await db.query(
      `UPDATE announcement_deliveries SET status = 'failed', locked_at = NULL, last_error = $2 WHERE id = $1`,
      [d.id, error],
    );
    return 'failed';
  }
  const waitSeconds = out.retryAfter
    ? Math.min(3600, Math.max(1, Number(out.retryAfter)))
    : RETRY_MINUTES[Math.min(d.attempts, RETRY_MINUTES.length) - 1] * 60;
  await db.query(
    `UPDATE announcement_deliveries
        SET status = 'retry', locked_at = NULL, last_error = $2,
            next_attempt_at = now() + ($3 || ' seconds')::interval
      WHERE id = $1`,
    [d.id, error, String(waitSeconds)],
  );
  return 'retry';
}

/**
 * One batch of one channel of one announcement (the `announcement.deliver`
 * job). Queues the next batch while work remains.
 */
async function deliverBatch({ announcementId, channel, seq = 0 }) {
  if (!KINDS.includes(channel)) return { processed: 0, remaining: 0 };
  // Rows a crashed instance was sending go back in line.
  await db.query(
    `UPDATE announcement_deliveries SET status = 'retry', locked_at = NULL
      WHERE announcement_id = $1 AND channel = $2 AND status = 'sending'
        AND locked_at < now() - ($3 || ' minutes')::interval`,
    [announcementId, channel, String(STALE_MINUTES)],
  );
  const a = await loadAnnouncement(announcementId);
  if (!a) return { processed: 0, remaining: 0 }; // deleted: its deliveries went with it

  const claimed = (await db.query(
    `UPDATE announcement_deliveries
        SET status = 'sending', locked_at = now(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM announcement_deliveries
         WHERE announcement_id = $1 AND channel = $2 AND status IN ('queued', 'retry')
           AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT $3)
      RETURNING *`,
    [announcementId, channel, BATCH],
  )).rows;

  const tally = { sent: 0, skipped: 0, failed: 0, retry: 0 };
  if (claimed.length) {
    const ctx = await contextFor(a, channel, claimed);
    for (const d of claimed) {
      let out;
      try {
        // eslint-disable-next-line no-await-in-loop
        out = await SENDERS[channel](d, a, ctx);
      } catch (err) {
        out = { error: err?.message || 'Delivery failed' };
      }
      // eslint-disable-next-line no-await-in-loop
      tally[await record(d, out)] += 1;
      // Telegram allows about 30 messages a second; stay well under it.
      // eslint-disable-next-line no-await-in-loop
      if (channel !== 'email') await pause(40);
    }
  }

  const rest = (await db.query(
    `SELECT COUNT(*)::int AS n, MIN(COALESCE(next_attempt_at, now())) AS next_at
       FROM announcement_deliveries
      WHERE announcement_id = $1 AND channel = $2 AND status IN ('queued', 'retry')`,
    [announcementId, channel],
  )).rows[0];
  if (rest.n > 0) {
    const runAt = new Date(Math.max(Date.now() + 1000, new Date(rest.next_at).getTime()));
    await jobs.enqueue(
      'announcement.deliver',
      { announcementId, channel, seq: seq + 1 },
      { runAt, dedupeKey: `ann:${announcementId}:${channel}:${seq + 1}` },
    );
  }
  return { processed: claimed.length, remaining: rest.n, ...tally };
}

/** Bring the channel post of an edited announcement in line with it (`announcement.sync_post`). */
async function syncChannelPost({ announcementId }) {
  const a = await loadAnnouncement(announcementId);
  if (!a || a.status !== 'sent') return;
  const posts = await db.query(
    `SELECT d.external_id, c.chat_id
       FROM announcement_deliveries d
       JOIN event_telegram_channels c ON c.event_id = $2
      WHERE d.announcement_id = $1 AND d.channel = 'telegram_channel' AND d.status = 'sent'
        AND d.external_id IS NOT NULL`,
    [a.id, a.event_id],
  );
  for (const p of posts.rows) {
    const pageUrl = a.event_slug ? `${resolveFrontendBaseUrl()}/e/${encodeURIComponent(a.event_slug)}` : null;
    const { text, extra } = telegram.announcementMessage({
      title: a.title, content: a.content, priority: a.priority, eventName: a.event_name, url: pageUrl, lang: a.event_language,
    });
    // eslint-disable-next-line no-await-in-loop
    const r = await telegram.call('editMessageText', {
      chat_id: String(p.chat_id), message_id: Number(p.external_id), text, parse_mode: 'HTML',
      disable_web_page_preview: true, ...extra,
    });
    // "message is not modified" and a post deleted by hand are both fine.
    if (!r.ok && !r.permanent) throw new Error(r.description);
  }
}

/** Take down the channel posts of a deleted announcement (`announcement.retract`). */
async function retractPosts({ posts }) {
  for (const p of Array.isArray(posts) ? posts : []) {
    // eslint-disable-next-line no-await-in-loop
    const r = await telegram.call('deleteMessage', { chat_id: String(p.chatId), message_id: Number(p.messageId) });
    if (!r.ok && !r.permanent) throw new Error(r.description);
  }
}

module.exports = {
  notifyInApp, plan, deliverBatch, syncChannelPost, retractPosts, channelFor, MAX_ATTEMPTS, BATCH };
