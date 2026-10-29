/**
 * @file participant.service.js
 * @description Business logic for hackathon participant management.
 *
 * Participants are users registered for a specific event.
 * A participant row links a user to an event + tracks their status and solo/team preference.
 */

const crypto           = require('crypto');
const db               = require('../config/db');
const { hashPassword } = require('../utils/hashHelper');
const { httpError }    = require('../utils/responseFormat');

const PARTICIPANT_STATUSES = ['pending', 'approved', 'rejected', 'eliminated', 'waitlisted'];

// ─────────────────────────────────────────────────────────────────────────────
// Read Operations
// ─────────────────────────────────────────────────────────────────────────────

/** List all participants for an event, optionally filtered by status. */
const getParticipants = async (eventId, status) => {
  // The person's team in THIS event (a user has at most one per event).
  let sql = `
    SELECT p.*, u.full_name, u.email, u.role,
           u.skills, u.experience, u.university, u.country, u.phone,
           mt.name AS team_name, mt.id AS current_team_id, mt.is_lead AS team_leader
    FROM participants p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT t.id, t.name, (t.leader_id = p.user_id OR tm.is_leader) AS is_lead
        FROM team_members tm JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = p.user_id AND t.event_id = p.event_id
       LIMIT 1
    ) mt ON true
    WHERE p.event_id = $1`;
  const params = [eventId];

  if (status) {
    sql += ' AND p.status = $2';
    params.push(status);
  }

  sql += ' ORDER BY p.registered_at DESC';

  const result = await db.query(sql, params);
  return result.rows;
};

/**
 * Fetch a single participant row by its primary key, optionally asserting
 * that it belongs to `eventId` (prevents cross-event writes via the URL).
 */
const getParticipantById = async (id, eventId) => {
  const params = [id];
  let sql = `
    SELECT p.*, u.full_name, u.email, u.role
      FROM participants p
      JOIN users u ON p.user_id = u.id
     WHERE p.id = $1`;
  if (eventId != null) {
    sql += ' AND p.event_id = $2';
    params.push(eventId);
  }
  const result = await db.query(sql, params);
  return result.rows[0];
};

const getParticipantCount = async (eventId) => {
  const result = await db.query(
    'SELECT COUNT(*) FROM participants WHERE event_id = $1',
    [eventId],
  );
  return parseInt(result.rows[0].count, 10);
};

/**
 * Hackers registered for this event who are not on any team for this event
 * (solo flow + others looking for teammates). Used by the Team Lobby UI.
 */
