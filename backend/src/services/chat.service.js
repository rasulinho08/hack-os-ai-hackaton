/**
 * @file chat.service.js
 * @description Event chat: who reads and writes which channel, messages,
 * and the organisers' moderation (remove, lock, mute, reports).
 *
 * Channels (see migration 0023):
 *   general  organisers, judges, mentors, volunteers and accepted
 *            participants. With blind judging the judges stay out: the
 *            channel is full of names and teams.
 *   team     the team's members (organisers too, for moderation).
 *   support  one person's thread with the organisers: any participant still
 *            in the event (not rejected or eliminated) and any staff member.
 *   ticket   a help request: the person who asked, their team, the mentors
 *            (the assigned one writes, others read) and the organisers.
 *
 * The plan decides what exists: general, team and support need the 'chat'
 * module, ticket threads the 'mentors' module. The organiser switches the
 * first three in the builder (comms_config.chat). Locked channels and muted
 * people leave writing to the organisers; a muted person can still write in
 * their own support thread, to talk about it.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { isAdminUser, isOwnerUser } = require('../utils/authz');
const { forEvent } = require('./entitlement.service');
const { withDefaults } = require('./eventBuilderInput');
const bus = require('./chatBus');

const MAX_BODY = 2000;
const PAGE = 50;
const MAX_AFTER = 200;
const ORG_MANAGER_ROLES = ['owner', 'admin', 'organizer'];
/** Participants still in the event, for support threads. */
const SUPPORT_STATUSES = ['approved', 'pending', 'waitlisted'];
/** Participants who write in a team channel. */
const TEAM_STATUSES = ['approved', 'pending'];

const notFound = () => httpError(404, 'Chat not found', 'NOT_FOUND');
const forbidden = (message = 'You cannot do this in this chat.', code = 'FORBIDDEN') => httpError(403, message, code);

/* ── Who is asking ──────────────────────────────────────────────────────── */

/**
 * The caller's place in the event. `user` is req.user after eventAccess:
 * an admin-like role here means they organise this event (the tenant check
 * already ran); otherwise the memberships decide.
 */
async function actorFor(user, eventId) {
  const r = await db.query(
    `SELECT
       EXISTS (SELECT 1 FROM judges WHERE event_id = $2 AND user_id = $1) AS judge,
       EXISTS (SELECT 1 FROM mentor_assignments WHERE event_id = $2 AND user_id = $1) AS mentor,
       EXISTS (SELECT 1 FROM volunteers WHERE event_id = $2 AND user_id = $1) AS volunteer,
       (SELECT LOWER(TRIM(COALESCE(status::text, 'pending'))) FROM participants
         WHERE event_id = $2 AND user_id = $1 LIMIT 1) AS participant_status,
       (SELECT t.id FROM team_members tm JOIN teams t ON t.id = tm.team_id
         WHERE tm.user_id = $1 AND t.event_id = $2 LIMIT 1) AS team_id,
       (SELECT CASE WHEN m.until IS NULL OR m.until > now() THEN COALESCE(m.until::text, 'forever') END
          FROM chat_mutes m WHERE m.event_id = $2 AND m.user_id = $1) AS muted_until`,
    [user.id, eventId],
  );
  const row = r.rows[0];
  return {
    userId: user.id,
    organizer: isOwnerUser(user) || isAdminUser(user),
    judge: row.judge,
    mentor: row.mentor,
    volunteer: row.volunteer,
    participantStatus: row.participant_status,
    teamId: row.team_id,
    muted: row.muted_until != null,
    mutedUntil: row.muted_until && row.muted_until !== 'forever' ? new Date(row.muted_until).toISOString() : null,
  };
}

const isStaff = (a) => a.judge || a.mentor || a.volunteer;

