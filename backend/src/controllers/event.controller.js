/**
 * @file event.controller.js
 * @description HTTP handlers for event management.
 *
 * Routes:
 *   GET    /api/events                     → getAllEvents (public: published only)
 *   GET    /api/events/active              → getActiveEvent
 *   GET    /api/events/details/:id         → getEventById (admin)
 *   GET    /api/events/:identifier         → getEventByIdentifier (ID or code)
 *   POST   /api/events                     → createEvent  (admin); optional body.criteria → scoring_criteria rows
 *   PUT    /api/events/:id                 → updateEvent  (admin)
 *   DELETE /api/events/:id                 → deleteEvent  (admin)
 *   POST   /api/events/:id/publish         → publishEvent (admin)
 *   POST   /api/events/:id/archive         → archiveEvent (admin): read-only from now on
 *   POST   /api/events/:id/unarchive       → unarchiveEvent (admin)
 *   GET    /api/events/:id/export.zip      → exportEventZip (admin): everything in the event
 *   GET    /api/events/:id/analytics       → getEventAnalytics (admin)
 *   GET    /api/events/:id/overview        → getEventOverview (admin): the organiser's home
 */

const eventService = require('../services/event.service');
const judgeService = require('../services/judge.service');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { isOwnerUser } = require('../utils/authz');
const { seesUnassignedEvents, activeEventFor } = require('../services/tenantAccess.service');
const tenancyService = require('../services/tenancy.service');
const audit = require('../services/audit.service');
const entitlementService = require('../services/entitlement.service');
const eventBuilder = require('../services/eventBuilder.service');
const eventArchive = require('../services/eventArchive.service');
const db = require('../config/db');
const { eventRoleOf, participantEventId } = require('../services/effectiveRole.service');
const { openEvent } = require('../utils/secretBox');
const { phaseOf } = require('../services/eventOverview.service');

/**
 * The online link (Zoom, Meet, Discord…) is for the event's own people: its
 * organisers and staff, and participants who were admitted. Someone pending,
 * waitlisted or rejected can still see the event, but not the room.
 */
async function withoutPrivateLink(event, user) {
  if (!event || !event.online_url) return event;
  if (user && isOwnerUser(user)) return openEvent(event);
  const r = user ? await eventRoleOf(user.id, event.id) : null;
  if (r && (r.role !== 'participant' || ['approved', 'eliminated'].includes(r.participantStatus))) return openEvent(event);
  const { online_url: _hidden, ...rest } = event;
  return rest;
}

/**
 * GET /api/events
 *
 * Three answers, by who is asking.
 *
 *   owner            every event on the installation
 *   admin/org_admin  their customer's events, plus any not yet assigned
 *   anyone else      only the events they belong to
 *   anonymous        published, non-archived, public columns
 *
 * This route used to hand `getAllEvents()` to anybody with a session, so a
 * hacker registered for one hackathon received every hackathon on the
 * platform, unpublished drafts included.
 *
 * Customer administrators are scoped too: they see events they created and
 * events of a customer they belong to. Events with no customer are no longer
 * shared with every organiser (see seesUnassignedEvents) — with self-serve
 * checkout that rule handed other organisations' events to any new buyer.
 */
const getAllEvents = async (req, res, next) => {
  try {
    if (!req.user) {
      return successResponse(res, HTTP.OK, 'OK', await eventService.getPublicEvents());
    }
    const events = isOwnerUser(req.user)
      ? await eventService.getAllEvents()
      : await eventService.getEventsVisibleTo(req.user.id, {
        includeUnassigned: seesUnassignedEvents(req.user),
      });
    // `phase` is where each event is now, by the organiser home's rule (the
    // dates and whether results were published), so every list, badge and
    // the home use one word for it.
    return successResponse(res, HTTP.OK, 'OK', await Promise.all(events.map(async (e) => ({
      ...(await withoutPrivateLink(e, req.user)), phase: phaseOf(e).key,
    }))));
  } catch (error) { next(error); }
};

