/**
 * @file prize.controller.js
 * @description HTTP handlers for hackathon prize management.
 */

const prizeService = require('../services/prize.service');

const getPrizes = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const prizes = await prizeService.getPrizes(eventId);
    res.status(200).json({ success: true, data: prizes });
  } catch (error) {
    next(error);
  }
};

const createPrize = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const prize = await prizeService.createPrize(eventId, req.body);
    res.status(201).json({ success: true, data: prize });
  } catch (error) {
    next(error);
  }
};

const updatePrize = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await prizeService.updatePrize(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Prize not found' });
    }
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

const deletePrize = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prizeService.deletePrize(id);
    res.status(200).json({ success: true, message: 'Prize deleted successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPrizes,
  createPrize,
  updatePrize,
  deletePrize,
};
