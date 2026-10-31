/**
 * @file checkin.service.js
 * @description Check-in at the door (plan module 'checkin').
 *
 * Every accepted participant has a ticket: an 8-character code, shown in
 * their portal as a QR code and in large type. At the door the organisers
 * and the event's volunteers scan it (or type it); the organisers can also
 * check someone in by hand, undo a check-in, and download the list.
 *
 * Who may do what:
 *   - the participant: read their own ticket (accepted participants only);
 *   - the event's volunteers: scan, and read the counts;
 *   - the event's organisers and the platform owner: all of it.
 * Judges, mentors and other participants are refused (403); anyone outside
 * the event never gets this far (eventAccess answers 404). The plan's module
 * and the archive guard are applied where the routes are mounted.
 *
 * A ticket code is made the first time it is needed and is unique within its
 * event. The QR code carries the scanner's address with the event id and the
 * code, so a phone's own camera app can open it too.
 */

const crypto = require('crypto');
const db = require('../config/db');
const { eventRoleOf } = require('./effectiveRole.service');
const { isOwnerUser } = require('../utils/authz');
const { httpError } = require('../utils/responseFormat');

/** No 0/O or 1/I: read aloud or typed from a phone screen without mix-ups. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`);
/** Participants who were accepted (an eliminated team still came in). */
const ADMITTED = ['approved', 'eliminated'];
const LIST_MAX = 200;

const iso = (t) => (t ? new Date(t).toISOString() : null);
const forbidden = (message) => httpError(403, message, 'FORBIDDEN');

function generateCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

/**
 * The ticket code in whatever form it arrives: typed with dashes or spaces,
 * in small letters, or the whole QR address (…?e=12&c=ABCDEFGH).
 * @returns {{ code: string|null, eventId: number|null }}
 */
function parseScan(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { code: null, eventId: null };
  let codePart = text;
  let eventId = null;
  const query = text.includes('?') ? text.slice(text.indexOf('?') + 1) : (/[=&]/.test(text) ? text : '');
  if (query) {
    const params = new URLSearchParams(query.split('#')[0]);
    if (params.get('c')) codePart = params.get('c');
    const e = Number.parseInt(String(params.get('e') ?? ''), 10);
    if (Number.isInteger(e) && e > 0) eventId = e;
  }
  const code = codePart.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return { code: CODE_RE.test(code) ? code : null, eventId };
}

/** What one person may do with check-in in one event. */
async function accessOf(user, eventId) {
  if (!user) return { scan: false, manage: false };
  if (isOwnerUser(user)) return { scan: true, manage: true };
  const found = await eventRoleOf(user.id, eventId);
  if (!found) return { scan: false, manage: false };
  if (found.role === 'organizer') return { scan: true, manage: true };
  if (found.role === 'volunteer') return { scan: true, manage: false };
  return { scan: false, manage: false };
}

async function requireStaff(user, eventId) {
  const access = await accessOf(user, eventId);
  if (!access.scan) throw forbidden('Only the organisers and the event\'s volunteers check people in.');
  return access;
}

async function requireOrganiser(user, eventId) {
  const access = await accessOf(user, eventId);
  if (!access.manage) throw forbidden('Only the organisers manage check-in.');
  return access;
}

/** Gives a participant a ticket code if they have none yet; returns it. */
async function ensureCode(participantId) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await db.query(
        `UPDATE participants SET ticket_code = COALESCE(ticket_code, $2) WHERE id = $1 RETURNING ticket_code`,
        [participantId, generateCode()],
      );
      return r.rows[0]?.ticket_code || null;
    } catch (err) {
      // Another participant of the event drew the same code: draw again.
      if (err.code !== '23505') throw err;
    }
  }
  throw httpError(500, 'Could not make a ticket code. Try again.', 'TICKET_CODE');
}

/** Codes for every accepted participant who has none (the list and the CSV show them). */
async function ensureCodes(eventId) {
  const r = await db.query(
    'SELECT id FROM participants WHERE event_id = $1 AND LOWER(status) = ANY($2::text[]) AND ticket_code IS NULL',
    [eventId, ADMITTED],
  );
  for (const row of r.rows) {
    // eslint-disable-next-line no-await-in-loop
    await ensureCode(row.id);
  }
}

// The person's team in this event: membership is in team_members (a user has
// at most one team per event), as in participant.service.
const TEAM_JOIN = `
    LEFT JOIN LATERAL (
      SELECT t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id
       WHERE tm.user_id = p.user_id AND t.event_id = p.event_id
       LIMIT 1
    ) mt ON true`;