/** What the event offers: plan modules, the organiser's switches, blind judging. */
async function settingsFor(eventId) {
  const [scope, ev] = await Promise.all([
    forEvent(eventId),
    db.query(
      `SELECT id, name, comms_config, judging_config, mentor_config,
              LOWER(TRIM(COALESCE(status::text, ''))) = 'archived' AS archived
         FROM events WHERE id = $1`,
      [eventId],
    ),
  ]);
  const event = ev.rows[0];
  if (!event) throw notFound();
  const has = (m) => !scope || scope.modules.has(m);
  const chat = withDefaults('comms_config', event.comms_config).chat;
  const chatOn = has('chat');
  return {
    event,
    general: chatOn && chat.general,
    team: chatOn && chat.team,
    support: chatOn && chat.support,
    ticket: has('mentors'),
    chatModule: chatOn,
    archived: Boolean(event.archived),
    blind: Boolean(withDefaults('judging_config', event.judging_config).blind),
  };
}

/* ── Access ─────────────────────────────────────────────────────────────── */

/**
 * { read, post, moderate } for a channel row (with team_status, ticket
 * requester / mentor / team when it is a ticket thread).
 */
function accessOf(actor, ch, settings) {
  const none = { read: false, post: false, moderate: false };
  if (!settings[ch.kind]) return none;
  const locked = Boolean(ch.locked_at);
  if (actor.organizer) return { read: true, post: true, moderate: true };

  if (ch.kind === 'general') {
    const inside = (isStaff(actor) && !(settings.blind && actor.judge && !actor.mentor && !actor.volunteer))
      || actor.participantStatus === 'approved';
    return inside ? { read: true, post: !locked && !actor.muted, moderate: false } : none;
  }
  if (ch.kind === 'team') {
    const member = actor.teamId != null && Number(actor.teamId) === Number(ch.team_id)
      && TEAM_STATUSES.includes(actor.participantStatus);
    if (!member) return none;
    const eliminated = String(ch.team_status || '').toLowerCase() === 'eliminated';
    return { read: true, post: !locked && !actor.muted && !eliminated, moderate: false };
  }
  if (ch.kind === 'support') {
    const own = Number(ch.user_id) === Number(actor.userId)
      && (isStaff(actor) || SUPPORT_STATUSES.includes(actor.participantStatus));
    return own ? { read: true, post: true, moderate: false } : none;
  }
  if (ch.kind === 'ticket') {
    const asked = Number(ch.requester_id) === Number(actor.userId)
      || (ch.ticket_team_id != null && Number(ch.ticket_team_id) === Number(actor.teamId));
    if (asked && !['rejected', 'eliminated'].includes(actor.participantStatus)) {
      return { read: true, post: !actor.muted, moderate: false };
    }
    if (actor.mentor) {
      const mine = ch.ticket_mentor_id == null || Number(ch.ticket_mentor_id) === Number(actor.userId);
      return { read: true, post: mine && !actor.muted, moderate: false };
    }
    return none;
  }
  return none;
}

// A help request's thread takes its team from the request.
const CHANNEL_SQL = `
  SELECT c.*, t.name AS team_name, LOWER(COALESCE(t.status, 'active')) AS team_status,
         u.full_name AS person_name,
         h.requester_id, h.team_id AS ticket_team_id, h.mentor_id AS ticket_mentor_id,
         h.topic AS ticket_topic, h.status AS ticket_status
    FROM chat_channels c
    LEFT JOIN help_tickets h ON h.id = c.ticket_id
    LEFT JOIN teams t ON t.id = COALESCE(c.team_id, h.team_id)
    LEFT JOIN users u ON u.id = c.user_id`;

/** A channel of this event the caller may read, with its access, or 404. */
async function openChannel(user, eventId, channelId) {
  const id = Number.parseInt(String(channelId), 10);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  const ch = (await db.query(`${CHANNEL_SQL} WHERE c.id = $1 AND c.event_id = $2`, [id, eventId])).rows[0];
  if (!ch) throw notFound();
  const [actor, settings] = await Promise.all([actorFor(user, eventId), settingsFor(eventId)]);
  const access = accessOf(actor, ch, settings);
  if (!access.read) throw notFound();
  return { ch, actor, settings, access };
}

/* ── Channels ───────────────────────────────────────────────────────────── */

