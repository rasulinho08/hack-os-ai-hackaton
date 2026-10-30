/**
 * @file chat.controller.js
 * @description Event chat (see chat.service for who reads and writes what).
 *
 *   GET    /api/events/:eventId/chat                           the caller's channels
 *   GET    /api/events/:eventId/chat/tickets/:ticketId         a help request's thread
 *   GET    /api/events/:eventId/chat/channels/:id              one channel (a link from the bell)
 *   GET    /api/events/:eventId/chat/channels/:id/messages     ?after&wait | ?before, ?since
 *   POST   /api/events/:eventId/chat/channels/:id/messages     { body }
 *   POST   /api/events/:eventId/chat/channels/:id/read         { lastId }
 *   POST   /api/events/:eventId/chat/channels/:id/lock|unlock  organiser
 *   DELETE /api/events/:eventId/chat/messages/:id              author or organiser
 *   POST   /api/events/:eventId/chat/messages/:id/report       { reason }
 *   GET    /api/events/:eventId/chat/reports                   organiser
 *   POST   /api/events/:eventId/chat/reports/:messageId/resolve { action: dismiss | remove }
 *   GET    /api/events/:eventId/chat/mutes                     organiser
 *   POST   /api/events/:eventId/chat/mutes                     { userId, minutes?, reason? }
 *   DELETE /api/events/:eventId/chat/mutes/:userId
 */

const chat = require('../services/chat.service');
const audit = require('../services/audit.service');
const notifications = require('../services/notification.service');
const { successResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const eventIdOf = (req) => Number(req.params.eventId);
const wrap = (fn) => async (req, res, next) => {
  try {
    return await fn(req, res);
  } catch (err) {
    return errorFromException(res, next, err);
  }
};
const ok = (res, data, message = 'OK') => successResponse(res, HTTP.OK, message, data);

const list = wrap(async (req, res) => ok(res, await chat.listChannels(req.user, eventIdOf(req))));
const ticket = wrap(async (req, res) => ok(res, await chat.ticketChannel(req.user, eventIdOf(req), req.params.ticketId)));
const channel = wrap(async (req, res) => ok(res, await chat.channel(req.user, eventIdOf(req), req.params.id)));

const messages = wrap(async (req, res) => {
  const data = await chat.messages(req.user, eventIdOf(req), req.params.id, req.query, res);
  if (res.writableEnded || res.destroyed) return undefined;
  res.set('Cache-Control', 'no-store');
  return ok(res, data);
});

/**
 * The bell for a message in a private thread: a support thread tells the
 * other side (the person, or the organisers), a help request's thread the
 * team or its mentor. One row per thread and person, counted while unread.
 * Busy channels (general, team) only show unread counts in the chat.
 */
async function bellFor(eventId, ch, actor, message) {
  if (!['support', 'ticket'].includes(ch.kind)) return;
  let to = [];
  if (ch.kind === 'support') {
    to = actor.organizer ? [ch.user_id] : await notifications.organiserIds(eventId);
  } else if (actor.organizer || actor.mentor) {
    to = [ch.requester_id, ...(await notifications.teamMemberIds(ch.ticket_team_id))];
  } else {
    to = ch.ticket_mentor_id ? [ch.ticket_mentor_id] : [];
  }
  to = to.filter((id) => id != null && Number(id) !== Number(actor.userId));
  await Promise.all(to.map((userId) => notifications.notify([userId], {
    eventId,
    kind: `chat.${ch.kind}`,
    target: 'chat',
    title: message.author?.name || null,
    body: String(message.body || '').slice(0, 200),
    data: {
      channelId: ch.id,
      channelKind: ch.kind,
      personName: ch.kind === 'support' ? ch.person_name || null : null,
      ticketTopic: ch.ticket_topic || null,
    },
    dedupeKey: `chat:${ch.id}`,
    collapse: 'count',
  })));
}

const post = wrap(async (req, res) => {
  const { message, channel, actor } = await chat.post(req.user, eventIdOf(req), req.params.id, req.body?.body);
  await bellFor(eventIdOf(req), channel, actor, message);
  return successResponse(res, HTTP.CREATED, 'Sent', message);
});

const read = wrap(async (req, res) => ok(res, await chat.markRead(req.user, eventIdOf(req), req.params.id, req.body?.lastId)));

const lockWith = (locked) => wrap(async (req, res) => {
  const out = await chat.setLocked(req.user, eventIdOf(req), req.params.id, locked);
  audit.record(req, locked ? 'chat.channel.lock' : 'chat.channel.unlock', { eventId: eventIdOf(req), targetType: 'chat_channel', targetId: out.id });
  return ok(res, out);
});

const remove = wrap(async (req, res) => {
  const out = await chat.remove(req.user, eventIdOf(req), req.params.id);
  if (out.byModerator) audit.record(req, 'chat.message.remove', { eventId: eventIdOf(req), targetType: 'chat_message', targetId: out.id });
  return ok(res, out, 'Removed');
});

const report = wrap(async (req, res) => {
  const out = await chat.report(req.user, eventIdOf(req), req.params.id, req.body?.reason);
  if (out.reported && out.first) {
    await notifications.notify(await notifications.organiserIds(eventIdOf(req)), {
      eventId: eventIdOf(req),
      kind: 'chat.report',
      target: 'chat',
      body: String(req.body?.reason || '').slice(0, 200) || null,
      data: { messageId: Number(req.params.id) },
      dedupeKey: `chatreport:${Number(req.params.id)}`,
    });
  }
  return ok(res, out, 'Reported');
});
const reports = wrap(async (req, res) => ok(res, await chat.listReports(req.user, eventIdOf(req))));

const resolve = wrap(async (req, res) => {
  const out = await chat.resolveReports(req.user, eventIdOf(req), req.params.messageId, req.body?.action);
  audit.record(req, `chat.report.${req.body?.action === 'remove' ? 'remove' : 'dismiss'}`, { eventId: eventIdOf(req), targetType: 'chat_message', targetId: out.id });
  return ok(res, out);
});

const mutes = wrap(async (req, res) => ok(res, await chat.listMutes(req.user, eventIdOf(req))));

const mute = wrap(async (req, res) => {
  const out = await chat.mute(req.user, eventIdOf(req), req.body || {});
  audit.record(req, 'chat.mute', { eventId: eventIdOf(req), targetType: 'user', targetId: out.userId, meta: { minutes: out.minutes } });
  return ok(res, out, 'Muted');
});

const unmute = wrap(async (req, res) => {
  const out = await chat.unmute(req.user, eventIdOf(req), req.params.userId);
  if (out.lifted) audit.record(req, 'chat.unmute', { eventId: eventIdOf(req), targetType: 'user', targetId: out.userId });
  return ok(res, out);
});

module.exports = {
  list, ticket, channel, messages, post, read, lock: lockWith(true), unlock: lockWith(false),
  remove, report, reports, resolve, mutes, mute, unmute,
};
