/**
 * @file team.controller.js
 * @description HTTP handlers for team management.
 *
 * Routes:
 *   POST   /api/teams                        → createTeam (hacker)
 *   POST   /api/teams/join                   → joinTeam (hacker)
 *   GET    /api/teams/mine?eventId=          → getMyTeam (hacker)
 *   GET    /api/teams?eventId=               → getAllTeams (staff)
 *   GET    /api/teams/:id                    → getTeamById
 *   PUT    /api/teams/:id                    → updateTeam (leader / admin)
 *   DELETE /api/teams/:id                    → deleteTeam (admin)
 *   GET    /api/teams/:id/members            → getTeamMembers
 *   POST   /api/teams/:id/members            → addTeamMember (leader / admin)
 *   DELETE /api/teams/:id/members/:userId    → removeTeamMember (leader / admin / self)
 *   PATCH  /api/teams/:id/members/:userId/lead → transferLead (leader / admin)
 *   PATCH  /api/teams/:id/status             → setTeamStatus (admin)
 */

const teamService    = require('../services/team.service');
const eventService   = require('../services/event.service');
const db = require('../config/db');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { isAdminUser } = require('../utils/authz');
const { userMayAccessEvent, filterByVisibleEvent } = require('../services/tenantAccess.service');
const { validateDisplayName } = require('../validations/common');
const audit = require('../services/audit.service');
const results = require('../services/results.service');
const matchmaking = require('../services/matchmaking.service');
const teamRequests = require('../services/teamRequest.service');
const { participantEventId } = require('../services/effectiveRole.service');

