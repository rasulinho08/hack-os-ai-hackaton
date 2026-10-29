/**
 * @file teamRequest.service.js
 * @description Asking to join a team: an approved participant without a team
 * sends a request (with a short message), the team's lead accepts or
 * declines, the participant can withdraw it.
 *
 * Accepting goes through the same checks as any other way into a team —
 * team formation still open, the person approved and teamless, the team not
 * full — and withdraws the person's other open requests in the event.
 * Each side hears about it on Telegram (and the requester by e-mail when
 * accepted) through the job queue.
 */

const db = require('../config/db');
const jobs = require('./jobs.service');
const teamService = require('./team.service');
const { assertTeamFormationOpen } = require('./event.service');
const { assertHackerApprovedForEvent } = require('./participant.service');
const { httpError } = require('../utils/responseFormat');

const OPEN_PER_PERSON = 5;

async function teamRow(teamId) {
  const r = await db.query(
    `SELECT t.id, t.name, t.event_id, t.leader_id, LOWER(COALESCE(t.status, 'active')) AS status,
            e.team_size_limit,
            (SELECT COUNT(*)::int FROM team_members x WHERE x.team_id = t.id) AS size
       FROM teams t JOIN events e ON e.id = t.event_id WHERE t.id = $1`,
    [teamId],
  );
  return r.rows[0] || null;
}

async function inTeam(eventId, userId) {
  const r = await db.query(
    `SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE t.event_id = $1 AND tm.user_id = $2 LIMIT 1`,
    [eventId, userId],
  );
  return Boolean(r.rows[0]);
}

function notify(userId, eventId, kind, vars, { email = false } = {}) {
  return jobs.enqueue('people.notify', { userId, eventId, kind, vars, email });
}

/** Send a request to join `teamId`. */
async function create(teamId, userId, message) {
  const team = await teamRow(teamId);
  if (!team) throw httpError(404, 'Team not found', 'TEAM_NOT_FOUND');
  if (team.status === 'eliminated') throw httpError(400, 'This team has been eliminated', 'TEAM_ELIMINATED');
  await assertTeamFormationOpen(team.event_id);
  await assertHackerApprovedForEvent(userId, team.event_id);
  if (await inTeam(team.event_id, userId)) {
    throw httpError(409, 'You are already in a team for this event', 'ALREADY_IN_TEAM');
  }
  if (team.size >= (Number(team.team_size_limit) || 4)) {
    throw httpError(400, 'This team is full', 'TEAM_FULL');
  }
  const open = await db.query(
    `SELECT COUNT(*)::int AS n FROM team_join_requests r JOIN teams t ON t.id = r.team_id
      WHERE r.user_id = $1 AND t.event_id = $2 AND r.status = 'pending'`,
    [userId, team.event_id],
  );
  if (open.rows[0].n >= OPEN_PER_PERSON) {
    throw httpError(429, `You can have at most ${OPEN_PER_PERSON} open requests at a time.`, 'TOO_MANY_REQUESTS');
  }
  let row;
  try {
    row = (await db.query(
      `INSERT INTO team_join_requests (team_id, user_id, message) VALUES ($1, $2, $3) RETURNING *`,
      [teamId, userId, message ? String(message).trim().slice(0, 500) : null],
    )).rows[0];
  } catch (err) {
    if (err.code === '23505') throw httpError(409, 'You already asked to join this team.', 'REQUEST_EXISTS');
    throw err;
  }
  const who = (await db.query('SELECT full_name FROM users WHERE id = $1', [userId])).rows[0];
  if (team.leader_id) await notify(team.leader_id, team.event_id, 'request_new', { name: who?.full_name || '', team: team.name, requestId: row.id });
  return row;
}

/** Open requests to a team, with who is asking (for its members and organisers). */
async function listForTeam(teamId) {
  const r = await db.query(
    `SELECT r.id, r.message, r.created_at, u.id AS user_id, u.full_name, u.university, u.experience, u.skills,
            u.github_link, u.linkedin
       FROM team_join_requests r JOIN users u ON u.id = r.user_id
      WHERE r.team_id = $1 AND r.status = 'pending'
      ORDER BY r.created_at ASC`,
    [teamId],
  );
  return r.rows;
}

/** The caller's requests in an event, newest first. */
async function listMine(userId, eventId) {
  const r = await db.query(
    `SELECT r.id, r.team_id, t.name AS team_name, r.status, r.message, r.created_at, r.decided_at
       FROM team_join_requests r JOIN teams t ON t.id = r.team_id
      WHERE r.user_id = $1 AND ($2::int IS NULL OR t.event_id = $2)
      ORDER BY r.created_at DESC LIMIT 50`,
    [userId, eventId],
  );
  return r.rows;
}

async function requestRow(requestId) {
  const r = await db.query(
    `SELECT r.*, t.name AS team_name, t.event_id, t.leader_id
       FROM team_join_requests r JOIN teams t ON t.id = r.team_id WHERE r.id = $1`,
    [requestId],
  );
  return r.rows[0] || null;
}

function assertDecider(req, actor) {
  if (!actor.isAdmin && Number(req.leader_id) !== Number(actor.userId)) {
    throw httpError(403, 'Only the team lead can answer join requests.', 'NOT_TEAM_LEAD');
  }
  if (req.status !== 'pending') throw httpError(409, 'This request was already answered.', 'REQUEST_CLOSED');
}

/** The lead (or an organiser) accepts: the person joins the team. */
async function accept(requestId, actor) {
  const req = await requestRow(requestId);
  if (!req) throw httpError(404, 'Request not found', 'NOT_FOUND');
  assertDecider(req, actor);
  // The usual way in, with its checks (formation open, approved, not full, not in another team).
  await teamService.addTeamMember(req.team_id, req.user_id, { isAdmin: false });
  await db.query(
    `UPDATE team_join_requests SET status = 'accepted', decided_at = now(), decided_by = $2 WHERE id = $1`,
    [req.id, actor.userId],
  );
  // Other open requests of this person in the event are withdrawn.
  await db.query(
    `UPDATE team_join_requests r SET status = 'cancelled', decided_at = now()
       FROM teams t
      WHERE t.id = r.team_id AND t.event_id = $1 AND r.user_id = $2 AND r.status = 'pending'`,
    [req.event_id, req.user_id],
  );
  await notify(req.user_id, req.event_id, 'request_accepted', { team: req.team_name, requestId: req.id }, { email: true });
  return { ...req, status: 'accepted' };
}

async function decline(requestId, actor) {
  const req = await requestRow(requestId);
  if (!req) throw httpError(404, 'Request not found', 'NOT_FOUND');
  assertDecider(req, actor);
  await db.query(
    `UPDATE team_join_requests SET status = 'declined', decided_at = now(), decided_by = $2 WHERE id = $1`,
    [req.id, actor.userId],
  );
  await notify(req.user_id, req.event_id, 'request_declined', { team: req.team_name, requestId: req.id });
  return { ...req, status: 'declined' };
}

/** The person withdraws their own open request. */
async function cancel(requestId, userId) {
  const r = await db.query(
    `UPDATE team_join_requests SET status = 'cancelled', decided_at = now()
      WHERE id = $1 AND user_id = $2 AND status = 'pending' RETURNING *`,
    [requestId, userId],
  );
  if (!r.rows[0]) throw httpError(404, 'Request not found', 'NOT_FOUND');
  return r.rows[0];
}

module.exports = { create, listForTeam, listMine, accept, decline, cancel, requestRow };
