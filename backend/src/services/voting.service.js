/**
 * @file voting.service.js
 * @description People's choice (J1): when the organiser switches it on
 * (judging_config.peopleChoice), every admitted participant may vote for one
 * project of another team that is still in the event and has an approved
 * member (the rule judging and the ranking use). Voting opens when submissions
 * close, or at the organiser's own voting start, and closes when results are
 * published; a vote can be changed or withdrawn while it is
 * open. Participants never see the counts; the organiser does, and may give
 * a special prize to the favourite.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const judging = require('./judging.service');

/** off | not_open | open | closed (results published) | archived */
async function stateOf(eventId, now = Date.now()) {
  const r = await db.query(
    `SELECT id, status, archived_at, start_date, end_date, submission_deadline, results_published_at, judging_config
       FROM events WHERE id = $1`,
    [eventId],
  );
  const e = r.rows[0];
  if (!e) throw httpError(404, 'Event not found', 'NOT_FOUND');
  const enabled = Boolean(judging.config(e).peopleChoice);
  const opens = votingOpensAt(e);
  let state = 'open';
  if (!enabled) state = 'off';
  else if (judging.isArchived(e)) state = 'archived';
  else if (e.results_published_at) state = 'closed';
  else if (!opens || now < opens.getTime()) state = 'not_open';
  return { enabled, state, opensAt: opens ? opens.toISOString() : null };
}

/**
 * When people's choice opens: the organiser's voting start
 * (judging_config.votingStart), else when submissions close (the submission
 * deadline, else the end), so everyone votes on finished projects; an event
 * with neither opens at its start.
 */
