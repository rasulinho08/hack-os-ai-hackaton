/**
 * @file submission.controller.js
 * @description HTTP handlers for project submission management.
 *
 * Access rules:
 *   - hacker  → only own team's submission (team resolved per event)
 *   - judge   → event-scoped submissions (must be assigned judge)
 *   - mentor  → event-scoped submissions (must be assigned mentor)
 *   - admin   → all submissions (cross-event)
 */

const submissionService = require('../services/submission.service');
const teamService       = require('../services/team.service');
const judgeService      = require('../services/judge.service');
const mentorService     = require('../services/mentor.service');
const judging           = require('../services/judging.service');
const eventService      = require('../services/event.service');
const emailService      = require('../services/email.service');
const { eventSender } = require('../services/eventSender');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const submissionRules = require('../services/submissionRules');
const results = require('../services/results.service');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { ROLES } = require('../constants/roles');
const { isAdminUser, normalizeRole } = require('../utils/authz');
const { userMayAccessEvent, filterByVisibleEvent } = require('../services/tenantAccess.service');
const { participantEventId } = require('../services/effectiveRole.service');
const db = require('../config/db');

function trimField(v) {
  if (v == null) return undefined;
  return typeof v === 'string' ? v.trim() : String(v).trim();
}

const CONTENT_COLUMNS = ['project_name', 'description', 'repo_link', 'demo_link', 'tech_stack', 'presentation_link', 'video_link'];

function mapSubmissionBody(body) {
  const pick = (...keys) => {
    for (const k of keys) if (body[k] !== undefined) return body[k];
    return undefined;
  };
  const opt = (v) => (v === undefined ? undefined : v == null || String(v).trim() === '' ? null : trimField(v));
  const fileIds = pick('fileIds', 'file_ids');
  return {
    project_name: trimField(pick('projectName', 'project_name')),
    description: opt(pick('description')),
    repo_link: opt(pick('repoLink', 'repo_link')),
    demo_link: opt(pick('demoLink', 'demo_link')),
    tech_stack: opt(pick('techStack', 'tech_stack')),
    presentation_link: opt(pick('presentationLink', 'presentation_link')),
    video_link: opt(pick('videoLink', 'video_link')),
    fileIds: Array.isArray(fileIds) ? fileIds.map(String) : undefined,
  };
}

/** If JSON body omits fields (e.g. proxy strips PUT body), keep DB values. */
function mergeMappedWithExisting(existing, mapped) {
  const out = { ...mapped };
  for (const k of CONTENT_COLUMNS) {
    if (out[k] === undefined) out[k] = existing[k];
  }
  return out;
}

/**
 * The organiser's rules for this event's submissions: which links and texts
 * are required, optional or off, and whether files may be attached.
 * Answers 400 with field errors, or the values to store.
 */
function applyRules(res, mapped, event) {
  const cfg = submissionRules.configFor(event);
  const checked = submissionRules.checkSubmission(mapped, cfg);
  if (!checked.ok) {
    errorResponse(res, HTTP.BAD_REQUEST, checked.message, checked.errors, 'VALIDATION_ERROR');
    return null;
  }
  if (mapped.fileIds !== undefined && cfg.files.enabled && mapped.fileIds.length > submissionRules.MAX_FILES) {
    errorResponse(res, HTTP.BAD_REQUEST, `At most ${submissionRules.MAX_FILES} files per project.`,
      [{ field: 'fileIds', message: `At most ${submissionRules.MAX_FILES} files per project.` }], 'VALIDATION_ERROR');
    return null;
  }
  // With files switched off, attachments already handed in stay as they are.
  return { values: checked.values, fileIds: cfg.files.enabled ? mapped.fileIds : undefined };
}

