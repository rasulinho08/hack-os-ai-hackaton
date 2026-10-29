/**
 * @file matchmaking.service.js
 * @description Finding a team, or people for one, by skills.
 *
 * Approved participants without a team can say they are looking (with a
 * short note); a team can say it is recruiting and which skills it wants.
 * Suggestions are ranked by what each side brings the other:
 *
 *   for a team    — a person who has a skill the team asked for counts twice,
 *                   a skill nobody on the team has yet counts once;
 *   for a person  — the same, seen from their side, over teams with room.
 *
 * Simple and explainable on purpose: every suggestion carries the skills
 * that matched, so people see why it was suggested.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { getEventById, teamFormationState } = require('./event.service');

const norm = (s) => String(s || '').trim().toLowerCase();

/** Skills as a clean list (JSONB array, comma text, or nothing). */
function skillList(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { arr = raw.split(','); }
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const label = String(s || '').trim().slice(0, 40);
    if (label && !seen.has(norm(label))) {
      seen.add(norm(label));
      out.push(label);
    }
  }
  return out.slice(0, 30);
}

/**
 * How well `offered` skills fit a side that already has `have` and wants
 * `wanted`. Returns the score and the skills behind it.
 */
function fit(offered, have, wanted) {
  const haveSet = new Set(have.map(norm));
  const wantedSet = new Set(wanted.map(norm));
  const matched = offered.filter((s) => wantedSet.has(norm(s)));
  const fresh = offered.filter((s) => !haveSet.has(norm(s)) && !wantedSet.has(norm(s)));
  return { score: matched.length * 2 + fresh.length, matched, fresh };
}

/** People ranked for a team (pure; tested on its own). */
function rankCandidates(teamSkills, wantedSkills, candidates) {
  return candidates
    .map((c) => {
      const f = fit(c.skills, teamSkills, wantedSkills);
      return { ...c, score: f.score + (c.looking ? 1 : 0), matched: f.matched, brings: f.fresh };
    })
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
}

/** Teams with room ranked for a person (pure; tested on its own). */
function rankTeams(mySkills, teams) {
  return teams
    .map((t) => {
      const f = fit(mySkills, t.skills, t.wantedSkills);
      return { ...t, score: f.score + (t.recruiting ? 1 : 0), matched: f.matched, brings: f.fresh };
    })
    .sort((a, b) => b.score - a.score || b.openSpots - a.openSpots || String(a.name).localeCompare(String(b.name)));
}

async function approvedParticipant(eventId, userId) {
  const r = await db.query(
    `SELECT p.id, p.looking_for_team, p.looking_note, LOWER(TRIM(p.status)) AS status, u.skills
       FROM participants p JOIN users u ON u.id = p.user_id
      WHERE p.event_id = $1 AND p.user_id = $2`,
    [eventId, userId],
  );
  return r.rows[0] || null;
}

async function teamOf(eventId, userId) {
  const r = await db.query(
    `SELECT t.id, t.name, t.leader_id, t.recruiting, t.recruiting_note, t.wanted_skills,
            (SELECT COUNT(*)::int FROM team_members x WHERE x.team_id = t.id) AS size
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE t.event_id = $1 AND tm.user_id = $2 LIMIT 1`,
    [eventId, userId],
  );
  return r.rows[0] || null;
}

/** Approved participants of the event without a team (optionally not `exceptUserId`). */
async function teamlessPeople(eventId, exceptUserId = null) {
  const r = await db.query(
    `SELECT p.user_id, u.full_name, u.university, u.experience, u.skills, u.github_link, u.linkedin,
            p.looking_for_team, p.looking_note
       FROM participants p JOIN users u ON u.id = p.user_id
      WHERE p.event_id = $1 AND LOWER(TRIM(p.status)) = 'approved'
        AND ($2::int IS NULL OR p.user_id <> $2)
        AND NOT EXISTS (SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id
                         WHERE t.event_id = $1 AND tm.user_id = p.user_id)
      ORDER BY p.looking_for_team DESC, u.full_name ASC
      LIMIT 300`,
    [eventId, exceptUserId],
  );
  return r.rows.map((row) => ({
    userId: row.user_id,
    name: row.full_name,
    university: row.university || null,
    experience: row.experience || null,
    skills: skillList(row.skills),
    github: row.github_link || null,
    linkedin: row.linkedin || null,
    looking: Boolean(row.looking_for_team),
    note: row.looking_note || null,
  }));
}

