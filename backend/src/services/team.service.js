/**
 * @file team.service.js
 * @description Business logic for team creation, membership, and management.
 *
 * All write operations that span multiple tables (create, join, remove)
 * use explicit DB transactions to maintain consistency.
 */

const crypto = require('crypto');
const db     = require('../config/db');
const { assertTeamFormationOpen } = require('./event.service');
const { assertHackerApprovedForEvent } = require('./participant.service');
const { httpError } = require('../utils/responseFormat');

const generateJoinCode = () => crypto.randomBytes(4).toString('hex'); // 8-char hex code

/** team_members row of `userId` in any team of `eventId` (or undefined). */
async function findMembershipInEvent(exec, userId, eventId) {
  const r = await exec.query(
    `SELECT tm.team_id, t.name
       FROM team_members tm
       JOIN teams t ON tm.team_id = t.id
      WHERE tm.user_id = $1 AND t.event_id = $2
      LIMIT 1`,
    [userId, eventId],
  );
  return r.rows[0];
}

/**
 * Members who count for the team's size (its room and the minimum to submit):
 * everyone on it except a participant the organiser rejected. Rejecting
 * someone takes them off their team (releaseMember); this also covers
 * memberships from before that rule.
 */
async function countedMembers(exec, teamId) {
  const r = await exec.query(
    `SELECT COUNT(*)::int AS n FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       LEFT JOIN participants p ON p.user_id = tm.user_id AND p.event_id = t.event_id
      WHERE tm.team_id = $1 AND LOWER(TRIM(COALESCE(p.status::text, ''))) <> 'rejected'`,
    [teamId],
  );
  return r.rows[0].n;
}

/**
 * Who leads a team after its lead leaves or is turned down: an approved
 * participant first, then whoever joined first. Null when nobody is left.
 */
async function nextLeader(exec, teamId, exceptUserId = null) {
  const r = await exec.query(
    `SELECT tm.user_id FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       LEFT JOIN participants p ON p.user_id = tm.user_id AND p.event_id = t.event_id
      WHERE tm.team_id = $1 AND ($2::int IS NULL OR tm.user_id <> $2::int)
        AND LOWER(TRIM(COALESCE(p.status::text, ''))) NOT IN ('rejected', 'eliminated')
      ORDER BY (LOWER(TRIM(COALESCE(p.status::text, ''))) = 'approved') DESC, tm.joined_at ASC NULLS LAST, tm.user_id ASC
      LIMIT 1`,
    [teamId, exceptUserId],
  );
  return r.rows[0] ? Number(r.rows[0].user_id) : null;
}

/** Make `userId` the lead of the team, in every place the lead is kept. */
async function setLeader(exec, teamId, eventId, userId) {
  await exec.query('UPDATE teams SET leader_id = $1 WHERE id = $2', [userId, teamId]);
  await exec.query('UPDATE team_members SET is_leader = (user_id = $1) WHERE team_id = $2', [userId, teamId]);
  await exec.query(
    'UPDATE participants SET is_team_lead = (user_id = $2) WHERE event_id = $1 AND user_id IN (SELECT user_id FROM team_members WHERE team_id = $3)',
    [eventId, userId, teamId],
  );
}

/**
 * What an organiser's decision about a participant means for their team,
 * inside the caller's transaction:
 *
 *   rejected    they leave the team (their seat frees up). If they led it,
 *               an approved member takes over, else whoever joined first. A
 *               team left empty goes, unless it handed in a project: that
 *               stays, with no lead, and is not judged (no approved member)
 *               until the organiser puts an accepted participant on it.
 *   eliminated  they stay on the team (they took part), but if they led an
 *               active team, an approved member takes over when there is one.
 *
 * Without an approved member a team is not judged, voted for or ranked
 * (judging.HAS_APPROVED_MEMBER), whatever its lead.
 *
 * @returns {Promise<{ teamId: number, left: boolean, newLeaderId: number|null, teamDeleted: boolean } | null>}
 */
