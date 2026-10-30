/**
 * @file mentor.controller.js
 * @description HTTP handlers for an event's mentors.
 *
 *   GET    /api/events/:eventId/mentors              the mentors (participants: no e-mail; presence per settings)
 *   POST   /api/events/:eventId/mentors              assign (organiser)
 *   PUT    /api/events/:eventId/mentors/:id          edit (organiser; only the fields sent)
 *   DELETE /api/events/:eventId/mentors/:id          remove (organiser)
 *   GET    /api/events/:eventId/mentors/me           the calling mentor's profile and slots
 *   PATCH  /api/events/:eventId/mentors/me           edit own skills, bio, place, presence
 *   POST   /api/events/:eventId/mentors/me/heartbeat their page is open (online dot)
 *   GET    /api/events/:eventId/mentors/slots        everyone's upcoming hours
 *   POST   /api/events/:eventId/mentors/slots        add hours (mentor: own; organiser: anyone's)
 *   DELETE /api/events/:eventId/mentors/slots/:slotId
 *   GET    /api/mentor/me/events                     the events the caller mentors
 */

const mentorService = require('../services/mentor.service');
const audit = require('../services/audit.service');
const { resolveUserIdFromBody } = require('../utils/resolveUserId');
const { isAdminUser, normalizeRole } = require('../utils/authz');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const isParticipantRole = (user) => ['hacker', 'pending'].includes(normalizeRole(user && user.role));

const getMentors = async (req, res, next) => {
  try {
    const rows = await mentorService.getMentors(req.params.eventId, { forParticipant: isParticipantRole(req.user) });
    return successResponse(res, HTTP.OK, 'OK', rows);
  } catch (error) {
    return next(error);
  }
};

const assignMentor = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const { expertise, availability, skills } = req.body || {};
    const userId = await resolveUserIdFromBody(req.body);
    const mentor = await mentorService.assignMentor(eventId, userId, expertise, availability, skills);
    await audit.record(req, 'mentor.assigned', { eventId: Number(eventId), targetType: 'user', targetId: userId });
    return successResponse(res, HTTP.CREATED, 'Mentor assigned', mentor);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const updateMentor = async (req, res, next) => {
  try {
    const updated = await mentorService.updateMentor(req.params.id, req.body || {});
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'Mentor assignment not found', null, 'NOT_FOUND');
    return successResponse(res, HTTP.OK, 'Saved', { ...updated, skills: mentorService.skillList(updated.skills) });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const removeMentor = async (req, res, next) => {
  try {
    await mentorService.removeMentor(req.params.id);
    await audit.record(req, 'mentor.removed', { eventId: Number(req.params.eventId), targetType: 'mentor_assignment', targetId: Number(req.params.id) });
    return successResponse(res, HTTP.OK, 'Mentor removed');
  } catch (error) {
    return next(error);
  }
};

const getMine = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await mentorService.getMine(req.params.eventId, req.user.id));
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const updateMine = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'Saved', await mentorService.updateMine(req.params.eventId, req.user.id, req.body || {}));
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const heartbeat = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await mentorService.heartbeat(req.params.eventId, req.user.id));
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const listSlots = async (req, res, next) => {
  try {
    const includePast = String(req.query.past || '') === '1' && isAdminUser(req.user);
    return successResponse(res, HTTP.OK, 'OK', await mentorService.listSlots(req.params.eventId, { includePast }));
  } catch (error) {
    return next(error);
  }
};

const createSlot = async (req, res, next) => {
  try {
    const body = req.body || {};
    // Organisers may add hours for any mentor of the event; a mentor only for themselves.
    const forUser = isAdminUser(req.user) && body.userId ? Number(body.userId) : req.user.id;
    const slot = await mentorService.createSlot(req.params.eventId, forUser, body);
    return successResponse(res, HTTP.CREATED, 'Slot added', slot);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const deleteSlot = async (req, res, next) => {
  try {
    const actor = { id: req.user.id, isAdmin: isAdminUser(req.user) };
    await mentorService.deleteSlot(req.params.eventId, req.params.slotId, actor);
    return successResponse(res, HTTP.OK, 'Slot removed');
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** GET /api/mentor/me/events — event ids the caller mentors. */
const getMyMentorEventIds = async (req, res, next) => {
  try {
    const eventIds = await mentorService.listMentorEventIdsForUser(req.user.id);
    return successResponse(res, HTTP.OK, 'OK', { event_ids: eventIds });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getMentors,
  assignMentor,
  updateMentor,
  removeMentor,
  getMine,
  updateMine,
  heartbeat,
  listSlots,
  createSlot,
  deleteSlot,
  getMyMentorEventIds,
};