/** Active teams of the event that still have room, with their members' skills. */
async function teamsWithRoom(eventId) {
  const r = await db.query(
    `SELECT t.id, t.name, t.recruiting, t.recruiting_note, t.wanted_skills, t.track_id, tr.name AS track_name,
            e.team_size_limit,
            COUNT(tm.user_id)::int AS size,
            COALESCE(jsonb_agg(u.skills) FILTER (WHERE u.id IS NOT NULL), '[]'::jsonb) AS member_skills,
            MAX(CASE WHEN tm.is_leader THEN u.full_name END) AS lead_name
       FROM teams t
       JOIN events e ON e.id = t.event_id
       LEFT JOIN team_members tm ON tm.team_id = t.id
       LEFT JOIN users u ON u.id = tm.user_id
       LEFT JOIN tracks tr ON tr.id = t.track_id
      WHERE t.event_id = $1 AND LOWER(COALESCE(t.status, 'active')) <> 'eliminated'
      GROUP BY t.id, e.team_size_limit, tr.name
     HAVING COUNT(tm.user_id) < COALESCE(e.team_size_limit, 4)
      ORDER BY t.recruiting DESC, t.name ASC
      LIMIT 300`,
    [eventId],
  );
  return r.rows.map((t) => ({
    id: t.id,
    name: t.name,
    leadName: t.lead_name || null,
    track: t.track_name || null,
    size: t.size,
    openSpots: Math.max(0, (Number(t.team_size_limit) || 4) - t.size),
    recruiting: Boolean(t.recruiting),
    note: t.recruiting_note || null,
    wantedSkills: skillList(t.wanted_skills),
    skills: skillList((t.member_skills || []).flatMap((s) => skillList(s))),
  }));
}

/**
 * What the matchmaking page shows the caller:
 *   in a team  → people to invite, ranked for the team;
 *   no team    → teams with room and other teamless people, ranked for them.
 */
async function overviewFor(eventId, userId) {
  const me = await approvedParticipant(eventId, userId);
  if (!me || me.status !== 'approved') {
    throw httpError(403, 'Only approved participants can look for teams and teammates.', 'HACKER_NOT_APPROVED');
  }
  const mySkills = skillList(me.skills);
  const event = await getEventById(eventId);
  const formation = teamFormationState(event);
  const teamSize = Number(event?.team_size_limit) || 4;
  const team = await teamOf(eventId, userId);
  if (team) {
    const members = await db.query(
      `SELECT u.skills FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = $1`,
      [team.id],
    );
    const teamSkills = skillList(members.rows.flatMap((m) => skillList(m.skills)));
    const wanted = skillList(team.wanted_skills);
    return {
      mode: 'team',
      formation,
      teamSize,
      team: {
        id: team.id, name: team.name, size: team.size, isLead: Number(team.leader_id) === Number(userId),
        recruiting: Boolean(team.recruiting), note: team.recruiting_note || null, wantedSkills: wanted, skills: teamSkills,
      },
      people: rankCandidates(teamSkills, wanted, await teamlessPeople(eventId)).slice(0, 100),
    };
  }
  return {
    mode: 'solo',
    formation,
    teamSize,
    me: { looking: Boolean(me.looking_for_team), note: me.looking_note || null, skills: mySkills },
    teams: rankTeams(mySkills, await teamsWithRoom(eventId)).slice(0, 100),
    people: rankCandidates(mySkills, [], await teamlessPeople(eventId, userId)).slice(0, 100),
  };
}

/** "I am looking for a team" (approved participants without one). */
async function setLooking(eventId, userId, { looking, note }) {
  const me = await approvedParticipant(eventId, userId);
  if (!me || me.status !== 'approved') {
    throw httpError(403, 'Only approved participants can look for a team.', 'HACKER_NOT_APPROVED');
  }
  const r = await db.query(
    `UPDATE participants SET looking_for_team = $3, looking_note = $4
      WHERE event_id = $1 AND user_id = $2 RETURNING looking_for_team, looking_note`,
    [eventId, userId, Boolean(looking), note ? String(note).trim().slice(0, 280) : null],
  );
  return { looking: r.rows[0].looking_for_team, note: r.rows[0].looking_note };
}

/** A team says it is recruiting, for which skills (its lead, or an organiser). */
async function setRecruiting(teamId, { recruiting, note, wantedSkills }) {
  const r = await db.query(
    `UPDATE teams SET recruiting = $2, recruiting_note = $3, wanted_skills = $4::jsonb
      WHERE id = $1 RETURNING id, recruiting, recruiting_note, wanted_skills`,
    [teamId, Boolean(recruiting), note ? String(note).trim().slice(0, 280) : null, JSON.stringify(skillList(wantedSkills).slice(0, 12))],
  );
  if (!r.rows[0]) throw httpError(404, 'Team not found', 'TEAM_NOT_FOUND');
  const t = r.rows[0];
  return { id: t.id, recruiting: t.recruiting, note: t.recruiting_note, wantedSkills: skillList(t.wanted_skills) };
}

module.exports = {
  skillList,
  fit,
  rankCandidates,
  rankTeams,
  overviewFor,
  setLooking,
  setRecruiting,
  teamlessPeople,
  teamsWithRoom,
};
