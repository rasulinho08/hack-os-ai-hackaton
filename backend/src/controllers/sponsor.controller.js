/**
 * @file sponsor.controller.js
 * @description HTTP handlers for event sponsor management.
 */

const sponsorService = require('../services/sponsor.service');
const { successResponse, errorResponse } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');
const { validateDisplayName, validateOptionalUrl } = require('../validations/common');

const TIERS = ['platinum', 'gold', 'silver', 'bronze', 'partner', 'community'];

/**
 * Sponsor `website` and `logo` are rendered as links and image sources in the
 * dashboard and in outbound e-mail, so they are checked here rather than
 * trusted. Both are optional.
 */
function readSponsorBody(body = {}) {
  const name = validateDisplayName(body.name, 'Sponsor name', { min: 2, max: 255 });
  if (!name.ok) return name;

  const website = validateOptionalUrl(body.website, 'Sponsor website');
  if (!website.ok) return website;

  const logo = validateOptionalUrl(body.logo, 'Sponsor logo URL');
  if (!logo.ok) return logo;

  let tier = body.tier == null ? null : String(body.tier).trim().toLowerCase();
  if (tier === '') tier = null;
  if (tier && !TIERS.includes(tier)) {
    return { ok: false, message: `tier must be one of: ${TIERS.join(', ')}` };
  }

  return { ok: true, value: { name: name.value, website: website.value, logo: logo.value, tier } };
}

const getSponsors = async (req, res, next) => {
  try {
    const sponsors = await sponsorService.getSponsors(req.params.eventId);
    return successResponse(res, HTTP.OK, 'OK', sponsors);
  } catch (error) {
    next(error);
  }
};

const createSponsor = async (req, res, next) => {
  try {
    const parsed = readSponsorBody(req.body);
    if (!parsed.ok) {
      return errorResponse(res, HTTP.BAD_REQUEST, parsed.message, null, 'VALIDATION_ERROR');
    }
    const sponsor = await sponsorService.createSponsor(req.params.eventId, parsed.value);
    return successResponse(res, HTTP.CREATED, 'Sponsor added', sponsor);
  } catch (error) {
    next(error);
  }
};

const updateSponsor = async (req, res, next) => {
  try {
    const parsed = readSponsorBody(req.body);
    if (!parsed.ok) {
      return errorResponse(res, HTTP.BAD_REQUEST, parsed.message, null, 'VALIDATION_ERROR');
    }
    const updated = await sponsorService.updateSponsor(req.params.id, parsed.value);
    if (!updated) return errorResponse(res, HTTP.NOT_FOUND, 'Sponsor not found');
    return successResponse(res, HTTP.OK, 'Sponsor updated', updated);
  } catch (error) {
    next(error);
  }
};

const deleteSponsor = async (req, res, next) => {
  try {
    await sponsorService.deleteSponsor(req.params.id);
    return successResponse(res, HTTP.OK, 'Sponsor deleted successfully');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getSponsors,
  createSponsor,
  updateSponsor,
  deleteSponsor,
};
