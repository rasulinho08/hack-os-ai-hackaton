/**
 * @file announcementJobs.js
 * @description Background jobs of announcements.
 *
 *   announcement.publish    a scheduled announcement's moment has come (or one
 *                           was just sent): make it visible, plan its e-mails
 *                           and Telegram messages
 *   announcement.deliver    one batch of one channel's deliveries
 *   announcement.sync_post  an edited announcement's channel post follows it
 *   announcement.retract    a deleted announcement's channel post comes down
 *
 * Planners (every pass, each throttled to once a minute): automatic
 * announcements that have become due, and scheduled announcements whose
 * job went missing.
 */

const db = require('../config/db');
const announcementService = require('../services/announcement.service');
const delivery = require('../services/announcementDelivery');
const autoPlanner = require('../services/autoAnnouncementPlanner');

const publishKey = (a) => `ann:${a.id}:publish:${a.scheduled_at ? new Date(a.scheduled_at).getTime() : 'now'}`;

let lastSweep = 0;

function register({ jobs, addPlanner }) {
  jobs.register('announcement.publish', async ({ announcementId }) => {
    const a = await announcementService.getById(announcementId);
    if (!a || a.status === 'cancelled') return;
    if (a.status === 'scheduled') {
      // Moved later since this job was queued: the job for the new time publishes it.
      if (a.scheduled_at && new Date(a.scheduled_at).getTime() > Date.now() + 5000) return;
      if (!(await announcementService.markSent(a.id))) return;
    }
    await delivery.plan(a.id);
    await delivery.notifyInApp(a.id);
  });
  jobs.register('announcement.deliver', (payload) => delivery.deliverBatch(payload));
  jobs.register('announcement.sync_post', (payload) => delivery.syncChannelPost(payload));
  jobs.register('announcement.retract', (payload) => delivery.retractPosts(payload));

  addPlanner(() => autoPlanner.planDue());
  // A scheduled announcement past its time with no job (lost, pruned) is published anyway.
  addPlanner(async () => {
    if (Date.now() - lastSweep < 60e3) return;
    lastSweep = Date.now();
    const overdue = await db.query(
      `SELECT id, scheduled_at FROM announcements
        WHERE status = 'scheduled' AND scheduled_at <= now() - interval '1 minute'
        ORDER BY scheduled_at LIMIT 50`,
    );
    for (const a of overdue.rows) {
      // eslint-disable-next-line no-await-in-loop
      await jobs.enqueue('announcement.publish', { announcementId: a.id }, { dedupeKey: publishKey(a) });
    }
  });
}

module.exports = { register, publishKey };
