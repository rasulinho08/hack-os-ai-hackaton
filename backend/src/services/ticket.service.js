/**
 * @file ticket.service.js
 * @description Business logic for the help-queue ticket system.
 *
 * Hackers create tickets when they need mentor assistance.
 * Mentors claim and resolve tickets. Admins can assign or reopen tickets.
 *
 * Ticket lifecycle:
 *   open → in-progress → resolved
 *   (mentor can unresolve: resolved → in-progress; admin can reopen → open)
 * `closed_reason` says why a request was closed: resolved by a mentor,
 * withdrawn by the participant, or the event ended (closed by a job).
 *
 * `actor` = { id, isAdmin } describes who performs a mutation.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');

const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const TICKET_STATUSES = ['open', 'in-progress', 'resolved'];

const normalizeStatus = (s) => String(s ?? '').trim().toLowerCase().replace(/_/g, '-');

async function loadTicket(id) {
  const r = await db.query('SELECT * FROM help_tickets WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function isMentorForEvent(userId, eventId) {
  const r = await db.query(
    'SELECT 1 FROM mentor_assignments WHERE event_id = $1 AND user_id = $2 LIMIT 1',
    [eventId, userId],
  );
  return r.rows.length > 0;
}

async function assertMentorForEvent(actor, eventId) {
  if (actor.isAdmin) return;
  if (!(await isMentorForEvent(actor.id, eventId))) {
    throw httpError(403, 'You are not a mentor for this event', 'NOT_EVENT_MENTOR');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch tickets with optional filters.
 *
 * Each row carries `event_name` and `event_finished`. Nothing closes a ticket
 * when its hackathon ends, so the live database still holds tickets sitting at
 * "open" on an event that finished three months ago; they sat in the mentor
 * queue looking live. The tickets are left exactly as they are — the queue can
 * now say the event is over instead of implying someone can still walk to the
 * table.
 *
 * @param {{ eventId?, status?, requesterId?, eventIds?: number[] }} filters
 */
