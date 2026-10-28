/**
 * @file auth.service.js
 * @description Authentication business logic — registration, login, and current user fetch.
 *
 * Registration flow:
 *   1. Check email uniqueness
 *   2. Resolve event (by numeric ID or event_code)
 *   3. The invitation: taken now only through its own link (inviteToken);
 *      one that matches the address alone waits until the address is
 *      confirmed (emailVerification.service)
 *   4. Insert user + mark invite used + role-specific row (participant/judge/mentor/volunteer)
 *   5. A confirmation link for the address, unless the invitation link came by e-mail
 *   6. All in a single DB transaction
 */

const crypto = require('crypto');
const db = require('../config/db');
const { hashPassword, comparePassword } = require('../utils/hashHelper');
const { signToken } = require('../utils/jwtHelper');
const { httpError } = require('../utils/responseFormat');
const inviteTokens = require('./inviteToken');
const { LIVE_INVITE } = require('./invite.service');
const verification = require('./emailVerification.service');
const { defaultParticipation } = require('./event.service');

// ─────────────────────────────────────────────────────────────────────────────
// Approval status helper (hacker-only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Participant status of a hacker, per event: in the event they are working
 * in (`eventId`: named by the request or the workspace they entered) when
 * they are registered there, else in the registration their participant
 * pages fall back to (eventService.defaultParticipation: one they were
 * admitted to first, then running, upcoming, finished). Never a status from
 * one event for another: approved in one hackathon and pending in the next
 * reads approved there and pending here. No registrations → 'pending'.
 *
 * Non-hackers always get 'approved' (their access is invite-gated).
 *
 * @param {number|string} userId
 * @param {string} role
 * @param {object} [queryExec] optional transaction client
 * @returns {Promise<string>} approved | pending | rejected | eliminated | waitlisted
 */
const getHackerApprovalStatus = async (userId, role, queryExec, eventId = null) => {
  const r = String(role || '').trim().toLowerCase();
  if (r !== 'hacker' && r !== 'pending') return 'approved';
  const exec = queryExec && typeof queryExec.query === 'function' ? queryExec : db;
  // The event the person is working in decides, when there is one.
  if (eventId != null) {
    const own = await exec.query(
      `SELECT LOWER(TRIM(COALESCE(status::text, 'pending'))) AS status
         FROM participants WHERE user_id = $1 AND event_id = $2 LIMIT 1`,
      [userId, eventId],
    );
    if (own.rows[0]) return own.rows[0].status;
  }
  const own = await defaultParticipation(userId, exec);
  return own?.status || 'pending';
};

// ─────────────────────────────────────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a new user.
 *
 * Role resolution order:
 *   1. With a valid invitation link (inviteToken) for this address → the invitation's role
 *   2. Otherwise → 'hacker'. An invitation that only matches the address is
 *      kept for when the address is confirmed, and the account is not put
 *      on that event until then.
 *
 * @returns {Promise<object>} Newly created user (no password_hash), with
 *   `registration`, `verification` (the link token to e-mail) and
 *   `pendingInvite` for the controller, which strips them
 * @throws {Error} 409 if email already registered
 * @throws {Error} 404 if eventCode / eventId not found
 * @throws {Error} 400 INVALID_INVITE_TOKEN for a link that is not this address's
 */
