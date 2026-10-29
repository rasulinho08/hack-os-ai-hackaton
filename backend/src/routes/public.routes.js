const express = require('express');
const ctrl = require('../controllers/eventBuilder.controller');
const certificates = require('../controllers/certificate.controller');
const notifications = require('../controllers/notification.controller');
const showcase = require('../controllers/showcase.controller');
const profiles = require('../controllers/profile.controller');
const projects = require('../controllers/publicProjects.controller');
const platformStatus = require('../services/status.service');
const publicStats = require('../services/publicStats.service');
const directory = require('../services/directory.service');
const { optionalAuthMw } = require('../middlewares/authMw');
const { registerLimiter, lookupLimiter } = require('../middlewares/authRateLimit');

// Pages anyone can open: the event page and its registration, the check of
// a certificate by its code, the home page's figures and the stories from
// past hackathons.
const router = express.Router();

router.get('/events/:slug/calendar.ics', lookupLimiter, notifications.publicFeed);
router.get('/events/:slug', ctrl.publicEvent);
// The event's projects, once the organiser opened the page and the results are out.
// No lookup limiter: the address is the public event page's, nothing to guess,
// and the web server reads it for every visitor (all their misses would count
// against its one address, together with certificate checks).
router.get('/events/:slug/projects', projects.publicList);
router.post('/events/:slug/register', registerLimiter, optionalAuthMw, ctrl.register);
// A personal invitation's link, read by the registration page (only misses count).
router.get('/invitations/:token', lookupLimiter, require('../controllers/participantInvite.controller').preview);
// The owner's notice for every page (maintenance, an incident), or null.
router.get('/notice', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    // eslint-disable-next-line global-require
    return res.status(200).json({ success: true, data: await require('../services/platform.service').currentNotice() });
  } catch (error) { return next(error); }
});
// The home page's figures, counted from the database (kept ten minutes).
router.get('/stats', async (req, res, next) => {
  try {
    res.set('Cache-Control', `public, max-age=${Math.round(publicStats.TTL_MS / 1000)}`);
    return res.status(200).json({ success: true, data: await publicStats.stats() });
  } catch (error) { return next(error); }
});
// Is the platform up: API, database, background jobs, e-mail (kept 30 s; 503 when down).
router.get('/status', async (req, res, next) => {
  try {
    const data = await platformStatus.status();
    res.set('Cache-Control', `public, max-age=${Math.round(platformStatus.TTL_MS / 1000)}`);
    return res.status(data.status === 'down' ? 503 : 200).json({ success: true, data });
  } catch (error) { return next(error); }
});
// The directory of hackathons: published, public events their organiser left
// listed; a page at a time with the filters' counts (kept a minute).
router.get('/directory', async (req, res, next) => {
  try {
    res.set('Cache-Control', `public, max-age=${Math.round(directory.TTL_MS / 1000)}`);
    return res.status(200).json({ success: true, data: await directory.list(req.query) });
  } catch (error) { return next(error); }
});
// The listed events' addresses, for the site's sitemap.
router.get('/directory/slugs', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ success: true, data: await directory.slugs() });
  } catch (error) { return next(error); }
});
// Stories from past hackathons: the published ones only.
router.get('/showcase', showcase.publicList);
router.get('/showcase/:slug', showcase.publicDetail);
// A participant's public profile, when they switched it on (only the parts they chose).
// The profiles their owners let search engines find, for the site's sitemap.
router.get('/profiles/sitemap', profiles.sitemap);
router.get('/profiles/:handle', profiles.publicView);
router.get('/certificates/:code', lookupLimiter, certificates.publicView);
router.get('/certificates/:code/pdf', lookupLimiter, certificates.publicPdf);

module.exports = router;
