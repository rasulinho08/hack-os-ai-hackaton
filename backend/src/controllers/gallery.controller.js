/**
 * @file gallery.controller.js
 * @description An event's photo gallery (see gallery.service).
 *
 *   GET    /api/events/:eventId/gallery              the photos; canManage for organisers
 *   POST   /api/events/:eventId/gallery              { fileIds } organiser: add uploaded photos
 *   PATCH  /api/events/:eventId/gallery/:photoId     { caption?, position? } organiser
 *   DELETE /api/events/:eventId/gallery/:photoId     organiser: the photo and its file
 *   POST   /api/events/:eventId/gallery/share        { chat?, email?, message? } organiser
 *   GET    /api/gallery/:slug                        the same as the first, by the event's address
 *
 * Photos are uploaded first with POST /api/files?purpose=gallery&eventId=.
 */

const gallery = require('../services/gallery.service');
const audit = require('../services/audit.service');
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

const get = wrap(async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  return ok(res, await gallery.get(req.user, eventIdOf(req)));
});

const getBySlug = wrap(async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  return ok(res, await gallery.getBySlug(req.user, req.params.slug));
});

const add = wrap(async (req, res) => {
  const out = await gallery.add(req.user, eventIdOf(req), req.body);
  audit.record(req, 'event.gallery.add', { eventId: eventIdOf(req), targetType: 'event', targetId: eventIdOf(req), meta: { added: out.added } });
  return successResponse(res, HTTP.CREATED, 'Added', out);
});

const update = wrap(async (req, res) => {
  const out = await gallery.update(req.user, eventIdOf(req), req.params.photoId, req.body);
  audit.record(req, 'event.gallery.update', { eventId: eventIdOf(req), targetType: 'gallery_photo', targetId: req.params.photoId });
  return ok(res, out, 'Saved');
});

const remove = wrap(async (req, res) => {
  const out = await gallery.remove(req.user, eventIdOf(req), req.params.photoId);
  audit.record(req, 'event.gallery.delete', { eventId: eventIdOf(req), targetType: 'gallery_photo', targetId: out.id });
  return ok(res, out, 'Deleted');
});

const share = wrap(async (req, res) => {
  const out = await gallery.share(req.user, eventIdOf(req), req.body);
  audit.record(req, 'event.gallery.share', { eventId: eventIdOf(req), targetType: 'event', targetId: eventIdOf(req), meta: { chat: out.chat, email: out.email } });
  return ok(res, out, 'Shared');
});

module.exports = { get, getBySlug, add, update, remove, share };
