/**
 * @file track.controller.js
 * @description HTTP handlers for hackathon track management.
 */

const trackService = require('../services/track.service');

const getTracks = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const tracks = await trackService.getTracks(eventId);
    res.status(200).json({ success: true, data: tracks });
  } catch (error) {
    next(error);
  }
};

const createTrack = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const track = await trackService.createTrack(eventId, req.body);
    res.status(201).json({ success: true, data: track });
  } catch (error) {
    next(error);
  }
};

const updateTrack = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await trackService.updateTrack(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Track not found' });
    }
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

const deleteTrack = async (req, res, next) => {
  try {
    const { id } = req.params;
    await trackService.deleteTrack(id);
    res.status(200).json({ success: true, message: 'Track deleted successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTracks,
  createTrack,
  updateTrack,
  deleteTrack,
};
