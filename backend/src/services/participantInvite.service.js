/**
 * @file participantInvite.service.js
 * @description Personal invitations to register for an event: the
 * organiser's Invitations screen.
 *
 * An invitation is an `event_invites` row with role 'hacker' (the same rows
 * the registration already honours): an address, optionally a name and a
 * team from the organiser's list, an expiry, and the e-mail with a personal
 * link to the event's registration form:
 *
 *   <site>/e/<slug>/register?inviteToken=<token>
 *
 * The token (inviteToken.js) is bound to the invitation's address and its
 * nonce, so it opens the form for that address only, works on an
 * invite-only event, gets its person past a closed window or a full event
 * (the organiser said "this person"), and dies when the invitation is
 * withdrawn, expires or is used. Inviting an address again after that gives
 * it a new nonce, so the old links stay dead.
 *
 * Statuses, from the row: not_sent (the e-mail did not go out), sent,
 * opened (the link opened the registration page), registered, expired,
 * revoked.
 *
 * Limits: 500 addresses a request, a resend of the same invitation once
 * every few minutes, and at most DAILY_SEND_CAP invitation e-mails per
 * event a day (the routes also rate-limit each account).
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const inviteTokens = require('./inviteToken');
const { inviteState } = require('./invite.service');
const emailService = require('./email.service');
const { eventSender } = require('./eventSender');
const { resolveFrontendBaseUrl } = require('../utils/frontendUrl');
const participantAdmin = require('./participantAdmin.service');

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;
const DEFAULT_TTL_DAYS = 14;
const MAX_TTL_DAYS = 60;
const MAX_BATCH = 500;
const DAILY_SEND_CAP = Number(process.env.INVITE_DAILY_SEND_CAP) > 0 ? Math.floor(Number(process.env.INVITE_DAILY_SEND_CAP)) : 2000;
const RESEND_COOLDOWN_MIN = 5;
const SEND_CONCURRENCY = 6;
const STATUSES = ['not_sent', 'sent', 'opened', 'registered', 'expired', 'revoked'];

const DAY = 24 * 3600e3;
const iso = (d) => (d ? new Date(d).toISOString() : null);
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Where an invitation stands for the screen. */
function statusOf(row, now = Date.now()) {
  const state = inviteState(row, now);
  if (state === 'revoked') return 'revoked';
  if (state === 'used') return 'registered';
  if (state === 'expired') return 'expired';
  if (row.opened_at) return 'opened';
  if (row.last_sent_at || row.sent_at) return 'sent';
  return 'not_sent';
}

/**
 * The organiser's list, checked: addresses trimmed and lower-cased, names
 * and teams cleaned, duplicates (the same address twice) kept once.
 *
 * @param {Array<{ email, fullName?, team? }|string>} list
 * @returns {{ valid: Array<{ email, fullName, team }>, invalid: Array<{ value, reason }>, duplicates: string[] }}
 */
function parseInvitees(list) {
  const valid = [];
  const invalid = [];
  const duplicates = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const item = typeof raw === 'string' ? { email: raw } : raw && typeof raw === 'object' ? raw : {};
    const email = String(item.email ?? '').trim().toLowerCase();
    if (!email) continue;
    if (email.length > 255 || !EMAIL_RE.test(email)) { invalid.push({ value: email.slice(0, 255), reason: 'invalid_email' }); continue; }
    if (seen.has(email)) { duplicates.push(email); continue; }
    seen.add(email);
    const fullName = clean(item.fullName ?? item.full_name ?? item.name, 200);
    const team = clean(item.team ?? item.teamName ?? item.team_name, 80);
    if (/[<>]/.test(fullName) || /[<>]/.test(team)) { invalid.push({ value: email, reason: 'invalid_text' }); continue; }
    valid.push({ email, fullName: fullName || null, team: team || null });
  }
  return { valid, invalid, duplicates };
}

async function eventFor(eventId) {
  const r = await db.query(
    `SELECT id, name, slug, event_code, language, visibility, is_published, status, archived_at,
            start_date, end_date, registration_mode
       FROM events WHERE id = $1`,
    [eventId],
  );
  if (!r.rows[0]) throw httpError(404, 'Event not found', 'NOT_FOUND');
  return r.rows[0];
}

const isArchived = (e) => Boolean(e.archived_at) || String(e.status || '').toLowerCase() === 'archived';