const getActiveEvent = async (req, res, next) => {
  try {
    // A hacker's "active event" is the one they act in (participantEventId:
    // the one named or entered, if they are registered there, else their
    // default); the platform-wide pick is for staff and organisers.
    const role = String(req.user?.role || '').toLowerCase();
    let event;
    if (role === 'hacker' || role === 'pending') {
      const id = await participantEventId(req);
      event = id ? await eventService.getEventById(id) : null;
    } else {
      event = await activeEventFor(req.user);
    }
    if (!event) return errorResponse(res, HTTP.NOT_FOUND, 'No active event found', null, 'NO_ACTIVE_EVENT');
    return successResponse(res, HTTP.OK, 'OK', await withoutPrivateLink(event, req.user));
  } catch (error) { next(error); }
};

const getEventById = async (req, res, next) => {
  try {
    const event = await eventService.getEventById(req.params.id);
    if (!event) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found');
    return successResponse(res, HTTP.OK, 'OK', event);
  } catch (error) { next(error); }
};

/** Accepts either a numeric ID or an event_code string. */
/**
 * GET /api/events/:identifier  (id or event code)
 *
 * Anonymous callers get the public column list, and only for a published,
 * non-archived event — everything else is a 404 rather than a 403, so the
 * endpoint does not confirm that a hidden event exists.
 *
 * This route took no authentication at all and returned `SELECT *`. Ids are
 * sequential, so walking /api/events/1, /2, /3 exposed every event on the
 * platform including drafts nobody had announced.
 */
const getEventByIdentifier = async (req, res, next) => {
  try {
    const { identifier } = req.params;

    if (!req.user) {
      const publicEvent = await eventService.getPublicEventByIdentifier(identifier);
      if (!publicEvent) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found');
      return successResponse(res, HTTP.OK, 'OK', publicEvent);
    }

    const isNumeric = /^\d+$/.test(identifier);
    const event = isNumeric
      ? await eventService.getEventById(identifier)
      : await eventService.getEventByCode(identifier);
    if (!event) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found');

    if (!isOwnerUser(req.user)) {
      const allowed = await eventService.canUserSeeEvent(req.user.id, event.id, {
        includeUnassigned: seesUnassignedEvents(req.user),
      });
      if (!allowed) {
        // Same 404 an anonymous caller gets: membership is not disclosed.
        return errorResponse(res, HTTP.NOT_FOUND, 'Event not found');
      }
    }
    return successResponse(res, HTTP.OK, 'OK', await withoutPrivateLink(event, req.user));
  } catch (error) { next(error); }
};

const createEvent = async (req, res, next) => {
  let reserved = null;
  try {
    const { criteria, judging, ...eventBody } = req.body || {};

    /*
     * An event belongs to its organiser's organisation from the moment it is
     * created, so tenant isolation covers it without the platform owner
     * assigning each event by hand. It takes one event from that
     * organisation's plan when it goes public: a draft costs nothing. This
     * older route can publish on create (is_published: true), so it reserves
     * the credit first in that case — an organisation with nothing left gets
     * a clear refusal, not half an event. Exempt organisations and the
     * owner's own events take nothing. The builder (POST /api/events/drafts)
     * is the way the web app creates events now.
     */
    let org = null;
    const publishNow = ['true', true, 1, '1'].includes(eventBody.is_published ?? eventBody.isPublished);
    if (!isOwnerUser(req.user)) {
      org = await entitlementService.organisationForNewEvent(req.user.id);
      if (publishNow) reserved = await entitlementService.reserveEventCredit(org, { startDate: eventBody.start_date ?? eventBody.startDate });
    }

    const newEvent = await eventService.createEvent({
      ...eventBody,
      created_by: req.user.id,
    });
    if (org) {
      await tenancyService.assignEventToCustomer(newEvent.id, org.id);
      newEvent.customer_id = org.id;
    }
    if (reserved) {
      await db.query('UPDATE events SET entitlement_id = $1 WHERE id = $2', [reserved, newEvent.id]);
      newEvent.entitlement_id = reserved;
      reserved = null;
    }

    const criteriaList = Array.isArray(criteria)
      ? criteria
      : judging && Array.isArray(judging.criteria)
        ? judging.criteria
        : null;
    if (criteriaList && criteriaList.length > 0) {
      await judgeService.replaceCriteriaForEvent(newEvent.id, criteriaList);
    }

    return successResponse(res, HTTP.CREATED, 'Event created successfully', newEvent);
  } catch (error) {
    if (reserved) await entitlementService.releaseEventCredit(reserved).catch(() => {});
    return errorFromException(res, next, error);
  }
};

