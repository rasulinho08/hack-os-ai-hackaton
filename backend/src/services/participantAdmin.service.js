/**
 * @file participantAdmin.service.js
 * @description Organisers managing who takes part: status changes one by one,
 * in bulk or for a whole team, the event's capacity, the waiting list, and
 * the participant export.
 *
 * Seats: a pending or approved participant holds a seat (the same count the
 * registration form uses). Moving someone onto a seat — from the waiting
 * list, from rejected — needs a free one, unless the organiser says
 * "anyway"; restoring an eliminated participant never does. When a seat
 * frees up before the event starts, the waiting list moves up by itself in
 * registration order: straight to approved when the event approves
 * automatically, otherwise to pending for the organiser to review.
 *
 * Rejecting someone takes them off their team, and a lead who is rejected
 * or eliminated hands the team to an approved member (team.releaseMember),
 * in the same transaction as the status.
 *
 * Status e-mails and Telegram messages go out through the job queue
 * (jobs/peopleJobs.js), never inside the request.
 */

const db = require('../config/db');
const jobs = require('./jobs.service');
const { httpError } = require('../utils/responseFormat');
const { effectiveLimit, countTaken } = require('./eventRegistration.service');
const { forEvent } = require('./entitlement.service');
const teamService = require('./team.service');

const STATUSES = ['pending', 'approved', 'rejected', 'waitlisted', 'eliminated'];
const HOLDS_SEAT = new Set(['pending', 'approved']);

const norm = (s) => String(s || 'pending').trim().toLowerCase();

