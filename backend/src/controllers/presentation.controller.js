/**
 * @file presentation.controller.js
 * @description HTTP handlers for presentation slot management.
 */

const presentationService = require('../services/presentation.service');
const { successResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { validateOptionalUrl } = require('../validations/common');

const getPresentations = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const presentations = await presentationService.getPresentations(eventId);
    res.status(200).json({ success: true, data: presentations });
  } catch (error) {
    next(error);
  }
};

/** GET /api/events/:eventId/presentations/settings — the organiser's slot rules, for timers and schedules. */
const getSettings = async (req, res, next) => {
  try {
    const settings = await presentationService.settingsFor(req.params.eventId);
    return successResponse(res, HTTP.OK, 'OK', settings);
  } catch (error) {
    next(error);
  }
};

const generatePresentations = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const created = await presentationService.generateFromSubmissions(eventId);
    res.status(200).json({
      success: true,
      message: `${created.length} presentation(s) generated`,
      data: created,
    });
  } catch (error) {
    next(error);
  }
};

const createPresentation = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const data = { ...req.body, event_id: eventId };
    const presentation = await presentationService.createPresentation(data);
    res.status(201).json({ success: true, data: presentation });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

/** Where a slot stands on the stage: not yet, on now, finished. */
const PRESENTATION_STATUSES = ['waiting', 'presenting', 'done'];

const updatePresentation = async (req, res, next) => {
  try {
    const { id } = req.params;
    // drive_link is rendered as a link on the presentations screen, so it is
    // checked rather than trusted; everything else passes through unchanged.
    const rawLink = req.body?.drive_link ?? req.body?.driveLink;
    if (rawLink !== undefined) {
      const link = validateOptionalUrl(rawLink, 'Drive link');
      if (!link.ok) {
        return res.status(400).json({ success: false, message: link.message, code: 'VALIDATION_ERROR' });
      }
      req.body.drive_link = link.value;
      delete req.body.driveLink;
    }
    if (req.body?.status !== undefined && !PRESENTATION_STATUSES.includes(req.body.status)) {
      return res.status(400).json({
        success: false, message: `Status must be one of: ${PRESENTATION_STATUSES.join(', ')}.`, code: 'VALIDATION_ERROR',
        errors: [{ field: 'status', code: 'INVALID', message: PRESENTATION_STATUSES.join(', ') }],
      });
    }
    const updated = await presentationService.updatePresentation(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Presentation not found' });
    }
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

const deletePresentation = async (req, res, next) => {
  try {
    const { id } = req.params;
    await presentationService.deletePresentation(id);
    res.status(200).json({ success: true, message: 'Presentation deleted successfully' });
  } catch (error) {
    next(error);
  }
};

const reorderPresentations = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const { order } = req.body;
    await presentationService.reorderPresentations(eventId, order);
    res.status(200).json({ success: true, message: 'Presentations reordered successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSettings,
  getPresentations,
  generatePresentations,
  createPresentation,
  updatePresentation,
  deletePresentation,
  reorderPresentations,
};
