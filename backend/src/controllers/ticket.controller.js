/**
 * @file ticket.controller.js
 * @description HTTP handlers for the help-queue ticket system.
 */

const ticketService = require('../services/ticket.service');
const teamService   = require('../services/team.service');
const db            = require('../config/db');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { isAdminUser, normalizeRole } = require('../utils/authz');
const { userMayAccessEvent, filterByVisibleEvent } = require('../services/tenantAccess.service');
const { withDefaults } = require('../services/eventBuilderInput');
const jobs = require('../services/jobs.service');
const { moduleEnabled, MODULE_DISABLED_MESSAGE } = require('../middlewares/requireModule');
const { participantEventId } = require('../services/effectiveRole.service');

const { TICKET_PRIORITIES, TICKET_STATUSES } = ticketService;

const actorOf = (req) => ({ id: req.user.id, isAdmin: isAdminUser(req.user) });

/** A short Telegram notice about a request (best effort: the request stands either way). */
function notify(ticketId, kind) {
  return jobs.enqueue('ticket.notify', { ticketId: Number(ticketId), kind })
    .catch((err) => console.error(`[ticket] notify ${kind} failed:`, err.message));
}

/**
 * Why someone registered with this status may not ask the mentors for help,
 * or null when they may: only participants the organisers accepted.
 */
function helpRefusal(status) {
  if (status === 'approved') return null;
  if (status === 'rejected') {
    return { code: 'PARTICIPANT_REJECTED', message: 'Your registration for this event was not accepted, so you cannot ask the mentors for help.' };
  }
  if (status === 'eliminated') {
    return { code: 'PARTICIPANT_ELIMINATED', message: 'Your team is out of the competition, so help requests are closed for you.' };
  }
  return { code: 'HACKER_NOT_APPROVED', message: 'Your registration is still being reviewed. You can ask the mentors for help once the organisers accept you.' };
}

