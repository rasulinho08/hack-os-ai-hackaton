/**
 * @file feedback.controller.js
 * @description Participant feedback and the recommendation question (NPS).
 *
 *   GET    /api/events/:eventId/feedback            organiser: written feedback
 *   GET    /api/events/:eventId/feedback/mine       one's own written feedback
 *   POST   /api/events/:eventId/feedback            { rating 1–5, comment, type }
 *   DELETE /api/events/:eventId/feedback/:id        organiser
 *   GET    /api/events/:eventId/feedback/nps        organiser: score, spread, comments (no names)
 *   GET    /api/events/:eventId/feedback/nps/mine   participant: can they answer, their answer
 *   POST   /api/events/:eventId/feedback/nps        participant: { score 0–10, comment? }
 */

const feedbackService = require('../services/feedback.service');
const { successResponse, errorFromException } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const getFeedback = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const feedback = await feedbackService.getFeedback(eventId);
    res.status(200).json({ success: true, data: feedback });
  } catch (error) {
    next(error);
  }
};

const getMyFeedback = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;
    const feedback = await feedbackService.getMyFeedback(eventId, userId);
    res.status(200).json({ success: true, data: feedback });
  } catch (error) {
    next(error);
  }
};

const createFeedback = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;
    const feedback = await feedbackService.createFeedback(eventId, userId, req.body);
    return res.status(201).json({ success: true, data: feedback });
  } catch (error) {
    return errorFromException(res, next, error);
  }
};

const npsSummary = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await feedbackService.npsSummary(Number(req.params.eventId)));
  } catch (error) { return errorFromException(res, next, error); }
};

const myNps = async (req, res, next) => {
  try {
    return successResponse(res, HTTP.OK, 'OK', await feedbackService.npsState(Number(req.params.eventId), req.user.id));
  } catch (error) { return errorFromException(res, next, error); }
};

const saveNps = async (req, res, next) => {
  try {
    const out = await feedbackService.saveNps(Number(req.params.eventId), req.user.id, req.body || {});
    return successResponse(res, HTTP.OK, 'Thank you', out);
  } catch (error) { return errorFromException(res, next, error); }
};

const deleteFeedback = async (req, res, next) => {
  try {
    const { id } = req.params;
    await feedbackService.deleteFeedback(id);
    res.status(200).json({ success: true, message: 'Feedback deleted successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getFeedback,
  getMyFeedback,
  createFeedback,
  deleteFeedback,
  npsSummary,
  myNps,
  saveNps,
};
