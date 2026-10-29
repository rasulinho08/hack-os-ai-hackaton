/**
 * @file elimination.service.js
 * @description Elimination in named rounds ("Round 1 — top 10 go on").
 *
 * The organiser makes a round, picks the teams that leave (the live ranking
 * suggests them), and gives a reason. Those teams' admitted members see the
 * elimination page — and only that page changes (decision E9): no automatic
 * announcement. Eliminated teams are not judged or ranked any more; a team
 * can be brought back.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const teamService = require('./team.service');
const judging = require('./judging.service');

async function writableEvent(eventId) {
  const event = await judging.loadEvent(eventId);
  if (judging.isArchived(event)) throw httpError(409, 'The event is archived.', 'EVENT_ARCHIVED');
  return event;
}

/** Rounds in order, each with the teams it eliminated, and teams eliminated outside rounds. */
async function listRounds(eventId) {
  const [rounds, teams] = await Promise.all([
    db.query(
      'SELECT id, name, note, position, created_at FROM elimination_rounds WHERE event_id = $1 ORDER BY position, id',
      [eventId],
    ),
    db.query(
      `SELECT t.id, t.name, t.elimination_reason, t.eliminated_at, t.eliminated_round_id,
              (SELECT COUNT(*)::int FROM team_members tm WHERE tm.team_id = t.id) AS members
         FROM teams t WHERE t.event_id = $1 AND LOWER(COALESCE(t.status, 'active')) = 'eliminated'
        ORDER BY t.eliminated_at DESC NULLS LAST, t.id`,
      [eventId],
    ),
  ]);
  const view = (t) => ({
    teamId: Number(t.id), teamName: t.name, reason: t.elimination_reason, eliminatedAt: t.eliminated_at, members: t.members,
  });
  return {
    rounds: rounds.rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      note: r.note,
      position: r.position,
      createdAt: r.created_at,
      teams: teams.rows.filter((t) => Number(t.eliminated_round_id) === Number(r.id)).map(view),
    })),
    outsideRounds: teams.rows.filter((t) => !t.eliminated_round_id).map(view),
  };
}

function cleanName(name) {
  const s = String(name ?? '').trim();
  if (!s) throw httpError(400, 'Give the round a name.', 'VALIDATION_ERROR', { errors: [{ field: 'name', code: 'REQUIRED', message: 'Required.' }] });
  if (s.length > 120) throw httpError(400, 'The name is too long.', 'VALIDATION_ERROR', { errors: [{ field: 'name', code: 'TOO_LONG', message: '120 characters at most.' }] });
  return s;
}

async function createRound(eventId, { name, note } = {}, actorId) {
  await writableEvent(eventId);
  const pos = await db.query('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM elimination_rounds WHERE event_id = $1', [eventId]);
  const r = await db.query(
    `INSERT INTO elimination_rounds (event_id, name, note, position, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, name, note, position, created_at`,
    [eventId, cleanName(name), note ? String(note).trim().slice(0, 2000) : null, pos.rows[0].p, actorId || null],
  );
  return { ...r.rows[0], id: Number(r.rows[0].id), teams: [] };
}

async function updateRound(eventId, roundId, { name, note } = {}) {
  await writableEvent(eventId);
  const sets = [];
  const params = [roundId, eventId];
  if (name !== undefined) { params.push(cleanName(name)); sets.push(`name = $${params.length}`); }
  if (note !== undefined) { params.push(note ? String(note).trim().slice(0, 2000) : null); sets.push(`note = $${params.length}`); }
  if (!sets.length) throw httpError(400, 'Nothing to change.', 'VALIDATION_ERROR');
  const r = await db.query(`UPDATE elimination_rounds SET ${sets.join(', ')} WHERE id = $1 AND event_id = $2 RETURNING id`, params);
  if (!r.rows[0]) throw httpError(404, 'Round not found', 'NOT_FOUND');
  return { id: Number(roundId) };
}

async function deleteRound(eventId, roundId) {
  await writableEvent(eventId);
  const used = await db.query('SELECT 1 FROM teams WHERE eliminated_round_id = $1 LIMIT 1', [roundId]);
  if (used.rows[0]) throw httpError(409, 'Bring the round\'s teams back first.', 'ROUND_IN_USE');
  const r = await db.query('DELETE FROM elimination_rounds WHERE id = $1 AND event_id = $2 RETURNING id', [roundId, eventId]);
  if (!r.rows[0]) throw httpError(404, 'Round not found', 'NOT_FOUND');
  return true;
}

/**
 * Eliminate teams in a round. Teams of other events, unknown ids and teams
 * already eliminated are skipped and reported.
 */
async function eliminate(eventId, roundId, teamIds, reason) {
  await writableEvent(eventId);
  const round = await db.query('SELECT id FROM elimination_rounds WHERE id = $1 AND event_id = $2', [roundId, eventId]);
  if (!round.rows[0]) throw httpError(404, 'Round not found', 'NOT_FOUND');
  const ids = [...new Set((Array.isArray(teamIds) ? teamIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw httpError(400, 'Choose at least one team.', 'VALIDATION_ERROR');
  const found = await db.query(
    "SELECT id, LOWER(COALESCE(status, 'active')) AS status FROM teams WHERE event_id = $1 AND id = ANY($2::int[])",
    [eventId, ids],
  );
  const byId = new Map(found.rows.map((r) => [Number(r.id), r.status]));
  // eslint-disable-next-line global-require
  await require('./results.service').assertNotInPublishedResults(eventId, ids.filter((id) => byId.get(id) && byId.get(id) !== 'eliminated'), 'eliminate');
  const done = [];
  const skipped = [];
  for (const id of ids) {
    if (!byId.has(id)) { skipped.push({ teamId: id, reason: 'NOT_FOUND' }); continue; }
    if (byId.get(id) === 'eliminated') { skipped.push({ teamId: id, reason: 'ALREADY_ELIMINATED' }); continue; }
    // eslint-disable-next-line no-await-in-loop
    await teamService.setTeamStatus(id, 'eliminated', reason, { roundId });
    done.push(id);
  }
  return { eliminated: done, skipped };
}

async function restore(eventId, teamId) {
  await writableEvent(eventId);
  const t = await db.query('SELECT id FROM teams WHERE id = $1 AND event_id = $2', [teamId, eventId]);
  if (!t.rows[0]) throw httpError(404, 'Team not found', 'TEAM_NOT_FOUND');
  return teamService.setTeamStatus(teamId, 'active');
}

/**
 * Which teams a cut that keeps the best `keep` would eliminate: the ranked
 * teams below the cut (teams tied at the cut all stay), then the unscored.
 */
async function suggest(eventId, keep) {
  const n = Math.max(0, Math.floor(Number(keep) || 0));
  // eslint-disable-next-line global-require
  const { ranking } = require('./results.service');
  const live = await ranking(eventId);
  // Keeping as many as are ranked (or more) leaves only the unscored to go.
  const cutPlace = n === 0 ? 0 : (live.ranked[Math.min(n, live.ranked.length) - 1]?.place ?? Infinity);
  const below = live.ranked.filter((r) => n === 0 || r.place > cutPlace);
  return {
    keep: n,
    eliminate: [...below, ...live.unscored].map((r) => ({ teamId: r.teamId, teamName: r.teamName, place: r.place ?? null, score: r.score ?? null })),
    stays: live.ranked.filter((r) => !below.includes(r)).map((r) => ({ teamId: r.teamId, teamName: r.teamName, place: r.place, score: r.score })),
  };
}

module.exports = { listRounds, createRound, updateRound, deleteRound, eliminate, restore, suggest };