function assertCanInvite(event) {
  if (isArchived(event)) throw httpError(409, 'The event is archived.', 'EVENT_ARCHIVED');
  if (!event.is_published) {
    throw httpError(409, 'Publish the event first: the invitation opens its registration page.', 'EVENT_NOT_PUBLISHED');
  }
}

/** The personal registration link of an invitation row. */
function registerUrl(event, row, via = 'mail') {
  const key = event.slug || String(event.event_code || '').toLowerCase();
  return `${resolveFrontendBaseUrl()}/e/${encodeURIComponent(key)}/register?inviteToken=${encodeURIComponent(inviteTokens.sign(row, via))}`;
}

function present(row, now = Date.now()) {
  return {
    id: Number(row.id),
    email: row.email,
    fullName: row.full_name || null,
    team: row.team_name || null,
    status: statusOf(row, now),
    createdAt: iso(row.created_at),
    sentAt: iso(row.last_sent_at || row.sent_at),
    sendCount: Number(row.send_count) || 0,
    openedAt: iso(row.opened_at),
    registeredAt: iso(row.used_at),
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
    invitedBy: row.inviter_name || null,
    // The registration it led to, as the participants page shows it.
    participantStatus: row.participant_status ? String(row.participant_status).toLowerCase() : null,
  };
}

/** Seats: the event's limit, who holds one, and the invitations still open (they get in regardless). */
async function capacityOf(eventId) {
  const [summary, open] = await Promise.all([
    participantAdmin.summary(eventId),
    db.query(
      `SELECT COUNT(*)::int AS n FROM event_invites
        WHERE event_id = $1 AND role = 'hacker' AND used_at IS NULL AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())`,
      [eventId],
    ),
  ]);
  const { limit, taken } = summary.capacity;
  const outstanding = open.rows[0].n;
  return {
    limit,
    taken,
    outstanding,
    remaining: limit == null ? null : Math.max(0, limit - taken),
    // If everyone invited registered: how far over the limit the event would go.
    overBy: limit == null ? 0 : Math.max(0, taken + outstanding - limit),
  };
}

async function rowsOf(eventId, ids = null) {
  const r = await db.query(
    `SELECT i.*, inv.full_name AS inviter_name, p.status AS participant_status
       FROM event_invites i
       LEFT JOIN users inv ON inv.id = i.invited_by
       LEFT JOIN participants p ON p.event_id = i.event_id AND p.user_id = i.user_id
      WHERE i.event_id = $1 AND i.role = 'hacker' ${ids ? 'AND i.id = ANY($2::int[])' : ''}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT 10000`,
    ids ? [eventId, ids] : [eventId],
  );
  return r.rows;
}

/** GET /api/events/:eventId/participant-invites — the screen. */
async function list(eventId) {
  const [event, rows, capacity] = await Promise.all([eventFor(eventId), rowsOf(eventId), capacityOf(eventId)]);
  const now = Date.now();
  const items = rows.map((row) => present(row, now));
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const it of items) counts[it.status] += 1;
  return {
    event: {
      id: Number(event.id),
      name: event.name,
      slug: event.slug || null,
      visibility: event.visibility,
      published: Boolean(event.is_published),
      archived: isArchived(event),
      language: event.language,
    },
    items,
    counts: { ...counts, total: items.length },
    capacity,
    limits: { batch: MAX_BATCH, defaultDays: DEFAULT_TTL_DAYS, maxDays: MAX_TTL_DAYS, dailySends: DAILY_SEND_CAP },
  };
}

