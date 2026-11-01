/**
 * @file jobs/index.js
 * @description Every kind of background job, registered in one place, and
 * the worker that runs them (started by server.js).
 *
 * On each pass the worker first plans what is due — automatic announcements
 * whose moment has come, waiting lists that can move up, help requests of
 * ended events to close, events to archive 14 days after their end — then
 * runs due jobs. Old finished jobs are pruned
 * hourly.
 */

const jobs = require('../services/jobs.service');

const PLANNERS = [];

/** Something to run before each pass (a planner that enqueues due work). */
function addPlanner(fn) { PLANNERS.push(fn); }

let registered = false;
function registerAll() {
  if (registered) return;
  registered = true;
  require('./announcementJobs').register({ jobs, addPlanner });
  require('./peopleJobs').register({ jobs, addPlanner });
  require('./ticketJobs').register({ jobs, addPlanner });
  require('./certificateJobs').register({ jobs, addPlanner });
  require('./archiveJobs').register({ jobs, addPlanner });
  require('./repoJobs').register({ jobs, addPlanner });
  require('./webhookJobs').register({ jobs, addPlanner });
  require('./showcaseJobs').register({ jobs, addPlanner });
}

function startWorker() {
  registerAll();
  let lastPrune = 0;
  return jobs.start({
    onTick: async () => {
      for (const plan of PLANNERS) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await plan();
        } catch (err) {
          console.error('[jobs] planner failed:', err.message);
        }
      }
      if (Date.now() - lastPrune > 3600e3) {
        lastPrune = Date.now();
        jobs.prune().catch((err) => console.error('[jobs] prune failed:', err.message));
        require('../services/telegramLink.service').prune()
          .catch((err) => console.error('[jobs] telegram prune failed:', err.message));
        require('../services/notification.service').prune()
          .catch((err) => console.error('[jobs] notification prune failed:', err.message));
      }
    },
  });
}

module.exports = { startWorker, registerAll, addPlanner };