const PERSON_SQL = `
  SELECT p.id, p.user_id, LOWER(p.status) AS status, p.ticket_code,
         u.full_name, u.email, mt.name AS team_name,
         c.checked_in_at, c.method, c.checked_in_by, cb.full_name AS checked_in_by_name
    FROM participants p
    JOIN users u ON u.id = p.user_id${TEAM_JOIN}
    LEFT JOIN event_checkins c ON c.participant_id = p.id
    LEFT JOIN users cb ON cb.id = c.checked_in_by`;

function personOut(r, { withEmail = false } = {}) {
  return {
    participantId: r.id,
    name: r.full_name || null,
    ...(withEmail ? { email: r.email || null } : {}),
    team: r.team_name || null,
    status: r.status,
    checkedIn: Boolean(r.checked_in_at),
    checkedInAt: iso(r.checked_in_at),
    checkedInBy: r.checked_in_at ? { id: r.checked_in_by ?? null, name: r.checked_in_by_name || null } : null,
    method: r.method || null,
  };
}

async function personById(eventId, participantId) {
  const r = await db.query(`${PERSON_SQL} WHERE p.event_id = $1 AND p.id = $2`, [eventId, participantId]);
  return r.rows[0] || null;
}

async function stats(eventId) {
  const r = await db.query(
    `SELECT COUNT(*) FILTER (WHERE LOWER(p.status) = ANY($2::text[]))::int AS admitted,
            COUNT(c.id)::int AS checked_in
       FROM participants p
       LEFT JOIN event_checkins c ON c.participant_id = p.id
      WHERE p.event_id = $1`,
    [eventId, ADMITTED],
  );
  const admitted = r.rows[0]?.admitted ?? 0;
  const checkedIn = r.rows[0]?.checked_in ?? 0;
  return { admitted, checkedIn, remaining: Math.max(0, admitted - checkedIn) };
}

/** GET …/checkin/me — the caller's own ticket. */
async function ticketFor(user, eventId) {
  const r = await db.query(
    `SELECT p.id, LOWER(p.status) AS status, e.name AS event_name
       FROM participants p JOIN events e ON e.id = p.event_id
      WHERE p.event_id = $1 AND p.user_id = $2`,
    [eventId, user.id],
  );
  const own = r.rows[0];
  if (!own) throw httpError(404, 'You are not registered for this event.', 'NOT_REGISTERED');
  if (!ADMITTED.includes(own.status)) {
    throw httpError(403, 'Your ticket appears once the organisers accept your registration.', 'NOT_APPROVED');
  }
  await ensureCode(own.id);
  const person = await personById(eventId, own.id);
  return {
    eventId: Number(eventId),
    eventName: own.event_name,
    code: person.ticket_code,
    ...personOut(person),
  };
}

/** Inserts the check-in unless there is one; says which happened. */
async function checkIn(eventId, participant, userId, method) {
  const ins = await db.query(
    `INSERT INTO event_checkins (event_id, participant_id, checked_in_by, method)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (participant_id) DO NOTHING
     RETURNING id`,
    [eventId, participant.id, userId, method],
  );
  const person = await personById(eventId, participant.id);
  return { result: ins.rows.length ? 'checked_in' : 'already', participant: personOut(person) };
}

/**
 * POST …/checkin/scan { code, eventId? } — a scanned or typed ticket.
 * Answers { result: 'checked_in' | 'already' | 'not_approved', participant }.
 */
async function scan(user, eventId, body) {
  await requireStaff(user, eventId);
  const b = body && typeof body === 'object' ? body : {};
  const parsed = parseScan(b.code);
  const claimed = Number.parseInt(String(b.eventId ?? parsed.eventId ?? ''), 10);
  if (Number.isInteger(claimed) && claimed > 0 && claimed !== Number(eventId)) {
    throw httpError(409, 'This ticket is for a different event.', 'WRONG_EVENT');
  }
  if (!parsed.code) throw httpError(400, 'That is not a ticket code.', 'VALIDATION_ERROR', { errors: [{ field: 'code', message: 'Enter the 8-character code on the ticket.' }] });
  const r = await db.query(`${PERSON_SQL} WHERE p.event_id = $1 AND p.ticket_code = $2`, [eventId, parsed.code]);
  const found = r.rows[0];
  if (!found) throw httpError(404, 'No ticket with this code for this event.', 'TICKET_NOT_FOUND');
  // Not refused as an error: the scanner shows who it is and why they cannot come in.
  if (!ADMITTED.includes(found.status)) return { result: 'not_approved', participant: personOut(found) };
  return checkIn(eventId, found, user.id, 'qr');
}

