/**
 * @file webhookJobs.js
 * @description Outgoing webhooks in the background (webhook.service.js).
 *
 *   planner          on each pass, turn what happened (webhook_outbox) into
 *                    deliveries; every few minutes pick up attempts a restart
 *                    cut short; hourly, delete deliveries older than 30 days
 *   webhook.deliver  one attempt at one delivery (a retry is a new job)
 */

const webhooks = require('../services/webhook.service');

/** Outbox batches one pass works through before the queue gets its turn. */
const BATCHES_PER_PASS = 5;

function register({ jobs, addPlanner }) {
  jobs.register('webhook.deliver', (payload) => webhooks.deliverJob(payload));

  let lastRecover = 0;
  let lastPrune = 0;
  addPlanner(async () => {
    for (let i = 0; i < BATCHES_PER_PASS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { processed } = await webhooks.processOutbox({ limit: 200 });
      if (processed < 200) break;
    }
    if (Date.now() - lastRecover > 5 * 60e3) {
      lastRecover = Date.now();
      await webhooks.recover();
    }
    if (Date.now() - lastPrune > 3600e3) {
      lastPrune = Date.now();
      await webhooks.prune();
    }
  });
}

module.exports = { register };