const createTeam = async (req, res, next) => {
  try {
    const rawEventId = req.body?.eventId ?? req.body?.event_id;
    const eventIdNum = parseInt(String(rawEventId ?? '').trim(), 10);
    if (!Number.isFinite(eventIdNum) || eventIdNum <= 0) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'eventId is required and must be a positive number');
    }
    const nameCheck = validateDisplayName(req.body?.name, 'Team name', { min: 2 });
    if (!nameCheck.ok) {
      return errorResponse(res, HTTP.BAD_REQUEST, nameCheck.message, null, 'VALIDATION_ERROR');
    }
    const teamName = nameCheck.value;
    const isAdmin = isAdminUser(req.user);
    if (isAdmin) {
      // An organiser makes a team for participants; they are not put on it themselves.
      if (!(await userMayAccessEvent(req.user, eventIdNum))) {
        return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
      }
      const memberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
      const team = await teamService.createTeamAsOrganiser(eventIdNum, teamName, memberIds, req.body?.leaderId ?? null);
      await audit.record(req, 'team.created', { eventId: eventIdNum, targetType: 'team', targetId: team.id, meta: { name: team.name, members: memberIds.length } });
      return successResponse(res, HTTP.CREATED, 'Team created successfully', team);
    }
    const team = await teamService.createTeam(eventIdNum, teamName, req.user.id, { isAdmin });
    return successResponse(res, HTTP.CREATED, 'Team created successfully', team);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const joinTeam = async (req, res, next) => {
  try {
    const joinCode = String(req.body?.joinCode ?? req.body?.join_code ?? '').trim();
    if (!joinCode) return errorResponse(res, HTTP.BAD_REQUEST, 'joinCode is required');
    const isAdmin = isAdminUser(req.user);
    const team = await teamService.joinTeam(joinCode, req.user.id, { isAdmin });
    return successResponse(res, HTTP.OK, 'Joined team successfully', team);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const getMyTeam = async (req, res, next) => {
  try {
    // The event they act in (named, entered, else their default), never an
    // event they are not registered for, so another event's roster never
    // shows on this one's screen.
    const eventIdNum = await participantEventId(req);
    if (!eventIdNum) return successResponse(res, HTTP.OK, 'OK', null);

    const team = await teamService.getMyTeam(req.user.id, eventIdNum);
    if (team) {
      // Whether this person may hand in the project, and as the lead or as an
      // approved member while the lead is not approved (team.handInRight).
      const right = await teamService.handInRight(team.id, req.user.id);
      team.can_submit = right.ok;
      team.submit_as_lead = right.ok && right.asLead;
    }
    // 200 + null instead of 404: "not in a team yet" is a normal state.
    return successResponse(res, HTTP.OK, 'OK', team || null);
  } catch (error) { next(error); }
};

const getAllTeams = async (req, res, next) => {
  try {
    const excludeEmpty = String(req.query.excludeEmpty || '').toLowerCase() === 'true';
    // Staff and organisers: only events they belong to.
    if (req.query.eventId && !(await userMayAccessEvent(req.user, req.query.eventId))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
    }
    let teams = await teamService.getAllTeams(req.query.eventId, { excludeEmpty });
    if (!req.query.eventId) teams = await filterByVisibleEvent(req.user, teams);
    return successResponse(res, HTTP.OK, 'OK', teams);
  } catch (error) { next(error); }
};

const getTeamById = async (req, res, next) => {
  try {
    const team = await teamService.getTeamById(req.params.id);
    if (!team) return errorResponse(res, HTTP.NOT_FOUND, 'Team not found');
    if (!(await userMayAccessEvent(req.user, team.event_id))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Team not found');
    }
    /*
     * The join code is the team's invitation: whoever holds it can join
     * uninvited through POST /api/teams/join. It belongs to the team's own
     * members and to organisers; every other signed-in role (another team's
     * hacker, a judge reading a submission) gets the team without it.
     */
    if (!isAdminUser(req.user)) {
      const onTeam =
        (await teamService.isTeamMember(team.id, req.user.id)) ||
        (await teamService.isTeamLeader(team.id, req.user.id));
      if (!onTeam) delete team.join_code;
    }
    return successResponse(res, HTTP.OK, 'OK', team);
  } catch (error) { next(error); }
};

const updateTeam = async (req, res, next) => {
  try {
    const teamId = req.params.id;
    if (!isAdminUser(req.user)) {
      const isLead = await teamService.isTeamLeader(teamId, req.user.id);
      if (!isLead) {
        return errorResponse(res, HTTP.FORBIDDEN, 'Only the team leader or an admin can update this team', null, 'NOT_TEAM_LEAD');
      }
    }

    const nameCheck = validateDisplayName(req.body?.name, 'Team name', { min: 2 });
    if (!nameCheck.ok) {
      return errorResponse(res, HTTP.BAD_REQUEST, nameCheck.message, null, 'VALIDATION_ERROR');
    }
    const name = nameCheck.value;

    const updated = await teamService.updateTeam(teamId, { name });
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'Team not found');
    return successResponse(res, HTTP.OK, 'Team updated successfully', updated);
  } catch (error) { next(error); }
};

const deleteTeam = async (req, res, next) => {
  try {
    const team = (await db.query('SELECT id, event_id FROM teams WHERE id = $1', [req.params.id])).rows[0];
    if (team) await results.assertNotInPublishedResults(team.event_id, [team.id], 'delete');
    await teamService.deleteTeam(req.params.id);
    return successResponse(res, HTTP.OK, 'Team deleted successfully');
  } catch (error) { next(error); }
};

const getTeamMembers = async (req, res, next) => {
  try {
    const members = await teamService.getTeamMembers(req.params.id);
    return successResponse(res, HTTP.OK, 'OK', members);
  } catch (error) { next(error); }
};

/**
 * POST /api/teams/:id/members
 * Add a member by userId or email. Admins may add unknown emails (a
 * placeholder account is created); leaders can only add existing users.
 */
const addTeamMember = async (req, res, next) => {
  try {
    const { id: teamId } = req.params;
    const isAdmin = isAdminUser(req.user);

    if (!isAdmin) {
      const isLead = await teamService.isTeamLeader(teamId, req.user.id);
      if (!isLead) {
        return errorResponse(res, HTTP.FORBIDDEN, 'Only the team leader or an admin can add members', null, 'NOT_TEAM_LEAD');
      }
    }

    let { userId } = req.body || {};
    const { email } = req.body || {};
    if (!userId && email) {
      // Only people who already have an account (and, checked below, are
      // participants of the event): a team is not a back door into it.
      const normalized = String(email).trim().toLowerCase();
      const r = await db.query('SELECT id FROM users WHERE LOWER(TRIM(email)) = $1', [normalized]);
      if (!r.rows[0]) {
        return errorResponse(res, HTTP.NOT_FOUND, 'No registered user with this email. Ask them to sign up for the event first.', null, 'USER_NOT_FOUND');
      }
      userId = r.rows[0].id;
    }
    if (!userId) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'userId or email is required');
    }

    // An organiser may move someone over from another team in one step.
    const member = isAdmin && req.body?.move === true
      ? await teamService.moveMember(teamId, userId)
      : await teamService.addTeamMember(teamId, userId, { isAdmin });
    if (isAdmin) {
      const t = await db.query('SELECT event_id, name FROM teams WHERE id = $1', [teamId]);
      await audit.record(req, req.body?.move === true ? 'team.member_moved' : 'team.member_added', {
        eventId: t.rows[0]?.event_id, targetType: 'team', targetId: teamId, meta: { userId: Number(userId), team: t.rows[0]?.name },
      });
    }
    return successResponse(res, HTTP.CREATED, 'Member added successfully', member);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/**
 * DELETE /api/teams/:id/members/:userId
 * Allowed for: admins, the team leader, or the member themselves (leave team).
 * Hackers can only change rosters while team formation is open.
 */
const removeTeamMember = async (req, res, next) => {
  try {
    const { id: teamId, userId } = req.params;
    const isAdmin = isAdminUser(req.user);
    const isSelf = String(req.user.id) === String(userId);

    if (!isAdmin) {
      const isLead = await teamService.isTeamLeader(teamId, req.user.id);
      if (!isLead && !isSelf) {
        return errorResponse(res, HTTP.FORBIDDEN, 'Only the team leader or an admin can remove other members', null, 'NOT_TEAM_LEAD');
      }
      const team = await teamService.getTeamById(teamId);
      if (!team) return errorResponse(res, HTTP.NOT_FOUND, 'Team not found');
      await eventService.assertTeamFormationOpen(team.event_id);
    }

    const result = await teamService.removeTeamMember(teamId, userId);
    return successResponse(
      res,
      HTTP.OK,
      result.teamDeleted ? 'Member removed — the empty team was deleted' : 'Member removed successfully',
      result,
    );
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/**
 * PATCH /api/teams/:id/members/:userId/lead
 * Transfer team leadership. The current lead or an admin may call this.
 */
const transferLead = async (req, res, next) => {
  try {
    const { id: teamId, userId: toUserId } = req.params;
    const isAdmin = isAdminUser(req.user);
    const team = await teamService.transferLead(teamId, req.user.id, toUserId, {
      requireFromUserIsLead: !isAdmin,
    });
    return successResponse(res, HTTP.OK, 'Team leadership transferred', team);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/**
 * PATCH /api/teams/:id/status — admin-only elimination / restore.
 * Body: { status: 'active' | 'eliminated', reason?: string }
 */
const setTeamStatus = async (req, res, next) => {
  try {
    if (!isAdminUser(req.user)) {
      return errorResponse(res, HTTP.FORBIDDEN, 'Only admins can change team status');
    }
    const raw = String(req.body?.status || '').trim().toLowerCase();
    if (raw !== 'active' && raw !== 'eliminated') {
      return errorResponse(res, HTTP.BAD_REQUEST, 'status must be "active" or "eliminated"');
    }
    const reason =
      raw === 'eliminated' && typeof req.body?.reason === 'string'
        ? req.body.reason.trim().slice(0, 500)
        : null;
    if (raw === 'eliminated') {
      const team = (await db.query('SELECT id, event_id FROM teams WHERE id = $1', [req.params.id])).rows[0];
      if (team) await results.assertNotInPublishedResults(team.event_id, [team.id], 'eliminate');
    }
    const updated = await teamService.setTeamStatus(req.params.id, raw, reason);
    return successResponse(res, HTTP.OK, 'Team status updated', updated);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/* ── Recruiting and join requests ──────────────────────────────────────── */

async function teamEvent(teamId) {
  const r = await db.query('SELECT id, event_id, leader_id FROM teams WHERE id = $1', [teamId]);
  return r.rows[0] || null;
}

/** PATCH /api/teams/:id/recruiting — the lead (or an organiser) says what the team looks for. */
const setRecruiting = async (req, res, next) => {
  try {
    const team = await teamEvent(req.params.id);
    if (!team) return errorResponse(res, HTTP.NOT_FOUND, 'Team not found', null, 'TEAM_NOT_FOUND');
    if (!isAdminUser(req.user) && Number(team.leader_id) !== Number(req.user.id)) {
      return errorResponse(res, HTTP.FORBIDDEN, 'Only the team lead can change this', null, 'NOT_TEAM_LEAD');
    }
    const out = await matchmaking.setRecruiting(team.id, {
      recruiting: req.body?.recruiting === true,
      note: req.body?.note,
      wantedSkills: req.body?.wantedSkills,
    });
    return successResponse(res, HTTP.OK, 'Saved', out);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** POST /api/teams/:id/requests — ask to join. */
const requestToJoin = async (req, res, next) => {
  try {
    const row = await teamRequests.create(req.params.id, req.user.id, req.body?.message);
    return successResponse(res, HTTP.CREATED, 'Request sent', row);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** GET /api/teams/:id/requests — open requests (team members and organisers). */
const listRequests = async (req, res, next) => {
  try {
    const team = await teamEvent(req.params.id);
    if (!team) return errorResponse(res, HTTP.NOT_FOUND, 'Team not found', null, 'TEAM_NOT_FOUND');
    if (!isAdminUser(req.user)) {
      const member = await db.query('SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2', [team.id, req.user.id]);
      if (!member.rows[0]) return errorResponse(res, HTTP.FORBIDDEN, 'Only team members can see join requests', null, 'NOT_A_MEMBER');
    }
    const rows = await teamRequests.listForTeam(team.id);
    return successResponse(res, HTTP.OK, 'OK', rows.map((r) => ({ ...r, skills: matchmaking.skillList(r.skills) })));
  } catch (error) {
    return next(error);
  }
};

/** GET /api/teams/requests/mine?eventId= */
const myRequests = async (req, res, next) => {
  try {
    const eventId = Number.parseInt(String(req.query.eventId ?? ''), 10);
    return successResponse(res, HTTP.OK, 'OK', await teamRequests.listMine(req.user.id, Number.isInteger(eventId) ? eventId : null));
  } catch (error) {
    return next(error);
  }
};

async function decide(req, res, next, action) {
  try {
    const found = await teamRequests.requestRow(req.params.rid);
    if (!found) return errorResponse(res, HTTP.NOT_FOUND, 'Request not found', null, 'NOT_FOUND');
    const isAdmin = isAdminUser(req.user);
    if (isAdmin && !(await userMayAccessEvent(req.user, found.event_id))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Request not found', null, 'NOT_FOUND');
    }
    const out = await teamRequests[action](found.id, { userId: req.user.id, isAdmin });
    return successResponse(res, HTTP.OK, action === 'accept' ? 'Request accepted' : 'Request declined', out);
  } catch (error) {
    return errorFromException(res, next, error);
  }
}
const acceptRequest = (req, res, next) => decide(req, res, next, 'accept');
const declineRequest = (req, res, next) => decide(req, res, next, 'decline');

/** DELETE /api/teams/requests/:rid — the person withdraws their request. */
const cancelRequest = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'Request withdrawn', await teamRequests.cancel(req.params.rid, req.user.id));
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

module.exports = {
  setRecruiting,
  requestToJoin,
  listRequests,
  myRequests,
  acceptRequest,
  declineRequest,
  cancelRequest,
  createTeam,
  joinTeam,
  getMyTeam,
  getAllTeams,
  getTeamById,
  updateTeam,
  deleteTeam,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
  transferLead,
  setTeamStatus,
};