const registerUser = async (userData) => {
  // Required here, not at the top: eventRegistration → effectiveRole → db is fine,
  // but loading it with this module would close a require cycle through authMw.
  const { openRegistrationStatus } = require('./eventRegistration.service');
  /* Role field from the client is intentionally ignored — determined server-side */
  const {
    fullName,
    email,
    password,
    githubLink,
    eventCode,
    eventId,
    event_id,
    isSolo,
    is_solo,
    phone,
    age,
    country,
    timezone,
    linkedin,
    attendanceMode, attendance_mode,
    university,
    cohort,
    skills,
    experience,
    rolePreference, role_preference,
    dietary,
    tshirtSize, tshirt_size,
    motivation,
    howHeard, how_heard,
    inviteToken,
  } = userData;

  const rawEventId = eventId ?? event_id;
  const finalAttendance = attendanceMode || attendance_mode || 'online';
  const finalRolePref   = rolePreference || role_preference || null;
  const finalDietary    = dietary || null;
  const finalTshirt     = tshirtSize || tshirt_size || null;
  const finalHowHeard   = howHeard || how_heard || null;
  const finalSkills     = Array.isArray(skills) ? JSON.stringify(skills) : (skills || '[]');

  const wantsSolo =
    isSolo === true  || is_solo === true  ||
    isSolo === 'true'|| is_solo === 'true'||
    isSolo === 1     || is_solo === 1     ||
    String(userData.registrationType || '').toLowerCase() === 'solo';

  const normalizedEmail = String(email).trim().toLowerCase();
  const hashedPwd       = await hashPassword(password);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // ── 1. Duplicate email check ──────────────────────────────────────────
    const existing = await client.query(
      'SELECT id FROM users WHERE LOWER(TRIM(email)) = $1',
      [normalizedEmail],
    );
    if (existing.rows.length > 0) {
      throw httpError(409, 'This email is already registered. Please sign in instead.', 'EMAIL_TAKEN');
    }

    // ── 2. Resolve event (by numeric ID, then by code) ───────────────────
    let resolvedEventId = null;
    let inviteRow       = null;
    let finalRole       = 'hacker';

    const idNum = rawEventId != null && rawEventId !== '' ? parseInt(String(rawEventId).trim(), 10) : NaN;
    const EVENT_COLS = 'id, status, end_date, registration_end';
    let eventRow = null;
    if (Number.isInteger(idNum) && idNum > 0) {
      const ev = await client.query(`SELECT ${EVENT_COLS} FROM events WHERE id = $1`, [idNum]);
      if (!ev.rows[0]) throw httpError(404, 'Event not found', 'EVENT_NOT_FOUND');
      eventRow = ev.rows[0];
    } else if (eventCode && String(eventCode).trim()) {
      const ev = await client.query(`SELECT ${EVENT_COLS} FROM events WHERE event_code = $1`, [String(eventCode).trim()]);
      if (!ev.rows[0]) throw httpError(404, 'Event not found', 'EVENT_NOT_FOUND');
      eventRow = ev.rows[0];
    }
    if (eventRow) resolvedEventId = eventRow.id;

    // ── 3. The invitation ────────────────────────────────────────────────
    // Its own link opens it now. Without the link, an invitation for this
    // address waits until the address is confirmed: the event code is
    // public and the address may belong to someone else.
    let inviteVia = null;
    let heldInvite = null;
    if (inviteToken) {
      const parsed = inviteTokens.parse(inviteToken);
      const inv = parsed
        ? (await client.query(`SELECT * FROM event_invites WHERE id = $1 AND ${LIVE_INVITE()}`, [parsed.inviteId])).rows[0]
        : null;
      const via = inv && String(inv.email).trim().toLowerCase() === normalizedEmail ? inviteTokens.check(inviteToken, inv) : null;
      if (!via || (resolvedEventId != null && Number(resolvedEventId) !== Number(inv.event_id))) {
        throw httpError(400, 'This invitation link is not valid for this e-mail address. Use the address the invitation was sent to, or ask the organisers for a new link.', 'INVALID_INVITE_TOKEN');
      }
      if (resolvedEventId == null) {
        eventRow = (await client.query(`SELECT ${EVENT_COLS} FROM events WHERE id = $1`, [inv.event_id])).rows[0];
        resolvedEventId = inv.event_id;
      }
      inviteRow = inv;
      inviteVia = via;
      finalRole = inviteRow.role;
    } else if (resolvedEventId != null) {
      heldInvite = (await client.query(
        `SELECT id, event_id, role FROM event_invites
          WHERE event_id = $1 AND LOWER(TRIM(email)) = $2 AND ${LIVE_INVITE()}`,
        [resolvedEventId, normalizedEmail],
      )).rows[0] || null;
    }

    // Open registration follows the event's rules. An invite is the organiser
    // saying "this person, now", so invited judges, mentors and hackers are
    // let through; anyone else meets the same checks as the event page's
    // registration: published, window open, entry type, capacity (waitlist
    // when full) and approval mode. Events that ask questions at
    // registration send people to their page, where the questions are.
    let openStatus = 'pending';
    if (eventRow && !inviteRow && !heldInvite) {
      const fullEvent = (await client.query('SELECT * FROM events WHERE id = $1', [eventRow.id])).rows[0];
      openStatus = await openRegistrationStatus(client, fullEvent, { solo: wantsSolo });
    }

    // ── 4. Insert the user ───────────────────────────────────────────────
    const userResult = await client.query(
      `INSERT INTO users (
         full_name, email, password_hash, role, github_link,
         phone, age, country, timezone, linkedin, attendance_mode,
         university, cohort, skills, experience, role_preference,
         dietary, tshirt_size, motivation, how_heard
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10, $11,
         $12, $13, $14::jsonb, $15, $16,
         $17, $18, $19, $20
       )
       RETURNING id, full_name, email, role, github_link,
         phone, age, country, timezone, linkedin, attendance_mode,
         university, cohort, skills, experience, role_preference,
         dietary, tshirt_size, motivation, how_heard`,
      [
        fullName, normalizedEmail, hashedPwd, finalRole, githubLink || null,
        phone != null && phone !== '' ? String(phone) : null,
        age ? parseInt(String(age), 10) : null,
        country || null, timezone || null, linkedin || null, finalAttendance,
        university || null, cohort || null, finalSkills, experience || null, finalRolePref,
        finalDietary, finalTshirt, motivation || null, finalHowHeard,
      ],
    );
    const user = userResult.rows[0];

    // ── 5. Post-insert side-effects ──────────────────────────────────────
    if (inviteRow) {
      // Invited hackers are pre-approved by the organiser.
      await verification.applyInvite(client, inviteRow, user.id, { solo: wantsSolo });
    } else if (heldInvite) {
      // Nothing on the event yet: the invitation is handed over when the
      // address is confirmed.
    } else if (resolvedEventId != null && finalRole === 'hacker') {
      // Open registration: the status the event's rules gave (pending for
      // the organiser's review, approved, or waitlisted when full).
      await client.query(
        `INSERT INTO participants (user_id, event_id, status, is_solo, is_team_lead)
         VALUES ($1, $2, $3, $4, false)
         ON CONFLICT (user_id, event_id) DO NOTHING`,
        [user.id, resolvedEventId, openStatus, wantsSolo],
      );
    }

    // ── 6. The address ───────────────────────────────────────────────────
    // An invitation link that came by e-mail proves it; anyone else gets a
    // link to confirm it.
    let verificationLink = null;
    if (inviteVia === 'mail') await verification.markVerified(client, user.id);
    else verificationLink = await verification.createToken(user.id, normalizedEmail, client);

    await client.query('COMMIT');
    // Tells the caller which e-mails fit; the controller strips these from
    // the response.
    user.registration =
      resolvedEventId != null && finalRole === 'hacker' && !heldInvite
        ? { eventId: resolvedEventId, status: inviteRow ? 'approved' : openStatus }
        : null;
    user.verification = verificationLink;
    user.pendingInvite = heldInvite ? { eventId: heldInvite.event_id, role: heldInvite.role } : null;
    user.email_verified = inviteVia === 'mail';
    return user;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authenticate a user and return a signed JWT + user profile.
 * @throws {Error} 'Invalid email or password' on auth failure (intentionally vague)
 */
const loginUser = async (email, password) => {
  const normalized = String(email).trim().toLowerCase();

  const result = await db.query(
    'SELECT * FROM users WHERE LOWER(TRIM(email)) = $1',
    [normalized],
  );
  const user = result.rows[0];

  // Constant-time path: always run bcrypt even when user is not found so
  // response timing does not reveal whether the email exists.
  const DUMMY_HASH = '$2a$12$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const hashToCompare = user ? user.password_hash : DUMMY_HASH;
  const isMatch = await comparePassword(password, hashToCompare);

  if (!user || !isMatch) throw new Error('Invalid email or password');

  const token = signToken({ id: user.id, role: user.role, email: user.email, tv: user.token_version || 0 });
  const status = await getHackerApprovalStatus(user.id, user.role);

  return {
    user: {
      id:              user.id,
      full_name:       user.full_name,
      fullName:        user.full_name,
      email:           user.email,
      role:            user.role,
      status,
      avatar:          user.avatar,
      github_link:     user.github_link,
      githubLink:      user.github_link,
      phone:           user.phone,
      age:             user.age,
      country:         user.country,
      timezone:        user.timezone,
      linkedin:        user.linkedin,
      attendance_mode: user.attendance_mode,
      university:      user.university,
      cohort:          user.cohort,
      skills:          user.skills || [],
      experience:      user.experience,
      role_preference: user.role_preference,
      dietary:         user.dietary,
      tshirt_size:     user.tshirt_size,
      motivation:      user.motivation,
      how_heard:       user.how_heard,
      email_verified:  Boolean(user.email_verified_at),
    },
    token,
    tokenVersion: user.token_version || 0,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Current User (me)
// ─────────────────────────────────────────────────────────────────────────────

const getMeById = async (userId, { role: effectiveRole = null, eventId = null } = {}) => {
  const result = await db.query(
    `SELECT id, full_name, email, role, avatar, github_link,
            phone, age, country, timezone, linkedin, attendance_mode,
            university, cohort, skills, experience, role_preference,
            dietary, tshirt_size, motivation, how_heard, created_at, email_verified_at
     FROM users WHERE id = $1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user) return user;
  user.email_verified = Boolean(user.email_verified_at);
  // What confirming the address would hand over, for the notice that asks for it.
  user.pending_invites = user.email_verified ? [] : await verification.pendingInvitesFor(user.email);

  const status = await getHackerApprovalStatus(user.id, effectiveRole || user.role, null, eventId);

  // When a hacker was eliminated together with their team, surface the team
  // name + organiser reason so the "You were eliminated" page can explain.
  let eliminatedTeam = null;
  if (status === 'eliminated') {
    const teamResult = await db.query(
      `SELECT t.id, t.name, t.elimination_reason, t.eliminated_at,
              e.name AS event_name
         FROM team_members tm
         JOIN teams t ON t.id = tm.team_id
         JOIN events e ON e.id = t.event_id
        WHERE tm.user_id = $1
          AND LOWER(TRIM(COALESCE(t.status::text, 'active'))) = 'eliminated'
          AND LOWER(TRIM(COALESCE(e.status::text, ''))) != 'archived'
        ORDER BY t.eliminated_at DESC NULLS LAST
        LIMIT 1`,
      [user.id],
    );
    if (teamResult.rows[0]) {
      const row = teamResult.rows[0];
      eliminatedTeam = {
        id: row.id,
        name: row.name,
        reason: row.elimination_reason || null,
        eliminated_at: row.eliminated_at || null,
        event_name: row.event_name || null,
      };
    }
  }

  return { ...user, status, eliminated_team: eliminatedTeam };
};

// ─────────────────────────────────────────────────────────────────────────────
// Passwords: forgot / reset / change / admin set
// ─────────────────────────────────────────────────────────────────────────────

const RESET_TOKEN_TTL_MINUTES = 60;
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * Create a one-time reset token for the account behind `email` (also the
 * "set your password" link of an account an organiser imported, which
 * lives longer: `ttlMinutes`).
 * Returns null when no account exists (callers must NOT reveal that).
 * Previous unused tokens of the user are invalidated.
 */
const createPasswordResetToken = async (email, { ttlMinutes = RESET_TOKEN_TTL_MINUTES } = {}) => {
  const normalized = String(email || '').trim().toLowerCase();
  const r = await db.query(
    'SELECT id, full_name, email FROM users WHERE LOWER(TRIM(email)) = $1',
    [normalized],
  );
  const user = r.rows[0];
  if (!user) return null;

  const token = crypto.randomBytes(32).toString('hex');
  await db.query(
    `UPDATE password_reset_tokens SET used_at = now()
      WHERE user_id = $1 AND used_at IS NULL`,
    [user.id],
  );
  await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [user.id, hashToken(token), String(ttlMinutes)],
  );
  return { user, token, expiresInMinutes: ttlMinutes };
};

/** Consume a reset token and set the new password. */
const resetPasswordWithToken = async (token, newPassword) => {
  const r = await db.query(
    `SELECT t.id, t.user_id, u.email
       FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()`,
    [hashToken(token)],
  );
  const row = r.rows[0];
  if (!row) {
    throw httpError(400, 'This password reset link is invalid or has expired.', 'INVALID_RESET_TOKEN');
  }

  const hashed = await hashPassword(newPassword);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // A reset ends every existing session: whoever had the old password is out.
    await client.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2',
      [hashed, row.user_id],
    );
    await client.query(
      `UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
      [row.user_id],
    );
    // The link went to the address, so the address is proven too (this is
    // also how an account an organiser imported is first opened).
    await verification.markVerified(client, row.user_id);
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
  return { id: row.user_id, email: row.email };
};

/** Signed-in user changes their own password (current password required). */
const changePassword = async (userId, currentPassword, newPassword) => {
  const r = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!r.rows[0]) throw httpError(404, 'User not found', 'NOT_FOUND');
  const ok = await comparePassword(currentPassword, r.rows[0].password_hash);
  if (!ok) throw httpError(400, 'Current password is incorrect', 'INVALID_CREDENTIALS');
  const hashed = await hashPassword(newPassword);
  // Other devices are signed out; the caller re-issues this device's cookie.
  const u = await db.query(
    `UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2
     RETURNING id, role, email, token_version`,
    [hashed, userId],
  );
  await db.query(
    `UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  return u.rows[0];
};

/** Ends every session of the account, this one included. */
const signOutEverywhere = async (userId) => {
  await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [userId]);
};

/** A fresh session token for an account, at its current session version. */
const issueToken = (user) =>
  signToken({ id: user.id, role: user.role, email: user.email, tv: user.token_version || 0 });

/** Admin sets a (temporary) password for any account, e.g. CSV-imported users. */
const setPasswordByAdmin = async (userId, newPassword) => {
  const hashed = await hashPassword(newPassword);
  const r = await db.query(
    'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, email, full_name, role',
    [hashed, userId],
  );
  return r.rows[0] || null;
};

module.exports = {
  registerUser,
  loginUser,
  getMeById,
  getHackerApprovalStatus,
  createPasswordResetToken,
  resetPasswordWithToken,
  changePassword,
  setPasswordByAdmin,
  signOutEverywhere,
  issueToken,
};