const createTicket = async (req, res, next) => {
  try {
    const topic = String(req.body.topic ?? '').trim();
    const description = String(req.body.description ?? '').trim();
    if (!topic) return errorResponse(res, HTTP.BAD_REQUEST, 'topic is required');
    if (!description) return errorResponse(res, HTTP.BAD_REQUEST, 'description is required');
    if (topic.length > 255) return errorResponse(res, HTTP.BAD_REQUEST, 'topic must be 255 characters or fewer');

    // The event they act in: the one named, else the workspace entered, else
    // their default, and only one they are registered for.
    const named = parseInt(String(req.body.eventId ?? req.body.event_id ?? '').trim(), 10);
    const eventId = await participantEventId(req);
    if (!eventId) {
      if (Number.isFinite(named) && named > 0) {
        return errorResponse(res, HTTP.FORBIDDEN, 'You are not a participant of this event', null, 'NOT_PARTICIPANT');
      }
      return errorResponse(res, HTTP.BAD_REQUEST, 'eventId is required (no active event found)', null, 'NO_ACTIVE_EVENT');
    }
    // An event that was not named had no plan guard in front of this route.
    if (!(Number.isFinite(named) && named > 0) && !(await moduleEnabled(eventId, 'mentors'))) {
      return errorResponse(res, HTTP.FORBIDDEN, MODULE_DISABLED_MESSAGE, null, 'MODULE_DISABLED');
    }

    // Must be registered for that event (the default may be the platform's),
    // and accepted: mentors' time goes to people taking part, not to
    // registrations still in review or turned down.
    const participantCheck = await db.query(
      "SELECT LOWER(TRIM(COALESCE(status::text, 'pending'))) AS status FROM participants WHERE user_id = $1 AND event_id = $2",
      [req.user.id, eventId],
    );
    if (participantCheck.rows.length === 0) {
      return errorResponse(res, HTTP.FORBIDDEN, 'You are not a participant of this event', null, 'NOT_PARTICIPANT');
    }
    const refusal = helpRefusal(participantCheck.rows[0].status);
    if (refusal) return errorResponse(res, HTTP.FORBIDDEN, refusal.message, null, refusal.code);

    // The organiser's help-queue settings (event builder → Mentors).
    const cfg = await db.query('SELECT mentor_config FROM events WHERE id = $1', [eventId]);
    const mentorCfg = withDefaults('mentor_config', cfg.rows[0]?.mentor_config);
    if (!mentorCfg.ticketsEnabled) {
      return errorResponse(res, HTTP.FORBIDDEN, 'The organisers have turned off help requests for this event.', null, 'TICKETS_DISABLED');
    }

    const team = await teamService.getMyTeam(req.user.id, eventId);
    const priority = String(req.body.priority ?? 'normal').trim().toLowerCase();
    if (!TICKET_PRIORITIES.includes(priority)) {
      return errorResponse(res, HTTP.BAD_REQUEST, `priority must be one of: ${TICKET_PRIORITIES.join(', ')}`);
    }

    // At most N unresolved requests per team (per person without a team), so
    // one team cannot fill the mentors' queue.
    const max = Number(mentorCfg.maxOpenTicketsPerTeam) || 2;
    const open = await db.query(
      `SELECT COUNT(*)::int AS n FROM help_tickets
        WHERE event_id = $1 AND ${team ? 'team_id' : 'requester_id'} = $2
          AND LOWER(REPLACE(COALESCE(status, ''), '_', '-')) IN ('open', 'in-progress')`,
      [eventId, team ? team.id : req.user.id],
    );
    if (open.rows[0].n >= max) {
      return errorResponse(
        res,
        HTTP.CONFLICT,
        `${team ? 'Your team already has' : 'You already have'} ${open.rows[0].n} open help ${open.rows[0].n === 1 ? 'request' : 'requests'} — the limit for this event is ${max}. Resolve one before asking again.`,
        null,
        'TICKET_LIMIT',
      );
    }

    const preferredRaw = Number(req.body.preferredMentorId ?? req.body.preferred_mentor_id);
    const ticket = await ticketService.createTicket({
      topic,
      description: description.slice(0, 4000),
      table_location: String(req.body.tableLocation ?? req.body.table_location ?? '').trim().slice(0, 100) || null,
      event_id: eventId,
      team_id: team ? team.id : null,
      requester_id: req.user.id,
      preferred_mentor_id: Number.isInteger(preferredRaw) && preferredRaw > 0 ? preferredRaw : null,
      preferred_mentor_name:
        String(req.body.preferredMentorName ?? req.body.preferred_mentor_name ?? '').trim().slice(0, 255) || null,
      contact_phone:
        String(req.body.contactPhone ?? req.body.contact_phone ?? '').trim().slice(0, 50) || null,
      priority,
    });
    if (ticket.preferred_mentor_id) await notify(ticket.id, 'new_for_you');
    return successResponse(res, HTTP.CREATED, 'Ticket created', ticket);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const getTickets = async (req, res, next) => {
  try {
    const { eventId } = req.query;
    const status = req.query.status ? String(req.query.status).toLowerCase() : undefined;
    if (status && !TICKET_STATUSES.includes(status.replace(/_/g, '-'))) {
      return errorResponse(res, HTTP.BAD_REQUEST, `status must be one of: ${TICKET_STATUSES.join(', ')}`);
    }

    const role = normalizeRole(req.user.role);
    if (role === 'hacker' || role === 'pending') {
      const tickets = await ticketService.getTickets({ eventId, status, requesterId: req.user.id });
      return successResponse(res, HTTP.OK, 'OK', tickets);
    }
    if (role === 'mentor') {
      // Mentors only ever see the queues of events they are assigned to.
      const eventIds = await ticketService.listMentorEventIds(req.user.id);
      const tickets = await ticketService.getTickets({ eventId, status, eventIds });
      return successResponse(res, HTTP.OK, 'OK', tickets);
    }
    // Organisers: only their own customer's events.
    if (eventId && !(await userMayAccessEvent(req.user, eventId))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
    }
    let tickets = await ticketService.getTickets({ eventId, status });
    if (!eventId) tickets = await filterByVisibleEvent(req.user, tickets);
    return successResponse(res, HTTP.OK, 'OK', tickets);
  } catch (error) {
    next(error);
  }
};

const claimTicket = async (req, res, next) => {
  try {
    const ticket = await ticketService.claimTicket(req.params.id, actorOf(req));
    if (!ticket) return errorResponse(res, HTTP.NOT_FOUND, 'Ticket not found');
    await notify(ticket.id, 'claimed');
    return successResponse(res, HTTP.OK, 'Ticket claimed', ticket);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const assignTicket = async (req, res, next) => {
  try {
    const raw = req.body.mentorUserId ?? req.body.mentor_user_id ?? req.body.userId;
    const mentorUserId = Number(raw);
    if (!Number.isFinite(mentorUserId) || mentorUserId < 1) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'mentorUserId is required (user id of the mentor)');
    }
    const ticket = await ticketService.assignTicketToMentor(req.params.id, mentorUserId);
    if (!ticket) return errorResponse(res, HTTP.NOT_FOUND, 'Ticket not found');
    await notify(ticket.id, 'claimed');
    return successResponse(res, HTTP.OK, 'Ticket assigned', ticket);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const resolveTicket = async (req, res, next) => {
  try {
    const ticket = await ticketService.resolveTicket(req.params.id, actorOf(req));
    if (!ticket) return errorResponse(res, HTTP.NOT_FOUND, 'Ticket not found');
    await notify(ticket.id, 'resolved');
    return successResponse(res, HTTP.OK, 'Ticket resolved', ticket);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** POST /:id/withdraw — the participant who asked closes their own request. */
const withdrawTicket = async (req, res, next) => {
  try {
    const ticket = await ticketService.withdrawTicket(req.params.id, req.user.id);
    return successResponse(res, HTTP.OK, 'Request withdrawn', ticket);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** PATCH|POST /:id/escalate — mentor flags a ticket for the organisers. */
const escalateTicket = async (req, res, next) => {
  try {
    const ticket = await ticketService.escalateTicket(req.params.id, actorOf(req));
    if (!ticket) return errorResponse(res, HTTP.NOT_FOUND, 'Ticket not found');
    console.log(`[ticket] escalated id=${req.params.id} by user_id=${req.user.id}`);
    await notify(ticket.id, 'escalated');
    return successResponse(res, HTTP.OK, 'Ticket escalated to organisers', ticket);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** PATCH /:id/unresolve — claiming mentor (or admin) reopens a resolved ticket. */
const unresolveTicket = async (req, res, next) => {
  try {
    const ticket = await ticketService.mentorUnresolveTicket(req.params.id, actorOf(req));
    if (!ticket) return errorResponse(res, HTTP.NOT_FOUND, 'Ticket not found');
    return successResponse(res, HTTP.OK, 'Ticket reopened', ticket);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** PATCH /:id/acknowledge-escalation — admin clears the escalated flag. */
const acknowledgeEscalation = async (req, res, next) => {
  try {
    const ticket = await ticketService.acknowledgeEscalation(req.params.id);
    if (!ticket) return errorResponse(res, HTTP.NOT_FOUND, 'Ticket not found');
    return successResponse(res, HTTP.OK, 'Escalation acknowledged', ticket);
  } catch (error) {
    next(error);
  }
};

/** PATCH /:id — admin sends { status: "open" } to reopen. */
const patchTicket = async (req, res, next) => {
  try {
    const status = String(req.body.status ?? '').trim().toLowerCase();
    if (status === 'open') {
      const ticket = await ticketService.reopenTicket(req.params.id);
      if (!ticket) return errorResponse(res, HTTP.NOT_FOUND, 'Ticket not found');
      return successResponse(res, HTTP.OK, 'Ticket reopened', ticket);
    }
    return errorResponse(res, HTTP.BAD_REQUEST, 'Use { "status": "open" } to reopen a ticket');
  } catch (error) {
    next(error);
  }
};

const deleteTicket = async (req, res, next) => {
  try {
    await ticketService.deleteTicket(req.params.id);
    return successResponse(res, HTTP.OK, 'Ticket deleted successfully');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createTicket,
  withdrawTicket,
  getTickets,
  claimTicket,
  assignTicket,
  resolveTicket,
  escalateTicket,
  acknowledgeEscalation,
  unresolveTicket,
  patchTicket,
  deleteTicket,
};
