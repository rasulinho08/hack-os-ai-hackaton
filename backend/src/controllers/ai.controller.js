/**
 * @file ai.controller.js
 * @description AI helpers for organisers, on Meta's Model API.
 *
 *   GET  /api/ai/status        whether AI is configured (the web app shows the button)
 *   POST /api/ai/event-draft   { prompt, language?, timezone? } → a new draft event
 */

const aiEventDraft = require('../services/aiEventDraft');
const metaAi = require('../services/metaAi');
const builder = require('../services/eventBuilder.service');
const entitlementService = require('../services/entitlement.service');
const audit = require('../services/audit.service');
const { isOwnerUser } = require('../utils/authz');
const { successResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const status = (req, res) => successResponse(res, HTTP.OK, 'OK', { enabled: metaAi.isEnabled() });

const eventDraft = async (req, res, next) => {
  try {
    const org = isOwnerUser(req.user) ? null : await entitlementService.organisationForNewEvent(req.user.id);
    const { eventId, skipped, model } = await aiEventDraft.createFromPrompt(req.user, req.body, org);
    audit.record(req, 'event.create', {
      eventId, customerId: org ? org.id : null, targetType: 'event', targetId: eventId, meta: { source: 'ai', model },
    });
    return successResponse(res, HTTP.CREATED, 'Draft created', { ...(await builder.getBuilder(eventId)), ai: { skipped, model } });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

module.exports = { status, eventDraft };