const getTickets = async (filters = {}) => {
  const { eventId, status, requesterId, eventIds } = filters;
  let query = `
    SELECT ht.*,
           u.full_name  AS requester_name,
           u.email      AS requester_email,
           m.full_name  AS mentor_name,
           pm.full_name AS preferred_mentor,
           tm.name      AS team_name,
           e.name       AS event_name,
           (e.end_date IS NOT NULL AND e.end_date < NOW()) AS event_finished
    FROM help_tickets ht
    LEFT JOIN users u   ON ht.requester_id = u.id
    LEFT JOIN users m   ON ht.mentor_id    = m.id
    LEFT JOIN users pm  ON ht.preferred_mentor_id = pm.id
    LEFT JOIN teams tm  ON ht.team_id      = tm.id
    LEFT JOIN events e  ON ht.event_id     = e.id`;

  const conditions = [];
  const params     = [];

  if (eventId) {
    params.push(eventId);
    conditions.push(`ht.event_id = $${params.length}`);
  }
  if (Array.isArray(eventIds)) {
    params.push(eventIds);
    conditions.push(`ht.event_id = ANY($${params.length}::int[])`);
  }
  if (status) {
    params.push(normalizeStatus(status));
    conditions.push(`ht.status = $${params.length}`);
  }
  if (requesterId) {
    params.push(requesterId);
    conditions.push(`ht.requester_id = $${params.length}`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY ht.escalated_to_admin DESC, ht.created_at DESC';

  const result = await db.query(query, params);
  return result.rows;
};

/** Event ids the user mentors (used to scope the mentor queue). */
const listMentorEventIds = async (userId) => {
  const r = await db.query('SELECT event_id FROM mentor_assignments WHERE user_id = $1', [userId]);
  return r.rows.map((x) => Number(x.event_id));
};

// ─────────────────────────────────────────────────────────────────────────────
// Write Operations (Hacker)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A participant asks for help. `preferred_mentor_id`, when given, must be a
 * mentor of the event (the request still reaches every mentor; the one asked
 * for sees it first and hears about it).
 */
const createTicket = async (data) => {
  const {
    event_id, team_id, requester_id, topic,
    description, table_location, contact_phone, priority,
  } = data;
  let { preferred_mentor_name: preferredName = null } = data;
  let preferredId = null;
  if (data.preferred_mentor_id) {
    const m = await db.query(
      `SELECT u.id, u.full_name FROM mentor_assignments ma JOIN users u ON u.id = ma.user_id
        WHERE ma.event_id = $1 AND ma.user_id = $2`,
      [event_id, data.preferred_mentor_id],
    );
    if (!m.rows[0]) throw httpError(400, 'This person is not a mentor of the event', 'NOT_EVENT_MENTOR');
    preferredId = m.rows[0].id;
    preferredName = m.rows[0].full_name;
  }

  const result = await db.query(
    `INSERT INTO help_tickets
       (event_id, team_id, requester_id, topic, description, table_location,
        preferred_mentor_name, preferred_mentor_id, contact_phone, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      event_id, team_id, requester_id, topic,
      description, table_location,
      preferredName ?? null,
      preferredId,
      contact_phone ?? null,
      TICKET_PRIORITIES.includes(priority) ? priority : 'normal',
    ],
  );
  return result.rows[0];
};

/**
 * The participant who asked withdraws their request (they got help some
 * other way). Open or in progress → closed as "withdrawn".
 */
const withdrawTicket = async (id, userId) => {
  const result = await db.query(
    `UPDATE help_tickets
        SET status = 'resolved', closed_reason = 'withdrawn', resolved_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND requester_id = $2
        AND LOWER(REPLACE(status, '_', '-')) IN ('open', 'in-progress')
      RETURNING *`,
    [id, userId],
  );
  if (!result.rows[0]) {
    const t = await loadTicket(id);
    if (!t || String(t.requester_id) !== String(userId)) throw httpError(404, 'Ticket not found', 'NOT_FOUND');
    throw httpError(400, 'This request is already closed.', 'TICKET_CLOSED');
  }
  return result.rows[0];
};

/**
 * Requests still open when their event ended (plus a grace period) are closed
 * as "event_ended", so mentor queues show only what someone can still help with.
 */
const closeRequestsOfEndedEvents = async ({ graceHours = 2 } = {}) => {
  const r = await db.query(
    `UPDATE help_tickets ht
        SET status = 'resolved', closed_reason = 'event_ended', resolved_at = CURRENT_TIMESTAMP
       FROM events e
      WHERE e.id = ht.event_id AND e.end_date IS NOT NULL
        AND e.end_date < now() - make_interval(hours => $1)
        AND LOWER(REPLACE(ht.status, '_', '-')) IN ('open', 'in-progress')
      RETURNING ht.id`,
    [graceHours],
  );
  return r.rows.length;
};

// ─────────────────────────────────────────────────────────────────────────────
// Write Operations (Mentor)
// ─────────────────────────────────────────────────────────────────────────────

/** A mentor of the ticket's event claims an open ticket. */
const claimTicket = async (id, actor) => {
  const ticket = await loadTicket(id);
  if (!ticket) return null;

  await assertMentorForEvent(actor, ticket.event_id);

  if (normalizeStatus(ticket.status) !== 'open') {
    throw httpError(400, 'Only open tickets can be claimed', 'TICKET_NOT_OPEN');
  }

  const result = await db.query(
    `UPDATE help_tickets SET status = 'in-progress', mentor_id = $2, claimed_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND LOWER(status) = 'open' RETURNING *`,
    [id, actor.id],
  );
  // Two mentors pressing at once: the second finds it already taken.
  if (!result.rows[0]) throw httpError(409, 'Another mentor took this request a moment ago.', 'TICKET_TAKEN');
  return result.rows[0];
};

/** The claiming mentor (or an admin) resolves an in-progress ticket. */
const resolveTicket = async (id, actor) => {
  const ticket = await loadTicket(id);
  if (!ticket) return null;

  if (normalizeStatus(ticket.status) !== 'in-progress') {
    throw httpError(400, 'Only in-progress tickets can be resolved', 'TICKET_NOT_IN_PROGRESS');
  }
  if (!actor.isAdmin && String(ticket.mentor_id) !== String(actor.id)) {
    throw httpError(403, 'Only the mentor who claimed this ticket can resolve it', 'NOT_TICKET_OWNER');
  }

  const result = await db.query(
    `UPDATE help_tickets
        SET status = 'resolved', closed_reason = 'resolved',
            mentor_id = COALESCE(mentor_id, $2), resolved_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
    [id, actor.id],
  );
  return result.rows[0];
};

// ─────────────────────────────────────────────────────────────────────────────
// Write Operations (Admin)
// ─────────────────────────────────────────────────────────────────────────────

/** Admin assigns an open ticket directly to a mentor of the event. */
const assignTicketToMentor = async (ticketId, mentorUserId) => {
  const ticket = await loadTicket(ticketId);
  if (!ticket) return null;

  const normalized = normalizeStatus(ticket.status);
  const isOpen = ['', 'open', 'pending', 'new', 'queued'].includes(normalized);
  if (!isOpen) {
    throw httpError(400, 'Only open tickets can be assigned', 'TICKET_NOT_OPEN');
  }

  if (!(await isMentorForEvent(mentorUserId, ticket.event_id))) {
    throw httpError(403, 'User is not a mentor for this event', 'NOT_EVENT_MENTOR');
  }

  const result = await db.query(
    `UPDATE help_tickets SET status = 'in-progress', mentor_id = $2, claimed_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
    [ticketId, mentorUserId],
  );
  return result.rows[0];
};

/**
 * A mentor of the event escalates a ticket to the organisers. The ticket
 * stays claimed; `escalated_to_admin` / `escalated_at` flag it for admins.
 * Idempotent: re-escalating bumps `escalated_at`.
 */
const escalateTicket = async (id, actor) => {
  const ticket = await loadTicket(id);
  if (!ticket) return null;

  await assertMentorForEvent(actor, ticket.event_id);

  if (normalizeStatus(ticket.status) === 'resolved') {
    throw httpError(400, 'Resolved tickets cannot be escalated. Reopen first.', 'TICKET_RESOLVED');
  }

  const result = await db.query(
    `UPDATE help_tickets
        SET escalated_to_admin = TRUE,
            escalated_at       = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *`,
    [id],
  );
  return result.rows[0];
};

/** Admin clears the escalation flag once reviewed. */
const acknowledgeEscalation = async (id) => {
  const result = await db.query(
    `UPDATE help_tickets
        SET escalated_to_admin = FALSE,
            escalated_at       = NULL
      WHERE id = $1
      RETURNING *`,
    [id],
  );
  return result.rows[0];
};

/**
 * Mentor un-resolves a ticket they resolved (accidental click, issue came
 * back). Goes back to in-progress with the same mentor. Admins may do this
 * for any ticket.
 */
const mentorUnresolveTicket = async (id, actor) => {
  const ticket = await loadTicket(id);
  if (!ticket) return null;

  if (normalizeStatus(ticket.status) !== 'resolved') {
    throw httpError(400, 'Only resolved tickets can be reopened by their mentor.', 'TICKET_NOT_RESOLVED');
  }
  if (!actor.isAdmin && String(ticket.mentor_id ?? '') !== String(actor.id)) {
    throw httpError(403, 'Only the mentor who resolved this ticket can reopen it.', 'NOT_TICKET_OWNER');
  }

  const result = await db.query(
    `UPDATE help_tickets
        SET status        = 'in-progress',
            resolved_at   = NULL,
            closed_reason = NULL
      WHERE id = $1
      RETURNING *`,
    [id],
  );
  return result.rows[0];
};

/** Admin reopens a ticket (back to 'open', unassigned). */
const reopenTicket = async (id) => {
  const result = await db.query(
    `UPDATE help_tickets
        SET status        = 'open',
            mentor_id     = NULL,
            resolved_at   = NULL,
            claimed_at    = NULL,
            closed_reason = NULL
      WHERE id = $1 RETURNING *`,
    [id],
  );
  return result.rows[0];
};

const deleteTicket = async (id) => {
  await db.query('DELETE FROM help_tickets WHERE id = $1', [id]);
};

module.exports = {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  createTicket,
  withdrawTicket,
  closeRequestsOfEndedEvents,
  getTickets,
  listMentorEventIds,
  isMentorForEvent,
  claimTicket,
  resolveTicket,
  assignTicketToMentor,
  escalateTicket,
  acknowledgeEscalation,
  mentorUnresolveTicket,
  reopenTicket,
  deleteTicket,
};
