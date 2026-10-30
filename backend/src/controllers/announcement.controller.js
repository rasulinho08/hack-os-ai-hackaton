/**
 * @file announcement.controller.js
 * @description HTTP handlers for event announcements.
 *
 * Organisers write an announcement for an audience (announcementAudience.js),
 * pick where it goes besides the app (Telegram, e-mail) and when (now, or a
 * time). Publishing and delivering happen in the background
 * (jobs/announcementJobs.js); this file only checks and records.
 *
 * Readers get the announcements meant for them: organisers every one of
 * their event (with its delivery report), everyone else the sent ones of
 * their audiences.
 */

const db = require('../config/db');
const announcementService = require('../services/announcement.service');
const { AUDIENCES, countRecipients, recipients } = require('../services/announcementAudience');
const jobs = require('../services/jobs.service');
const { publishKey } = require('../jobs/announcementJobs');
const { forEvent } = require('../services/entitlement.service');
const { getDefaultEventForUser } = require('../services/event.service');
const { errorResponse, successResponse, errorFromException, httpError } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { userMayAccessEvent, filterByVisibleEvent } = require('../services/tenantAccess.service');
const { isAdminUser, isOwnerUser } = require('../utils/authz');

/** E-mail announcements an event may send a day (automatic ones not counted). */
const EMAIL_PER_DAY = 20;
const MAX_TITLE = 255;
const MAX_CONTENT = 10_000;
const MAX_SCHEDULE_DAYS = 365;

const toId = (v) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Whether the caller runs this event (and so sees everything about its announcements). */
async function managesEvent(user, eventId) {
  if (isOwnerUser(user)) return true;
  if (user.eventRole) return user.eventRole === 'organizer' && Number(user.contextEventId) === Number(eventId);
  return isAdminUser(user) && (await userMayAccessEvent(user, eventId));
}

/**
 * Check and tidy what the organiser sent. `partial` for an update, where
 * every field may be left out.
 */
async function readInput(body, eventId, { partial = false } = {}) {
  const errors = [];
  const out = {};
  const has = (k) => body[k] !== undefined;

  if (!partial || has('title')) {
    const title = String(body.title ?? '').trim();
    if (!title) errors.push({ field: 'title', code: 'REQUIRED' });
    else if (title.length > MAX_TITLE) errors.push({ field: 'title', code: 'TOO_LONG', max: MAX_TITLE });
    out.title = title;
  }
  if (!partial || has('content')) {
    const content = String(body.content ?? '').trim();
    if (!content) errors.push({ field: 'content', code: 'REQUIRED' });
    else if (content.length > MAX_CONTENT) errors.push({ field: 'content', code: 'TOO_LONG', max: MAX_CONTENT });
    out.content = content;
  }
  if (has('type') || !partial) {
    const type = String(body.type || 'info').toLowerCase();
    out.type = announcementService.TYPES.includes(type) ? type : 'info';
  }
  if (has('priority') || !partial) {
    const priority = String(body.priority || 'normal').toLowerCase();
    out.priority = announcementService.PRIORITIES.includes(priority) ? priority : 'normal';
  }
  if (has('audience') || !partial) {
    const audience = String(body.audience || 'everyone');
    if (!AUDIENCES.includes(audience)) errors.push({ field: 'audience', code: 'INVALID' });
    out.audience = audience;
    if (audience === 'track') {
      const trackId = toId(body.trackId ?? body.track_id);
      const ok = trackId && (await db.query('SELECT 1 FROM tracks WHERE id = $1 AND event_id = $2', [trackId, eventId])).rows[0];
      if (!ok) errors.push({ field: 'trackId', code: 'INVALID' });
      out.track_id = trackId;
    }
  }
  if (has('channels') || !partial) {
    out.channels = announcementService.normaliseChannels(body.channels);
  }
  if (has('scheduledAt') || has('scheduled_at')) {
    const raw = body.scheduledAt ?? body.scheduled_at;
    if (raw === null || raw === '') out.scheduled_at = null;
    else {
      const at = new Date(raw);
      const ms = at.getTime();
      if (!Number.isFinite(ms)) errors.push({ field: 'scheduledAt', code: 'INVALID' });
      else if (ms < Date.now() + 30e3) errors.push({ field: 'scheduledAt', code: 'IN_PAST' });
      else if (ms > Date.now() + MAX_SCHEDULE_DAYS * 86400e3) errors.push({ field: 'scheduledAt', code: 'TOO_FAR' });
      out.scheduled_at = at.toISOString();
    }
  }
  if (errors.length) {
    throw httpError(400, 'Check the announcement and try again.', 'ANNOUNCEMENT_INVALID', { errors });
  }
  return out;
}