function votingOpensAt(e) {
  const explicit = judging.config(e).votingStart;
  const at = explicit || e.submission_deadline || e.end_date || e.start_date;
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function participantOf(eventId, userId) {
  const r = await db.query(
    `SELECT LOWER(TRIM(p.status)) AS status,
            (SELECT tm.team_id FROM team_members tm JOIN teams t ON t.id = tm.team_id
              WHERE t.event_id = p.event_id AND tm.user_id = p.user_id LIMIT 1) AS team_id
       FROM participants p WHERE p.event_id = $1 AND p.user_id = $2`,
    [eventId, userId],
  );
  const p = r.rows[0];
  if (!p) return null;
  return { eligible: ['approved', 'eliminated'].includes(p.status), teamId: p.team_id ? Number(p.team_id) : null };
}

/** Projects of teams still in the event, optionally leaving one team out. */
async function candidates(eventId, excludeTeamId = null) {
  const r = await db.query(
    `SELECT s.id AS submission_id, s.project_name, s.description, s.repo_link, s.demo_link, s.video_link,
            t.id AS team_id, t.name AS team_name, tr.name AS track
       FROM submissions s
       JOIN teams t ON t.id = s.team_id
       LEFT JOIN tracks tr ON tr.id = COALESCE(s.track_id, t.track_id)
      WHERE s.event_id = $1 AND LOWER(COALESCE(t.status, 'active')) <> 'eliminated'
        AND ${judging.HAS_APPROVED_MEMBER('t')}
        AND ($2::int IS NULL OR t.id <> $2::int)
      ORDER BY LOWER(COALESCE(s.project_name, t.name)), s.id`,
    [eventId, excludeTeamId],
  );
  return r.rows.map((x) => ({
    submissionId: Number(x.submission_id),
    teamId: Number(x.team_id),
    teamName: x.team_name,
    projectName: x.project_name || null,
    description: x.description || null,
    repoLink: x.repo_link || null,
    demoLink: x.demo_link || null,
    videoLink: x.video_link || null,
    track: x.track || null,
  }));
}

/** What a participant sees: whether they can vote, the projects, their vote. */
async function mine(eventId, userId) {
  const st = await stateOf(eventId);
  if (!st.enabled) return { enabled: false, state: 'off', eligible: false, candidates: [], myVote: null };
  const p = await participantOf(eventId, userId);
  const eligible = Boolean(p && p.eligible);
  const vote = await db.query('SELECT submission_id FROM people_choice_votes WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
  return {
    enabled: true,
    state: st.state,
    opensAt: st.opensAt,
    eligible,
    candidates: eligible ? await candidates(eventId, p.teamId) : [],
    myVote: vote.rows[0] ? Number(vote.rows[0].submission_id) : null,
  };
}

const CLOSED = {
  off: [409, 'People\'s choice is not switched on for this event.', 'VOTING_OFF'],
  not_open: [409, 'Voting opens when the event starts.', 'VOTING_NOT_OPEN'],
  closed: [409, 'Voting closed when the results were published.', 'VOTING_CLOSED'],
  archived: [409, 'The event is archived.', 'EVENT_ARCHIVED'],
};

async function openFor(eventId, userId) {
  const st = await stateOf(eventId);
  if (st.state !== 'open') throw httpError(...CLOSED[st.state]);
  const p = await participantOf(eventId, userId);
  if (!p || !p.eligible) throw httpError(403, 'Only participants of the event can vote.', 'NOT_PARTICIPANT');
  return p;
}

async function vote(eventId, userId, submissionId) {
  const id = Number(submissionId);
  if (!Number.isInteger(id) || id <= 0) {
    throw httpError(400, 'Choose a project.', 'VALIDATION_ERROR', { errors: [{ field: 'submissionId', code: 'REQUIRED', message: 'Required.' }] });
  }
  const p = await openFor(eventId, userId);
  const s = await db.query(
    `SELECT s.id, s.team_id, LOWER(COALESCE(t.status, 'active')) AS team_status,
            ${judging.HAS_APPROVED_MEMBER('t')} AS eligible
       FROM submissions s JOIN teams t ON t.id = s.team_id WHERE s.id = $1 AND s.event_id = $2`,
    [id, eventId],
  );
  const sub = s.rows[0];
  if (!sub) throw httpError(404, 'Project not found', 'NOT_FOUND');
  if (p.teamId && Number(sub.team_id) === p.teamId) throw httpError(409, 'You cannot vote for your own team.', 'OWN_TEAM');
  if (sub.team_status === 'eliminated') throw httpError(409, 'This team is out of the event.', 'TEAM_ELIMINATED');
  if (!sub.eligible) throw httpError(409, 'No member of this team has been accepted to the event.', 'TEAM_NOT_ELIGIBLE');
  await db.query(
    `INSERT INTO people_choice_votes (event_id, user_id, submission_id) VALUES ($1, $2, $3)
     ON CONFLICT (event_id, user_id) DO UPDATE SET submission_id = EXCLUDED.submission_id, updated_at = now()`,
    [eventId, userId, id],
  );
  return { myVote: id };
}

async function withdraw(eventId, userId) {
  await openFor(eventId, userId);
  await db.query('DELETE FROM people_choice_votes WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
  return { myVote: null };
}

/** The organiser's count: votes per project, most first; votes for eliminated or ineligible teams are left out. */
async function tally(eventId) {
  const st = await stateOf(eventId);
  const [list, counts, eligible] = await Promise.all([
    candidates(eventId),
    db.query('SELECT submission_id, COUNT(*)::int AS n FROM people_choice_votes WHERE event_id = $1 GROUP BY submission_id', [eventId]),
    db.query("SELECT COUNT(*)::int AS n FROM participants WHERE event_id = $1 AND LOWER(TRIM(status)) IN ('approved', 'eliminated')", [eventId]),
  ]);
  const by = new Map(counts.rows.map((r) => [Number(r.submission_id), r.n]));
  const rows = list.map((c) => ({ ...c, votes: by.get(c.submissionId) || 0 }));
  const voters = rows.reduce((s, r) => s + r.votes, 0);
  rows.sort((a, b) => b.votes - a.votes || String(a.projectName || a.teamName).localeCompare(String(b.projectName || b.teamName)));
  return {
    enabled: st.enabled,
    state: st.state,
    eligible: eligible.rows[0].n,
    voters,
    tally: rows.map((r) => ({
      submissionId: r.submissionId, teamId: r.teamId, teamName: r.teamName, projectName: r.projectName, track: r.track,
      votes: r.votes, share: voters ? Math.round((r.votes / voters) * 1000) / 10 : 0,
    })),
  };
}

module.exports = { stateOf, mine, vote, withdraw, tally };
