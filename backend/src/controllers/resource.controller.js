/**
 * @file resource.controller.js
 * @description HTTP handlers for event resources.
 */

const resourceService = require('../services/resource.service');
const { isAdminUser } = require('../utils/authz');
const { successResponse, errorResponse } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const getResources = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const rows = await resourceService.getResources(eventId, { includeHidden: isAdminUser(req.user) });
    return successResponse(res, HTTP.OK, 'OK', rows);
  } catch (error) {
    next(error);
  }
};

function isValidResourceUrl(v) {
  if (!v || !String(v).trim()) return true; // optional
  try {
    const u = new URL(String(v).trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

const addResource = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const { section, label, description, url, sort_order, visible_from } = req.body || {};
    if (!label || !String(label).trim()) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'label is required');
    }
    if (String(label).length > 255) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'label must be 255 characters or fewer');
    }
    if (url && !isValidResourceUrl(url)) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'url must be a valid http(s) URL');
    }
    const row = await resourceService.addResource(eventId, {
      section,
      label,
      description,
      url,
      sort_order,
      visible_from,
    });
    return successResponse(res, HTTP.CREATED, 'Resource added', row);
  } catch (error) {
    next(error);
  }
};

const updateResource = async (req, res, next) => {
  try {
    const { eventId, id } = req.params;
    const row = await resourceService.updateResource(eventId, id, req.body || {});
    if (!row) return errorResponse(res, HTTP.NOT_FOUND, 'Resource not found');
    return successResponse(res, HTTP.OK, 'Resource updated', row);
  } catch (error) {
    next(error);
  }
};

const deleteResource = async (req, res, next) => {
  try {
    const { eventId, id } = req.params;
    await resourceService.deleteResource(eventId, id);
    return successResponse(res, HTTP.OK, 'Resource deleted');
  } catch (error) {
    next(error);
  }
};

const bulkReplace = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const items = req.body?.items;
    if (!Array.isArray(items)) {
      return errorResponse(res, HTTP.BAD_REQUEST, 'items array is required');
    }
    const rows = await resourceService.bulkReplace(eventId, items);
    return successResponse(res, HTTP.OK, 'Resources saved', rows);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getResources,
  addResource,
  updateResource,
  deleteResource,
  bulkReplace,
};
