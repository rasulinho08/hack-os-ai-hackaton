/**
 * @file eventRegistration.service.js
 * @description Registering for an event, the way its organiser set it up.
 *
 * One transaction does all of it, so a registration is either complete or
 * did not happen: the account (for someone new), the participant row, the
 * answers to the form, and the team (created by its lead, or joined with a
 * code). The rules applied, all from the event:
 *
 *   - the event is published, not archived, and registration is open
 *     (an organiser's personal invite gets through a closed window);
 *   - an invite-only event takes only the addresses its organiser invited;
 *   - the entry type is one the registration mode allows (solo / team);
 *   - required fields are answered and answers fit their type;
 *   - eligibility (age, country, city, students only) and the rules / code
 *     of conduct confirmations;
 *   - capacity: the organiser's limit or the plan's, whichever is lower.
 *     A full event puts newcomers on the waitlist, or refuses them when
 *     the waitlist is off;
 *   - approval: 'auto' approves on the spot (while there is room), anything
 *     else leaves the registration pending for the organiser.
 *
 * The event row is locked for the capacity count, so two people taking the
 * last place at the same moment cannot both get it.
 */

const crypto = require('crypto');
const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { hashPassword } = require('../utils/hashHelper');
const inviteTokens = require('./inviteToken');
const { LIVE_INVITE, inviteState } = require('./invite.service');
const verification = require('./emailVerification.service');
const { withDefaults } = require('./eventBuilderInput');
const registrationForm = require('./registrationForm.service');
const { eventRoleOf } = require('./effectiveRole.service');
const entitlementService = require('./entitlement.service');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ENTRY_TYPES = { solo: ['solo'], team: ['lead', 'member'], both: ['solo', 'lead', 'member'] };
const PROFILE_COLUMNS = new Set([
  'phone', 'age', 'country', 'university', 'cohort', 'linkedin', 'github_link', 'tshirt_size',
  'dietary', 'how_heard', 'experience', 'skills', 'motivation',
]);

/** Open, not yet open, closed — from the event's window. */
function registrationState(event, now = Date.now()) {
  if (!event.is_published) return 'unpublished';
  if (String(event.status || '').toLowerCase() === 'archived') return 'closed';
  if (event.registration_start && new Date(event.registration_start).getTime() > now) return 'not_open';
  if (event.registration_end && new Date(event.registration_end).getTime() < now) return 'closed';
  if (event.end_date && new Date(event.end_date).getTime() < now) return 'closed';
  return 'open';
}

/** The participant limit in force: the organiser's, the plan's, or the lower of both. */
function effectiveLimit(event, planLimit) {
  const own = event.max_participants != null ? Number(event.max_participants) : null;
  if (own == null) return planLimit ?? null;
  if (planLimit == null) return own;
  return Math.min(own, planLimit);
}

async function countTaken(exec, eventId) {
  const r = await exec.query(
    `SELECT COUNT(*) FILTER (WHERE LOWER(status) IN ('pending', 'approved'))::int AS taken,
            COUNT(*) FILTER (WHERE LOWER(status) = 'waitlisted')::int AS waitlisted,
            COUNT(*) FILTER (WHERE LOWER(status) = 'approved')::int AS approved
       FROM participants WHERE event_id = $1`,
    [eventId],
  );
  return r.rows[0];
}

/** Capacity numbers for the public page and the form. */
async function capacity(event) {
  const scope = await entitlementService.forEvent(event.id);
  const limit = effectiveLimit(event, scope ? scope.limits.participants : null);
  const c = await countTaken(db, event.id);
  return {
    limit,
    taken: c.taken,
    approved: c.approved,
    waitlisted: c.waitlisted,
    full: limit != null && c.taken >= limit,
    waitlistEnabled: Boolean(event.waitlist_enabled),
  };
}