async function ensureChannel(kind, eventId, { teamId = null, userId = null, ticketId = null } = {}) {
  const conflict = {
    general: '(event_id) WHERE kind = \'general\'',
    support: '(event_id, user_id) WHERE kind = \'support\'',
    team: '(team_id) WHERE kind = \'team\'',
    ticket: '(ticket_id) WHERE kind = \'ticket\'',
  }[kind];
  await db.query(
    `INSERT INTO chat_channels (event_id, kind, team_id, user_id, ticket_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ${conflict} DO NOTHING`,
    [eventId, kind, teamId, userId, ticketId],
  );
  const where = {
    general: 'c.event_id = $1 AND c.kind = \'general\'',
    support: 'c.event_id = $1 AND c.kind = \'support\' AND c.user_id = $2',
    team: 'c.event_id = $1 AND c.kind = \'team\' AND c.team_id = $2',
    ticket: 'c.event_id = $1 AND c.kind = \'ticket\' AND c.ticket_id = $2',
  }[kind];
  const key = { general: [], support: [userId], team: [teamId], ticket: [ticketId] }[kind];
  return (await db.query(`${CHANNEL_SQL} WHERE ${where}`, [eventId, ...key])).rows[0];
}

/** Unread counts and the newest message of each channel, for the caller. */
async function summaries(channelIds, userId) {
  if (!channelIds.length) return new Map();
  const r = await db.query(
    `SELECT c.id,
            (SELECT COUNT(*)::int FROM chat_messages m
              WHERE m.channel_id = c.id AND m.id > COALESCE(rd.last_read_id, 0)
                AND m.deleted_at IS NULL AND m.author_id IS DISTINCT FROM $2) AS unread,
            COALESCE(rd.last_read_id, 0) AS last_read_id,
            lm.id AS last_id, lm.body AS last_body, lm.created_at AS last_at, lm.deleted_at AS last_deleted,
            au.full_name AS last_author
       FROM chat_channels c
       LEFT JOIN chat_reads rd ON rd.channel_id = c.id AND rd.user_id = $2
       LEFT JOIN LATERAL (SELECT * FROM chat_messages m WHERE m.channel_id = c.id ORDER BY m.id DESC LIMIT 1) lm ON true
       LEFT JOIN users au ON au.id = lm.author_id
      WHERE c.id = ANY($1::int[])`,
    [channelIds, userId],
  );
  return new Map(r.rows.map((x) => [x.id, x]));
}

function channelView(ch, access, summary) {
  return {
    id: ch.id,
    kind: ch.kind,
    teamId: ch.team_id ?? ch.ticket_team_id ?? null,
    teamName: ch.team_name || null,
    userId: ch.user_id,
    personName: ch.kind === 'support' ? ch.person_name || null : null,
    ticketId: ch.ticket_id,
    ticketTopic: ch.ticket_topic || null,
    ticketStatus: ch.ticket_status || null,
    locked: Boolean(ch.locked_at),
    canPost: access.post,
    canModerate: access.moderate,
    unread: summary?.unread ?? 0,
    lastReadId: summary ? Number(summary.last_read_id) : 0,
    lastMessage: summary?.last_id ? {
      id: Number(summary.last_id),
      preview: summary.last_deleted ? null : String(summary.last_body || '').slice(0, 140),
      at: summary.last_at,
      authorName: summary.last_author || null,
    } : null,
  };
}

/**
 * GET /chat: the caller's channels. Organisers get the general channel and
 * every team, support and ticket thread that has messages; everyone else the
 * channels that are theirs (created on first sight).
 */
