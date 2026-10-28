/**
 * @file eventBuilder.controller.js
 * @description HTTP side of the event builder, the public event page and
 * registration.
 *
 * Organiser routes (session, organiser of the event):
 *   GET    /api/events/builder/catalog
 *   POST   /api/events/drafts
 *   GET    /api/events/:eventId/builder
 *   PATCH  /api/events/:eventId/builder
 *   PUT    /api/events/:eventId/builder/{tracks|prizes|sponsors|criteria|form}
 *   POST   /api/events/:eventId/builder/publish | unpublish
 *
 * Public routes:
 *   GET    /api/public/events/:slug
 *   POST   /api/public/events/:slug/register
 *   GET    /api/universities?q=&country=
 */

const db = require('../config/db');
const builder = require('../services/eventBuilder.service');
const eventLists = require('../services/eventLists.service');
const registrationForm = require('../services/registrationForm.service');
const registration = require('../services/eventRegistration.service');
const entitlementService = require('../services/entitlement.service');
const universityService = require('../services/university.service');
const emailService = require('../services/email.service');
const { eventSender } = require('../services/eventSender');
const audit = require('../services/audit.service');
const { TEMPLATE_KEYS } = require('../services/eventTemplates');
const constants = require('../constants/eventBuilder');
const { isOwnerUser } = require('../utils/authz');
const { signToken } = require('../utils/jwtHelper');
const { setSessionCookie } = require('../utils/cookies');
const { finishUser } = require('../middlewares/authMw');
const { sendVerification } = require('./auth.controller');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const { successResponse, errorResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const eventIdOf = (req) => Number.parseInt(String(req.params.eventId), 10);

const catalog = (req, res) => successResponse(res, HTTP.OK, 'OK', {
  templates: TEMPLATE_KEYS,
  sections: constants.SECTIONS,
  categories: constants.CATEGORIES,
  languages: constants.LANGUAGES,
  formats: constants.FORMATS,
  registrationModes: constants.REGISTRATION_MODES,
  approvalModes: constants.APPROVAL_MODES,
  visibilities: constants.VISIBILITIES,
  standardFields: constants.STANDARD_FIELDS.map(({ key, type, options, defaultOn, sensitive, min, max }) => ({
    key, type, options: options || [], defaultOn, sensitive: Boolean(sensitive), ...(min != null ? { min, max } : {}),
  })),
  customFieldTypes: constants.CUSTOM_FIELD_TYPES,
  submissionFields: constants.SUBMISSION_FIELDS,
  submissionFileTypes: constants.SUBMISSION_FILE_TYPES,
  autoAnnouncements: constants.AUTO_ANNOUNCEMENTS,
  certificateTypes: constants.CERTIFICATE_TYPES,
  resultsVisibility: constants.RESULTS_VISIBILITY,
  judgeAssignment: constants.JUDGE_ASSIGNMENT,
  presentationOrder: constants.PRESENTATION_ORDER,
  sponsorTiers: constants.SPONSOR_TIERS,
  prizeKinds: constants.PRIZE_KINDS,
  configDefaults: constants.CONFIG_DEFAULTS,
});

const createDraft = async (req, res, next) => {
  try {
    const org = isOwnerUser(req.user) ? null : await entitlementService.organisationForNewEvent(req.user.id);
    const id = await builder.createDraft(req.user, req.body, org);
    audit.record(req, 'event.create', { eventId: id, customerId: org ? org.id : null, targetType: 'event', targetId: id, meta: { template: req.body?.template || 'blank' } });
    return successResponse(res, HTTP.CREATED, 'Draft created', await builder.getBuilder(id));
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const getBuilder = async (req, res, next) => {
  try {
    const data = await builder.getBuilder(eventIdOf(req));
    if (!data) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
    return successResponse(res, HTTP.OK, 'OK', data);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const patch = async (req, res, next) => {
  try {
    const data = await builder.patchEvent(eventIdOf(req), req.body, { isOwner: isOwnerUser(req.user), actorId: req.user.id });
    return successResponse(res, HTTP.OK, 'Saved', data);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const checklist = async (req, res, next) => {
  try {
    const e = (await db.query('SELECT * FROM events WHERE id = $1', [eventIdOf(req)])).rows[0];
    if (!e) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
    const { items } = await builder.checklistFor(e);
    return successResponse(res, HTTP.OK, 'OK', { checklist: items, ready: !items.some((i) => i.severity === 'error') });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** PUT /builder/<list>: replace one list; answers the saved list and the checklist. */
function syncList(kind) {
  const fns = {
    tracks: eventLists.syncTracks,
    prizes: eventLists.syncPrizes,
    sponsors: eventLists.syncSponsors,
    criteria: eventLists.syncCriteria,
  };
  return async (req, res, next) => {
    try {
      const eventId = eventIdOf(req);
      const items = req.body?.items;
      let result;
      if (kind === 'form') {
        const scope = await entitlementService.forEvent(eventId);
        const customAllowed = isOwnerUser(req.user) || !scope || scope.modules.has('forms');
        result = await registrationForm.syncFields(eventId, items, { customAllowed });
      } else {
        result = await fns[kind](eventId, items);
      }
      const e = (await db.query('SELECT * FROM events WHERE id = $1', [eventId])).rows[0];
      const { items: checklistItems } = await builder.checklistFor(e);
      return successResponse(res, HTTP.OK, 'Saved', {
        items: kind === 'sponsors'
          ? result.items.map((s) => ({ ...s, logo_url: s.logo_file_id ? `/api/files/${s.logo_file_id}` : s.logo || null }))
          : result.items,
        idsByCid: result.idsByCid,
        checklist: checklistItems,
        ready: !checklistItems.some((i) => i.severity === 'error'),
      });
    } catch (error) {
      return errorFromException(res, next, error);
    }
  };
}

const publish = async (req, res, next) => {
  try {
    const data = await builder.publish(eventIdOf(req));
    audit.record(req, 'event.publish', { eventId: eventIdOf(req), customerId: data.event.customer_id, targetType: 'event', targetId: eventIdOf(req) });
    return successResponse(res, HTTP.OK, 'Event published', data);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const unpublish = async (req, res, next) => {
  try {
    const data = await builder.unpublish(eventIdOf(req));
    audit.record(req, 'event.unpublish', { eventId: eventIdOf(req), customerId: data.event.customer_id, targetType: 'event', targetId: eventIdOf(req) });
    return successResponse(res, HTTP.OK, 'Event unpublished', data);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

// ── Public ──────────────────────────────────────────────────────────────────

const publicEvent = async (req, res, next) => {
  try {
    const data = await builder.publicEvent(req.params.slug);
    if (!data) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');
    res.set('Cache-Control', 'no-store');
    return successResponse(res, HTTP.OK, 'OK', data);
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

function notifyRegistration(result, event) {
  if (String(process.env.SEND_EMAIL_ON_REGISTRATION || 'true').trim().toLowerCase() === 'false') return;
  eventSender(event.id)
    .then((sender) => emailService.sendRegistrationReceivedEmail({
      to: result.email,
      fullName: result.fullName,
      eventName: event.name,
      eventCode: event.event_code,
      status: result.status,
      frontendUrl: resolveFrontendBaseUrl(),
      sender,
      lang: event.language,
    }))
    .catch((err) => console.error('[Registration] e-mail skipped:', err.message));
}

const register = async (req, res, next) => {
  try {
    const key = String(req.params.slug || '').trim();
    const event = (await db.query(
      `SELECT * FROM events
        WHERE (slug = LOWER($1) OR LOWER(event_code) = LOWER($1))
          AND LOWER(TRIM(COALESCE(status::text, ''))) <> 'archived'
        ORDER BY (slug = LOWER($1)) DESC LIMIT 1`,
      [key],
    )).rows[0];
    if (!event) return errorResponse(res, HTTP.NOT_FOUND, 'Event not found', null, 'NOT_FOUND');

    const body = req.body || {};
    const result = await registration.register({
      event,
      user: req.user || null,
      account: body.account,
      answers: body.answers,
      entry: body.entry,
      accept: body.accept,
      ref: body.ref,
      inviteToken: typeof body.inviteToken === 'string' ? body.inviteToken.slice(0, 200) : undefined,
    });

    let session = null;
    if (result.created) {
      setSessionCookie(res, signToken({ id: result.userId, role: 'hacker', email: result.email, tv: 0 }));
    }
    const userRow = (await db.query('SELECT id, role, email, full_name, token_version FROM users WHERE id = $1', [result.userId])).rows[0];
    if (userRow) {
      session = await finishUser({ params: { eventId: event.id }, query: {}, body: {}, cookies: {} }, { ...userRow });
    }
    notifyRegistration(result, event);
    const verifyExtras = result.verification
      ? sendVerification({ to: result.email, fullName: result.fullName, token: result.verification.token, lang: event.language })
      : {};
    return successResponse(res, HTTP.CREATED, 'Registered', {
      ...verifyExtras,
      verificationRequired: Boolean(result.verification),
      status: result.status,
      created: result.created,
      team: result.team ? { id: result.team.id, name: result.team.name, join_code: result.team.join_code || null } : null,
      teamSkipped: result.teamSkipped,
      event: { id: event.id, name: event.name, slug: event.slug, event_code: event.event_code },
      user: session ? {
        id: session.id,
        email: session.email,
        full_name: session.full_name,
        role: session.role,
        status: session.participantStatus || result.status,
        contextEventId: event.id,
      } : null,
    });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const universities = (req, res) => {
  const items = universityService.search(String(req.query.q || '').slice(0, 100), {
    country: req.query.country ? String(req.query.country) : null,
    limit: req.query.limit,
  });
  res.set('Cache-Control', 'public, max-age=3600');
  return successResponse(res, HTTP.OK, 'OK', items);
};

module.exports = {
  catalog,
  createDraft,
  getBuilder,
  patch,
  checklist,
  syncList,
  publish,
  unpublish,
  publicEvent,
  register,
  universities,
};
