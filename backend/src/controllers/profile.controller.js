/**
 * @file profile.controller.js
 * @description A participant's record across events and their public profile.
 *
 *   GET  /api/me/hackathons            the signed-in person's events, roles, teams, projects, places, certificates
 *   GET  /api/me/public-profile        their public profile's switches (all off until they turn it on)
 *   PUT  /api/me/public-profile        { enabled?, indexable?, handle?, showName?, showEvents?, showProjects?, showCertificates?, headline?, hiddenEventIds? }
 *   GET  /api/public/profiles/sitemap  the handles their owners let search engines find
 *   GET  /api/public/profiles/:handle  what /u/<handle> shows; 404 unless switched on
 */

const profiles = require('../services/profile.service');
const audit = require('../services/audit.service');
const { successResponse, errorFromException, httpError } = require('../utils/responseFormat');
const { HTTP } = require('../constants/httpStatus');

const wrap = (fn) => async (req, res, next) => {
  try {
    return await fn(req, res);
  } catch (err) {
    return errorFromException(res, next, err);
  }
};

const mine = wrap(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return successResponse(res, HTTP.OK, 'OK', await profiles.myHackathons(req.user.id));
});

const getSettings = wrap(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  return successResponse(res, HTTP.OK, 'OK', await profiles.settings(req.user));
});

const saveSettings = wrap(async (req, res) => {
  const before = await profiles.settings(req.user);
  const out = await profiles.saveSettings(req.user, req.body);
  if (before.enabled !== out.enabled) {
    await audit.record(req, out.enabled ? 'profile.published' : 'profile.unpublished', { targetType: 'user', targetId: req.user.id, meta: { handle: out.handle } });
  }
  if (before.indexable !== out.indexable) {
    await audit.record(req, out.indexable ? 'profile.indexable' : 'profile.noindex', { targetType: 'user', targetId: req.user.id, meta: { handle: out.handle } });
  }
  return successResponse(res, HTTP.OK, 'Saved', out);
});

const publicView = wrap(async (req, res) => {
  const data = await profiles.publicProfile(req.params.handle);
  if (!data) throw httpError(404, 'No public profile at this address.', 'NOT_FOUND');
  // Short: a person who switches the page off expects it gone soon.
  res.setHeader('Cache-Control', 'public, max-age=60');
  return successResponse(res, HTTP.OK, 'OK', data);
});

const sitemap = wrap(async (req, res) => {
  // Short, like the page: switching it off takes the profile out quickly.
  res.setHeader('Cache-Control', 'public, max-age=60');
  return successResponse(res, HTTP.OK, 'OK', await profiles.sitemapEntries());
});

module.exports = { mine, getSettings, saveSettings, publicView, sitemap };