async function releaseMember(exec, eventId, userId, status) {
  if (status !== 'rejected' && status !== 'eliminated') return null;
  const team = (await exec.query(
    `SELECT t.id, t.leader_id, LOWER(COALESCE(t.status, 'active')) AS status
       FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE t.event_id = $1 AND tm.user_id = $2
      LIMIT 1 FOR UPDATE OF t`,
    [eventId, userId],
  )).rows[0];
  if (!team) return null;
  const out = { teamId: Number(team.id), left: false, newLeaderId: null, teamDeleted: false };
  const led = Number(team.leader_id) === Number(userId);

  if (status === 'rejected') {
    await exec.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [team.id, userId]);
    await exec.query('UPDATE participants SET is_team_lead = false WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
    out.left = true;
    const rest = await exec.query(
      'SELECT user_id FROM team_members WHERE team_id = $1 ORDER BY joined_at ASC NULLS LAST, user_id ASC',
      [team.id],
    );
    if (!rest.rows.length) {
      const project = await exec.query('SELECT 1 FROM submissions WHERE team_id = $1 LIMIT 1', [team.id]);
      if (project.rows[0]) {
        if (led) await exec.query('UPDATE teams SET leader_id = NULL WHERE id = $1', [team.id]);
      } else {
        await exec.query('DELETE FROM teams WHERE id = $1', [team.id]);
        out.teamDeleted = true;
      }
      return out;
    }
    if (led) {
      out.newLeaderId = (await nextLeader(exec, team.id)) ?? Number(rest.rows[0].user_id);
      await setLeader(exec, team.id, eventId, out.newLeaderId);
    }
    return out;
  }

  // Eliminated on their own while the team plays on: an approved member leads.
  if (led && team.status !== 'eliminated') {
    const next = await nextLeader(exec, team.id, userId);
    if (next) {
      await setLeader(exec, team.id, eventId, next);
      out.newLeaderId = next;
    }
  }
  return out;
}