/** POST …/checkin/participants/:participantId — by hand, from the list. */
async function checkInById(user, eventId, participantId) {
  await requireOrganiser(user, eventId);
  const found = await personById(eventId, Number(participantId));
  if (!found) throw httpError(404, 'Participant not found.', 'NOT_FOUND');
  if (!ADMITTED.includes(found.status)) throw httpError(409, 'This person has not been accepted to the event.', 'NOT_APPROVED');
  return checkIn(eventId, found, user.id, 'manual');
}

/** DELETE …/checkin/participants/:participantId — the check-in was a mistake. */
async function undo(user, eventId, participantId) {
  await requireOrganiser(user, eventId);
  const r = await db.query(
    'DELETE FROM event_checkins WHERE event_id = $1 AND participant_id = $2 RETURNING participant_id, checked_in_at',
    [eventId, Number(participantId)],
  );
  if (!r.rows.length) throw httpError(404, 'This person is not checked in.', 'NOT_CHECKED_IN');
  const person = await personById(eventId, Number(participantId));
  return { result: 'undone', participant: personOut(person), wasCheckedInAt: iso(r.rows[0].checked_in_at) };
}

function escapeLike(s) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** GET …/checkin?q=&filter=all|in|out&limit=&offset= — the organisers' list. */
async function list(user, eventId, query = {}) {
  await requireOrganiser(user, eventId);
  await ensureCodes(eventId);
  const params = [eventId, ADMITTED];
  const where = ['p.event_id = $1', 'LOWER(p.status) = ANY($2::text[])'];
  const q = String(query.q ?? '').trim().slice(0, 100);
  if (q) {
    params.push(`%${escapeLike(q)}%`);
    const n = params.length;
    where.push(`(u.full_name ILIKE $${n} OR u.email ILIKE $${n} OR mt.name ILIKE $${n} OR p.ticket_code ILIKE $${n})`);
  }
  const filter = String(query.filter ?? 'all');
  if (filter === 'in') where.push('c.id IS NOT NULL');
  else if (filter === 'out') where.push('c.id IS NULL');
  const limit = Math.min(Math.max(Number.parseInt(String(query.limit ?? ''), 10) || 50, 1), LIST_MAX);
  const offset = Math.max(Number.parseInt(String(query.offset ?? ''), 10) || 0, 0);
  const whereSql = where.join(' AND ');
  const [rows, count, s] = await Promise.all([
    db.query(
      `${PERSON_SQL} WHERE ${whereSql}
        ORDER BY c.checked_in_at DESC NULLS LAST, u.full_name ASC, p.id ASC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    db.query(
      `SELECT COUNT(*)::int AS n FROM participants p
         JOIN users u ON u.id = p.user_id${TEAM_JOIN}
         LEFT JOIN event_checkins c ON c.participant_id = p.id
        WHERE ${whereSql}`,
      params,
    ),
    stats(eventId),
  ]);
  return {
    stats: s,
    total: count.rows[0]?.n ?? 0,
    limit,
    offset,
    items: rows.rows.map((r) => ({ ...personOut(r, { withEmail: true }), code: r.ticket_code || null })),
  };
}

/** GET …/checkin/stats — the counts, for the scanner screen. */
async function statsFor(user, eventId) {
  const access = await requireStaff(user, eventId);
  return { ...(await stats(eventId)), canManage: Boolean(access.manage) };
}

/** Rows for GET …/checkin/export.csv. */
async function exportRows(user, eventId) {
  await requireOrganiser(user, eventId);
  await ensureCodes(eventId);
  const r = await db.query(
    `${PERSON_SQL} WHERE p.event_id = $1 AND LOWER(p.status) = ANY($2::text[])
      ORDER BY u.full_name ASC, p.id ASC`,
    [eventId, ADMITTED],
  );
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'E-mail' },
    { key: 'team', header: 'Team' },
    { key: 'status', header: 'Status' },
    { key: 'code', header: 'Ticket code' },
    { key: 'checkedIn', header: 'Checked in', value: (row) => (row.checkedIn ? 'yes' : 'no') },
    { key: 'checkedInAt', header: 'Checked in at' },
    { key: 'checkedInBy', header: 'Checked in by', value: (row) => row.checkedInBy?.name || '' },
    { key: 'method', header: 'Method' },
  ];
  const rows = r.rows.map((row) => ({ ...personOut(row, { withEmail: true }), code: row.ticket_code || null }));
  return { columns, rows };
}

module.exports = {
  ALPHABET,
  CODE_LENGTH,
  generateCode,
  parseScan,
  ticketFor,
  scan,
  checkInById,
  undo,
  list,
  statsFor,
  exportRows,
};
