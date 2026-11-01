/**
 * @file repoJobs.js
 * @description The GitHub check in the background (services/repoCheck.service.js).
 *
 *   repo.check   check one project's repository; GitHub not answering (or
 *                the rate limit) is retried, and after the last attempt the
 *                project shows "could not check" with the reason
 *
 * Planner (every ten minutes): for events with the check switched on, once
 * projects are in, every GitHub project not checked since it last changed.
 */

const SWEEP_EVERY_MS = 10 * 60e3;
let lastSweep = 0;

function register({ jobs, addPlanner }) {
  jobs.register('repo.check', async ({ submissionId }, job) => {
    // eslint-disable-next-line global-require
    const repoCheck = require('../services/repoCheck.service');
    try {
      await repoCheck.checkSubmission(submissionId);
    } catch (err) {
      if (!(err instanceof repoCheck.RetryLater)) throw err;
      if (job && job.attempts >= job.max_attempts) {
        // eslint-disable-next-line global-require
        await require('../config/db').query(
          `INSERT INTO submission_repo_checks (submission_id, status, error, checked_at) VALUES ($1, 'error', $2, now())
           ON CONFLICT (submission_id) DO UPDATE SET status = 'error', error = EXCLUDED.error, checked_at = now()`,
          [submissionId, err.message.slice(0, 300)],
        );
        return;
      }
      throw err;
    }
  });

  addPlanner(async () => {
    if (Date.now() - lastSweep < SWEEP_EVERY_MS) return;
    lastSweep = Date.now();
    // eslint-disable-next-line global-require
    const ids = await require('../services/repoCheck.service').dueChecks();
    const hour = Math.floor(Date.now() / 3600e3);
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      await jobs.enqueue('repo.check', { submissionId: id }, { dedupeKey: `repo-auto:${id}:${hour}`, maxAttempts: 4 });
    }
  });
}

module.exports = { register };
