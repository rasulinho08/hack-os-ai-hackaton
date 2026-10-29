/**
 * @file file.controller.js
 * @description Upload, read and delete files.
 *
 *   POST   /api/files?purpose=<p>&eventId=<id>   raw body, X-File-Name header
 *   GET    /api/files/:id
 *   DELETE /api/files/:id
 *
 * Who may upload depends on the purpose: an event's organisers upload its
 * logo, banner, sponsor logos, certificate signature and gallery photos
 * (when the plan has the gallery); anyone filling in
 * the registration form of an open event uploads registration attachments,
 * signed in or not (those are claimed with a one-time token when the form
 * is submitted, and removed after a day if it never is); a team lead uploads
 * project files while submissions are open, when the organiser allows files,
 * within the event's size and types (kept only once a submission lists them).
 * The photos of the platform's stories are uploaded by the owner through
 * /api/owner/showcase/files, never here.
 */

const fileService = require('../services/file.service');
const eventService = require('../services/event.service');
const entitlementService = require('../services/entitlement.service');
const { eventRoleOf } = require('../services/effectiveRole.service');
const teamService = require('../services/team.service');
const submissionRules = require('../services/submissionRules');
const db = require('../config/db');
const { isOwnerUser } = require('../utils/authz');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const ORGANISER_PURPOSES = {
  event_logo: 'branding', event_banner: 'branding', sponsor_logo: null, signature: 'certificates', gallery: 'gallery',
};

async function organises(user, eventId) {
  if (!user) return false;
  if (isOwnerUser(user)) return true;
  const found = await eventRoleOf(user.id, eventId);
  return Boolean(found && found.role === 'organizer');
}

function registrationOpen(event) {
  if (!event || !event.is_published) return false;
  if (String(event.status || '').toLowerCase() === 'archived') return false;
  const now = Date.now();
  if (event.registration_start && new Date(event.registration_start).getTime() > now) return false;
  if (event.registration_end && new Date(event.registration_end).getTime() < now) return false;
  if (event.end_date && new Date(event.end_date).getTime() < now) return false;
  return true;
}

const upload = async (req, res, next) => {
  try {
    const purpose = String(req.query.purpose || '');
    const eventId = Number.parseInt(String(req.query.eventId || ''), 10);
    if (!fileService.PURPOSES[purpose]) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'Unknown upload purpose.', null, 'VALIDATION_ERROR');
    }
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'eventId is required.', null, 'VALIDATION_ERROR');
    }
    const event = await eventService.getEventById(eventId);
    if (!event) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');

    const scope = await entitlementService.forEvent(eventId);
    let limits = null;
    if (purpose === 'submission') {
      if (!req.user) return errorResponse(res, HTTP.UNAUTHORIZED, 'Sign in to upload.', null, 'UNAUTHENTICATED');
      const cfg = submissionRules.configFor(event);
      if (!cfg.files.enabled) {
        return errorResponse(res, HTTP.FORBIDDEN, 'This event does not take files with projects.', null, 'FILES_DISABLED');
      }
      const team = await teamService.getMyTeam(req.user.id, eventId);
      if (!team) return errorResponse(res, HTTP.NOT_FOUND, 'You are not in a team for this event', null, 'NO_TEAM');
      if (!(await teamService.isTeamLeader(team.id, req.user.id))) {
        return errorResponse(res, HTTP.FORBIDDEN, 'Only the team lead can submit the project.', null, 'NOT_TEAM_LEAD');
      }
      const open = submissionRules.windowCheck(event);
      if (!open.ok) return errorResponse(res, HTTP.FORBIDDEN, open.message, null, open.code);
      limits = submissionRules.fileLimits(cfg);
    } else if (purpose in ORGANISER_PURPOSES) {
      if (!req.user) return errorResponse(res, HTTP.UNAUTHORIZED, 'Sign in to upload.', null, 'UNAUTHENTICATED');
      if (!(await organises(req.user, eventId))) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
      const module = ORGANISER_PURPOSES[purpose];
      if (module && scope && !scope.modules.has(module) && !isOwnerUser(req.user)) {
        return res.status(403).json({
          success: false,
          message: 'This feature is not part of the plan this event runs on.',
          code: 'MODULE_DISABLED',
          module,
        });
      }
    } else if (purpose !== 'registration') {
      return errorResponse(res, HTTP.BAD_REQUEST, 'Unknown upload purpose.', null, 'VALIDATION_ERROR');
    } else if (!registrationOpen(event) && !(await organises(req.user, eventId))) {
      return errorResponse(res, HTTP.FORBIDDEN, 'Registration for this event is closed.', null, 'REGISTRATION_CLOSED');
    }

    const stored = await fileService.store({
      data: req.body,
      purpose,
      event,
      userId: req.user ? req.user.id : null,
      filename: req.get('x-file-name'),
      storageLimitGb: scope ? scope.limits.storageGb : null,
      limits,
    });
    return successResponse(res, HTTP.CREATED, 'File uploaded', {
      ...stored,
      url: fileService.fileUrl(stored.id),
    });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/**
 * A project file is for the team that handed it in and for the people who
 * assess it: the event's judges and mentors (and its organisers, as always).
 */
