/**
 * @file archiveJobs.js
 * @description Planner (hourly; ARCHIVE_EVERY_MS shortens it): published
 * events that ended more than 14 days ago are archived (decision E13) and
 * become read-only. See services/eventArchive.service.js. AUTO_ARCHIVE=off
 * leaves archiving to the organisers.
 */

const SWEEP_EVERY_MS = Number(process.env.ARCHIVE_EVERY_MS) || 3600e3;
let lastSweep = 0;

function register({ addPlanner }) {
  if (['off', 'false', '0'].includes(String(process.env.AUTO_ARCHIVE || '').trim().toLowerCase())) return;
  addPlanner(async () => {
    if (Date.now() - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = Date.now();
    // eslint-disable-next-line global-require
    const ids = await require('../services/eventArchive.service').autoArchive();
    if (ids.length) console.log(`[archive] archived ${ids.length} event(s) 14 days after their end: ${ids.join(', ')}`);
  });
}

module.exports = { register };
