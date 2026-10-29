/**
 * @file participant.controller.js
 * @description HTTP handlers for event participant management.
 * All routes are mounted under /api/events/:eventId/participants and every
 * write is scoped to that event (a participant id from another event is 404).
 */

const participantService = require('../services/participant.service');
const registrationForm = require('../services/registrationForm.service');
const { isAdminUser } = require('../utils/authz');
const participantAdmin = require('../services/participantAdmin.service');
const audit = require('../services/audit.service');
const { sendCsv } = require('../utils/csv');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const { PARTICIPANT_STATUSES } = participantService;

const parseEventId = (req) => {
  const eventId = parseInt(String(req.params.eventId), 10);
  return Number.isFinite(eventId) && eventId > 0 ? eventId : null;
};

const getParticipants = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const status = req.query.status ? String(req.query.status).toLowerCase() : undefined;
    if (status && !PARTICIPANT_STATUSES.includes(status)) {
      return errorResponse(res, HTTP.BAD_REQUEST, `status must be one of: ${PARTICIPANT_STATUSES.join(', ')}`);
    }
    const participants = await participantService.getParticipants(eventId, status);
    /*
     * Registration answers ride along. Organisers see all of them; judges,
     * mentors and volunteers do not see the ones marked sensitive (phone,
     * age, CV by default) nor the phone number on the account.
     */
    const organiser = isAdminUser(req.user);
    const answers = await registrationForm.answersForEvent(eventId, { hideSensitive: !organiser });
    let rows = participants.map((p) => {
      const row = { ...p, answers: answers[p.id] || {} };
      if (!organiser) delete row.phone;
      return row;
    });
    if (req.query.team === 'none') rows = rows.filter((r) => !r.team_name);
    return successResponse(res, HTTP.OK, 'OK', rows);
  } catch (error) {
    next(error);
  }
};

const getParticipantById = async (req, res, next) => {
  try {
    const participant = await participantService.getParticipantById(req.params.id, req.params.eventId);
    if (!participant) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Participant not found');
    }
    return successResponse(res, HTTP.OK, 'OK', participant);
  } catch (error) {
    next(error);
  }
};

const registerSelf = async (req, res, next) => {
  try {
    const eventId = parseEventId(req);
    if (!eventId) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid event id');

    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'hacker' && role !== 'pending') {
      return errorResponse(res, HTTP.FORBIDDEN, 'Only participant accounts can self-register for an event');
    }

    const boolish = (v, defaultVal) => {
      if (v === true || v === 1 || v === '1' || v === 'true' || v === 't') return true;
      if (v === false || v === 0 || v === '0' || v === 'false' || v === 'f') return false;
      return defaultVal;
    };

    const isTeamLead = boolish(req.body.is_team_lead ?? req.body.isTeamLead, false);
    const isSolo = boolish(req.body.is_solo ?? req.body.isSolo, !isTeamLead);

    // Security: status is NEVER taken from the request body — always 'pending'.
    const row = await participantService.registerSelfParticipant(eventId, req.user.id, {
      isSolo: isTeamLead ? false : isSolo,
      isTeamLead,
      status: 'pending',
    });
    return successResponse(res, HTTP.CREATED, 'Registered for event', row);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const addParticipant = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    let { userId } = req.body;

    if (!userId && req.body.email) {
      const user = await participantService.findOrCreateUserByEmail(
        req.body.email,
        req.body.full_name || req.body.fullName || 'Participant',
      );
      userId = user.id;
    }

    if (!userId) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'userId or email is required');
    }

    const status = String(req.body.status || 'pending').toLowerCase();
    if (!PARTICIPANT_STATUSES.includes(status)) {
      return errorResponse(res, HTTP.BAD_REQUEST, `status must be one of: ${PARTICIPANT_STATUSES.join(', ')}`);
    }

    const participant = await participantService.addParticipant(userId, eventId, status);
    return successResponse(res, HTTP.CREATED, 'Participant added', participant);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** Whether a status change needs the waiting list to move up afterwards. */
const freesSeat = (from, to) => ['pending', 'approved'].includes(from) && !['pending', 'approved'].includes(to);

const updateParticipantStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const eventId = parseEventId(req);
    const status = String(req.body.status || '').toLowerCase();

    if (!status || !PARTICIPANT_STATUSES.includes(status)) {
      return errorResponse(res, HTTP.BAD_REQUEST, `status must be one of: ${PARTICIPANT_STATUSES.join(', ')}`);
    }
    const { changed, skipped } = await participantAdmin.setStatuses(eventId, [id], status, { force: req.body.force === true });
    const why = skipped[0]?.reason;
    if (why === 'NOT_FOUND') return errorResponse(res, HTTP.NOT_FOUND, 'Participant not found', null, 'NOT_FOUND');
    if (why === 'CAPACITY_FULL') {
      return errorResponse(res, HTTP.CONFLICT, 'The event is full. Raise the limit, or approve anyway.', null, 'CAPACITY_FULL');
    }
    const c = changed[0];
    if (c) {
      await audit.record(req, 'participant.status', { eventId, targetType: 'participant', targetId: c.id, meta: { from: c.from, to: c.to } });
      if (freesSeat(c.from, c.to)) await participantAdmin.promoteWaitlist(eventId);
    }
    const updated = await participantService.getParticipantById(id, eventId);
    return successResponse(res, HTTP.OK, 'Participant updated', updated);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** POST /participants/bulk { ids, status, force } — many at once, within the capacity. */
