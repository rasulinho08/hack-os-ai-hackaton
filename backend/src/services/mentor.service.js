/**
 * @file mentor.service.js
 * @description Mentors of an event: who they are and what they know, where
 * and when to find them, and whether they are around right now.
 *
 * Mentors are assigned per event via `mentor_assignments` (the global user
 * role is handled by invites). Each assignment carries:
 *   skills        a list matched against help requests
 *   bio, location a line about them and where to find them ("Table 3")
 *   presence      what the mentor says: available, busy or away
 *   last_seen_at  the last time HackOS heard from their open mentor page
 * "Online" = seen in the last ONLINE_WINDOW_MS and not away. Participants see
 * it only when the organiser left "show online status" on.
 *
 * Slots (`mentor_slots`) are the hours a mentor is around, on site or online.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { withDefaults } = require('./eventBuilderInput');

const PRESENCE = ['available', 'busy', 'away'];
const SLOT_MODES = ['onsite', 'online'];
const ONLINE_WINDOW_MS = 3 * 60e3;
const MAX_SLOT_HOURS = 12;

const norm = (s) => String(s || '').trim().toLowerCase();

/** Skills as a clean list (array, comma text, or nothing), at most 20. */
function skillList(raw) {
  let arr = raw;
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { arr = raw.split(/[,;]/); }
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  for (const s of arr) {
    const label = String(s ?? '').trim().slice(0, 40);
    if (label && !seen.has(norm(label))) {
      seen.add(norm(label));
      out.push(label);
    }
  }
  return out.slice(0, 20);
}

const isOnline = (row, now = Date.now()) =>
  row.presence !== 'away' && row.last_seen_at != null && now - new Date(row.last_seen_at).getTime() < ONLINE_WINDOW_MS;

// ─────────────────────────────────────────────────────────────────────────────
// Access
// ─────────────────────────────────────────────────────────────────────────────

const isUserMentorForEvent = async (userId, eventId) => {
  const result = await db.query(
    'SELECT 1 FROM mentor_assignments WHERE event_id = $1 AND user_id = $2 LIMIT 1',
    [eventId, userId],
  );
  return result.rows.length > 0;
};