const listHackersForTeamLobby = async (eventId) => {
  const result = await db.query(
    `SELECT
       u.id AS user_id,
       u.full_name,
       u.email,
       u.role AS account_role,
       u.role_preference,
       u.skills,
       u.experience,
       u.country,
       u.university,
       u.timezone,
       u.linkedin,
       u.github_link,
       u.attendance_mode,
       p.status AS participant_status,
       p.is_solo,
       p.is_team_lead
     FROM participants p
     INNER JOIN users u ON u.id = p.user_id
     WHERE p.event_id = $1
       AND LOWER(TRIM(COALESCE(u.role::text, ''))) IN ('hacker', 'pending')
       -- Only approved participants can be invited (an invite to anyone else fails).
       AND LOWER(TRIM(COALESCE(p.status::text, 'pending'))) = 'approved'
       AND NOT EXISTS (
         SELECT 1
         FROM team_members tm
         INNER JOIN teams t ON t.id = tm.team_id AND t.event_id = $1
         WHERE tm.user_id = u.id
       )
     ORDER BY u.full_name ASC`,
    [eventId],
  );
  return result.rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// Write Operations (Admin)
// ─────────────────────────────────────────────────────────────────────────────

/** Add or update a participant record (admin action). Upsert on (user, event). */
const addParticipant = async (userId, eventId, status) => {
  const result = await db.query(
    `INSERT INTO participants (user_id, event_id, status)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, event_id) DO UPDATE SET status = $3
     RETURNING *`,
    [userId, eventId, status || 'pending'],
  );
  return result.rows[0];
};

/** Self-registration: a hacker joins an event directly (solo or looking-for-team). */
const registerSelfParticipant = async (eventId, userId, opts = {}) => {
  const { isSolo = true, isTeamLead = false, status = 'pending' } = opts;

  const ev = await db.query('SELECT id FROM events WHERE id = $1', [eventId]);
  if (!ev.rows[0]) throw httpError(404, 'Event not found', 'EVENT_NOT_FOUND');

  const result = await db.query(
    `INSERT INTO participants (user_id, event_id, status, is_solo, is_team_lead)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, event_id) DO UPDATE SET
       is_solo = EXCLUDED.is_solo,
       is_team_lead = participants.is_team_lead OR EXCLUDED.is_team_lead,
       status  = CASE
         WHEN participants.status = 'approved' THEN participants.status
         ELSE EXCLUDED.status
       END
     RETURNING *`,
    [userId, eventId, status, isSolo, Boolean(isTeamLead)],
  );
  return result.rows[0];
};

/** Update a participant's status (approve/reject/eliminate) — scoped to the event. */
const updateParticipantStatus = async (id, status, eventId) => {
  const params = [status, id];
  let sql = 'UPDATE participants SET status = $1 WHERE id = $2';
  if (eventId != null) {
    sql += ' AND event_id = $3';
    params.push(eventId);
  }
  const result = await db.query(`${sql} RETURNING *`, params);
  return result.rows[0];
};

/** Permanently remove a participant from an event (scoped to the event). */
const deleteParticipant = async (id, eventId) => {
  const params = [id];
  let sql = 'DELETE FROM participants WHERE id = $1';
  if (eventId != null) {
    sql += ' AND event_id = $2';
    params.push(eventId);
  }
  const result = await db.query(`${sql} RETURNING id`, params);
  return Boolean(result.rows[0]);
};

const eliminateParticipant = async (id, eventId) => updateParticipantStatus(id, 'eliminated', eventId);

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

/** Check whether a hacker has an `approved` participant row for this event. */
const isHackerApprovedForEvent = async (userId, eventId, queryExec) => {
  const exec = queryExec && typeof queryExec.query === 'function' ? queryExec : db;
  const result = await exec.query(
    `SELECT 1
       FROM participants
      WHERE user_id = $1
        AND event_id = $2
        AND LOWER(TRIM(COALESCE(status::text, ''))) = 'approved'
      LIMIT 1`,
    [userId, eventId],
  );
  return result.rows.length > 0;
};

/**
 * Throw a 403 if the hacker is not admin-approved for this event.
 * No-op for non-hackers (judge / mentor / volunteer / admin accounts).
 */
const assertHackerApprovedForEvent = async (userId, eventId, queryExec) => {
  const exec = queryExec && typeof queryExec.query === 'function' ? queryExec : db;
  const userRes = await exec.query(
    `SELECT LOWER(TRIM(COALESCE(role::text, ''))) AS role FROM users WHERE id = $1`,
    [userId],
  );
  const role = userRes.rows[0]?.role || '';
  if (role && role !== 'hacker' && role !== 'pending') return;

  const ok = await isHackerApprovedForEvent(userId, eventId, exec);
  if (!ok) {
    throw httpError(403, 'Your account is not approved for this event yet', 'HACKER_NOT_APPROVED');
  }
};

/**
 * Find an existing user by email, or create a placeholder account
 * (bulk import / admin adding by email). The placeholder password is random
 * — the organiser must set a password for the user before they can log in.
 */
const findOrCreateUserByEmail = async (email, fullName, extraFields = {}) => {
  const existing = await db.query(
    'SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))',
    [email],
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const tempPassword = crypto.randomBytes(16).toString('hex');
  const hashed       = await hashPassword(tempPassword);
  const skillsJson   = extraFields.skills
    ? (Array.isArray(extraFields.skills) ? JSON.stringify(extraFields.skills) : extraFields.skills)
    : '[]';

  const result = await db.query(
    `INSERT INTO users (
       full_name, email, password_hash, role, github_link,
       phone, age, country, timezone, linkedin, attendance_mode,
       university, cohort, skills, experience, role_preference,
       dietary, tshirt_size, motivation, how_heard
     ) VALUES (
       $1, LOWER(TRIM($2)), $3, 'hacker', $4,
       $5, $6, $7, $8, $9, $10,
       $11, $12, $13::jsonb, $14, $15,
       $16, $17, $18, $19
     ) RETURNING *`,
    [
      fullName, email, hashed, extraFields.github_link || null,
      extraFields.phone || null,
      extraFields.age ? parseInt(String(extraFields.age), 10) : null,
      extraFields.country || null, extraFields.timezone || null,
      extraFields.linkedin || null, extraFields.attendance_mode || 'online',
      extraFields.university || null, extraFields.cohort || null,
      skillsJson, extraFields.experience || null, extraFields.role_preference || null,
      extraFields.dietary || null, extraFields.tshirt_size || null,
      extraFields.motivation || null, extraFields.how_heard || null,
    ],
  );
  return result.rows[0];
};

module.exports = {
  PARTICIPANT_STATUSES,
  getParticipants,
  getParticipantById,
  getParticipantCount,
  listHackersForTeamLobby,
  addParticipant,
  registerSelfParticipant,
  updateParticipantStatus,
  deleteParticipant,
  eliminateParticipant,
  findOrCreateUserByEmail,
  isHackerApprovedForEvent,
  assertHackerApprovedForEvent,
};