const bulkStatus = async (req, res, next) => {
  try {
    const eventId = parseEventId(req);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const result = await participantAdmin.setStatuses(eventId, ids, req.body?.status, { force: req.body?.force === true });
    if (result.changed.length) {
      await audit.record(req, 'participant.bulk_status', {
        eventId, targetType: 'event', targetId: eventId,
        meta: { to: String(req.body?.status).toLowerCase(), count: result.changed.length },
      });
      if (result.changed.some((c) => freesSeat(c.from, c.to))) await participantAdmin.promoteWaitlist(eventId);
    }
    return successResponse(res, HTTP.OK, 'Updated', {
      changed: result.changed.map((c) => ({ id: c.id, from: c.from, to: c.to, team: c.team || null })),
      skipped: result.skipped,
    });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** POST /participants/team/:teamId/status { status, force } — a whole team. */
const teamStatus = async (req, res, next) => {
  try {
    const eventId = parseEventId(req);
    const result = await participantAdmin.setTeamStatus(eventId, Number(req.params.teamId), req.body?.status, { force: req.body?.force === true });
    if (result.changed.length) {
      await audit.record(req, 'participant.team_status', {
        eventId, targetType: 'team', targetId: req.params.teamId,
        meta: { to: String(req.body?.status).toLowerCase(), count: result.changed.length },
      });
      if (result.changed.some((c) => freesSeat(c.from, c.to))) await participantAdmin.promoteWaitlist(eventId);
    }
    return successResponse(res, HTTP.OK, 'Updated', {
      changed: result.changed.map((c) => ({ id: c.id, from: c.from, to: c.to, team: c.team || null })),
      skipped: result.skipped,
    });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** GET /participants/summary — capacity and counts. */
const summary = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await participantAdmin.summary(parseEventId(req)));
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** POST /participants/promote — move the waiting list up into free seats now. */
const promote = async (req, res, next) => {
  try {
    const eventId = parseEventId(req);
    const promoted = await participantAdmin.promoteWaitlist(eventId);
    if (promoted.length) {
      await audit.record(req, 'participant.promoted', { eventId, targetType: 'event', targetId: eventId, meta: { count: promoted.length } });
    }
    return successResponse(res, HTTP.OK, 'OK', { promoted: promoted.map((p) => ({ id: p.id, to: p.to })) });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** GET /participants/unassigned — approved people without a team. */
const unassigned = async (req, res, next) => {
  try {
    const rows = await participantAdmin.unassigned(parseEventId(req));
    return successResponse(res, HTTP.OK, 'OK', rows);
  } catch (error) {
    return next(error);
  }
};

/** GET /participants/export.csv — everyone, with their answers, safe for spreadsheets. */
const exportCsv = async (req, res, next) => {
  try {
    const eventId = parseEventId(req);
    const { columns, rows } = await participantAdmin.exportRows(eventId);
    await audit.record(req, 'participant.exported', { eventId, targetType: 'event', targetId: eventId, meta: { rows: rows.length } });
    return sendCsv(res, `participants-${eventId}`, columns, rows);
  } catch (error) {
    return next(error);
  }
};

const deleteParticipant = async (req, res, next) => {
  try {
    const eventId = parseEventId(req);
    const out = await participantAdmin.removeParticipant(eventId, Number(req.params.id));
    if (!out) return errorResponse(res, HTTP.NOT_FOUND, 'Participant not found');
    await audit.record(req, 'participant.removed', { eventId, targetType: 'participant', targetId: out.removed.id, meta: { promoted: out.promoted.length } });
    return successResponse(res, HTTP.OK, 'Participant deleted successfully');
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const eliminateParticipant = async (req, res, next) => {
  try {
    const { id, eventId } = req.params;
    const eliminated = await participantService.eliminateParticipant(id, eventId);
    if (!eliminated) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Participant not found');
    }
    return successResponse(res, HTTP.OK, 'Participant eliminated', eliminated);
  } catch (error) {
    next(error);
  }
};

/** GET …/participants/lobby-hackers — hackers in this event not yet on a team */
const listLobbyHackers = async (req, res, next) => {
  try {
    const eventId = parseEventId(req);
    if (!eventId) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid event id');
    const rows = await participantService.listHackersForTeamLobby(eventId);
    return successResponse(res, HTTP.OK, 'OK', rows);
  } catch (error) {
    next(error);
  }
};

/** GET …/participants/lobby-self-approval — is the current hacker approved for THIS event only */
const getLobbySelfApproval = async (req, res, next) => {
  try {
    const eventId = parseEventId(req);
    if (!eventId) return errorResponse(res, HTTP.BAD_REQUEST, 'Invalid event id');
    const approved = await participantService.isHackerApprovedForEvent(req.user.id, eventId);
    return successResponse(res, HTTP.OK, 'OK', { approved });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getParticipants,
  getParticipantById,
  registerSelf,
  listLobbyHackers,
  getLobbySelfApproval,
  addParticipant,
  updateParticipantStatus,
  bulkStatus,
  teamStatus,
  summary,
  promote,
  unassigned,
  exportCsv,
  deleteParticipant,
  eliminateParticipant,
};
