/**
 * @file setting.controller.js
 * @description HTTP handlers for event settings (key-value store).
 */

const settingService = require('../services/setting.service');

const getSettings = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const settings = await settingService.getSettings(eventId);
    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
};

const upsertSettings = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    await settingService.upsertSettings(eventId, req.body);
    res.status(200).json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    next(error);
  }
};

const deleteSetting = async (req, res, next) => {
  try {
    const { id } = req.params;
    await settingService.deleteSetting(id);
    res.status(200).json({ success: true, message: 'Setting deleted successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSettings,
  upsertSettings,
  deleteSetting,
};
