/**
 * @file telegram.controller.js
 * @description The platform bot over HTTP: its webhook, a person's own
 * connection, an event's channel, and its status for organisers (no secrets).
 */

const crypto = require('crypto');
const telegram = require('../services/telegram.service');
const links = require('../services/telegramLink.service');
const { isDevLike } = require('../utils/runtimeEnv');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

/** Constant-time comparison of the secret Telegram echoes back on every call. */
function secretMatches(given) {
  const expected = telegram.webhookSecret();
  if (!expected || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/telegram/webhook
 *
 * Shut (404) until TELEGRAM_WEBHOOK_SECRET is set; then every call must
 * carry it in X-Telegram-Bot-Api-Secret-Token, as Telegram does when the
 * webhook was set with that secret. A handled or unhandleable update is
 * answered 200 so Telegram does not resend it forever.
 */
const webhook = async (req, res) => {
  if (!telegram.webhookSecret() || !telegram.isEnabled()) {
    return res.status(404).json({ success: false, message: 'Not found', code: 'NOT_FOUND' });
  }
  if (!secretMatches(req.get('x-telegram-bot-api-secret-token'))) {
    return res.status(401).json({ success: false, message: 'Invalid webhook secret', code: 'UNAUTHENTICATED' });
  }
  try {
    const result = await links.handleUpdate(req.body);
    return res.status(200).json({ ok: true, ...(isDevLike() ? { result } : {}) });
  } catch (err) {
    console.error('[telegram] update failed:', err.message);
    return res.status(200).json({ ok: false });
  }
};

/** GET /api/telegram/status — for organisers' Messages page and the owner console. */
const getStatus = async (req, res, next) => {
  try {
    const configured = telegram.isEnabled();
    const bot = configured ? await telegram.getBot() : null;
    return successResponse(res, HTTP.OK, 'OK', {
      configured,
      botUsername: bot?.username || null,
      tokenAccepted: configured ? Boolean(bot) : false,
      webhookReady: Boolean(telegram.webhookSecret()),
      telegramConfigured: configured && Boolean(bot),
    });
  } catch (err) {
    return next(err);
  }
};

/* ── A person's own chat ───────────────────────────────────────────────── */

const getMine = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await links.getUserLink(req.user.id));
  } catch (err) {
    return next(err);
  }
};

const createMyLink = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.CREATED, 'Open the link in Telegram and press Start', await links.createUserLink(req.user.id));
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

const deleteMine = async (req, res, next) => {
  try {
    await links.unlinkUser(req.user.id);
    return successResponse(res, HTTP.OK, 'Telegram disconnected', await links.getUserLink(req.user.id));
  } catch (err) {
    return next(err);
  }
};

/* ── An event's channel (mounted under /api/events/:eventId/telegram) ───── */

const eventId = (req) => Number(req.params.eventId);

const getChannel = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await links.getChannel(eventId(req)));
  } catch (err) {
    return next(err);
  }
};

const createChannelCode = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.CREATED, 'Post the command in the channel', await links.createChannelCode(eventId(req), req.user.id));
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

const linkByUsername = async (req, res, next) => {
  try {
    const name = String(req.body?.username || req.body?.channel || '').trim();
    if (!name) return errorResponse(res, HTTP.BAD_REQUEST, 'Enter the channel as @name', null, 'TG_BAD_USERNAME');
    return successResponse(res, HTTP.OK, 'Channel connected', await links.linkChannelByUsername(eventId(req), req.user.id, name));
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

const updateChannel = async (req, res, next) => {
  try {
    if (typeof req.body?.mirrorPosts !== 'boolean') {
      return errorResponse(res, HTTP.BAD_REQUEST, 'mirrorPosts must be true or false', null, 'VALIDATION_ERROR');
    }
    return successResponse(res, HTTP.OK, 'Saved', await links.setMirror(eventId(req), req.body.mirrorPosts));
  } catch (err) {
    return next(err);
  }
};

const testChannel = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'Test message sent', await links.testChannel(eventId(req)));
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

const unlinkChannel = async (req, res, next) => {
  try {
    await links.unlinkChannel(eventId(req));
    return successResponse(res, HTTP.OK, 'Channel disconnected', await links.getChannel(eventId(req)));
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  webhook,
  getStatus,
  getMine,
  createMyLink,
  deleteMine,
  getChannel,
  createChannelCode,
  linkByUsername,
  updateChannel,
  testChannel,
  unlinkChannel,
};