async function readsProjectFile(user, meta) {
  if (!user || meta.purpose !== 'submission') return false;
  const role = await eventRoleOf(user.id, meta.event_id);
  if (role && ['organizer', 'judge', 'mentor'].includes(role.role)) return true;
  const team = await db.query(
    `SELECT 1 FROM submission_files sf
       JOIN submissions s ON s.id = sf.submission_id
       JOIN team_members tm ON tm.team_id = s.team_id
      WHERE sf.file_id = $1 AND tm.user_id = $2
      LIMIT 1`,
    [meta.id, user.id],
  );
  return team.rows.length > 0;
}

const read = async (req, res, next) => {
  try {
    const meta = await fileService.getMeta(req.params.id);
    if (!meta) return errorResponse(res, HTTP.NOT_FOUND, 'File not found', null, 'NOT_FOUND');
    if (!meta.is_public) {
      const own = req.user && meta.owner_user_id != null && Number(meta.owner_user_id) === Number(req.user.id);
      if (!own && !(await organises(req.user, meta.event_id)) && !(await readsProjectFile(req.user, meta))) {
        return errorResponse(res, HTTP.NOT_FOUND, 'File not found', null, 'NOT_FOUND');
      }
    }
    const data = await fileService.readBytes(meta.id);
    if (!data) return errorResponse(res, HTTP.NOT_FOUND, 'File not found', null, 'NOT_FOUND');

    const inline = meta.mime.startsWith('image/') || meta.mime === 'application/pdf';
    res.set({
      'Content-Type': meta.mime,
      'Content-Length': String(data.length),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      'Cache-Control': meta.is_public ? 'public, max-age=31536000, immutable' : 'private, no-store',
      ETag: `"${meta.sha256}"`,
    });
    if (meta.is_public && req.get('if-none-match') === `"${meta.sha256}"`) return res.status(304).end();
    return res.status(200).end(data);
  } catch (error) {
    return next(error);
  }
};

const remove = async (req, res, next) => {
  try {
    const meta = await fileService.getMeta(req.params.id);
    if (!meta) return errorResponse(res, HTTP.NOT_FOUND, 'File not found', null, 'NOT_FOUND');
    // Uploader's own file, while nothing uses it yet: an unsent registration
    // attachment, or a project file no submission lists.
    const mine = meta.owner_user_id != null && Number(meta.owner_user_id) === Number(req.user.id);
    const unused = meta.purpose === 'registration'
      ? !meta.claimed_at
      : meta.purpose === 'submission'
        && (await db.query('SELECT 1 FROM submission_files WHERE file_id = $1', [meta.id])).rows.length === 0;
    const own = mine && unused;
    if (!own && !(await organises(req.user, meta.event_id))) {
      return errorResponse(res, HTTP.NOT_FOUND, 'File not found', null, 'NOT_FOUND');
    }
    await fileService.remove(meta.id);
    return successResponse(res, HTTP.OK, 'File deleted');
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

module.exports = { upload, read, remove, registrationOpen, organises };