function checkAccount(account) {
  const errors = [];
  const a = account && typeof account === 'object' ? account : {};
  const fullName = String(a.fullName ?? a.full_name ?? '').trim().replace(/\s+/g, ' ');
  const emailAddr = String(a.email ?? '').trim().toLowerCase();
  const password = String(a.password ?? '');
  if (fullName.length < 2 || fullName.length > 200) errors.push({ field: 'account.fullName', message: 'Enter your full name.' });
  else if (/[<>]/.test(fullName)) errors.push({ field: 'account.fullName', message: 'The name cannot contain < or >.' });
  if (!EMAIL_RE.test(emailAddr) || emailAddr.length > 255) errors.push({ field: 'account.email', message: 'Enter a valid e-mail address.' });
  if (password.length < 8 || password.length > 128) errors.push({ field: 'account.password', message: 'The password needs at least 8 characters.' });
  else if (!/\d/.test(password)) errors.push({ field: 'account.password', message: 'The password needs at least one number.' });
  return { fullName, email: emailAddr, password, errors };
}

function checkEntry(entry, event, tracks) {
  const errors = [];
  const e = entry && typeof entry === 'object' ? entry : {};
  const type = ['solo', 'lead', 'member'].includes(e.type) ? e.type : null;
  const allowed = ENTRY_TYPES[event.registration_mode] || ENTRY_TYPES.both;
  if (!type || !allowed.includes(type)) {
    errors.push({
      field: 'entry.type',
      message: event.registration_mode === 'solo'
        ? 'This event is for individual participants.'
        : event.registration_mode === 'team'
          ? 'This event is for teams: create a team or join one with its code.'
          : 'Choose how you take part.',
    });
    return { errors };
  }
  const out = { type };
  if (type === 'lead') {
    const name = String(e.teamName ?? '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) errors.push({ field: 'entry.teamName', message: 'Team name: 2 to 80 characters.' });
    else if (/[<>]/.test(name)) errors.push({ field: 'entry.teamName', message: 'The team name cannot contain < or >.' });
    out.teamName = name;
    if (e.trackId != null && e.trackId !== '') {
      const t = tracks.find((x) => Number(x.id) === Number(e.trackId));
      if (!t) errors.push({ field: 'entry.trackId', message: 'Choose one of the tracks.' });
      else out.trackId = t.id;
    }
  }
  if (type === 'member') {
    const code = String(e.teamCode ?? '').trim();
    if (!/^[A-Za-z0-9]{4,20}$/.test(code)) errors.push({ field: 'entry.teamCode', message: 'Enter the code your team lead shared.' });
    out.teamCode = code.toLowerCase();
  }
  return { errors, entry: out };
}

function teamFormationClosed(event, now = Date.now()) {
  if (event.allow_team_formation === false) return true;
  const cutoff = event.team_deadline || event.start_date;
  return cutoff ? new Date(cutoff).getTime() <= now : false;
}

/**
 * What the registration form may offer about teams:
 *   open            people can still create or join a team
 *   closesAt        when that stops (the team deadline, else the start)
 *   reason          'deadline' (it passed) | 'disabled' (the organisers form
 *                   the teams themselves) | null while open
 *   soloCanCompete  false when the deadline passed and the event needs teams
 *                   of at least two: someone registering alone now could
 *                   never join a team, so could never hand in a project.
 *                   Such registrations are refused (TEAM_FORMATION_CLOSED_SOLO).
 */
function teamFormationInfo(event, now = Date.now()) {
  const cutoff = event.team_deadline || event.start_date || null;
  const disabled = event.allow_team_formation === false;
  const open = !teamFormationClosed(event, now);
  const minTeam = Number(event.min_team_size) || 1;
  return {
    open,
    closesAt: cutoff ? new Date(cutoff).toISOString() : null,
    reason: open ? null : disabled ? 'disabled' : 'deadline',
    minTeamSize: minTeam,
    soloCanCompete: open || disabled || minTeam <= 1,
  };
}

/**
 * @param {object} p
 * @param {object} p.event          events row
 * @param {object|null} p.user      signed-in account (req.user) or null
 * @param {object} [p.account]      { fullName, email, password } for someone new
 * @param {object} [p.answers]
 * @param {object} [p.entry]        { type: 'solo'|'lead'|'member', teamName, teamCode, trackId }
 * @param {object} [p.accept]       { rules: bool, coc: bool }
 * @param {string} [p.ref]          share-link source
 * @param {string} [p.inviteToken]  the token from a participant invitation's link
 * @returns {Promise<{ userId, created, status, participantId, team, teamSkipped, verification }>}
 */
async function register({ event, user = null, account, answers, entry, accept, ref, inviteToken }) {
  const errors = [];

  // Who is registering.
  let acct = null;
  if (!user) {
    acct = checkAccount(account);
    errors.push(...acct.errors);
    // Said first, with the other answers, so nobody fixes a whole form only
    // to learn at the end that they should have signed in.
    if (!acct.errors.some((e) => e.field === 'account.email')) {
      const exists = await db.query('SELECT 1 FROM users WHERE LOWER(TRIM(email)) = $1', [acct.email]);
      if (exists.rows.length) {
        throw httpError(409, 'This e-mail already has an account. Sign in to register with it.', 'EMAIL_TAKEN', {
          errors: [{ field: 'account.email', message: 'This e-mail already has an account. Sign in to register with it.' }],
        });
      }
    }
  } else {
    const role = await eventRoleOf(user.id, event.id);
    if (role && role.role === 'participant') {
      throw httpError(409, 'You are already registered for this event.', 'ALREADY_REGISTERED', { status: role.participantStatus });
    }
    if (role) {
      throw httpError(409, 'You are on this event\'s team (organiser, judge, mentor or volunteer) and cannot also register as a participant.', 'ALREADY_STAFF');
    }
  }

  const emailAddr = user ? String(user.email || '').toLowerCase() : acct.email;

  // A personal invitation's link: said plainly when it no longer works, or
  // is someone else's (the link is bound to the address it was sent to).
  if (inviteToken) {
    const parsed = inviteTokens.parse(inviteToken);
    const row = parsed
      ? (await db.query('SELECT * FROM event_invites WHERE id = $1 AND event_id = $2', [parsed.inviteId, event.id])).rows[0]
      : null;
    if (!row || !inviteTokens.check(inviteToken, row)) {
      throw httpError(400, 'This invitation link is not valid. Ask the organisers for a new one.', 'INVALID_INVITE_TOKEN');
    }
    const state = inviteState(row);
    if (state === 'revoked') throw httpError(403, 'The organisers withdrew this invitation.', 'INVITE_REVOKED');
    if (state === 'expired') throw httpError(403, 'This invitation has expired. Ask the organisers to send it again.', 'INVITE_EXPIRED', { expiresAt: row.expires_at });
    if (state === 'used') throw httpError(409, 'This invitation has already been used to register.', 'INVITE_USED');
    if (row.role !== 'hacker') throw httpError(400, 'This invitation is not for participants.', 'INVALID_INVITE_TOKEN');
    if (emailAddr && String(row.email).trim().toLowerCase() !== emailAddr) {
      const message = `This invitation is for ${String(row.email).trim().toLowerCase()}. Register with that address${user ? ', or sign in with its account' : ''}.`;
      throw httpError(403, message, 'INVITE_EMAIL_MISMATCH', { errors: [{ field: 'account.email', message }] });
    }
  }

  const pendingInvite = emailAddr
    ? (await db.query(
      `SELECT * FROM event_invites
        WHERE event_id = $1 AND LOWER(TRIM(email)) = $2 AND role = 'hacker' AND ${LIVE_INVITE()}`,
      [event.id, emailAddr],
    )).rows[0]
    : null;
  // The invitation lets its person in past the window and the capacity, so
  // it counts only for whoever shows the address is theirs: a signed-in
  // account that confirmed it, or the invitation's own link. Anyone else
  // registers like everybody; the invitation is handed over (and a pending
  // or waiting-list place approved) when the address is confirmed.
  const inviteVia = pendingInvite && inviteToken ? inviteTokens.check(inviteToken, pendingInvite) : null;
  let addressProven = false;
  if (user && pendingInvite && !inviteVia) {
    addressProven = Boolean((await db.query('SELECT email_verified_at FROM users WHERE id = $1', [user.id])).rows[0]?.email_verified_at);
  }
  const invite = pendingInvite && (inviteVia || addressProven) ? pendingInvite : null;

  // An invite-only event takes only the addresses its organiser invited. An
  // invitation not yet proven still counts here: the place is handed over
  // when its address is confirmed, as for any other invitation.
  if (event.visibility === 'invite' && !pendingInvite) {
    if (!event.is_published) throw httpError(404, 'Event not found', 'NOT_FOUND');
    throw httpError(403, 'Registration for this event is by invitation only.', 'INVITE_ONLY');
  }

  const state = registrationState(event);
  if (state !== 'open' && !invite) {
    if (state === 'unpublished') throw httpError(404, 'Event not found', 'NOT_FOUND');
    throw httpError(403, state === 'not_open' ? 'Registration has not opened yet.' : 'Registration for this event is closed.', state === 'not_open' ? 'REGISTRATION_NOT_OPEN' : 'REGISTRATION_CLOSED');
  }

  const tracks = (await db.query('SELECT id, name FROM tracks WHERE event_id = $1', [event.id])).rows;
  // The organiser put the invited person in a team (their list's team
  // column): joining it needs no code, the invitation stands for it.
  let entryIn = entry;
  const invitedTeam = invite && String(invite.team_name || '').trim();
  if (invitedTeam && entry && entry.type === 'member' && !String(entry.teamCode || '').trim()) {
    const t = (await db.query(
      'SELECT join_code FROM teams WHERE event_id = $1 AND LOWER(TRIM(name)) = LOWER($2) ORDER BY id LIMIT 1',
      [event.id, invitedTeam],
    )).rows[0];
    if (t?.join_code) entryIn = { ...entry, teamCode: t.join_code };
  }
  const checkedEntry = checkEntry(entryIn, event, tracks);
  errors.push(...checkedEntry.errors);

  const fields = (await registrationForm.listFields(event.id)).filter((f) => f.enabled);
  const eligibility = withDefaults('eligibility', event.eligibility);
  const checked = registrationForm.checkAnswers(fields, answers, eligibility);
  errors.push(...checked.errors);

  const acc = accept && typeof accept === 'object' ? accept : {};
  if (eligibility.requireRules && acc.rules !== true) errors.push({ field: 'accept.rules', message: 'Please accept the event rules.' });
  if (eligibility.requireCoc && acc.coc !== true) errors.push({ field: 'accept.coc', message: 'Please accept the code of conduct.' });

  if (errors.length) {
    const notEligible = errors.find((e) => e.code === 'NOT_ELIGIBLE');
    throw httpError(400, notEligible ? notEligible.message : 'Some answers need attention.', notEligible ? 'NOT_ELIGIBLE' : 'VALIDATION_ERROR', { errors });
  }

  let teamEntry = checkedEntry.entry;
  if ((teamEntry.type === 'lead' || teamEntry.type === 'member') && teamFormationClosed(event)) {
    throw httpError(403, 'Team formation for this event is closed.', 'TEAM_FORMATION_CLOSED');
  }
  // Alone after the team deadline in an event that needs teams: they could
  // never hand in a project. An organiser's invitation still lets them in
  // (the organisers place them in a team themselves).
  const formation = teamFormationInfo(event);
  if (!formation.soloCanCompete && !invite) {
    throw httpError(
      403,
      `Team formation has closed and this event needs teams of at least ${formation.minTeamSize}, so a new registration could not hand in a project. Contact the organisers if you think this is a mistake.`,
      'TEAM_FORMATION_CLOSED_SOLO',
      { minTeamSize: formation.minTeamSize },
    );
  }

  const scope = await entitlementService.forEvent(event.id);
  const planLimit = scope ? scope.limits.participants : null;
  const hashed = acct ? await hashPassword(acct.password) : null;
  const refSource = ref ? String(ref).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || null : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const locked = (await client.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [event.id])).rows[0];

    // Capacity.
    let status;
    let teamSkipped = false;
    if (invite) {
      status = 'approved';
    } else {
      const limit = effectiveLimit(locked, planLimit);
      const { taken } = await countTaken(client, event.id);
      if (limit != null && taken >= limit) {
        if (!locked.waitlist_enabled) throw httpError(409, 'This event is full.', 'EVENT_FULL');
        status = 'waitlisted';
      } else {
        status = locked.approval_mode === 'auto' ? 'approved' : 'pending';
      }
    }
    // Someone on the waitlist has no place yet, so no team either.
    if (status === 'waitlisted' && teamEntry.type !== 'solo') {
      teamSkipped = true;
      teamEntry = { type: 'solo' };
    }

    // The team to join, checked before anything is written.
    let joinTeam = null;
    if (teamEntry.type === 'member') {
      joinTeam = (await client.query(
        'SELECT * FROM teams WHERE LOWER(join_code) = $1 AND event_id = $2 FOR UPDATE',
        [teamEntry.teamCode, event.id],
      )).rows[0];
      if (!joinTeam) throw httpError(400, 'No team with this code in this event.', 'TEAM_NOT_FOUND', { errors: [{ field: 'entry.teamCode', message: 'No team with this code in this event.' }] });
      if (String(joinTeam.status).toLowerCase() === 'eliminated') throw httpError(400, 'This team has been eliminated.', 'TEAM_ELIMINATED');
      const size = (await client.query('SELECT COUNT(*)::int AS n FROM team_members WHERE team_id = $1', [joinTeam.id])).rows[0].n;
      const max = Number(locked.team_size_limit) || 4;
      if (size >= max) throw httpError(400, `This team is full (${max} members).`, 'TEAM_FULL', { errors: [{ field: 'entry.teamCode', message: `This team is full (${max} members).` }] });
    }

    // The account.
    let userId;
    let created = false;
    const profile = Object.fromEntries(Object.entries(checked.profile).filter(([k]) => PROFILE_COLUMNS.has(k)));
    if (!user) {
      const exists = await client.query('SELECT 1 FROM users WHERE LOWER(TRIM(email)) = $1', [acct.email]);
      if (exists.rows.length) {
        throw httpError(409, 'This e-mail already has an account. Sign in to register with it.', 'EMAIL_TAKEN', { errors: [{ field: 'account.email', message: 'This e-mail already has an account. Sign in to register with it.' }] });
      }
      const cols = ['full_name', 'email', 'password_hash', 'role', ...Object.keys(profile)];
      const vals = [acct.fullName, acct.email, hashed, 'hacker', ...Object.values(profile)];
      const r = await client.query(
        `INSERT INTO users (${cols.join(', ')}) VALUES (${cols.map((c, i) => (c === 'skills' ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')})
         RETURNING id`,
        vals,
      );
      userId = r.rows[0].id;
      created = true;
    } else {
      userId = user.id;
      const entries = Object.entries(profile);
      if (entries.length) {
        await client.query(
          `UPDATE users SET ${entries.map(([c], i) => `${c} = ${c === 'skills' ? `$${i + 2}::jsonb` : `$${i + 2}`}`).join(', ')} WHERE id = $1`,
          [userId, ...entries.map(([, v]) => v)],
        );
      }
    }

    // The participant row.
    const p = await client.query(
      `INSERT INTO participants (user_id, event_id, status, is_solo, is_team_lead, ref_source)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [userId, event.id, status, teamEntry.type === 'solo', teamEntry.type === 'lead', refSource],
    );
    const participantId = p.rows[0].id;

    await registrationForm.saveAnswers(client, { participantId, eventId: event.id, userId, values: checked.values });

    // The team.
    let team = null;
    if (teamEntry.type === 'lead') {
      const t = await client.query(
        `INSERT INTO teams (name, event_id, leader_id, join_code, track_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, join_code, track_id`,
        [teamEntry.teamName, event.id, userId, crypto.randomBytes(4).toString('hex'), teamEntry.trackId || null],
      );
      team = t.rows[0];
      await client.query('INSERT INTO team_members (team_id, user_id, is_leader) VALUES ($1, $2, true)', [team.id, userId]);
    } else if (joinTeam) {
      await client.query('INSERT INTO team_members (team_id, user_id, is_leader) VALUES ($1, $2, false)', [joinTeam.id, userId]);
      team = { id: joinTeam.id, name: joinTeam.name, track_id: joinTeam.track_id };
    }
    if (team) await client.query('UPDATE participants SET team_id = $2 WHERE id = $1', [participantId, team.id]);

    if (invite) {
      await client.query('UPDATE event_invites SET used_at = now(), user_id = $2 WHERE id = $1', [invite.id, userId]);
    }

    // A new account confirms its address by e-mail, unless the invitation
    // link it came through was itself sent to that address.
    let verificationLink = null;
    if (created) {
      if (inviteVia === 'mail') await verification.markVerified(client, userId);
      else verificationLink = await verification.createToken(userId, emailAddr, client);
    } else if (inviteVia === 'mail') {
      await verification.markVerified(client, userId);
    }

    await client.query('COMMIT');
    return {
      userId, created, status, participantId, team, teamSkipped, email: emailAddr,
      fullName: acct ? acct.fullName : user.full_name,
      verification: verificationLink,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err && err.code === '23505' && String(err.constraint || '').includes('participants_user_id')) {
      throw httpError(409, 'You are already registered for this event.', 'ALREADY_REGISTERED');
    }
    if (err && err.code === '23505' && String(err.constraint || '').includes('users_email')) {
      throw httpError(409, 'This e-mail already has an account. Sign in to register with it.', 'EMAIL_TAKEN');
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The rules of an open registration for callers that create the participant
 * row themselves (the account sign-up with an event code): window, entry
 * type and capacity. Returns the status the row should get.
 */
async function openRegistrationStatus(client, eventRow, { solo = true } = {}) {
  const state = registrationState(eventRow);
  if (state === 'unpublished') throw httpError(404, 'Event not found', 'EVENT_NOT_FOUND');
  if (state !== 'open') {
    throw httpError(403, state === 'not_open' ? 'Registration has not opened yet.' : 'Registration for this event is closed.', state === 'not_open' ? 'REGISTRATION_NOT_OPEN' : 'REGISTRATION_CLOSED');
  }
  if (solo && eventRow.registration_mode === 'team') {
    throw httpError(400, 'This event is for teams: register on the event page to create or join a team.', 'TEAM_REQUIRED');
  }
  const formation = teamFormationInfo(eventRow);
  if (solo && !formation.soloCanCompete) {
    throw httpError(
      403,
      `Team formation has closed and this event needs teams of at least ${formation.minTeamSize}, so a new registration could not hand in a project.`,
      'TEAM_FORMATION_CLOSED_SOLO',
    );
  }
  const required = await client.query(
    'SELECT 1 FROM registration_fields WHERE event_id = $1 AND enabled AND required AND archived_at IS NULL LIMIT 1',
    [eventRow.id],
  );
  if (required.rows.length) {
    throw httpError(400, 'This event asks a few questions at registration. Register on the event page.', 'REGISTRATION_FORM_REQUIRED');
  }
  const elig = withDefaults('eligibility', eventRow.eligibility);
  // The old sign-up form always asked for the code of conduct itself; the rest it cannot ask.
  if (elig.requireRules || elig.studentsOnly || elig.minAge != null || elig.maxAge != null || elig.countries.length) {
    throw httpError(400, 'This event asks you to confirm its rules at registration. Register on the event page.', 'REGISTRATION_FORM_REQUIRED');
  }
  const scope = await entitlementService.forEvent(eventRow.id);
  await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [eventRow.id]);
  const limit = effectiveLimit(eventRow, scope ? scope.limits.participants : null);
  const { taken } = await countTaken(client, eventRow.id);
  if (limit != null && taken >= limit) {
    if (!eventRow.waitlist_enabled) throw httpError(409, 'This event is full.', 'EVENT_FULL');
    return 'waitlisted';
  }
  return eventRow.approval_mode === 'auto' ? 'approved' : 'pending';
}

module.exports = {
  register,
  registrationState,
  effectiveLimit,
  countTaken,
  capacity,
  openRegistrationStatus,
  teamFormationClosed,
  teamFormationInfo,
  ENTRY_TYPES,
};
