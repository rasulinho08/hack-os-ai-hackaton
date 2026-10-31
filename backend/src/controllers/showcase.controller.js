/**
 * @file showcase.controller.js
 * @description Stories from past hackathons (see showcase.service).
 *
 * Owner (owner.routes.js):
 *   GET    /api/owner/showcase                  every story, drafts first
 *   POST   /api/owner/showcase                  { title, summary, body, heldFrom, heldTo, location,
 *                                                 organisers, figures, photos, coverFileId, eventId } → a draft
 *   POST   /api/owner/showcase/files            raw image body, X-File-Name → { id, url, mime, sizeBytes }
 *   GET    /api/owner/showcase/:id
 *   PATCH  /api/owner/showcase/:id              any of the fields above, and slug
 *   DELETE /api/owner/showcase/:id              the story and its photos
 *   POST   /api/owner/showcase/:id/publish | /unpublish
 *   POST   /api/owner/showcase/:id/schedule     { publishAt } → scheduled (a past time publishes now)
 *
 * Public (public.routes.js):
 *   GET    /api/public/showcase?limit=1..24&tag= published stories, newest event first
 *   GET    /api/public/showcase/:slug           one published story, or 404
 */

const showcase = require('../services/showcase.service');
const fileService = require('../services/file.service');
const audit = require('../services/audit.service');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const wrap = (fn) => async (req, res, next) => {
  try {
    return await fn(req, res);
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

const ownerList = wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  return successResponse(res, HTTP.OK, 'OK', await showcase.ownerList());
});

const ownerGet = wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  return successResponse(res, HTTP.OK, 'OK', await showcase.ownerGet(req.params.id));
});

const create = wrap(async (req, res) => {
  const story = await showcase.create(req.body, req.user.id);
  await audit.record(req, 'owner.showcase.create', { targetType: 'showcase_post', targetId: story.id, meta: { slug: story.slug } });
  return successResponse(res, HTTP.CREATED, 'Saved', story);
});

const update = wrap(async (req, res) => {
  const story = await showcase.update(req.params.id, req.body);
  await audit.record(req, 'owner.showcase.update', { targetType: 'showcase_post', targetId: story.id, meta: { slug: story.slug } });
  return successResponse(res, HTTP.OK, 'Saved', story);
});

const publish = wrap(async (req, res) => {
  const story = await showcase.publish(req.params.id);
  await audit.record(req, 'owner.showcase.publish', { targetType: 'showcase_post', targetId: story.id, meta: { slug: story.slug } });
  return successResponse(res, HTTP.OK, 'Published', story);
});

const unpublish = wrap(async (req, res) => {
  const story = await showcase.unpublish(req.params.id);
  await audit.record(req, 'owner.showcase.unpublish', { targetType: 'showcase_post', targetId: story.id, meta: { slug: story.slug } });
  return successResponse(res, HTTP.OK, 'Unpublished', story);
});

const schedule = wrap(async (req, res) => {
  const story = await showcase.schedule(req.params.id, req.body?.publishAt);
  const action = story.status === 'scheduled' ? 'owner.showcase.schedule' : 'owner.showcase.publish';
  await audit.record(req, action, { targetType: 'showcase_post', targetId: story.id, meta: { slug: story.slug, publishAt: story.publishAt } });
  return successResponse(res, HTTP.OK, story.status === 'scheduled' ? 'Scheduled' : 'Published', story);
});

const remove = wrap(async (req, res) => {
  const out = await showcase.remove(req.params.id);
  await audit.record(req, 'owner.showcase.delete', { targetType: 'showcase_post', targetId: out.id, meta: { slug: out.slug, files: out.removedFiles } });
  return successResponse(res, HTTP.OK, 'Deleted', out);
});

/** A story photo: an image, public by link, belonging to no event. */
const upload = wrap(async (req, res) => {
  const stored = await fileService.store({
    data: req.body,
    purpose: 'showcase',
    event: null,
    userId: req.user.id,
    filename: req.get('x-file-name'),
  });
  await audit.record(req, 'owner.showcase.upload', { targetType: 'file', targetId: stored.id, meta: { size: stored.size } });
  return successResponse(res, HTTP.CREATED, 'File uploaded', {
    id: stored.id,
    url: fileService.fileUrl(stored.id),
    mime: stored.mime,
    sizeBytes: stored.size,
  });
});

const publicList = wrap(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  return successResponse(res, HTTP.OK, 'OK', await showcase.publicList({ limit: req.query.limit, tag: req.query.tag }));
});

const publicDetail = wrap(async (req, res) => {
  const story = await showcase.publicDetail(req.params.slug);
  if (!story) return errorResponse(res, HTTP.NOT_FOUND, 'Story not found', null, 'NOT_FOUND');
  res.set('Cache-Control', 'public, max-age=300');
  return successResponse(res, HTTP.OK, 'OK', story);
});

module.exports = { ownerList, ownerGet, create, update, publish, unpublish, schedule, remove, upload, publicList, publicDetail };
