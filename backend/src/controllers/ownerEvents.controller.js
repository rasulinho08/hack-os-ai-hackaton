/**
 * @file ownerEvents.controller.js
 * @description The owner console's events manager (see ownerEvents.service).
 *
 *   GET   /api/owner/events/:id/page          the public page's fields, directory state, old addresses
 *   PATCH /api/owner/events/:id/page          some of: name, slug, tagline, description, start_date,
 *                                             end_date, timezone, format, venue_name, venue_address,
 *                                             city, country, map_url, logo_file_id, banner_file_id,
 *                                             registration_start, registration_end, max_participants,
 *                                             waitlist_enabled, visibility, directory_listed
 *   PATCH /api/owner/events/:id/flags         { featured?, featuredRank?, isTest? }
 *   POST  /api/owner/events/:id/publish | /unpublish | /archive | /unarchive
 *
 * Every change is written to the audit trail under the event and its
 * organisation, with what changed.
 */

const ownerEvents = require('../services/ownerEvents.service');
const audit = require('../services/audit.service');
const { successResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const wrap = (fn) => async (req, res, next) => {
  try {
    return await fn(req, res);
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

const about = (row) => ({ eventId: row.id, customerId: row.customer_id ?? null, targetType: 'event', targetId: row.id });

const getPage = wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  return successResponse(res, HTTP.OK, 'OK', await ownerEvents.getEditable(req.params.id));
});

const updatePage = wrap(async (req, res) => {
  const out = await ownerEvents.update(req.params.id, req.body, { actorId: req.user.id });
  if (out.changed.length) {
    await audit.record(req, 'owner.event.update', {
      ...about(out.before),
      meta: { fields: out.changed, ...(out.slug ? { slug: out.slug } : {}) },
    });
  }
  return successResponse(res, HTTP.OK, out.changed.length ? 'Saved' : 'Nothing changed', { event: out.event, changed: out.changed });
});

const FLAG_ACTIONS = {
  directory_featured: (c) => (c.to ? 'owner.event.feature' : 'owner.event.unfeature'),
  directory_featured_rank: () => 'owner.event.feature_rank',
  is_test: (c) => (c.to ? 'owner.event.mark_test' : 'owner.event.unmark_test'),
};

const updateFlags = wrap(async (req, res) => {
  const out = await ownerEvents.setFlags(req.params.id, req.body);
  for (const [col, change] of Object.entries(out.changes)) {
    // A rank that moved together with the pin itself is part of that entry.
    if (col === 'directory_featured_rank' && out.changes.directory_featured) continue;
    // eslint-disable-next-line no-await-in-loop
    await audit.record(req, FLAG_ACTIONS[col](change), {
      ...about(out.row),
      meta: col === 'directory_featured' ? { rank: out.row.directory_featured_rank } : change,
    });
  }
  return successResponse(res, HTTP.OK, 'Saved', { event: out.event, changes: out.changes });
});

const lifecycle = (name, run, message) => wrap(async (req, res) => {
  const out = await run(req);
  await audit.record(req, `owner.event.${name}`, { ...about(out.row), meta: { name: out.row.name } });
  return successResponse(res, HTTP.OK, message, { event: out.event });
});

const publish = lifecycle('publish', (req) => ownerEvents.publish(req.params.id), 'Published');
const unpublish = lifecycle('unpublish', (req) => ownerEvents.unpublish(req.params.id), 'Unpublished');
const archive = lifecycle('archive', (req) => ownerEvents.archive(req.params.id, req.user.id), 'Archived');
const unarchive = lifecycle('unarchive', (req) => ownerEvents.unarchive(req.params.id), 'Back from the archive');

module.exports = { getPage, updatePage, updateFlags, publish, unpublish, archive, unarchive };
