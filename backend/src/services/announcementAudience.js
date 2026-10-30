/**
 * @file announcementAudience.js
 * @description Who an announcement is for.
 *
 * An organiser picks one audience; the same rule decides who sees it in the
 * app and who gets it by e-mail or Telegram, so the two never disagree.
 *
 *   everyone       every participant who was not rejected, and the event's staff
 *   attendees      approved participants and the event's staff (the people
 *                  who took part: the gallery's link goes to them)
 *   participants   approved participants (still competing)
 *   waiting        participants waiting for approval or on the waiting list
 *   no_team        approved participants without a team
 *   no_submission  approved participants whose team has not submitted
 *   track          approved participants whose team is in one track
 *   staff          judges, mentors and volunteers
 *   judges, mentors, volunteers
 *
 * Organisers always see every announcement of their event (with its delivery
 * report); they are not recipients.
 */

const db = require('../config/db');

const AUDIENCES = Object.freeze([
  'everyone', 'attendees', 'participants', 'waiting', 'no_team', 'no_submission', 'track',
  'staff', 'judges', 'mentors', 'volunteers',
]);

const STAFF_SQL = `SELECT user_id FROM judges WHERE event_id = $1
  UNION SELECT user_id FROM mentor_assignments WHERE event_id = $1
  UNION SELECT user_id FROM volunteers WHERE event_id = $1`;
const APPROVED_SQL = `SELECT p.user_id FROM participants p
  WHERE p.event_id = $1 AND LOWER(TRIM(p.status)) = 'approved'`;
const IN_TEAM_SQL = `SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id
  WHERE t.event_id = $1 AND tm.user_id = p.user_id`;

const RECIPIENTS = {
  everyone: `SELECT p.user_id FROM participants p
    WHERE p.event_id = $1 AND LOWER(TRIM(p.status)) <> 'rejected'
    UNION ${STAFF_SQL}`,
  attendees: `${APPROVED_SQL} UNION ${STAFF_SQL}`,
  participants: APPROVED_SQL,
  waiting: `SELECT p.user_id FROM participants p
    WHERE p.event_id = $1 AND LOWER(TRIM(p.status)) IN ('pending', 'waitlisted')`,
  no_team: `${APPROVED_SQL} AND NOT EXISTS (${IN_TEAM_SQL})`,
  no_submission: `${APPROVED_SQL} AND NOT EXISTS (${IN_TEAM_SQL}
    AND EXISTS (SELECT 1 FROM submissions s WHERE s.team_id = t.id AND s.event_id = $1))`,
  track: `${APPROVED_SQL} AND EXISTS (${IN_TEAM_SQL} AND t.track_id = $2)`,
  staff: STAFF_SQL,
  judges: 'SELECT user_id FROM judges WHERE event_id = $1',
  mentors: 'SELECT user_id FROM mentor_assignments WHERE event_id = $1',
  volunteers: 'SELECT user_id FROM volunteers WHERE event_id = $1',
};

/**
 * The user ids an audience covers, as SQL with its parameters ($1 event,
 * $2 track for `track`), for use inside a larger statement.
 */
function recipients(audience, eventId, trackId = null) {
  const sql = RECIPIENTS[audience] || RECIPIENTS.everyone;
  const params = audience === 'track' ? [eventId, trackId] : [eventId];
  return { sql: `SELECT DISTINCT user_id FROM (${sql}) aud`, params };
}

/** How many people an audience reaches right now (the composer shows it). */
async function countRecipients(audience, eventId, trackId = null) {
  if (audience === 'track' && !trackId) return 0;
  const { sql, params } = recipients(audience, eventId, trackId);
  const r = await db.query(`SELECT COUNT(*)::int AS n FROM (${sql}) x`, params);
  return r.rows[0].n;
}

/**
 * The audiences one person belongs to in one event, and their team's track.
 * @returns {Promise<{ segments: string[], trackId: number|null }>}
 */
async function segmentsFor(userId, eventId) {
  const r = await db.query(
    `SELECT
       (SELECT LOWER(TRIM(status)) FROM participants WHERE event_id = $1 AND user_id = $2 LIMIT 1) AS pstatus,
       t.id AS team_id, t.track_id,
       EXISTS (SELECT 1 FROM submissions s WHERE s.team_id = t.id AND s.event_id = $1) AS submitted,
       EXISTS (SELECT 1 FROM judges WHERE event_id = $1 AND user_id = $2) AS judge,
       EXISTS (SELECT 1 FROM mentor_assignments WHERE event_id = $1 AND user_id = $2) AS mentor,
       EXISTS (SELECT 1 FROM volunteers WHERE event_id = $1 AND user_id = $2) AS volunteer
       FROM (SELECT 1) one
       LEFT JOIN LATERAL (
         SELECT t.id, t.track_id FROM team_members tm JOIN teams t ON t.id = tm.team_id
          WHERE t.event_id = $1 AND tm.user_id = $2 LIMIT 1) t ON true`,
    [eventId, userId],
  );
  const row = r.rows[0] || {};
  const s = new Set();
  const staff = row.judge || row.mentor || row.volunteer;
  const approved = row.pstatus === 'approved';
  if ((row.pstatus && row.pstatus !== 'rejected') || staff) s.add('everyone');
  if (approved || staff) s.add('attendees');
  if (approved) s.add('participants');
  if (row.pstatus === 'pending' || row.pstatus === 'waitlisted') s.add('waiting');
  if (approved && !row.team_id) s.add('no_team');
  if (approved && !row.submitted) s.add('no_submission');
  if (staff) s.add('staff');
  if (row.judge) s.add('judges');
  if (row.mentor) s.add('mentors');
  if (row.volunteer) s.add('volunteers');
  return { segments: [...s], trackId: approved && row.track_id ? Number(row.track_id) : null };
}

module.exports = { AUDIENCES, recipients, countRecipients, segmentsFor };