async function eventRow(exec, eventId, { lock = false } = {}) {
  const r = await exec.query(
    `SELECT id, name, start_date, max_participants, waitlist_enabled, approval_mode, status,
            team_size_limit, min_team_size
       FROM events WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [eventId],
  );
  if (!r.rows[0]) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return r.rows[0];
}

async function seatLimit(event) {
  const scope = await forEvent(event.id);
  return effectiveLimit(event, scope ? scope.limits.participants : null);
}

/** Capacity and counts per status, for the participants page. */
async function summary(eventId) {
  const event = await eventRow(db, eventId);
  const limit = await seatLimit(event);
  const r = await db.query(
    `SELECT LOWER(TRIM(p.status)) AS status, COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id
               WHERE t.event_id = p.event_id AND tm.user_id = p.user_id))::int AS teamless,
            COUNT(*) FILTER (WHERE p.looking_for_team)::int AS looking
       FROM participants p WHERE p.event_id = $1 GROUP BY 1`,
    [eventId],
  );
  const by = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let teamlessApproved = 0;
  let looking = 0;
  for (const row of r.rows) {
    by[row.status] = row.n;
    if (row.status === 'approved') {
      teamlessApproved = row.teamless;
      looking = row.looking;
    }
  }
  const taken = by.pending + by.approved;
  const teams = await db.query(
    `SELECT COUNT(*)::int AS n FROM teams WHERE event_id = $1 AND LOWER(COALESCE(status, 'active')) <> 'eliminated'`,
    [eventId],
  );
  return {
    capacity: {
      limit,
      taken,
      remaining: limit == null ? null : Math.max(0, limit - taken),
      full: limit != null && taken >= limit,
      waitlistEnabled: Boolean(event.waitlist_enabled),
      approvalMode: event.approval_mode,
    },
    byStatus: by,
    total: Object.values(by).reduce((a, b) => a + b, 0),
    teamlessApproved,
    lookingForTeam: looking,
    teams: teams.rows[0].n,
    teamSize: { min: Number(event.min_team_size) || 1, max: Number(event.team_size_limit) || 4 },
  };
}

function queueStatusMessage(participantId, status, exec = db) {
  return jobs.enqueue('participant.status_message', { participantId, status }, { exec });
}

/**
 * Change statuses inside one transaction that holds the event row, so two
 * organisers approving at once cannot both take the last seat.
 *
 * @param {number} eventId
 * @param {Array<number>} participantIds
 * @param {string} status
 * @param {{ force?: boolean }} [opts]  force: approve past the capacity
 * @returns {Promise<{ changed: Array<{ id, from, to, user_id, full_name, team }>, skipped: Array<{ id, reason }> }>}
 */
async function setStatuses(eventId, participantIds, status, { force = false } = {}) {
  const to = norm(status);
  if (!STATUSES.includes(to)) throw httpError(400, `status must be one of: ${STATUSES.join(', ')}`, 'INVALID_STATUS');
  const ids = [...new Set(participantIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) throw httpError(400, 'Choose at least one participant.', 'NOTHING_SELECTED');
  if (ids.length > 1000) throw httpError(400, 'At most 1000 participants at once.', 'TOO_MANY');

  const client = await db.pool.connect();
  const changed = [];
  const skipped = [];
  try {
    await client.query('BEGIN');
    const event = await eventRow(client, eventId, { lock: true });
    const limit = await seatLimit(event);
    let taken = (await countTaken(client, eventId)).taken;
    const rows = (await client.query(
      `SELECT p.id, p.user_id, LOWER(TRIM(p.status)) AS status, u.full_name
         FROM participants p JOIN users u ON u.id = p.user_id
        WHERE p.event_id = $1 AND p.id = ANY($2::int[])
        ORDER BY p.registered_at ASC, p.id ASC`,
      [eventId, ids],
    )).rows;
    const found = new Set(rows.map((r) => r.id));
    for (const id of ids) if (!found.has(id)) skipped.push({ id, reason: 'NOT_FOUND' });

    for (const p of rows) {
      if (p.status === to) {
        skipped.push({ id: p.id, reason: 'UNCHANGED' });
        continue;
      }
      const takesSeat = HOLDS_SEAT.has(to) && !HOLDS_SEAT.has(p.status) && p.status !== 'eliminated';
      if (takesSeat && limit != null && taken >= limit && !force) {
        skipped.push({ id: p.id, reason: 'CAPACITY_FULL' });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await client.query(
        'UPDATE participants SET status = $2, status_changed_at = now() WHERE id = $1',
        [p.id, to],
      );
      if (HOLDS_SEAT.has(to) && !HOLDS_SEAT.has(p.status)) taken += 1;
      if (!HOLDS_SEAT.has(to) && HOLDS_SEAT.has(p.status)) taken -= 1;
      // eslint-disable-next-line no-await-in-loop
      const team = await teamService.releaseMember(client, eventId, p.user_id, to);
      changed.push({ id: p.id, from: p.status, to, user_id: p.user_id, full_name: p.full_name, team });
      // eslint-disable-next-line no-await-in-loop
      await queueStatusMessage(p.id, to, client);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { changed, skipped };
}

/** Every member of a team, in one go (approval by team). */
async function setTeamStatus(eventId, teamId, status, opts = {}) {
  const r = await db.query(
    `SELECT p.id FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       JOIN participants p ON p.user_id = tm.user_id AND p.event_id = t.event_id
      WHERE t.id = $1 AND t.event_id = $2`,
    [teamId, eventId],
  );
  if (!r.rows.length) throw httpError(404, 'Team not found', 'TEAM_NOT_FOUND');
  return setStatuses(eventId, r.rows.map((x) => x.id), status, opts);
}

/**
 * Move the waiting list up into free seats (before the event starts, when
 * the event has a waiting list and a limit). Returns who moved.
 */
async function promoteWaitlist(eventId, { now = Date.now() } = {}) {
  const client = await db.pool.connect();
  const promoted = [];
  try {
    await client.query('BEGIN');
    const event = await eventRow(client, eventId, { lock: true });
    const started = event.start_date && new Date(event.start_date).getTime() <= now;
    const limit = await seatLimit(event);
    if (!event.waitlist_enabled || started || limit == null || String(event.status || '').toLowerCase() === 'archived') {
      await client.query('ROLLBACK');
      return promoted;
    }
    const { taken } = await countTaken(client, eventId);
    const room = limit - taken;
    if (room <= 0) {
      await client.query('ROLLBACK');
      return promoted;
    }
    const to = event.approval_mode === 'auto' ? 'approved' : 'pending';
    const next = await client.query(
      `SELECT p.id, p.user_id, u.full_name FROM participants p JOIN users u ON u.id = p.user_id
        WHERE p.event_id = $1 AND LOWER(TRIM(p.status)) = 'waitlisted'
        ORDER BY p.registered_at ASC, p.id ASC
        LIMIT $2 FOR UPDATE OF p`,
      [eventId, room],
    );
    for (const p of next.rows) {
      // eslint-disable-next-line no-await-in-loop
      await client.query('UPDATE participants SET status = $2, status_changed_at = now() WHERE id = $1', [p.id, to]);
      // eslint-disable-next-line no-await-in-loop
      await queueStatusMessage(p.id, to === 'approved' ? 'approved' : 'promoted', client);
      promoted.push({ id: p.id, user_id: p.user_id, full_name: p.full_name, to });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return promoted;
}

/**
 * Remove a participant from the event: off their team first (leadership
 * passes on, an empty team goes), then the participant row; the waiting
 * list moves up.
 */
async function removeParticipant(eventId, participantId) {
  const p = (await db.query(
    'SELECT id, user_id FROM participants WHERE id = $1 AND event_id = $2',
    [participantId, eventId],
  )).rows[0];
  if (!p) return null;
  const membership = (await db.query(
    `SELECT tm.team_id FROM team_members tm JOIN teams t ON t.id = tm.team_id
      WHERE t.event_id = $1 AND tm.user_id = $2 LIMIT 1`,
    [eventId, p.user_id],
  )).rows[0];
  if (membership) await teamService.removeTeamMember(membership.team_id, p.user_id);
  await db.query('DELETE FROM participants WHERE id = $1', [p.id]);
  const promoted = await promoteWaitlist(eventId);
  return { removed: p, promoted };
}

/** Approved participants without a team, for the organiser's team builder. */
async function unassigned(eventId) {
  const r = await db.query(
    `SELECT p.id, p.user_id, u.full_name, u.email, u.skills, p.looking_for_team, p.looking_note
       FROM participants p JOIN users u ON u.id = p.user_id
      WHERE p.event_id = $1 AND LOWER(TRIM(p.status)) = 'approved'
        AND NOT EXISTS (SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id
                         WHERE t.event_id = $1 AND tm.user_id = p.user_id)
      ORDER BY u.full_name ASC`,
    [eventId],
  );
  return r.rows;
}

/**
 * Rows for the participant export: the person, their status and team, the
 * profile fields the form asks, and every answer to the event's own
 * questions (archived questions included, so nothing answered is lost).
 */
async function exportRows(eventId) {
  const [people, fields, answers] = await Promise.all([
    db.query(
      `SELECT p.id, p.status, p.registered_at, p.ref_source, p.is_team_lead, p.looking_for_team,
              u.full_name, u.email, u.phone, u.university, u.country, u.experience, u.skills,
              u.github_link, u.linkedin, u.tshirt_size, u.dietary,
              t.name AS team_name
         FROM participants p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN LATERAL (
           SELECT t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id
            WHERE t.event_id = p.event_id AND tm.user_id = p.user_id LIMIT 1) t ON true
        WHERE p.event_id = $1
        ORDER BY p.registered_at ASC, p.id ASC`,
      [eventId],
    ),
    db.query(
      `SELECT id, label, field_key FROM registration_fields
        WHERE event_id = $1 AND kind = 'custom' ORDER BY sort_order, id`,
      [eventId],
    ),
    db.query(
      `SELECT a.participant_id, a.field_id, a.value, a.file_id
         FROM registration_answers a JOIN registration_fields f ON f.id = a.field_id
        WHERE a.event_id = $1 AND f.kind = 'custom'`,
      [eventId],
    ),
  ]);
  const byParticipant = new Map();
  for (const a of answers.rows) {
    const m = byParticipant.get(a.participant_id) || new Map();
    m.set(a.field_id, a.file_id ? '(file)' : a.value);
    byParticipant.set(a.participant_id, m);
  }
  const skills = (v) => (Array.isArray(v) ? v.join('; ') : typeof v === 'string' ? v : '');
  const columns = [
    { key: 'full_name', header: 'Name' },
    { key: 'email', header: 'E-mail' },
    { key: 'status', header: 'Status' },
    { key: 'team_name', header: 'Team' },
    { header: 'Team lead', value: (r) => (r.is_team_lead ? 'yes' : '') },
    { header: 'Registered', value: (r) => (r.registered_at ? new Date(r.registered_at).toISOString() : '') },
    { key: 'phone', header: 'Phone' },
    { key: 'university', header: 'University' },
    { key: 'country', header: 'Country' },
    { key: 'experience', header: 'Experience' },
    { header: 'Skills', value: (r) => skills(r.skills) },
    { key: 'github_link', header: 'GitHub' },
    { key: 'linkedin', header: 'LinkedIn' },
    { key: 'tshirt_size', header: 'T-shirt' },
    { key: 'dietary', header: 'Diet' },
    { key: 'ref_source', header: 'Came from' },
    { header: 'Looking for a team', value: (r) => (r.looking_for_team ? 'yes' : '') },
    ...fields.rows.map((f) => ({
      header: f.label || f.field_key,
      value: (r) => byParticipant.get(r.id)?.get(f.id) ?? '',
    })),
  ];
  return { columns, rows: people.rows };
}

module.exports = {
  STATUSES,
  summary,
  setStatuses,
  setTeamStatus,
  promoteWaitlist,
  removeParticipant,
  unassigned,
  exportRows,
};