/** How many invitation e-mails the event sent in the last day. */
async function sentToday(eventId) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n FROM event_invites
      WHERE event_id = $1 AND role = 'hacker' AND last_sent_at > now() - interval '24 hours'`,
    [eventId],
  );
  return r.rows[0].n;
}

async function assertDailyRoom(eventId, wanted) {
  const used = await sentToday(eventId);
  if (used + wanted > DAILY_SEND_CAP) {
    throw httpError(
      429,
      `An event sends at most ${DAILY_SEND_CAP} invitation e-mails a day; ${Math.max(0, DAILY_SEND_CAP - used)} are left today.`,
      'DAILY_LIMIT',
      { errors: [{ field: 'left', message: String(Math.max(0, DAILY_SEND_CAP - used)) }] },
    );
  }
}

/** Sends the invitation e-mail of each row (a few at a time) and stamps the ones that went out. */
async function sendAll(event, rows, inviterName) {
  const sender = await eventSender(event.id);
  const sent = [];
  const failed = [];
  let i = 0;
  const worker = async () => {
    while (i < rows.length) {
      const row = rows[i];
      i += 1;
      // eslint-disable-next-line no-await-in-loop
      const out = await emailService.sendParticipantInvitationEmail({
        to: row.email,
        fullName: row.full_name,
        eventName: event.name,
        url: registerUrl(event, row, 'mail'),
        startDate: event.start_date,
        endDate: event.end_date,
        expiresAt: row.expires_at,
        teamName: event.registration_mode === 'solo' ? null : row.team_name,
        inviterName,
        lang: event.language,
        sender,
      }).catch((err) => ({ ok: false, message: err.message }));
      (out && out.ok ? sent : failed).push(Number(row.id));
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, rows.length) }, worker));
  if (sent.length) {
    await db.query(
      `UPDATE event_invites SET last_sent_at = now(), sent_at = COALESCE(sent_at, now()), send_count = send_count + 1
        WHERE id = ANY($1::int[])`,
      [sent],
    );
  }
  return { sent, failed };
}

function ttlDays(v) {
  if (v == null || v === '') return DEFAULT_TTL_DAYS;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TTL_DAYS) {
    throw httpError(400, `The link can work for 1 to ${MAX_TTL_DAYS} days.`, 'VALIDATION_ERROR', { errors: [{ field: 'expiresInDays', message: `1 to ${MAX_TTL_DAYS} days.` }] });
  }
  return n;
}

/**
 * POST /api/events/:eventId/participant-invites — invite a list of people.
 * Addresses already registered, already invited (and still valid), or on
 * the event's staff are skipped and said; one invited before whose
 * invitation expired or was withdrawn is invited again with a new link.
 */
async function create(eventId, actor, body = {}) {
  const event = await eventFor(eventId);
  assertCanInvite(event);
  const days = ttlDays(body.expiresInDays);
  const parsed = parseInvitees(body.invitees);
  if (parsed.valid.length > MAX_BATCH) {
    throw httpError(400, `At most ${MAX_BATCH} addresses at a time.`, 'TOO_MANY', { errors: [{ field: 'invitees', message: String(MAX_BATCH) }] });
  }
  if (!parsed.valid.length) {
    throw httpError(400, parsed.invalid.length ? 'None of these addresses is valid.' : 'Add at least one e-mail address.', 'VALIDATION_ERROR', {
      errors: parsed.invalid.slice(0, 50).map((x) => ({ field: 'invitees', message: x.value, code: x.reason })),
    });
  }
  const emails = parsed.valid.map((x) => x.email);
  const [existing, registered, staff] = await Promise.all([
    db.query('SELECT * FROM event_invites WHERE event_id = $1 AND LOWER(TRIM(email)) = ANY($2::text[])', [eventId, emails]),
    db.query(
      `SELECT LOWER(TRIM(u.email)) AS email FROM participants p JOIN users u ON u.id = p.user_id
        WHERE p.event_id = $1 AND LOWER(TRIM(u.email)) = ANY($2::text[])`,
      [eventId, emails],
    ),
    db.query(
      `SELECT LOWER(TRIM(u.email)) AS email FROM users u
        WHERE LOWER(TRIM(u.email)) = ANY($2::text[]) AND (
          EXISTS (SELECT 1 FROM judges j WHERE j.event_id = $1 AND j.user_id = u.id)
          OR EXISTS (SELECT 1 FROM mentor_assignments m WHERE m.event_id = $1 AND m.user_id = u.id)
          OR EXISTS (SELECT 1 FROM volunteers v WHERE v.event_id = $1 AND v.user_id = u.id))`,
      [eventId, emails],
    ),
  ]);
  const byEmail = new Map(existing.rows.map((r) => [String(r.email).trim().toLowerCase(), r]));
  const isRegistered = new Set(registered.rows.map((r) => r.email));
  const isStaff = new Set(staff.rows.map((r) => r.email));

  const skipped = [];
  const fresh = [];
  const again = [];
  for (const p of parsed.valid) {
    const row = byEmail.get(p.email);
    if (isRegistered.has(p.email)) { skipped.push({ email: p.email, reason: 'registered' }); continue; }
    if (isStaff.has(p.email)) { skipped.push({ email: p.email, reason: 'staff' }); continue; }
    if (!row) { fresh.push(p); continue; }
    if (row.role !== 'hacker') { skipped.push({ email: p.email, reason: row.used_at ? 'staff' : 'other_role' }); continue; }
    const state = inviteState(row);
    if (state === 'used') { skipped.push({ email: p.email, reason: 'registered' }); continue; }
    if (state === 'live') { skipped.push({ email: p.email, reason: 'already_invited', id: Number(row.id) }); continue; }
    again.push({ ...p, id: Number(row.id) });
  }
  const toSend = fresh.length + again.length;
  if (toSend) await assertDailyRoom(eventId, toSend);

  const expires = new Date(Date.now() + days * DAY);
  const rows = [];
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of fresh) {
      // eslint-disable-next-line no-await-in-loop
      const r = await client.query(
        `INSERT INTO event_invites (event_id, email, role, full_name, team_name, expires_at, token_nonce, invited_by)
         VALUES ($1, $2, 'hacker', $3, $4, $5, $6, $7)
         ON CONFLICT (event_id, email) DO NOTHING
         RETURNING *`,
        [eventId, p.email, p.fullName, p.team, expires, inviteTokens.newNonce(), actor?.id ?? null],
      );
      if (r.rows[0]) rows.push({ row: r.rows[0], again: false });
      else skipped.push({ email: p.email, reason: 'already_invited' });
    }
    for (const p of again) {
      // A new invitation for the same address: a new nonce, so the old links stay dead.
      // eslint-disable-next-line no-await-in-loop
      const r = await client.query(
        `UPDATE event_invites SET revoked_at = NULL, revoked_by = NULL, opened_at = NULL, expires_at = $3,
                token_nonce = $4, invited_by = $5, created_at = now(),
                full_name = COALESCE($6, full_name), team_name = COALESCE($7, team_name)
          WHERE id = $1 AND event_id = $2 AND role = 'hacker' AND used_at IS NULL
          RETURNING *`,
        [p.id, eventId, expires, inviteTokens.newNonce(), actor?.id ?? null, p.fullName, p.team],
      );
      if (r.rows[0]) rows.push({ row: r.rows[0], again: true });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const { sent, failed } = await sendAll(event, rows.map((x) => x.row), actor?.full_name);
  return {
    created: rows.filter((x) => !x.again).map((x) => Number(x.row.id)),
    reinvited: rows.filter((x) => x.again).map((x) => Number(x.row.id)),
    sent: sent.length,
    failed: failed.length,
    failedIds: failed,
    skipped,
    invalid: parsed.invalid,
    duplicates: parsed.duplicates.length,
    capacity: await capacityOf(eventId),
  };
}

const cleanIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_BATCH);

/**
 * POST …/resend { ids } — the e-mail again. An expired invitation is given
 * a new expiry (its link is the same); withdrawn and used ones are skipped,
 * as is one sent minutes ago.
 */
async function resend(eventId, actor, ids) {
  const event = await eventFor(eventId);
  assertCanInvite(event);
  const list_ = cleanIds(ids);
  if (!list_.length) throw httpError(400, 'Choose the invitations to send again.', 'VALIDATION_ERROR');
  const rows = await rowsOf(eventId, list_);
  const skipped = [];
  const due = [];
  const now = Date.now();
  for (const row of rows) {
    const state = inviteState(row, now);
    if (state === 'revoked' || state === 'used') { skipped.push({ id: Number(row.id), email: row.email, reason: state === 'used' ? 'registered' : 'revoked' }); continue; }
    if (row.last_sent_at && now - new Date(row.last_sent_at).getTime() < RESEND_COOLDOWN_MIN * 60e3) {
      skipped.push({ id: Number(row.id), email: row.email, reason: 'cooldown' });
      continue;
    }
    due.push(row);
  }
  if (due.length) await assertDailyRoom(eventId, due.length);
  const expired = due.filter((r) => inviteState(r, now) === 'expired').map((r) => Number(r.id));
  if (expired.length) {
    const r = await db.query(
      `UPDATE event_invites SET expires_at = now() + make_interval(days => $2::int) WHERE id = ANY($1::int[]) RETURNING id, expires_at`,
      [expired, DEFAULT_TTL_DAYS],
    );
    const fresh = new Map(r.rows.map((x) => [Number(x.id), x.expires_at]));
    for (const row of due) if (fresh.has(Number(row.id))) row.expires_at = fresh.get(Number(row.id));
  }
  const { sent, failed } = await sendAll(event, due, actor?.full_name);
  return { sent: sent.length, sentIds: sent, failed: failed.length, failedIds: failed, renewed: expired.length, skipped };
}

/** POST …/revoke { ids } — the links stop working at once. Registered people stay registered. */
async function revoke(eventId, actor, ids) {
  await eventFor(eventId);
  const list_ = cleanIds(ids);
  if (!list_.length) throw httpError(400, 'Choose the invitations to withdraw.', 'VALIDATION_ERROR');
  const r = await db.query(
    `UPDATE event_invites SET revoked_at = now(), revoked_by = $3
      WHERE event_id = $1 AND id = ANY($2::int[]) AND role = 'hacker' AND used_at IS NULL AND revoked_at IS NULL
      RETURNING id, email`,
    [eventId, list_, actor?.id ?? null],
  );
  const done = new Set(r.rows.map((x) => Number(x.id)));
  return { revoked: r.rows.map((x) => Number(x.id)), skipped: list_.filter((id) => !done.has(id)).map((id) => ({ id, reason: 'not_open' })) };
}

/**
 * GET …/:id/link — the personal link, for the organiser to pass on by hand.
 * It opens the form for the invited address only. Unlike the e-mailed link
 * it does not prove the address: the new account still confirms it.
 */
async function link(eventId, id) {
  const event = await eventFor(eventId);
  assertCanInvite(event);
  const row = (await rowsOf(eventId, [Number(id)]))[0];
  if (!row) throw httpError(404, 'Invitation not found', 'NOT_FOUND');
  const state = inviteState(row);
  if (state === 'revoked') throw httpError(409, 'This invitation was withdrawn.', 'INVITE_REVOKED');
  if (state === 'used') throw httpError(409, 'This invitation has already been used.', 'INVITE_USED');
  if (state === 'expired') throw httpError(409, 'This invitation has expired. Send it again to renew it.', 'INVITE_EXPIRED');
  return { id: Number(row.id), email: row.email, url: registerUrl(event, row, 'link'), expiresAt: iso(row.expires_at) };
}

/** The rows of the CSV export (sendCsv escapes every cell against formulas). */
async function exportRows(eventId) {
  const now = Date.now();
  return (await rowsOf(eventId)).map((row) => present(row, now));
}

/**
 * GET /api/public/invitations/:token — what the registration page needs to
 * know about the invitation its link carries: whose it is (to fill in the
 * address), the team, and whether it still works. The first look marks the
 * invitation "opened". Withdrawn or expired invitations say only that.
 */
async function preview(token) {
  const parsed = inviteTokens.parse(token);
  const row = parsed ? (await db.query("SELECT * FROM event_invites WHERE id = $1 AND role = 'hacker'", [parsed.inviteId])).rows[0] : null;
  if (!row || !inviteTokens.check(token, row)) return null;
  const event = (await db.query('SELECT id, slug, event_code, name, is_published, status, archived_at FROM events WHERE id = $1', [row.event_id])).rows[0];
  if (!event || !event.is_published || isArchived(event)) return null;
  const state = inviteState(row);
  const base = { status: state, event: { slug: event.slug || null, name: event.name } };
  if (state !== 'live') return state === 'expired' ? { ...base, expiresAt: iso(row.expires_at) } : base;
  if (!row.opened_at) await db.query('UPDATE event_invites SET opened_at = now() WHERE id = $1 AND opened_at IS NULL', [row.id]);
  let team = null;
  if (row.team_name) {
    const t = await db.query('SELECT 1 FROM teams WHERE event_id = $1 AND LOWER(TRIM(name)) = LOWER($2) LIMIT 1', [row.event_id, row.team_name]);
    team = { name: row.team_name, exists: t.rows.length > 0 };
  }
  return { ...base, email: String(row.email).trim().toLowerCase(), fullName: row.full_name || null, team, expiresAt: iso(row.expires_at) };
}

module.exports = {
  list,
  create,
  resend,
  revoke,
  link,
  exportRows,
  preview,
  parseInvitees,
  statusOf,
  capacityOf,
  STATUSES,
  MAX_BATCH,
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
  DAILY_SEND_CAP,
  RESEND_COOLDOWN_MIN,
};
