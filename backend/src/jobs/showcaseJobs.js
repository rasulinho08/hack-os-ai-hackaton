/**
 * @file showcaseJobs.js
 * @description showcase.publish: a story the owner scheduled goes public at
 * its time (showcase.service.schedule). The public reads already show a
 * scheduled story once its time has come, so a late job only makes it
 * official: the story becomes 'published' and the audit trail says so.
 */

function register({ jobs }) {
  // eslint-disable-next-line global-require
  const showcase = require('../services/showcase.service');
  // eslint-disable-next-line global-require
  const audit = require('../services/audit.service');
  jobs.register(showcase.JOB_TYPE, async (payload) => {
    const done = await showcase.publishDue(payload.id, payload.at || null);
    if (!done) return;
    await audit.record(null, 'owner.showcase.publish_scheduled', {
      targetType: 'showcase_post',
      targetId: done.id,
      meta: { slug: done.slug, at: payload.at || null },
    });
  });
}

module.exports = { register };