/** Telegram needs the plan's telegram module; e-mail is capped per day. */
async function checkChannels(eventId, channels, { creating }) {
  if (channels.includes('telegram')) {
    const scope = await forEvent(eventId);
    if (scope && !scope.modules.has('telegram')) {
      throw httpError(403, 'Telegram is not part of the plan this event runs on.', 'MODULE_DISABLED', { module: 'telegram' });
    }
  }
  if (creating && channels.includes('email')) {
    const today = await announcementService.emailAnnouncementsToday(eventId);
    if (today >= EMAIL_PER_DAY) {
      throw httpError(429, `An event can send at most ${EMAIL_PER_DAY} announcements by e-mail a day.`, 'EMAIL_LIMIT', { limit: EMAIL_PER_DAY });
    }
  }
}

async function queuePublish(a) {
  await jobs.enqueue('announcement.publish', { announcementId: a.id }, {
    runAt: a.status === 'scheduled' ? a.scheduled_at : null,
    dedupeKey: publishKey(a),
  });
}

/** POST /api/announcements */
const createAnnouncement = async (req, res, next) => {
  try {
    const eventId = toId(req.body.eventId ?? req.body.event_id);
    if (!eventId) return errorResponse(res, HTTP.BAD_REQUEST, 'eventId is required', null, 'EVENT_REQUIRED');
    if (!(await userMayAccessEvent(req.user, eventId))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
    }
    const input = await readInput(req.body, eventId);
    await checkChannels(eventId, input.channels, { creating: true });
    const announcement = await announcementService.createAnnouncement({ ...input, event_id: eventId, author_id: req.user.id });
    await queuePublish(announcement);
    return successResponse(res, HTTP.CREATED, announcement.status === 'scheduled' ? 'Announcement scheduled' : 'Announcement published', {
      ...announcement,
      deliveries: {},
    });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** GET /api/announcements?eventId= */
const getAnnouncements = async (req, res, next) => {
  try {
    let eventId = toId(req.query.eventId ?? req.query.event_id);
    if (eventId) {
      if (await managesEvent(req.user, eventId)) {
        return res.status(200).json({ success: true, data: await announcementService.listForManager(eventId) });
      }
      // Announcements are for the event's own people: its staff and its (even pending) participants.
      if (!(await userMayAccessEvent(req.user, eventId, { gateHackers: true }))) {
        return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
      }
      return res.status(200).json({ success: true, data: await announcementService.listForMember(eventId, req.user.id) });
    }
    // No event named: an organiser sees every event they run; anyone else
    // the event they are working in.
    if (isAdminUser(req.user) && !req.user.eventRole) {
      const rows = await filterByVisibleEvent(req.user, await announcementService.getAnnouncements(null));
      return res.status(200).json({ success: true, data: rows });
    }
    eventId = toId(req.user.contextEventId) || toId((await getDefaultEventForUser(req.user.id))?.id);
    if (!eventId) return res.status(200).json({ success: true, data: [] });
    return res.status(200).json({ success: true, data: await announcementService.listForMember(eventId, req.user.id) });
  } catch (error) {
    return next(error);
  }
};

/** GET /api/announcements/audience?eventId=&audience=&trackId= — how many it would reach. */
const audienceSize = async (req, res, next) => {
  try {
    const eventId = toId(req.query.eventId);
    if (!eventId || !(await userMayAccessEvent(req.user, eventId))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
    }
    const audience = AUDIENCES.includes(req.query.audience) ? req.query.audience : 'everyone';
    const trackId = toId(req.query.trackId);
    const people = await countRecipients(audience, eventId, trackId);
    let email = 0;
    let telegram = 0;
    if (people) {
      const { sql, params } = recipients(audience, eventId, trackId);
      const r = await db.query(
        `SELECT COUNT(*) FILTER (WHERE COALESCE(TRIM(u.email), '') <> '')::int AS email,
                COUNT(l.user_id) FILTER (WHERE l.blocked_at IS NULL)::int AS telegram
           FROM (${sql}) aud
           JOIN users u ON u.id = aud.user_id
           LEFT JOIN telegram_links l ON l.user_id = aud.user_id`,
        params,
      );
      ({ email, telegram } = r.rows[0]);
    }
    const channel = (await db.query('SELECT title, username FROM event_telegram_channels WHERE event_id = $1', [eventId])).rows[0] || null;
    return successResponse(res, HTTP.OK, 'OK', { audience, people, email, telegram, channel });
  } catch (error) {
    return next(error);
  }
};

/** PUT /api/announcements/:id */
const updateAnnouncement = async (req, res, next) => {
  try {
    const current = await announcementService.getById(req.params.id);
    if (!current) return errorResponse(res, HTTP.NOT_FOUND, 'Announcement not found', null, 'NOT_FOUND');
    if (current.status === 'cancelled') {
      return errorResponse(res, HTTP.CONFLICT, 'A cancelled announcement cannot be changed.', null, 'ANNOUNCEMENT_CANCELLED');
    }
    const input = await readInput(req.body, current.event_id, { partial: true });
    if (current.status === 'scheduled' && input.channels) await checkChannels(current.event_id, input.channels, { creating: false });
    if (current.status === 'scheduled' && input.scheduled_at === null) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'Use "send now" to publish a scheduled announcement.', null, 'USE_SEND_NOW');
    }
    const updated = await announcementService.updateAnnouncement(current.id, input);
    if (updated.status === 'scheduled' && String(updated.scheduled_at) !== String(current.scheduled_at)) {
      await jobs.cancelByPrefix(`ann:${updated.id}:publish`);
      await queuePublish(updated);
    }
    // A sent announcement's channel post follows the correction.
    if (updated.status === 'sent' && (input.title !== undefined || input.content !== undefined || input.priority !== undefined)) {
      await jobs.enqueue('announcement.sync_post', { announcementId: updated.id }, { dedupeKey: `ann:${updated.id}:sync:${Date.now()}` });
    }
    return successResponse(res, HTTP.OK, 'Announcement updated', updated);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** POST /api/announcements/:id/cancel — a scheduled one will not go out. */
const cancelAnnouncement = async (req, res, next) => {
  try {
    const cancelled = await announcementService.cancelAnnouncement(req.params.id);
    if (!cancelled) {
      return errorResponse(res, HTTP.CONFLICT, 'Only a scheduled announcement can be cancelled.', null, 'NOT_SCHEDULED');
    }
    await jobs.cancelByPrefix(`ann:${cancelled.id}:publish`);
    return successResponse(res, HTTP.OK, 'Announcement cancelled', cancelled);
  } catch (error) {
    return next(error);
  }
};

/** POST /api/announcements/:id/send-now — publish a scheduled one immediately. */
const sendNow = async (req, res, next) => {
  try {
    const current = await announcementService.getById(req.params.id);
    if (!current || current.status !== 'scheduled') {
      return errorResponse(res, HTTP.CONFLICT, 'Only a scheduled announcement can be sent now.', null, 'NOT_SCHEDULED');
    }
    await jobs.cancelByPrefix(`ann:${current.id}:publish`);
    const sent = await announcementService.markSent(current.id);
    if (!sent) return errorResponse(res, HTTP.CONFLICT, 'Only a scheduled announcement can be sent now.', null, 'NOT_SCHEDULED');
    await jobs.enqueue('announcement.publish', { announcementId: sent.id }, { dedupeKey: `ann:${sent.id}:publish:now` });
    return successResponse(res, HTTP.OK, 'Announcement published', sent);
  } catch (error) {
    return next(error);
  }
};

/** GET /api/announcements/:id/deliveries — the report, and who did not get it and why. */
const getDeliveries = async (req, res, next) => {
  try {
    const a = await announcementService.getById(req.params.id);
    if (!a) return errorResponse(res, HTTP.NOT_FOUND, 'Announcement not found', null, 'NOT_FOUND');
    const [report, problems] = await Promise.all([
      announcementService.deliveryReport([a.id]),
      announcementService.failedDeliveries(a.id),
    ]);
    return successResponse(res, HTTP.OK, 'OK', { report: report.get(a.id) || {}, problems });
  } catch (error) {
    return next(error);
  }
};

/** DELETE /api/announcements/:id — also takes its post down from the event's channel. */
const deleteAnnouncement = async (req, res, next) => {
  try {
    const { id } = req.params;
    const posts = await announcementService.channelPosts(id);
    await jobs.cancelByPrefix(`ann:${Number(id)}:`);
    await announcementService.deleteAnnouncement(id);
    if (posts.length) {
      await jobs.enqueue('announcement.retract', {
        posts: posts.map((p) => ({ chatId: String(p.chat_id), messageId: p.external_id })),
      });
    }
    return res.status(200).json({ success: true, message: 'Announcement deleted successfully' });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createAnnouncement,
  getAnnouncements,
  audienceSize,
  updateAnnouncement,
  cancelAnnouncement,
  sendNow,
  getDeliveries,
  deleteAnnouncement,
};