const updateEvent = async (req, res, next) => {
  try {
    const updated = await eventService.updateEvent(req.params.id, req.body || {});
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found');
    return successResponse(res, HTTP.OK, 'Event updated successfully', updated);
  } catch (error) { return errorFromException(res, next, error); }
};

const deleteEvent = async (req, res, next) => {
  try {
    const deleted = await eventService.deleteEvent(req.params.id);
    // An event that never went public gives its plan credit back.
    if (deleted.entitlement_id && !deleted.is_published) {
      await entitlementService.releaseEventCredit(deleted.entitlement_id);
    }
    audit.record(req, 'event.delete', { targetType: 'event', targetId: req.params.id });
    return successResponse(res, HTTP.OK, 'Event deleted successfully');
  } catch (error) { return errorFromException(res, next, error); }
};

/** Same rules as the builder's publish: complete enough, and a plan credit. */
const publishEvent = async (req, res, next) => {
  try {
    const data = await eventBuilder.publish(Number(req.params.id));
    audit.record(req, 'event.publish', { eventId: Number(req.params.id), targetType: 'event', targetId: req.params.id });
    return successResponse(res, HTTP.OK, 'Event published successfully', data.event);
  } catch (error) { return errorFromException(res, next, error); }
};

const archiveEvent = async (req, res, next) => {
  try {
    const eventId = Number(req.params.id);
    const out = await eventArchive.archive(eventId, req.user.id);
    audit.record(req, 'event.archived', { eventId, targetType: 'event', targetId: eventId });
    return successResponse(res, HTTP.OK, 'Event archived successfully', { id: eventId, archivedAt: out.archived_at });
  } catch (error) { return errorFromException(res, next, error); }
};

const unarchiveEvent = async (req, res, next) => {
  try {
    const eventId = Number(req.params.id);
    const out = await eventArchive.unarchive(eventId);
    audit.record(req, 'event.unarchived', { eventId, targetType: 'event', targetId: eventId });
    return successResponse(res, HTTP.OK, 'Event restored from the archive', { id: eventId, status: out.status, archivedAt: null });
  } catch (error) { return errorFromException(res, next, error); }
};

const exportEventZip = async (req, res, next) => {
  try {
    const eventId = Number(req.params.id);
    const out = await eventArchive.exportZip(eventId);
    audit.record(req, 'event.exported', { eventId, targetType: 'event', targetId: eventId, meta: { bytes: out.data.length, files: out.files, skipped: out.skipped } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${out.name}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(out.data);
  } catch (error) { return errorFromException(res, next, error); }
};

const getEventAnalytics = async (req, res, next) => {
  try {
    const analytics = await eventService.getEventAnalytics(req.params.id);
    return successResponse(res, HTTP.OK, 'OK', analytics);
  } catch (error) { next(error); }
};

const getEventOverview = async (req, res, next) => {
  try {
    const { overview } = require('../services/eventOverview.service');
    const data = await overview(Number(req.params.id));
    if (!data) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
    return successResponse(res, HTTP.OK, 'OK', data);
  } catch (error) { next(error); }
};

module.exports = {
  getAllEvents,
  getActiveEvent,
  getEventById,
  getEventByIdentifier,
  createEvent,
  updateEvent,
  deleteEvent,
  publishEvent,
  archiveEvent,
  unarchiveEvent,
  exportEventZip,
  getEventAnalytics,
  getEventOverview,
};