async function listChannels(user, eventId) {
  const [actor, settings] = await Promise.all([actorFor(user, eventId), settingsFor(eventId)]);
  const rows = [];
  const probe = (kind, extra = {}) => ({ kind, locked_at: null, ...extra });

  if (settings.general && accessOf(actor, probe('general'), settings).read) rows.push(await ensureChannel('general', eventId));
  if (actor.organizer) {
    const r = await db.query(
      `${CHANNEL_SQL} WHERE c.event_id = $1 AND c.kind <> 'general' AND c.last_message_at IS NOT NULL
        ORDER BY c.last_message_at DESC LIMIT 300`,
      [eventId],
    );
    rows.push(...r.rows.filter((ch) => settings[ch.kind]));
  } else {
    if (settings.team && actor.teamId != null && TEAM_STATUSES.includes(actor.participantStatus)) {
      rows.push(await ensureChannel('team', eventId, { teamId: actor.teamId }));
    }
    if (settings.support && accessOf(actor, probe('support', { user_id: actor.userId }), settings).read) {
      rows.push(await ensureChannel('support', eventId, { userId: actor.userId }));
    }
    if (settings.ticket) {
      const r = await db.query(
        `${CHANNEL_SQL} WHERE c.event_id = $1 AND c.kind = 'ticket'
            AND (h.requester_id = $2 OR ($3::int IS NOT NULL AND h.team_id = $3::int) OR h.mentor_id = $2)
          ORDER BY c.last_message_at DESC NULLS LAST LIMIT 100`,
        [eventId, actor.userId, actor.teamId],
      );
      rows.push(...r.rows);
    }
  }

  const visible = rows.filter(Boolean).map((ch) => ({ ch, access: accessOf(actor, ch, settings) })).filter((x) => x.access.read);
  const sums = await summaries(visible.map((x) => x.ch.id), actor.userId);
  let reports = null;
  if (actor.organizer) {
    reports = (await db.query('SELECT COUNT(DISTINCT message_id)::int AS n FROM chat_reports WHERE event_id = $1 AND resolved_at IS NULL', [eventId])).rows[0].n;
  }
  return {
    enabled: { general: settings.general, team: settings.team, support: settings.support, ticket: settings.ticket },
    // Whether the plan has the chat at all (the switches above can be off for either reason).
    chatModule: settings.chatModule,
    // Archived events keep their chat to read.
    archived: settings.archived,
    me: { userId: actor.userId, organizer: actor.organizer, muted: actor.muted, mutedUntil: actor.mutedUntil },
    openReports: reports,
    channels: visible.map(({ ch, access }) => channelView(ch, access, sums.get(ch.id))),
  };
}

/** GET /chat/tickets/:ticketId — the thread of a help request (opened on first use). */
async function ticketChannel(user, eventId, ticketId) {
  const id = Number.parseInt(String(ticketId), 10);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  const ticket = (await db.query('SELECT id FROM help_tickets WHERE id = $1 AND event_id = $2', [id, eventId])).rows[0];
  if (!ticket) throw notFound();
  const [actor, settings] = await Promise.all([actorFor(user, eventId), settingsFor(eventId)]);
  if (!settings.ticket) throw httpError(403, 'Help request threads are not part of the plan this event runs on.', 'MODULE_DISABLED');
  // Check before creating: nobody opens a thread they could not read.
  const probe = (await db.query(
    `SELECT 'ticket' AS kind, NULL::timestamptz AS locked_at, h.requester_id, h.team_id AS ticket_team_id, h.mentor_id AS ticket_mentor_id
       FROM help_tickets h WHERE h.id = $1`,
    [id],
  )).rows[0];
  if (!accessOf(actor, probe, settings).read) throw notFound();
  const ch = await ensureChannel('ticket', eventId, { ticketId: id });
  const access = accessOf(actor, ch, settings);
  const sums = await summaries([ch.id], actor.userId);
  return {
    ...channelView(ch, access, sums.get(ch.id)),
    archived: settings.archived,
    me: { muted: actor.muted, mutedUntil: actor.mutedUntil },
  };
}

/** GET /chat/channels/:id — one channel the caller may read (a link from the bell). */
async function channel(user, eventId, channelId) {
  const { ch, actor, settings, access } = await openChannel(user, eventId, channelId);
  const sums = await summaries([ch.id], actor.userId);
  return {
    ...channelView(ch, access, sums.get(ch.id)),
    archived: settings.archived,
    me: { muted: actor.muted, mutedUntil: actor.mutedUntil },
  };
}

/* ── Messages ───────────────────────────────────────────────────────────── */

