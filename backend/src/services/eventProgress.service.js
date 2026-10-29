/**
 * @file eventProgress.service.js
 * @description Where a participant stands in their event, and what to do next.
 *
 * The event's own timeline (builder → Schedule) and the person's state —
 * admitted or not, in a team or not, project handed in or not — become six
 * stages (registration, team, hacking, submission, judging, results), each
 * done, current, upcoming, skipped or missed, plus one next step the
 * participant dashboard words in the reader's language.
 */

const db = require('../config/db');

const ms = (v) => (v ? new Date(v).getTime() : null);

/**
 * @param {number} userId
 * @param {number} eventId
 * @param {number} [now]
 * @returns {Promise<null | { eventId, participantStatus, stages: Array, next: { code, at?, href? }, team, submitted }>}
 *   null when the person is not a participant of the event.
 */
async function progressFor(userId, eventId, now = Date.now()) {
  const r = await db.query(
    `SELECT e.id, e.name, e.registration_mode, e.registration_end, e.team_deadline, e.start_date, e.end_date,
            e.submission_deadline, e.judging_start, e.judging_end, e.demo_day, e.results_at, e.results_published_at,
            e.allow_team_formation, e.allow_late_submissions,
            LOWER(TRIM(COALESCE(p.status::text, 'pending'))) AS participant_status, p.registered_at,
            t.id AS team_id, t.name AS team_name, LOWER(COALESCE(t.status::text, '')) AS team_status,
            CASE WHEN t.id IS NULL THEN NULL
                 ELSE COALESCE(t.leader_id = p.user_id, false) OR COALESCE(tm.is_leader, false) END AS is_leader,
            (SELECT COUNT(*)::int FROM team_members x WHERE x.team_id = t.id) AS team_size,
            s.id AS submission_id
       FROM events e
       JOIN participants p ON p.event_id = e.id AND p.user_id = $1
       LEFT JOIN team_members tm ON tm.user_id = $1
                                AND tm.team_id IN (SELECT id FROM teams WHERE event_id = e.id)
       LEFT JOIN teams t ON t.id = tm.team_id
       LEFT JOIN submissions s ON s.team_id = t.id AND s.event_id = e.id
      WHERE e.id = $2
      LIMIT 1`,
    [userId, eventId],
  );
  return r.rows[0] ? compute(r.rows[0], now) : null;
}

/** The stages and next step for one participant row (see progressFor's query). */
function compute(e, now = Date.now()) {
  const status = e.participant_status;
  const admitted = status === 'approved' || status === 'eliminated';
  const eliminated = status === 'eliminated' || e.team_status === 'eliminated';
  const inTeam = Boolean(e.team_id);
  const submitted = Boolean(e.submission_id);

  const start = ms(e.start_date);
  const end = ms(e.end_date);
  const subClose = ms(e.submission_deadline) || end;
  const teamClose = ms(e.team_deadline) || start;
  const judgingStart = ms(e.judging_start) || ms(e.demo_day) || subClose;
  const judgingEnd = ms(e.judging_end) || ms(e.results_at) || (judgingStart ? judgingStart + 6 * 3600e3 : null);
  const results = ms(e.results_at);

  const formationOpen = e.allow_team_formation !== false && (teamClose == null || now < teamClose);
  const hackingOpen = start != null && now >= start && (subClose == null || now <= subClose || e.allow_late_submissions);

  const stage = (key, state, at = null, until = null) => ({ key, state, at, until });
  const iso = (v) => (v ? new Date(v).toISOString() : null);

  const registration = stage(
    'registration',
    admitted ? 'done' : status === 'rejected' ? 'missed' : 'current',
    null,
    iso(e.registration_end),
  );

  let teamState;
  if (inTeam) teamState = 'done';
  else if (e.registration_mode === 'solo') teamState = 'skipped';
  else if (!admitted) teamState = 'upcoming';
  else if (formationOpen) teamState = 'current';
  else teamState = 'skipped';
  const team = stage('team', teamState, null, iso(teamClose));

  let hackState = 'upcoming';
  if (start != null && now >= start) hackState = subClose != null && now > subClose ? 'done' : 'current';
  const hacking = stage('hacking', hackState, iso(start), iso(subClose));

  let subState = 'upcoming';
  if (submitted) subState = 'done';
  else if (hackingOpen) subState = 'current';
  else if (subClose != null && now > subClose) subState = 'missed';
  const submission = stage('submission', subState, iso(start), iso(subClose));

  let judgeState = 'upcoming';
  if (judgingStart != null && now >= judgingStart) judgeState = judgingEnd != null && now > judgingEnd ? 'done' : 'current';
  const judging = stage('judging', judgeState, iso(judgingStart), iso(judgingEnd));

  // Results are there once the organiser publishes them; the planned date
  // only says when to expect them.
  const published = ms(e.results_published_at);
  const resultsStage = stage('results', published != null ? 'current' : 'upcoming', iso(published ?? results));
  if (published != null && judging.state !== 'done') judging.state = 'done';

  // One next step, in the order a participant meets them.
  let next;
  if (eliminated) next = { code: 'eliminated', href: '/hacker/eliminated' };
  else if (status === 'rejected') next = { code: 'rejected' };
  else if (status === 'waitlisted') next = { code: 'waitlisted' };
  else if (!admitted) next = { code: 'wait_approval' };
  else if (teamState === 'current') next = { code: 'find_team', at: iso(teamClose), href: '/hacker/lobby' };
  else if (start != null && now < start) next = { code: 'wait_start', at: iso(start) };
  else if (subState === 'current' && !submitted) {
    next = inTeam && e.is_leader === false
      ? { code: 'lead_submits', at: iso(subClose), href: '/hacker/submit' }
      : { code: 'submit', at: iso(subClose), href: '/hacker/submit' };
  } else if (submitted && hackingOpen) next = { code: 'update_submission', at: iso(subClose), href: '/hacker/submit' };
  else if (resultsStage.state === 'current') next = { code: 'see_results', href: '/hacker/results' };
  else if (ms(e.demo_day) != null && now < ms(e.demo_day) && submitted) next = { code: 'prepare_pitch', at: iso(e.demo_day) };
  else if (subState === 'missed') next = { code: 'missed_submission' };
  else next = { code: 'wait_results', at: iso(results) };

  return {
    eventId: e.id,
    // For the "your registration is in review" screen: which event, since when.
    eventName: e.name || null,
    registeredAt: e.registered_at || null,
    participantStatus: status,
    registrationMode: e.registration_mode || null,
    team: inTeam ? { id: e.team_id, name: e.team_name, size: e.team_size, isLead: Boolean(e.is_leader) } : null,
    submitted,
    stages: [registration, team, hacking, submission, judging, resultsStage],
    next,
  };
}

module.exports = { progressFor, compute };