/** The event id the request itself names (body or query), if any. */
function namedEventId(req) {
  const raw = req.body?.eventId ?? req.body?.event_id ?? req.query?.eventId ?? req.query?.event_id;
  const n = parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The event a hacker acts in (participantEventId): the one named or the
 * workspace entered when they are registered there, else their default.
 * Null when they named an event they are not registered for, or have none.
 */
const resolveEventIdForHacker = (req) => participantEventId(req);

/** The refusal when no event could be resolved for a hacker. */
function noEvent(res, req) {
  if (namedEventId(req)) {
    return errorResponse(res, HTTP.FORBIDDEN, 'You are not registered for this event', null, 'NOT_PARTICIPANT');
  }
  return errorResponse(res, HTTP.BAD_REQUEST, 'eventId is required (no active event found)', null, 'NO_ACTIVE_EVENT');
}

/**
 * Submissions are only allowed while the hackathon is running — now ∈
 * [start_date, submission_deadline ?? end_date]. `allow_late_submissions`
 * lifts the closing check but never the "not started yet" check.
 */
async function assertSubmissionWindow(eventId) {
  const event = await eventService.getEventById(eventId);
  if (!event) {
    return { ok: false, code: 'EVENT_NOT_FOUND', message: 'Event not found' };
  }
  const check = submissionRules.windowCheck(event);
  return check.ok ? { ok: true, event } : check;
}

/** Enforce per-event minimum team size: rejected members do not count. */
async function assertMinTeamSize(teamId, eventRow) {
  const min = Number(eventRow?.min_team_size ?? 1);
  if (!Number.isFinite(min) || min <= 1) {
    return { ok: true, memberCount: null, min: 1 };
  }
  const count = await teamService.countedMembers(db, teamId);
  if (count < min) {
    return {
      ok: false,
      code: 'TEAM_TOO_SMALL',
      message: `Your team needs at least ${min} members before you can submit (current: ${count}).`,
      memberCount: count,
      min,
    };
  }
  return { ok: true, memberCount: count, min };
}

/**
 * The refusal when this person may not hand in or edit the team's project
 * (team.handInRight: the approved lead, or any approved member while the
 * lead is not approved), or null when they may.
 */
async function handInRefusal(res, teamId, userId, leadMessage) {
  const right = await teamService.handInRight(teamId, userId);
  if (right.ok) return null;
  if (right.code === 'NOT_TEAM_LEAD') return errorResponse(res, HTTP.FORBIDDEN, leadMessage, null, 'NOT_TEAM_LEAD');
  return errorResponse(res, HTTP.FORBIDDEN, 'Only participants the organisers have accepted can hand in a project.', null, 'HACKER_NOT_APPROVED');
}

/**
 * What a judge may see of the event's projects: the teams they judge, and
 * with blind judging on, a project number instead of the team's name.
 */
async function forJudge(userId, eventId, rows) {
  const judge = await judging.judgeFor(userId, eventId);
  if (!judge) return [];
  const scope = await judging.scopeFor(await judging.loadEvent(eventId), judge);
  const mine = rows.filter((r) => scope.allowed.has(Number(r.team_id)));
  if (!scope.cfg.blind) return mine;
  return mine.map((r) => ({ ...r, team_name: null, team_number: scope.labels.get(Number(r.team_id)) ?? null }));
}

/** Enforce team / event-scoped read access. */
async function canReadSubmission(user, submission) {
  const role = normalizeRole(user.role);
  if (isAdminUser(user)) return true;
  if (role === 'hacker' || role === 'pending') {
    const team = await teamService.getMyTeam(user.id, submission.event_id);
    return Boolean(team && team.id === submission.team_id);
  }
  if (role === 'judge') {
    return judgeService.isUserJudgeForEvent(user.id, submission.event_id);
  }
  if (role === 'mentor') {
    return mentorService.isUserMentorForEvent(user.id, submission.event_id);
  }
  return false;
}

/**
 * "Project submitted" e-mail to every member of the team. Recipients come
 * from the team roster, never from the request. Runs after the response;
 * opt-out: SEND_EMAIL_ON_SUBMISSION=false.
 */
function notifySubmission(team, event, mapped) {
  if (String(process.env.SEND_EMAIL_ON_SUBMISSION || 'true').trim().toLowerCase() === 'false') return;
  const frontendUrl = resolveFrontendBaseUrl();
  Promise.all([teamService.getTeamMembers(team.id), eventSender(event?.id ?? team.event_id)])
    .then(([members, sender]) =>
      Promise.all(
        members
          .filter((m) => m.email)
          .map((m) =>
            emailService.sendSubmissionReceivedEmail({
              to: m.email,
              fullName: m.full_name,
              eventName: event?.name,
              teamName: team.name,
              projectName: mapped.project_name,
              frontendUrl,
              sender,
              lang: event?.language,
            }),
          ),
      ),
    )
    .catch((err) => console.error('[Submission] confirmation e-mail skipped:', err.message));
}

const submitProject = async (req, res, next) => {
  try {
    const eventId = await resolveEventIdForHacker(req);
    if (!eventId) return noEvent(res, req);
    const team = await teamService.getMyTeam(req.user.id, eventId);
    if (!team) {
      return errorResponse(res, HTTP.NOT_FOUND, 'You are not in a team for this event', null, 'NO_TEAM');
    }
    // Only the team lead may submit so two people don't overwrite each other
    // (an approved member instead, while the lead is not approved).
    const refused = await handInRefusal(res, team.id, req.user.id, 'Only the team lead can submit the project.');
    if (refused) return refused;

    const windowCheck = await assertSubmissionWindow(team.event_id);
    if (!windowCheck.ok) {
      return errorResponse(res, HTTP.FORBIDDEN, windowCheck.message, null, windowCheck.code);
    }

    const sizeCheck = await assertMinTeamSize(team.id, windowCheck.event);
    if (!sizeCheck.ok) {
      return res.status(HTTP.FORBIDDEN).json({
        success: false,
        message: sizeCheck.message,
        code: sizeCheck.code,
        min: sizeCheck.min,
        current: sizeCheck.memberCount,
      });
    }

    const mapped = mapSubmissionBody(req.body);
    const ruled = applyRules(res, mapped, windowCheck.event);
    if (!ruled) return undefined;
    const saved = await submissionService.submitProject(team.id, team.event_id, ruled.values);
    if (ruled.fileIds !== undefined) await submissionService.setFiles(saved, ruled.fileIds);
    notifySubmission(team, windowCheck.event, ruled.values);
    return successResponse(res, HTTP.CREATED, 'Submission saved successfully', await submissionService.getSubmissionById(saved.id));
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/**
 * GET /api/submissions/rules?eventId= — what the event asks a team to hand in
 * (each link or text required, optional or off; files and their limits) and
 * whether submissions are open, so the form asks exactly that.
 */
const getRules = async (req, res, next) => {
  try {
    // Staff name the event; a participant may leave it to their workspace.
    const eventId = namedEventId(req) || (await resolveEventIdForHacker(req));
    if (!eventId) return errorResponse(res, HTTP.BAD_REQUEST, 'eventId is required (no active event found)', null, 'NO_ACTIVE_EVENT');
    if (!(await userMayAccessEvent(req.user, eventId)) && !(await eventService.canUserSeeEvent(req.user.id, eventId))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
    }
    const event = await eventService.getEventById(eventId);
    if (!event) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
    const cfg = submissionRules.configFor(event);
    const window = submissionRules.windowCheck(event);
    return successResponse(res, HTTP.OK, 'OK', {
      eventId: event.id,
      fields: cfg.fields,
      files: { ...cfg.files, maxFiles: submissionRules.MAX_FILES },
      open: window.ok,
      ...(window.ok ? {} : { closedCode: window.code }),
    });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const getAllSubmissions = async (req, res, next) => {
  try {
    const role = normalizeRole(req.user.role);
    const { eventId } = req.query;

    if (role === 'hacker' || role === 'pending') {
      const eid = await resolveEventIdForHacker(req);
      const team = eid ? await teamService.getMyTeam(req.user.id, eid) : null;
      if (!team) return successResponse(res, HTTP.OK, 'OK', []);
      const submissions = await submissionService.getTeamSubmissions(team.id);
      return successResponse(res, HTTP.OK, 'OK', submissions);
    }

    if (role === 'judge' || role === ROLES.MENTOR) {
      const eid = parseInt(String(eventId ?? '').trim(), 10);
      if (!Number.isFinite(eid) || eid < 1) {
        return errorResponse(res, HTTP.BAD_REQUEST, `eventId query parameter is required for ${role}s`);
      }
      const allowed = role === 'judge'
        ? await judgeService.isUserJudgeForEvent(req.user.id, eid)
        : await mentorService.isUserMentorForEvent(req.user.id, eid);
      if (!allowed) {
        return errorResponse(res, HTTP.FORBIDDEN, `Forbidden. You are not a ${role} for this event.`);
      }
      const submissions = await submissionService.getAllSubmissions(eid);
      if (role === 'judge') return successResponse(res, HTTP.OK, 'OK', await forJudge(req.user.id, eid, submissions));
      return successResponse(res, HTTP.OK, 'OK', submissions);
    }

    // Organisers: only their own customer's events.
    if (eventId && !(await userMayAccessEvent(req.user, eventId))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
    }
    let submissions = await submissionService.getAllSubmissions(eventId);
    if (!eventId) submissions = await filterByVisibleEvent(req.user, submissions);
    return successResponse(res, HTTP.OK, 'OK', submissions);
  } catch (error) {
    next(error);
  }
};

const getSubmissionById = async (req, res, next) => {
  try {
    const submission = await submissionService.getSubmissionById(req.params.id);
    if (!submission) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Submission not found');
    }
    if (!(await canReadSubmission(req.user, submission))) {
      return errorResponse(res, HTTP.FORBIDDEN, 'Forbidden. You cannot view this submission.');
    }
    if (normalizeRole(req.user.role) === 'judge' && !isAdminUser(req.user)) {
      const [visible] = await forJudge(req.user.id, submission.event_id, [submission]);
      if (!visible) return errorResponse(res, HTTP.FORBIDDEN, 'Forbidden. You cannot view this submission.');
      return successResponse(res, HTTP.OK, 'OK', visible);
    }
    return successResponse(res, HTTP.OK, 'OK', submission);
  } catch (error) {
    next(error);
  }
};

const updateSubmission = async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await submissionService.getSubmissionById(id);
    if (!existing) {
      return errorResponse(res, HTTP.NOT_FOUND, 'Submission not found');
    }

    if (isAdminUser(req.user)) {
      // Admin edits are limited to an explicit status override.
      const { status } = req.body;
      if (status === undefined) {
        return errorResponse(res, HTTP.BAD_REQUEST, 'Admin update requires status');
      }
      const updated = await submissionService.updateSubmission(id, { status });
      return successResponse(res, HTTP.OK, 'Submission updated', updated);
    }

    const role = normalizeRole(req.user.role);
    if (role !== 'hacker' && role !== 'pending') {
      return errorResponse(res, HTTP.FORBIDDEN, 'Forbidden. Insufficient permissions.');
    }

    const team = await teamService.getMyTeam(req.user.id, existing.event_id);
    if (!team || existing.team_id !== team.id) {
      return errorResponse(res, HTTP.FORBIDDEN, 'You can only update your own team submission');
    }

    const refused = await handInRefusal(res, team.id, req.user.id, 'Only the team lead can update the project submission.');
    if (refused) return refused;

    const windowCheck = await assertSubmissionWindow(existing.event_id);
    if (!windowCheck.ok) {
      return errorResponse(res, HTTP.FORBIDDEN, windowCheck.message, null, windowCheck.code);
    }

    const sizeCheck = await assertMinTeamSize(team.id, windowCheck.event);
    if (!sizeCheck.ok) {
      return res.status(HTTP.FORBIDDEN).json({
        success: false,
        message: sizeCheck.message,
        code: sizeCheck.code,
        min: sizeCheck.min,
        current: sizeCheck.memberCount,
      });
    }

    const mapped = mapSubmissionBody(req.body);
    const merged = mergeMappedWithExisting(existing, mapped);
    const ruled = applyRules(res, merged, windowCheck.event);
    if (!ruled) return undefined;

    await submissionService.updateSubmission(id, ruled.values);
    if (ruled.fileIds !== undefined) await submissionService.setFiles(existing, ruled.fileIds);
    return successResponse(res, HTTP.OK, 'Submission updated successfully', await submissionService.getSubmissionById(id));
  } catch (error) {
    next(error);
  }
};

const deleteSubmission = async (req, res, next) => {
  try {
    const sub = await submissionService.getSubmissionById(req.params.id);
    if (sub) await results.assertNotInPublishedResults(sub.event_id, [sub.team_id], 'delete_submission');
    await submissionService.deleteSubmission(req.params.id);
    return successResponse(res, HTTP.OK, 'Submission deleted successfully');
  } catch (error) {
    if (error && error.code === 'RESULTS_PUBLISHED') return errorFromException(res, next, error);
    next(error);
  }
};

module.exports = {
  getRules,
  submitProject,
  getAllSubmissions,
  getSubmissionById,
  updateSubmission,
  deleteSubmission,
};