/** Each author's place in the event, for the badge next to their name. */
const MESSAGE_SQL = `
  SELECT m.id, m.channel_id, m.author_id, m.body, m.created_at, m.deleted_at,
         u.full_name AS author_name, u.avatar AS author_avatar,
         CASE
           WHEN e.created_by = m.author_id OR LOWER(COALESCE(u.role, '')) = 'superadmin'
             OR EXISTS (SELECT 1 FROM customer_contacts cc WHERE cc.user_id = m.author_id
                         AND cc.customer_id = e.customer_id AND cc.member_role = ANY($ROLES::text[])) THEN 'organizer'
           WHEN EXISTS (SELECT 1 FROM judges j WHERE j.event_id = m.event_id AND j.user_id = m.author_id) THEN 'judge'
           WHEN EXISTS (SELECT 1 FROM mentor_assignments ma WHERE ma.event_id = m.event_id AND ma.user_id = m.author_id) THEN 'mentor'
           WHEN EXISTS (SELECT 1 FROM volunteers v WHERE v.event_id = m.event_id AND v.user_id = m.author_id) THEN 'volunteer'
           ELSE 'participant'
         END AS author_role
    FROM chat_messages m
    JOIN events e ON e.id = m.event_id
    LEFT JOIN users u ON u.id = m.author_id`;

function messageView(m, viewerId) {
  const removed = Boolean(m.deleted_at);
  return {
    id: Number(m.id),
    channelId: m.channel_id,
    author: m.author_id ? { id: m.author_id, name: m.author_name || null, role: m.author_role, avatar: m.author_avatar || null } : null,
    body: removed ? null : m.body,
    removed,
    createdAt: m.created_at,
    mine: m.author_id != null && Number(m.author_id) === Number(viewerId),
  };
}

const asCursor = (v) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

async function queryMessages(channelId, { after = null, before = null }, roleParam) {
  const sql = MESSAGE_SQL.replace('$ROLES', '$2');
  if (after != null) {
    return (await db.query(`${sql} WHERE m.channel_id = $1 AND m.id > $3 ORDER BY m.id ASC LIMIT ${MAX_AFTER}`, [channelId, roleParam, after])).rows;
  }
  if (before != null) {
    const r = await db.query(`${sql} WHERE m.channel_id = $1 AND m.id < $3 ORDER BY m.id DESC LIMIT ${PAGE}`, [channelId, roleParam, before]);
    return r.rows.reverse();
  }
  const r = await db.query(`${sql} WHERE m.channel_id = $1 ORDER BY m.id DESC LIMIT ${PAGE}`, [channelId, roleParam]);
  return r.rows.reverse();
}

/**
 * GET /chat/channels/:id/messages
 *   ?after=<id>   newer messages (with ?wait=<s>, up to 20 s, waits for some)
 *   ?before=<id>  the page before (older)
 *   ?since=<iso>  also the ids removed since then (the `at` of the last answer)
 * Answers { messages, removed, at, hasMore }.
 */
async function messages(user, eventId, channelId, query = {}, res = null) {
  const { ch, actor } = await openChannel(user, eventId, channelId);
  const after = asCursor(query.after);
  const before = after == null ? asCursor(query.before) : null;
  const since = query.since && !Number.isNaN(Date.parse(query.since)) ? new Date(query.since) : null;
  const waitS = Math.min(Math.max(Number.parseInt(String(query.wait ?? '0'), 10) || 0, 0), 20);

  const read = async () => {
    const at = (await db.query('SELECT now() AS now')).rows[0].now;
    const rows = await queryMessages(ch.id, { after, before }, ORG_MANAGER_ROLES);
    const removed = since
      ? (await db.query(
        'SELECT id FROM chat_messages WHERE channel_id = $1 AND deleted_at > $2 ORDER BY id',
        [ch.id, since],
      )).rows.map((x) => Number(x.id))
      : [];
    return { rows, removed, at };
  };

  let out = await read();
  if (after != null && waitS > 0 && !out.rows.length && !out.removed.length) {
    const woken = await bus.waitFor(ch.id, waitS * 1000, res);
    if (woken) out = await read();
  }
  const hasMore = before != null || after == null
    ? out.rows.length === PAGE
    : out.rows.length === MAX_AFTER;
  return {
    channelId: ch.id,
    messages: out.rows.map((m) => messageView(m, actor.userId)),
    removed: out.removed,
    at: out.at,
    hasMore,
  };
}