async function assertTeamHasRoom(exec, teamId, eventId) {
  const [count, limitRes] = await Promise.all([
    countedMembers(exec, teamId),
    exec.query('SELECT team_size_limit FROM events WHERE id = $1', [eventId]),
  ]);
  const limit = Number(limitRes.rows[0]?.team_size_limit) || 4;
  if (count >= limit) {
    throw httpError(400, `Team is full (max ${limit} members)`, 'TEAM_FULL');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / Join
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new team and add the creator as its leader.
 * @throws 403 TEAM_FORMATION_CLOSED / HACKER_NOT_APPROVED, 409 ALREADY_IN_TEAM
 */
const createTeam = async (eventId, name, userId, opts = {}) => {
  if (!opts.isAdmin) {
    await assertTeamFormationOpen(eventId);
    await assertHackerApprovedForEvent(userId, eventId);
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await findMembershipInEvent(client, userId, eventId);
    if (existing) {
      throw httpError(409, `You are already on team "${existing.name}" for this event`, 'ALREADY_IN_TEAM');
    }

    const teamResult = await client.query(
      `INSERT INTO teams (name, event_id, leader_id, join_code)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, eventId, userId, generateJoinCode()],
    );
    const team = teamResult.rows[0];

    await client.query(
      `INSERT INTO team_members (team_id, user_id, is_leader) VALUES ($1, $2, true)`,
      [team.id, userId],
    );

    // Creator always has a participants row (admin-created teams included).
    await client.query(
      `INSERT INTO participants (user_id, event_id, status, is_team_lead)
       VALUES ($1, $2, 'pending', true)
       ON CONFLICT (user_id, event_id) DO UPDATE SET is_team_lead = true`,
      [userId, eventId],
    );

    await client.query('COMMIT');
    return team;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * An organiser makes a team for participants (they are not put on it
 * themselves). Members must be participants of the event without a team;
 * the lead is `leaderId` or the first member.
 * @throws 400 TEAM_FULL / NOT_A_PARTICIPANT, 409 ALREADY_IN_TEAM
 */
const createTeamAsOrganiser = async (eventId, name, memberIds = [], leaderId = null) => {
  const ids = [...new Set((memberIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const lead = leaderId && ids.includes(Number(leaderId)) ? Number(leaderId) : ids[0] || null;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const ev = await client.query('SELECT team_size_limit FROM events WHERE id = $1', [eventId]);
    if (!ev.rows[0]) throw httpError(404, 'Event not found', 'NOT_FOUND');
    const limit = Number(ev.rows[0].team_size_limit) || 4;
    if (ids.length > limit) throw httpError(400, `Team is full (max ${limit} members)`, 'TEAM_FULL');
    for (const uid of ids) {
      // eslint-disable-next-line no-await-in-loop
      const isParticipant = await client.query('SELECT 1 FROM participants WHERE event_id = $1 AND user_id = $2', [eventId, uid]);
      if (!isParticipant.rows[0]) throw httpError(400, 'Only participants of this event can be put on a team.', 'NOT_A_PARTICIPANT');
      // eslint-disable-next-line no-await-in-loop
      const existing = await findMembershipInEvent(client, uid, eventId);
      if (existing) throw httpError(409, `This participant is already on team "${existing.name}"`, 'ALREADY_IN_TEAM');
    }
    const team = (await client.query(
      `INSERT INTO teams (name, event_id, leader_id, join_code) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, eventId, lead, generateJoinCode()],
    )).rows[0];
    for (const uid of ids) {
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        'INSERT INTO team_members (team_id, user_id, is_leader) VALUES ($1, $2, $3)',
        [team.id, uid, uid === lead],
      );
    }
    if (lead) {
      await client.query('UPDATE participants SET is_team_lead = (user_id = $2) WHERE event_id = $1 AND user_id = ANY($3::int[])', [eventId, lead, ids]);
    }
    await client.query('COMMIT');
    return team;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * An organiser moves a participant to another team: off the old one
 * (leadership passes on, an empty team goes), onto the new one.
 */
const moveMember = async (teamId, userId) => {
  const t = await db.query('SELECT id, event_id FROM teams WHERE id = $1', [teamId]);
  if (!t.rows[0]) throw httpError(404, 'Team not found', 'TEAM_NOT_FOUND');
  const current = await findMembershipInEvent(db, userId, t.rows[0].event_id);
  if (current && String(current.team_id) === String(teamId)) {
    throw httpError(409, 'This user is already on this team', 'ALREADY_IN_TEAM');
  }
  if (current) await removeTeamMember(current.team_id, userId);
  return addTeamMember(teamId, userId, { isAdmin: true });
};

/**
 * Join an existing team using its invite join code.
 * @throws 404 TEAM_NOT_FOUND, 400 ALREADY_IN_TEAM / TEAM_FULL, 403 lifecycle guards
 */
const joinTeam = async (joinCode, userId, opts = {}) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const teamResult = await client.query(
      `SELECT t.* FROM teams t WHERE t.join_code = $1`,
      [String(joinCode || '').trim()],
    );
    const team = teamResult.rows[0];
    if (!team) throw httpError(404, 'Team not found — check the join code', 'TEAM_NOT_FOUND');
    if (String(team.status).toLowerCase() === 'eliminated') {
      throw httpError(400, 'This team has been eliminated', 'TEAM_ELIMINATED');
    }

    if (!opts.isAdmin) {
      await assertTeamFormationOpen(team.event_id);
      await assertHackerApprovedForEvent(userId, team.event_id, client);
    }

    const existing = await findMembershipInEvent(client, userId, team.event_id);
    if (existing) {
      throw httpError(400, 'You are already in a team for this event', 'ALREADY_IN_TEAM');
    }

    await assertTeamHasRoom(client, team.id, team.event_id);

    await client.query(
      `INSERT INTO team_members (team_id, user_id, is_leader)
       VALUES ($1, $2, false)
       ON CONFLICT (team_id, user_id) DO NOTHING`,
      [team.id, userId],
    );
    await client.query(
      `INSERT INTO participants (user_id, event_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (user_id, event_id) DO NOTHING`,
      [userId, team.event_id],
    );

    await client.query('COMMIT');
    return team;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Read Operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the team a user is on for an event (or the most recent one if no
 * event is given — callers should always pass eventId to avoid leaking
 * rosters from previous hackathons).
 */
const getMyTeam = async (userId, eventId) => {
  let memberQuery = `
    SELECT tm.team_id FROM team_members tm
    JOIN teams t ON tm.team_id = t.id
    WHERE tm.user_id = $1`;
  const params = [userId];
  if (eventId) {
    memberQuery += ' AND t.event_id = $2';
    params.push(eventId);
  }
  memberQuery += ' ORDER BY t.created_at DESC LIMIT 1';

  const memberResult = await db.query(memberQuery, params);
  if (!memberResult.rows[0]) return null;
  return getTeamById(memberResult.rows[0].team_id);
};

/**
 * List all teams, optionally scoped to a specific event.
 * `excludeEmpty: true` drops teams with zero member rows.
 */
const getAllTeams = async (eventId, opts = {}) => {
  const excludeEmpty = Boolean(opts && opts.excludeEmpty);
  const sql = `
    SELECT t.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id',        u.id,
            'name',      u.full_name,
            'full_name', u.full_name,
            'email',     u.email,
            'role',      u.role,
            'is_leader', COALESCE(tm.is_leader, false) OR (u.id = t.leader_id)
          )
          ORDER BY (COALESCE(tm.is_leader, false) OR (u.id = t.leader_id)) DESC NULLS LAST, u.full_name ASC
        ) FILTER (WHERE u.id IS NOT NULL),
        '[]'
      ) AS members
    FROM teams t
    LEFT JOIN team_members tm ON t.id = tm.team_id
    LEFT JOIN users u ON tm.user_id = u.id
    ${eventId ? 'WHERE t.event_id = $1' : ''}
    GROUP BY t.id
    ${excludeEmpty ? 'HAVING COUNT(u.id) > 0' : ''}
    ORDER BY t.created_at DESC`;

  const result = eventId ? await db.query(sql, [eventId]) : await db.query(sql);
  return result.rows;
};

/** Get a single team by ID, including its members. */
const getTeamById = async (id) => {
  const result = await db.query(
    `SELECT t.*,
       e.event_code AS event_code,
       e.team_size_limit AS team_size_limit,
       COALESCE(
         json_agg(json_build_object(
           'id', u.id, 'full_name', u.full_name, 'email', u.email,
           'role', u.role,
           'is_leader', COALESCE(tm.is_leader, false) OR (u.id = t.leader_id)
         ) ORDER BY (COALESCE(tm.is_leader, false) OR (u.id = t.leader_id)) DESC, tm.joined_at ASC)
         FILTER (WHERE u.id IS NOT NULL),
         '[]'
       ) AS members
     FROM teams t
     INNER JOIN events e ON e.id = t.event_id
     LEFT JOIN team_members tm ON t.id = tm.team_id
     LEFT JOIN users u ON tm.user_id = u.id
     WHERE t.id = $1
     GROUP BY t.id, e.id`,
    [id],
  );
  return result.rows[0];
};

const getTeamMembers = async (teamId) => {
  // participant_status: whether the organisers accepted each member in the
  // team's event (the lead's list shows who is still waiting).
  const result = await db.query(
    `SELECT u.id, u.full_name, u.email, u.role, tm.is_leader, tm.joined_at,
            LOWER(TRIM(COALESCE(p.status::text, 'pending'))) AS participant_status
     FROM team_members tm
     JOIN users u ON tm.user_id = u.id
     JOIN teams t ON t.id = tm.team_id
     LEFT JOIN participants p ON p.user_id = u.id AND p.event_id = t.event_id
     WHERE tm.team_id = $1
     ORDER BY tm.is_leader DESC, tm.joined_at ASC`,
    [teamId],
  );
  return result.rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// Write Operations
// ─────────────────────────────────────────────────────────────────────────────

const updateTeam = async (id, data) => {
  const { name } = data;
  const result = await db.query(
    'UPDATE teams SET name = $1 WHERE id = $2 RETURNING *',
    [name, id],
  );
  return result.rows[0];
};

const deleteTeam = async (id) => {
  await db.query('DELETE FROM teams WHERE id = $1', [id]);
};

/**
 * Add a member to a team. Leaders may only add approved participants while
 * team formation is open and the team has room; admins bypass those checks.
 * @throws 404 TEAM_NOT_FOUND, 409 ALREADY_IN_TEAM, 400 TEAM_FULL, 403 guards
 */
const addTeamMember = async (teamId, userId, opts = {}) => {
  const teamResult = await db.query('SELECT id, event_id FROM teams WHERE id = $1', [teamId]);
  const eventId    = teamResult.rows[0]?.event_id;
  if (!eventId) throw httpError(404, 'Team not found', 'TEAM_NOT_FOUND');

  if (!opts.isAdmin) {
    await assertTeamFormationOpen(eventId);
    await assertHackerApprovedForEvent(userId, eventId);
    await assertTeamHasRoom(db, teamId, eventId);
  } else {
    // Organisers skip the deadline and the size check, but a team is still
    // made of the event's participants: adding someone does not register
    // them past the capacity and the approval.
    const isParticipant = await db.query('SELECT 1 FROM participants WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
    if (!isParticipant.rows[0]) {
      throw httpError(400, 'Only participants of this event can be put on a team.', 'NOT_A_PARTICIPANT');
    }
  }

  const conflict = await findMembershipInEvent(db, userId, eventId);
  if (conflict) {
    if (String(conflict.team_id) === String(teamId)) {
      throw httpError(409, 'This user is already on this team', 'ALREADY_IN_TEAM');
    }
    throw httpError(409, `This user is already on team "${conflict.name}" for this event`, 'ALREADY_IN_TEAM');
  }

  const result = await db.query(
    `INSERT INTO team_members (team_id, user_id, is_leader)
     VALUES ($1, $2, false)
     ON CONFLICT (team_id, user_id) DO NOTHING
     RETURNING *`,
    [teamId, userId],
  );

  return result.rows[0] || { team_id: teamId, user_id: userId, is_leader: false };
};

/**
 * Remove a member from a team. If the leader leaves, leadership passes to an
 * approved member (the longest-standing one), else the longest-standing
 * remaining member; if the last member leaves, the empty team row is deleted
 * so it never lingers as a ghost in admin/mentor views.
 *
 * @returns {Promise<{ removed: boolean, teamDeleted: boolean, newLeaderId: number|null }>}
 */
const removeTeamMember = async (teamId, userId) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const teamRes = await client.query(
      'SELECT id, event_id, leader_id FROM teams WHERE id = $1 FOR UPDATE',
      [teamId],
    );
    const team = teamRes.rows[0];
    if (!team) throw httpError(404, 'Team not found', 'TEAM_NOT_FOUND');

    const del = await client.query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2 RETURNING user_id',
      [teamId, userId],
    );
    if (!del.rows[0]) throw httpError(404, 'User is not a member of this team', 'NOT_A_MEMBER');

    const remaining = await client.query(
      `SELECT user_id FROM team_members WHERE team_id = $1
       ORDER BY joined_at ASC NULLS LAST, user_id ASC`,
      [teamId],
    );

    let teamDeleted = false;
    let newLeaderId = null;

    if (remaining.rows.length === 0) {
      await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
      teamDeleted = true;
    } else if (Number(team.leader_id) === Number(userId)) {
      newLeaderId = (await nextLeader(client, teamId)) ?? remaining.rows[0].user_id;
      await setLeader(client, teamId, team.event_id, newLeaderId);
    }

    await client.query('COMMIT');
    return { removed: true, teamDeleted, newLeaderId };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
};

/**
 * Transfer team leadership to another team member.
 * Admins call this with `requireFromUserIsLead = false`.
 */
const transferLead = async (teamId, fromUserId, toUserId, opts = {}) => {
  const requireFromUserIsLead = opts.requireFromUserIsLead !== false;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const teamResult = await client.query('SELECT id, leader_id FROM teams WHERE id = $1', [teamId]);
    const team = teamResult.rows[0];
    if (!team) throw httpError(404, 'Team not found', 'TEAM_NOT_FOUND');

    if (requireFromUserIsLead && Number(team.leader_id) !== Number(fromUserId)) {
      throw httpError(403, 'Only the current team lead can transfer leadership', 'NOT_TEAM_LEAD');
    }
    if (Number(team.leader_id) === Number(toUserId)) {
      throw httpError(400, 'User is already the team lead', 'ALREADY_LEAD');
    }

    const memberResult = await client.query(
      'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, toUserId],
    );
    if (memberResult.rows.length === 0) {
      throw httpError(400, 'Target user is not a member of this team', 'NOT_A_MEMBER');
    }

    await client.query('UPDATE team_members SET is_leader = (user_id = $1) WHERE team_id = $2', [toUserId, teamId]);
    await client.query('UPDATE teams SET leader_id = $1 WHERE id = $2', [toUserId, teamId]);

    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }

  return getTeamById(teamId);
};

