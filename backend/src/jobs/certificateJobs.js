/**
 * @file certificateJobs.js
 * @description Certificates in the background.
 *
 *   certificates.issue  issue every kind the organiser chose (after results
 *                       are published, when "issue after results" is on),
 *                       e-mail each new one and post the "certificates are
 *                       ready" announcement; `source: 'results'` marks them
 *                       as the publication's, and does nothing once the
 *                       results were unpublished before the job ran
 *   certificate.email   send one certificate's link to its holder
 */

const db = require('../config/db');
const emailService = require('../services/email.service');
const { eventSender } = require('../services/eventSender');

function register({ jobs }) {
  jobs.register('certificates.issue', async ({ eventId, source = null }, job) => {
    // eslint-disable-next-line global-require
    const certificates = require('../services/certificate.service');
    const published = async () => Boolean((await db.query('SELECT results_published_at FROM events WHERE id = $1', [eventId])).rows[0]?.results_published_at);
    if (source === 'results' && !(await published())) return;
    const out = await certificates.issue(eventId, { source });
    // Unpublished while this ran: what it issued after the revocation goes too.
    if (source === 'results' && !(await published())) {
      await certificates.revokeForUnpublish(eventId);
      return;
    }
    // Each certificate is saved as it is issued, so a retry after a failure
    // further on (its e-mail not queued yet) finds nothing new to issue; it
    // still queues what is unsent. Both steps are safe to repeat: the e-mail
    // jobs are deduplicated and the announcement goes out once per event.
    if (out.issued > 0 || (job && job.attempts > 1)) {
      await certificates.queueEmails(eventId, null, jobs);
      try {
        // eslint-disable-next-line global-require
        await require('../services/autoAnnouncementPlanner').trigger(eventId, 'certs');
      } catch (err) {
        console.warn('[certificates] announcement not queued:', err.message);
      }
    }
  });

  jobs.register('certificate.email', async ({ certificateId }) => {
    const r = await db.query(
      `SELECT c.id, c.code, c.recipient_name, c.revoked_at, u.email, e.id AS event_id, e.name AS event_name, e.language
         FROM certificates c JOIN users u ON u.id = c.user_id JOIN events e ON e.id = c.event_id
        WHERE c.id = $1`,
      [certificateId],
    );
    const c = r.rows[0];
    if (!c || c.revoked_at || !c.email) return;
    // eslint-disable-next-line global-require
    const { verifyUrl } = require('../services/certificate.service');
    const out = await emailService.sendCertificateEmail({
      to: c.email,
      fullName: c.recipient_name,
      eventName: c.event_name,
      code: c.code,
      url: verifyUrl(c.code),
      lang: c.language,
      sender: await eventSender(c.event_id),
    });
    if (out && out.ok === false) {
      // A bad address will not get better; a missing provider or a refusal may.
      if (out.status === 400) throw new jobs.PermanentJobError(out.message || 'invalid recipient');
      throw new Error(out.message || 'certificate e-mail failed');
    }
    await db.query('UPDATE certificates SET emailed_at = now() WHERE id = $1', [c.id]);
  });
}

module.exports = { register };