/** Plain text, one to MAX_BODY characters, without control characters (new lines and tabs stay). */
function cleanBody(raw) {
  // eslint-disable-next-line no-control-regex
  const body = String(raw ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!body) throw httpError(400, 'Write a message first.', 'VALIDATION_ERROR', { errors: [{ field: 'body', message: 'Write a message first.' }] });
  if (body.length > MAX_BODY) throw httpError(400, `A message is at most ${MAX_BODY} characters.`, 'VALIDATION_ERROR', { errors: [{ field: 'body', message: `A message is at most ${MAX_BODY} characters.` }] });
  return body;
}

/** POST /chat/channels/:id/messages { body } */
async function post(user, eventId, channelId, rawBody) {
  const { ch, actor, access } = await openChannel(user, eventId, channelId);
  if (!access.post) {
    if (actor.muted && !actor.organizer) throw forbidden('The organisers have muted you in this event\'s chat.', 'CHAT_MUTED');
    if (ch.locked_at) throw forbidden('Only the organisers write in this channel now.', 'CHAT_LOCKED');
    throw forbidden('You can read this channel but not write in it.', 'CHAT_READ_ONLY');
  }
  const body = cleanBody(rawBody);
  const client = await db.pool.connect();
  let row;
  try {
    await client.query('BEGIN');
    row = (await client.query(
      `INSERT INTO chat_messages (channel_id, event_id, author_id, body)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [ch.id, eventId, actor.userId, body],
    )).rows[0];
    await client.query('UPDATE chat_channels SET last_message_at = now() WHERE id = $1', [ch.id]);
    // One's own message is read.
    await client.query(
      `INSERT INTO chat_reads (channel_id, user_id, last_read_id) VALUES ($1, $2, $3)
       ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read_id = GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id), read_at = now()`,
      [ch.id, actor.userId, row.id],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  bus.publish(ch.id);
  const m = (await db.query(`${MESSAGE_SQL.replace('$ROLES', '$2')} WHERE m.id = $1`, [row.id, ORG_MANAGER_ROLES])).rows[0];
  return { message: messageView(m, actor.userId), channel: ch, actor };
}

/** POST /chat/channels/:id/read { lastId } — moves the caller's read mark forward. */
async function markRead(user, eventId, channelId, lastId) {
  const { ch, actor } = await openChannel(user, eventId, channelId);
  const n = asCursor(lastId);
  const top = (await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM chat_messages WHERE channel_id = $1', [ch.id])).rows[0].id;
  const mark = n == null ? Number(top) : Math.min(n, Number(top));
  await db.query(
    `INSERT INTO chat_reads (channel_id, user_id, last_read_id) VALUES ($1, $2, $3)
     ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read_id = GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id), read_at = now()`,
    [ch.id, actor.userId, mark],
  );
  return { channelId: ch.id, lastReadId: mark };
}

/** A message of this event with its channel, for removing or reporting. */
async function messageInEvent(eventId, messageId) {
  const id = Number.parseInt(String(messageId), 10);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  const m = (await db.query('SELECT id, channel_id, author_id, deleted_at FROM chat_messages WHERE id = $1 AND event_id = $2', [id, eventId])).rows[0];
  if (!m) throw notFound();
  return m;
}

/** DELETE /chat/messages/:id — its author, or an organiser. */
async function remove(user, eventId, messageId) {
  const m = await messageInEvent(eventId, messageId);
  const { access, actor } = await openChannel(user, eventId, m.channel_id);
  const own = Number(m.author_id) === Number(actor.userId);
  if (!own && !access.moderate) throw forbidden('Only the author or an organiser removes a message.');
  if (!m.deleted_at) {
    // The words go; the place in the conversation stays ("message removed").
    await db.query(
      `UPDATE chat_messages SET deleted_at = now(), deleted_by = $2, body = '' WHERE id = $1 AND deleted_at IS NULL`,
      [m.id, actor.userId],
    );
    await db.query(
      `UPDATE chat_reports SET resolved_at = now(), resolved_by = $2, resolution = 'removed'
        WHERE message_id = $1 AND resolved_at IS NULL`,
      [m.id, actor.userId],
    );
    bus.publish(m.channel_id);
  }
  return { id: Number(m.id), removed: true, byModerator: !own };
}

/** POST /chat/messages/:id/report { reason } — anyone who reads it, except its author. */
async function report(user, eventId, messageId, reason) {
  const m = await messageInEvent(eventId, messageId);
  const { actor } = await openChannel(user, eventId, m.channel_id);
  if (Number(m.author_id) === Number(actor.userId)) throw httpError(400, 'You cannot report your own message.', 'OWN_MESSAGE');
  if (m.deleted_at) return { reported: false, alreadyRemoved: true };
  const why = String(reason ?? '').trim().slice(0, 500) || null;
  const r = await db.query(
    `INSERT INTO chat_reports (message_id, event_id, reporter_id, reason) VALUES ($1, $2, $3, $4)
     ON CONFLICT (message_id, reporter_id) DO NOTHING RETURNING id`,
    [m.id, eventId, actor.userId, why],
  );
  return { reported: true, first: Boolean(r.rows[0]) };
}

/* ── Moderation (organisers) ────────────────────────────────────────────── */

async function requireOrganizer(user, eventId) {
  const actor = await actorFor(user, eventId);
  if (!actor.organizer) throw forbidden('Only the organisers moderate the chat.');
  return actor;
}

/** GET /chat/reports — reported messages not dealt with yet. */
async function listReports(user, eventId) {
  await requireOrganizer(user, eventId);
  const r = await db.query(
    `SELECT m.id AS message_id, m.channel_id, m.body, m.created_at, m.author_id, au.full_name AS author_name,
            c.kind, t.name AS team_name,
            COUNT(cr.id)::int AS reports,
            MIN(cr.created_at) AS first_reported_at,
            ARRAY_REMOVE(ARRAY_AGG(cr.reason ORDER BY cr.created_at), NULL) AS reasons
       FROM chat_reports cr
       JOIN chat_messages m ON m.id = cr.message_id
       JOIN chat_channels c ON c.id = m.channel_id
       LEFT JOIN teams t ON t.id = c.team_id
       LEFT JOIN users au ON au.id = m.author_id
      WHERE cr.event_id = $1 AND cr.resolved_at IS NULL
      GROUP BY m.id, c.id, t.name, au.full_name
      ORDER BY MIN(cr.created_at)`,
    [eventId],
  );
  return r.rows.map((x) => ({
    messageId: Number(x.message_id),
    channelId: x.channel_id,
    channelKind: x.kind,
    teamName: x.team_name || null,
    body: x.body,
    createdAt: x.created_at,
    author: x.author_id ? { id: x.author_id, name: x.author_name } : null,
    reports: x.reports,
    reasons: x.reasons.slice(0, 5),
    firstReportedAt: x.first_reported_at,
  }));
}

/** POST /chat/reports/:messageId/resolve { action: dismiss | remove } */
async function resolveReports(user, eventId, messageId, action) {
  const actor = await requireOrganizer(user, eventId);
  if (!['dismiss', 'remove'].includes(action)) throw httpError(400, 'action must be dismiss or remove', 'VALIDATION_ERROR');
  const m = await messageInEvent(eventId, messageId);
  if (action === 'remove') return remove(user, eventId, m.id);
  await db.query(
    `UPDATE chat_reports SET resolved_at = now(), resolved_by = $2, resolution = 'dismissed'
      WHERE message_id = $1 AND resolved_at IS NULL`,
    [m.id, actor.userId],
  );
  return { id: Number(m.id), dismissed: true };
}

/** POST /chat/channels/:id/lock | unlock — the general or a team channel. */
async function setLocked(user, eventId, channelId, locked) {
  const { ch, access, actor } = await openChannel(user, eventId, channelId);
  if (!access.moderate) throw forbidden('Only the organisers lock a channel.');
  if (!['general', 'team'].includes(ch.kind)) throw httpError(400, 'Only the general and team channels can be locked.', 'VALIDATION_ERROR');
  await db.query(
    'UPDATE chat_channels SET locked_at = CASE WHEN $2 THEN now() ELSE NULL END, locked_by = CASE WHEN $2 THEN $3::int ELSE NULL END WHERE id = $1',
    [ch.id, Boolean(locked), actor.userId],
  );
  bus.publish(ch.id);
  return { id: ch.id, locked: Boolean(locked) };
}

/** GET /chat/mutes */
async function listMutes(user, eventId) {
  await requireOrganizer(user, eventId);
  const r = await db.query(
    `SELECT m.user_id, u.full_name, m.until, m.reason, m.created_at, mb.full_name AS muted_by_name
       FROM chat_mutes m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN users mb ON mb.id = m.muted_by
      WHERE m.event_id = $1 AND (m.until IS NULL OR m.until > now())
      ORDER BY m.created_at DESC`,
    [eventId],
  );
  return r.rows.map((x) => ({
    userId: x.user_id, name: x.full_name, until: x.until, reason: x.reason, since: x.created_at, mutedBy: x.muted_by_name || null,
  }));
}

/** POST /chat/mutes { userId, minutes?, reason? } — minutes empty: until lifted. */
async function mute(user, eventId, { userId, minutes, reason } = {}) {
  const actor = await requireOrganizer(user, eventId);
  const target = Number.parseInt(String(userId ?? ''), 10);
  if (!Number.isInteger(target) || target <= 0) throw httpError(400, 'userId is required', 'VALIDATION_ERROR');
  if (target === Number(actor.userId)) throw httpError(400, 'You cannot mute yourself.', 'VALIDATION_ERROR');
  const them = (await db.query('SELECT id, role FROM users WHERE id = $1', [target])).rows[0];
  if (!them) throw notFound();
  const theirs = await actorFor({ id: target, role: 'hacker' }, eventId);
  const organiser = (await db.query(
    `SELECT 1 FROM events e WHERE e.id = $1 AND (e.created_by = $2 OR EXISTS (
       SELECT 1 FROM customer_contacts cc WHERE cc.user_id = $2 AND cc.customer_id = e.customer_id AND cc.member_role = ANY($3::text[])))`,
    [eventId, target, ORG_MANAGER_ROLES],
  )).rows.length > 0;
  if (organiser || String(them.role).toLowerCase() === 'superadmin') throw httpError(400, 'Organisers cannot be muted.', 'VALIDATION_ERROR');
  if (!isStaff(theirs) && theirs.participantStatus == null) throw httpError(400, 'This person is not on the event.', 'NOT_IN_EVENT');
  let mins = null;
  if (minutes != null && minutes !== '') {
    mins = Number.parseInt(String(minutes), 10);
    if (!Number.isInteger(mins) || mins < 1 || mins > 60 * 24 * 30) throw httpError(400, 'minutes must be between 1 and 43200', 'VALIDATION_ERROR');
  }
  const why = String(reason ?? '').trim().slice(0, 300) || null;
  await db.query(
    `INSERT INTO chat_mutes (event_id, user_id, until, reason, muted_by)
     VALUES ($1, $2, CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(mins => $3::int) END, $4, $5)
     ON CONFLICT (event_id, user_id) DO UPDATE
       SET until = EXCLUDED.until, reason = EXCLUDED.reason, muted_by = EXCLUDED.muted_by, created_at = now()`,
    [eventId, target, mins, why, actor.userId],
  );
  return { userId: target, minutes: mins };
}

/** DELETE /chat/mutes/:userId */
async function unmute(user, eventId, userId) {
  await requireOrganizer(user, eventId);
  const r = await db.query('DELETE FROM chat_mutes WHERE event_id = $1 AND user_id = $2 RETURNING user_id', [eventId, Number(userId)]);
  return { userId: Number(userId), lifted: r.rows.length > 0 };
}

/** Unread messages across the caller's channels (the notification bell). */
async function unreadTotal(user, eventId) {
  const list = await listChannels(user, eventId);
  return list.channels.reduce((n, c) => n + c.unread, 0);
}

module.exports = {
  MAX_BODY,
  actorFor,
  settingsFor,
  accessOf,
  listChannels,
  ticketChannel,
  channel,
  messages,
  post,
  markRead,
  remove,
  report,
  listReports,
  resolveReports,
  setLocked,
  listMutes,
  mute,
  unmute,
  unreadTotal,
  cleanBody,
};