async function assignmentOf(eventId, userId) {
  const r = await db.query('SELECT * FROM mentor_assignments WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
  return r.rows[0] || null;
}

async function requireAssignment(eventId, userId) {
  const row = await assignmentOf(eventId, userId);
  if (!row) throw httpError(403, 'You are not a mentor for this event', 'NOT_EVENT_MENTOR');
  return row;
}

async function showsOnlineStatus(eventId) {
  const r = await db.query('SELECT mentor_config FROM events WHERE id = $1', [eventId]);
  return withDefaults('mentor_config', r.rows[0]?.mentor_config).showOnlineStatus !== false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The event's mentors with what the help queue needs: requests they are on,
 * requests waiting for them by name, and their next slot.
 *
 * @param {{ forParticipant?: boolean }} opts participants get no e-mail, and
 *   no presence when the organiser turned online status off
 */
const getMentors = async (eventId, { forParticipant = false } = {}) => {
  const result = await db.query(
    `SELECT ma.*, u.full_name, u.email,
            (SELECT COUNT(*)::int FROM help_tickets t
              WHERE t.event_id = ma.event_id AND t.mentor_id = ma.user_id
                AND LOWER(REPLACE(t.status, '_', '-')) = 'in-progress') AS active_tickets,
            (SELECT COUNT(*)::int FROM help_tickets t
              WHERE t.event_id = ma.event_id AND t.preferred_mentor_id = ma.user_id
                AND LOWER(t.status) = 'open') AS waiting_for_them,
            (SELECT COUNT(*)::int FROM help_tickets t
              WHERE t.event_id = ma.event_id AND t.mentor_id = ma.user_id
                AND t.closed_reason = 'resolved') AS resolved_tickets,
            (SELECT json_build_object('starts_at', s.starts_at, 'ends_at', s.ends_at, 'mode', s.mode, 'note', s.note)
               FROM mentor_slots s
              WHERE s.event_id = ma.event_id AND s.user_id = ma.user_id AND s.ends_at > now()
              ORDER BY s.starts_at ASC LIMIT 1) AS next_slot
       FROM mentor_assignments ma
       JOIN users u ON ma.user_id = u.id
      WHERE ma.event_id = $1
      ORDER BY u.full_name ASC`,
    [eventId],
  );
  const showPresence = !forParticipant || (await showsOnlineStatus(eventId));
  const now = Date.now();
  return result.rows.map((row) => {
    const out = {
      ...row,
      skills: skillList(row.skills),
      online: showPresence ? isOnline(row, now) : null,
      presence: showPresence ? row.presence : null,
    };
    if (forParticipant) {
      delete out.email;
      delete out.last_seen_at;
    }
    return out;
  });
};

/** Event ids this user mentors (most recent first). */
const listMentorEventIdsForUser = async (userId) => {
  const result = await db.query(
    `SELECT ma.event_id
       FROM mentor_assignments ma
       JOIN events e ON e.id = ma.event_id
      WHERE ma.user_id = $1
      ORDER BY e.start_date DESC NULLS LAST, ma.event_id DESC`,
    [userId],
  );
  return result.rows.map((r) => Number(r.event_id)).filter((n) => Number.isFinite(n) && n > 0);
};

/** The calling mentor's own assignment in an event, with their slots. */
const getMine = async (eventId, userId) => {
  const row = await requireAssignment(eventId, userId);
  return {
    ...row,
    skills: skillList(row.skills),
    online: isOnline(row),
    slots: await listSlots(eventId, { userId }),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

/** Assign (or update) a mentor of an event. The global role is not changed. */
const assignMentor = async (eventId, userId, expertise, availability, skills) => {
  const list = skills !== undefined ? skillList(skills) : skillList(expertise);
  const result = await db.query(
    `INSERT INTO mentor_assignments (event_id, user_id, expertise, availability, skills)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (event_id, user_id) DO UPDATE SET
       expertise    = COALESCE(EXCLUDED.expertise, mentor_assignments.expertise),
       availability = COALESCE(EXCLUDED.availability, mentor_assignments.availability),
       skills       = CASE WHEN EXCLUDED.skills = '[]'::jsonb THEN mentor_assignments.skills ELSE EXCLUDED.skills END
     RETURNING *`,
    [eventId, userId, expertise || null, availability || null, JSON.stringify(list)],
  );
  return result.rows[0];
};

const TEXT_FIELDS = { expertise: 2000, availability: 255, bio: 600, location: 120 };

/** The changes in `data` that are present (and only those), validated. */
function readChanges(data, { allowPresence = false } = {}) {
  const sets = [];
  const params = [];
  for (const [key, max] of Object.entries(TEXT_FIELDS)) {
    if (!(key in data)) continue;
    const v = data[key] == null ? null : String(data[key]).trim();
    if (v && v.length > max) throw httpError(400, `${key} must be ${max} characters or fewer`, 'VALIDATION_ERROR');
    params.push(v || null);
    sets.push(`${key} = $${params.length}`);
  }
  if ('skills' in data) {
    params.push(JSON.stringify(skillList(data.skills)));
    sets.push(`skills = $${params.length}::jsonb`);
  }
  if (allowPresence && 'presence' in data) {
    const p = norm(data.presence);
    if (!PRESENCE.includes(p)) throw httpError(400, `presence must be one of: ${PRESENCE.join(', ')}`, 'VALIDATION_ERROR');
    params.push(p);
    sets.push(`presence = $${params.length}`);
  }
  return { sets, params };
}

/**
 * An organiser edits a mentor. Only the fields sent change: sending the
 * skills no longer wipes the availability (the old update set both).
 */
const updateMentor = async (id, data) => {
  const { sets, params } = readChanges(data || {});
  if (!sets.length) {
    const r = await db.query('SELECT * FROM mentor_assignments WHERE id = $1', [id]);
    return r.rows[0];
  }
  params.push(id);
  const result = await db.query(
    `UPDATE mentor_assignments SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return result.rows[0];
};

/** A mentor edits their own profile in an event (and says if they are around). */
const updateMine = async (eventId, userId, data) => {
  await requireAssignment(eventId, userId);
  const { sets, params } = readChanges(data || {}, { allowPresence: true });
  if (sets.length) {
    params.push(eventId, userId);
    await db.query(
      `UPDATE mentor_assignments SET ${sets.join(', ')}, last_seen_at = now()
        WHERE event_id = $${params.length - 1} AND user_id = $${params.length}`,
      params,
    );
  }
  return getMine(eventId, userId);
};

/** The mentor's page is open: they count as online for a few minutes. */
const heartbeat = async (eventId, userId) => {
  const r = await db.query(
    `UPDATE mentor_assignments SET last_seen_at = now()
      WHERE event_id = $1 AND user_id = $2 RETURNING presence, last_seen_at`,
    [eventId, userId],
  );
  if (!r.rows[0]) throw httpError(403, 'You are not a mentor for this event', 'NOT_EVENT_MENTOR');
  return { presence: r.rows[0].presence, online: isOnline(r.rows[0]) };
};

const removeMentor = async (id) => {
  const r = await db.query('DELETE FROM mentor_assignments WHERE id = $1 RETURNING event_id, user_id', [id]);
  const gone = r.rows[0];
  // Their hours go with them; open requests addressed to them return to everyone.
  if (gone) {
    await db.query('DELETE FROM mentor_slots WHERE event_id = $1 AND user_id = $2', [gone.event_id, gone.user_id]);
    await db.query(
      `UPDATE help_tickets SET preferred_mentor_id = NULL
        WHERE event_id = $1 AND preferred_mentor_id = $2 AND LOWER(status) = 'open'`,
      [gone.event_id, gone.user_id],
    );
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Slots
// ─────────────────────────────────────────────────────────────────────────────

/** Slots of an event, earliest first (ended ones only when asked). */
async function listSlots(eventId, { userId = null, includePast = false } = {}) {
  const r = await db.query(
    `SELECT s.id, s.event_id, s.user_id, s.starts_at, s.ends_at, s.mode, s.note, u.full_name AS mentor_name
       FROM mentor_slots s JOIN users u ON u.id = s.user_id
      WHERE s.event_id = $1 AND ($2::int IS NULL OR s.user_id = $2) AND ($3 OR s.ends_at > now())
      ORDER BY s.starts_at ASC, u.full_name ASC
      LIMIT 500`,
    [eventId, userId, includePast],
  );
  return r.rows;
}

const parseTime = (v) => {
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
};

/**
 * Add a slot for `mentorUserId`. Refuses an end before the start, a slot
 * longer than MAX_SLOT_HOURS, one that already ended, and one overlapping
 * another slot of the same mentor.
 */
async function createSlot(eventId, mentorUserId, { startsAt, endsAt, mode, note }) {
  await requireAssignment(eventId, mentorUserId);
  const start = parseTime(startsAt);
  const end = parseTime(endsAt);
  const errors = [];
  if (!start) errors.push({ field: 'startsAt', code: 'INVALID', message: 'A start time is needed.' });
  if (!end) errors.push({ field: 'endsAt', code: 'INVALID', message: 'An end time is needed.' });
  if (start && end) {
    if (end <= start) errors.push({ field: 'endsAt', code: 'BEFORE_START', message: 'The end must come after the start.' });
    else if (end - start > MAX_SLOT_HOURS * 3600e3) errors.push({ field: 'endsAt', code: 'TOO_LONG', message: `At most ${MAX_SLOT_HOURS} hours in one slot.` });
    if (end <= new Date()) errors.push({ field: 'endsAt', code: 'IN_PAST', message: 'This time has already passed.' });
  }
  const m = norm(mode || 'onsite');
  if (!SLOT_MODES.includes(m)) errors.push({ field: 'mode', code: 'INVALID', message: 'On site or online.' });
  const n = note == null ? null : String(note).trim().slice(0, 200) || null;
  if (errors.length) throw httpError(400, errors[0].message, 'SLOT_INVALID', { errors });

  const overlap = await db.query(
    `SELECT 1 FROM mentor_slots WHERE event_id = $1 AND user_id = $2 AND starts_at < $4 AND ends_at > $3 LIMIT 1`,
    [eventId, mentorUserId, start, end],
  );
  if (overlap.rows[0]) {
    throw httpError(409, 'This overlaps another slot of the same mentor.', 'SLOT_OVERLAP');
  }
  const r = await db.query(
    `INSERT INTO mentor_slots (event_id, user_id, starts_at, ends_at, mode, note)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [eventId, mentorUserId, start, end, m, n],
  );
  return r.rows[0];
}

/** Delete a slot: its mentor, or an organiser. */
async function deleteSlot(eventId, slotId, actor) {
  const r = await db.query('SELECT * FROM mentor_slots WHERE id = $1 AND event_id = $2', [slotId, eventId]);
  const slot = r.rows[0];
  if (!slot) throw httpError(404, 'Slot not found', 'NOT_FOUND');
  if (!actor.isAdmin && Number(slot.user_id) !== Number(actor.id)) {
    throw httpError(403, 'Only the mentor or an organiser can remove this slot', 'NOT_SLOT_OWNER');
  }
  await db.query('DELETE FROM mentor_slots WHERE id = $1', [slotId]);
  return slot;
}

module.exports = {
  PRESENCE,
  SLOT_MODES,
  ONLINE_WINDOW_MS,
  skillList,
  isOnline,
  isUserMentorForEvent,
  getMentors,
  listMentorEventIdsForUser,
  getMine,
  assignMentor,
  updateMentor,
  updateMine,
  heartbeat,
  removeMentor,
  listSlots,
  createSlot,
  deleteSlot,
};