/**
 * Flip a team between "active" and "eliminated" and fan the decision out to
 * its members' participants.status for the team's event: admitted members
 * become eliminated (someone still pending, waitlisted or rejected keeps that
 * status), and restoring brings back only the members who were eliminated.
 * `roundId` names the elimination round the decision belongs to.
 */
const setTeamStatus = async (teamId, nextStatus, reason = null, { roundId = null } = {}) => {
  const normalized = String(nextStatus || '').trim().toLowerCase();
  if (normalized !== 'eliminated' && normalized !== 'active') {
    throw httpError(400, 'Invalid team status', 'VALIDATION_ERROR');
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id, event_id, status FROM teams WHERE id = $1 FOR UPDATE',
      [teamId],
    );
    const team = existing.rows[0];
    if (!team) throw httpError(404, 'Team not found', 'TEAM_NOT_FOUND');

    const eventId = team.event_id;
    const cleanReason =
      normalized === 'eliminated'
        ? (typeof reason === 'string' ? reason.trim().slice(0, 500) : '') || null
        : null;

    const eliminating = normalized === 'eliminated';
    const updated = await client.query(
      `UPDATE teams
          SET status              = $1,
              elimination_reason  = $2,
              eliminated_at       = CASE WHEN $4::boolean THEN NOW() ELSE NULL END,
              eliminated_round_id = $5
        WHERE id = $3
        RETURNING *`,
      // $1 cannot double as the CASE operand: Postgres infers one type for it
      // from both uses (the status column and a text literal) and refuses
      // with "inconsistent types deduced for parameter $1".
      [normalized, cleanReason, teamId, eliminating, eliminating && roundId ? Number(roundId) : null],
    );

    if (eliminating) {
      await client.query(
        `UPDATE participants p
            SET status = 'eliminated', status_changed_at = NOW()
          WHERE p.event_id = $1
            AND LOWER(TRIM(COALESCE(p.status::text, ''))) = 'approved'
            AND p.user_id IN (SELECT user_id FROM team_members WHERE team_id = $2)`,
        [eventId, teamId],
      );
    } else {
      await client.query(
        `UPDATE participants p
            SET status = 'approved', status_changed_at = NOW()
          WHERE p.event_id = $1
            AND LOWER(TRIM(COALESCE(p.status::text, ''))) = 'eliminated'
            AND p.user_id IN (SELECT user_id FROM team_members WHERE team_id = $2)`,
        [eventId, teamId],
      );
    }

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Who may hand in or edit a team's project: its lead, once the organiser
 * approved them. While the lead is not an approved participant of the event
 * (pending, waitlisted, rejected before rejecting took people off their
 * team, or no lead at all), any approved member may, so the lead's status
 * cannot block approved teammates. Never someone who is not approved.
 * The submission routes and the team page read this one rule.
 *
 * @returns {Promise<{ ok: boolean, asLead: boolean, code: string|null }>}
 *   code NOT_TEAM_LEAD (an approved lead hands in) or HACKER_NOT_APPROVED
 */
async function handInRight(teamId, userId, exec = db) {
  const r = await exec.query(
    `SELECT t.leader_id,
            (SELECT LOWER(TRIM(p.status::text)) FROM participants p
              WHERE p.event_id = t.event_id AND p.user_id = $2) AS mine,
            EXISTS (SELECT 1 FROM team_members tm
                      JOIN participants p ON p.user_id = tm.user_id AND p.event_id = t.event_id
                     WHERE tm.team_id = t.id AND tm.user_id = t.leader_id
                       AND LOWER(TRIM(p.status::text)) = 'approved') AS lead_approved
       FROM teams t WHERE t.id = $1`,
    [teamId, userId],
  );
  const row = r.rows[0];
  if (!row) return { ok: false, asLead: false, code: 'NOT_TEAM_LEAD' };
  const asLead = Number(row.leader_id) === Number(userId);
  const approved = row.mine === 'approved';
  if (asLead) return approved ? { ok: true, asLead, code: null } : { ok: false, asLead, code: 'HACKER_NOT_APPROVED' };
  if (row.lead_approved) return { ok: false, asLead, code: 'NOT_TEAM_LEAD' };
  return approved ? { ok: true, asLead, code: null } : { ok: false, asLead, code: 'HACKER_NOT_APPROVED' };
}

/** Check whether `userId` is the leader of `teamId`. */
async function isTeamLeader(teamId, userId) {
  const result = await db.query(
    'SELECT 1 FROM teams WHERE id = $1 AND leader_id = $2',
    [teamId, userId],
  );
  return result.rows.length > 0;
}

/** Check whether `userId` is a member of `teamId`. */
async function isTeamMember(teamId, userId) {
  const result = await db.query(
    'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2',
    [teamId, userId],
  );
  return result.rows.length > 0;
}

module.exports = {
  countedMembers,
  releaseMember,
  handInRight,
  createTeamAsOrganiser,
  moveMember,
  createTeam,
  joinTeam,
  getMyTeam,
  getAllTeams,
  getTeamById,
  updateTeam,
  deleteTeam,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
  transferLead,
  isTeamLeader,
  isTeamMember,
  setTeamStatus,
};
