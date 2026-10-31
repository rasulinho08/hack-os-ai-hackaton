/**
 * @file platform.service.js
 * @description What the platform owner's console reads in one go: the
 * overview of every organisation and event, the health of this instance and
 * its integrations, the searchable audit trail, and the notice shown on
 * every page.
 *
 * The console used to add these up in the browser, four requests per event;
 * a total silently missed an event whose request failed. Here every number
 * comes from one query each.
 */

const db = require('../config/db');
const jobs = require('./jobs.service');
const telegram = require('./telegram.service');
const { getReadiness } = require('./mailer');
const metrics = require('../middlewares/metrics');
const { httpError } = require('../utils/responseFormat');

const NOTICE_KEY = 'notice';
const NOTICE_LEVELS = ['info', 'warning', 'critical'];
const LANGS = ['az', 'en', 'ru'];

/* ── Overview ───────────────────────────────────────────────────────────── */

/** The phase of an event, the way its organisers see it. */
const PHASE_SQL = `CASE
    WHEN LOWER(COALESCE(e.status::text, '')) = 'archived' THEN 'archived'
    WHEN NOT e.is_published THEN 'draft'
    WHEN e.start_date > now() THEN 'upcoming'
    WHEN e.end_date >= now() THEN 'running'
    ELSE 'finished'
  END`;

/**
 * GET /api/owner/overview?customerId= — totals over everything; the list of
 * events (one organisation's when customerId is given) in the order the
 * owner looks at them: running, upcoming (soonest first), drafts, finished
 * (latest first), archived. At most LIST_MAX rows, with `truncated`.
 */
const LIST_MAX = 300;

async function overview({ customerId = null, list: withList = true } = {}) {
  const cid = Number.parseInt(String(customerId ?? ''), 10);
  const forCustomer = Number.isInteger(cid) && cid > 0 ? cid : null;
  const [customers, orders, revenue, users, events, signups, totals] = await Promise.all([
    db.query(
      `SELECT status, COUNT(*)::int AS n FROM customers
        WHERE archived_at IS NULL AND ($1::int IS NULL OR id = $1::int) GROUP BY status`,
      [forCustomer],
    ),
    db.query(`SELECT status, COUNT(*)::int AS n FROM orders WHERE $1::int IS NULL OR customer_id = $1::int GROUP BY status`, [forCustomer]),
    db.query(
      `SELECT currency, SUM(amount_minor)::bigint AS paid_minor, COUNT(*)::int AS n
         FROM orders WHERE paid_at IS NOT NULL AND amount_minor IS NOT NULL AND ($1::int IS NULL OR customer_id = $1::int)
        GROUP BY currency ORDER BY currency`,
      [forCustomer],
    ),
    // Accounts: everyone on the platform, or the people of one organisation
    // (its members and everyone on its events).
    db.query(
      `WITH people AS (
         SELECT u.* FROM users u WHERE $1::int IS NULL
         UNION
         SELECT u.* FROM users u WHERE $1::int IS NOT NULL AND u.id IN (
           SELECT cc.user_id FROM customer_contacts cc WHERE cc.customer_id = $1::int
           UNION SELECT p.user_id FROM participants p JOIN events e ON e.id = p.event_id WHERE e.customer_id = $1::int
           UNION SELECT j.user_id FROM judges j JOIN events e ON e.id = j.event_id WHERE e.customer_id = $1::int
           UNION SELECT m.user_id FROM mentor_assignments m JOIN events e ON e.id = m.event_id WHERE e.customer_id = $1::int
           UNION SELECT v.user_id FROM volunteers v JOIN events e ON e.id = v.event_id WHERE e.customer_id = $1::int)
       )
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS last7,
              COUNT(*) FILTER (WHERE email_verified_at IS NULL)::int AS unverified
         FROM people`,
      [forCustomer],
    ),
    // The console's paginated /api/owner/events replaces this list; list=false skips it.
    !withList ? Promise.resolve({ rows: [] }) : db.query(
      `SELECT e.id, e.name, e.event_code, e.slug, e.customer_id, c.name AS customer_name,
              e.start_date, e.end_date, ${PHASE_SQL} AS phase,
              (SELECT COUNT(*)::int FROM participants p WHERE p.event_id = e.id) AS participants,
              (SELECT COUNT(*)::int FROM participants p WHERE p.event_id = e.id AND LOWER(p.status::text) = 'approved') AS approved,
              (SELECT COUNT(*)::int FROM participants p WHERE p.event_id = e.id AND LOWER(p.status::text) = 'pending') AS pending,
              (SELECT COUNT(*)::int FROM participants p WHERE p.event_id = e.id AND LOWER(p.status::text) = 'waitlisted') AS waitlisted,
              (SELECT COUNT(*)::int FROM teams t WHERE t.event_id = e.id) AS teams,
              (SELECT COUNT(*)::int FROM submissions s WHERE s.event_id = e.id) AS submissions,
              (SELECT COUNT(*)::int FROM help_tickets h WHERE h.event_id = e.id AND LOWER(h.status) = 'open') AS open_tickets,
              (SELECT COUNT(*)::int FROM help_tickets h WHERE h.event_id = e.id AND h.escalated_to_admin) AS escalated,
              (SELECT COUNT(*)::int FROM chat_reports r WHERE r.event_id = e.id AND r.resolved_at IS NULL) AS open_reports
         FROM events e
         LEFT JOIN customers c ON c.id = e.customer_id
        WHERE ($1::int IS NULL OR e.customer_id = $1::int)
        ORDER BY CASE ${PHASE_SQL} WHEN 'running' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'draft' THEN 2 WHEN 'finished' THEN 3 ELSE 4 END,
                 CASE WHEN ${PHASE_SQL} = 'upcoming' THEN e.start_date END ASC,
                 e.end_date DESC NULLS LAST, e.id DESC
        LIMIT ${LIST_MAX + 1}`,
      [forCustomer],
    ),
    db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              (SELECT COUNT(*)::int FROM users u WHERE u.created_at >= d AND u.created_at < d + interval '1 day'
                  AND ($1::int IS NULL OR EXISTS (
                    SELECT 1 FROM participants p JOIN events e ON e.id = p.event_id
                     WHERE p.user_id = u.id AND e.customer_id = $1::int))) AS users,
              (SELECT COUNT(*)::int FROM participants p JOIN events e ON e.id = p.event_id
                WHERE p.registered_at >= d AND p.registered_at < d + interval '1 day'
                  AND ($1::int IS NULL OR e.customer_id = $1::int)) AS registrations
         FROM generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') AS d
        ORDER BY d`,
      [forCustomer],
    ),
    // Totals over every event, not only the ones listed.
    db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM events e WHERE $1::int IS NULL OR e.customer_id = $1::int) AS events,
         (SELECT COUNT(*)::int FROM participants p JOIN events e ON e.id = p.event_id WHERE $1::int IS NULL OR e.customer_id = $1::int) AS participants,
         (SELECT COUNT(*)::int FROM teams t JOIN events e ON e.id = t.event_id WHERE $1::int IS NULL OR e.customer_id = $1::int) AS teams,
         (SELECT COUNT(*)::int FROM submissions s JOIN events e ON e.id = s.event_id WHERE $1::int IS NULL OR e.customer_id = $1::int) AS submissions,
         (SELECT COUNT(*)::int FROM help_tickets h JOIN events e ON e.id = h.event_id
           WHERE LOWER(h.status) = 'open' AND ($1::int IS NULL OR e.customer_id = $1::int)) AS open_tickets,
         (SELECT COUNT(*)::int FROM chat_reports r JOIN events e ON e.id = r.event_id
           WHERE r.resolved_at IS NULL AND ($1::int IS NULL OR e.customer_id = $1::int)) AS open_reports,
         (SELECT json_object_agg(phase, n) FROM (
            SELECT ${PHASE_SQL} AS phase, COUNT(*)::int AS n FROM events e
             WHERE $1::int IS NULL OR e.customer_id = $1::int GROUP BY 1) x) AS by_phase`,
      [forCustomer],
    ),
  ]);
  const byStatus = (rows) => Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const t = totals.rows[0];
  const list = events.rows.slice(0, LIST_MAX).map((e) => ({
    id: e.id,
    name: e.name,
    eventCode: e.event_code,
    slug: e.slug,
    customerId: e.customer_id,
    customerName: e.customer_name || null,
    startDate: e.start_date,
    endDate: e.end_date,
    phase: e.phase,
    participants: { total: e.participants, approved: e.approved, pending: e.pending, waitlisted: e.waitlisted },
    teams: e.teams,
    submissions: e.submissions,
    openTickets: e.open_tickets,
    escalated: e.escalated,
    openReports: e.open_reports,
  }));
  return {
    customerId: forCustomer,
    customers: byStatus(customers.rows),
    orders: byStatus(orders.rows),
    revenue: revenue.rows.map((r) => ({ currency: r.currency, paidMinor: Number(r.paid_minor), orders: r.n })),
    users: users.rows[0],
    events: {
      total: t.events,
      byPhase: t.by_phase || {},
      list,
      truncated: events.rows.length > LIST_MAX,
    },
    totals: {
      participants: t.participants,
      teams: t.teams,
      submissions: t.submissions,
      openTickets: t.open_tickets,
      openReports: t.open_reports,
    },
    signups: signups.rows,
  };
}

/* ── Health ─────────────────────────────────────────────────────────────── */

async function health() {
  const t0 = process.hrtime.bigint();
  let dbOk = true;
  let dbError = null;
  try { await db.query('SELECT 1'); } catch (err) { dbOk = false; dbError = err.message; }
  const dbMs = Number(process.hrtime.bigint() - t0) / 1e6;

  const [queue, lag, migration] = dbOk
    ? await Promise.all([
      jobs.stats(),
      db.query(`SELECT EXTRACT(EPOCH FROM (now() - MIN(run_at)))::int AS lag_s, COUNT(*)::int AS due
                  FROM jobs WHERE status IN ('queued', 'retry') AND run_at <= now()`),
      db.query('SELECT version, name, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1'),
    ])
    : [null, null, null];

  const mail = getReadiness();
  const mem = process.memoryUsage();
  // eslint-disable-next-line global-require
  const chat = require('./chatBus').status();
  return {
    checkedAt: new Date().toISOString(),
    version: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null,
    environment: process.env.NODE_ENV || 'development',
    process: {
      uptimeS: Math.round(process.uptime()),
      node: process.version,
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
    },
    database: {
      ok: dbOk,
      error: dbError,
      latencyMs: Math.round(dbMs * 10) / 10,
      pool: { total: db.pool.totalCount, idle: db.pool.idleCount, waiting: db.pool.waitingCount },
      migration: migration?.rows[0] || null,
    },
    jobs: queue ? {
      ...queue,
      due: lag.rows[0].due,
      lagSeconds: lag.rows[0].lag_s == null ? 0 : Math.max(0, lag.rows[0].lag_s),
      worker: { disabled: String(process.env.JOBS_DISABLED || '').toLowerCase() === 'true', intervalMs: Number(process.env.JOBS_INTERVAL_MS) || 15000 },
    } : null,
    requests: metrics.snapshot(15),
    integrations: {
      mail: { configured: mail.configured, provider: mail.provider, problem: mail.problem || null },
      telegram: { configured: telegram.isEnabled(), webhookReady: Boolean(telegram.webhookSecret()) },
      github: { tokenConfigured: Boolean(String(process.env.GITHUB_TOKEN || '').trim()) },
      autoArchive: !['off', 'false', '0'].includes(String(process.env.AUTO_ARCHIVE || '').trim().toLowerCase()),
      chat,
      // eslint-disable-next-line global-require
      cardPayments: (() => { const c = require('./cardPayments'); return { enabled: c.isCardEnabled(), problem: c.cardProblem() }; })(),
    },
  };
}

/* ── Audit ──────────────────────────────────────────────────────────────── */

const toInt = (v) => { const n = Number.parseInt(String(v ?? ''), 10); return Number.isInteger(n) && n > 0 ? n : null; };
const toDate = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

/**
 * The trail, newest first, filtered: customerId, eventId, actorId, action
 * (a prefix: "chat." finds every chat action), since / until, before (id,
 * for paging), limit (max 500; 5000 for the CSV).
 */
async function auditSearch(q = {}, { max = 500 } = {}) {
  const params = [];
  const where = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  if (toInt(q.customerId)) add('a.customer_id = ?', toInt(q.customerId));
  if (toInt(q.eventId)) add('a.event_id = ?', toInt(q.eventId));
  if (toInt(q.actorId)) add('a.actor_user_id = ?', toInt(q.actorId));
  if (q.action && /^[a-z0-9_.]{1,80}$/i.test(String(q.action))) add('a.action LIKE ?', `${String(q.action).toLowerCase()}%`);
  if (toDate(q.since)) add('a.created_at >= ?', toDate(q.since));
  if (toDate(q.until)) add('a.created_at < ?', toDate(q.until));
  if (toInt(q.before)) add('a.id < ?', toInt(q.before));
  params.push(Math.min(Math.max(toInt(q.limit) || 100, 1), max));
  const r = await db.query(
    // No e-mail addresses: the owner sees who acted by name, not participants' contact data.
    `SELECT a.id, a.actor_user_id, u.full_name AS actor_name,
            a.customer_id, c.name AS customer_name, a.event_id, e.name AS event_name,
            a.action, a.target_type, a.target_id, a.meta, a.ip, a.created_at
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
       LEFT JOIN customers c ON c.id = a.customer_id
       LEFT JOIN events e ON e.id = a.event_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.id DESC
      LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

/** The actions seen in the trail, for the filter's list. */
async function auditActions() {
  const r = await db.query(`SELECT action, COUNT(*)::int AS n FROM audit_log GROUP BY action ORDER BY action LIMIT 300`);
  return r.rows;
}

/* ── The notice on every page ───────────────────────────────────────────── */

function noticeView(row) {
  if (!row) return null;
  const v = row.value || {};
  return {
    active: Boolean(v.active),
    level: NOTICE_LEVELS.includes(v.level) ? v.level : 'info',
    message: v.message || {},
    startsAt: v.startsAt || null,
    endsAt: v.endsAt || null,
    updatedAt: row.updated_at,
  };
}

async function getNotice() {
  const r = await db.query('SELECT value, updated_at FROM platform_settings WHERE key = $1', [NOTICE_KEY]);
  return noticeView(r.rows[0]);
}

/** What visitors see now: an active notice inside its window, or null. */
async function currentNotice() {
  const n = await getNotice();
  if (!n || !n.active) return null;
  const now = Date.now();
  if (n.startsAt && Date.parse(n.startsAt) > now) return null;
  if (n.endsAt && Date.parse(n.endsAt) <= now) return null;
  return { level: n.level, message: n.message, endsAt: n.endsAt, updatedAt: n.updatedAt };
}

/** PUT /api/owner/settings/notice { active, level, message: { az, en, ru }, startsAt?, endsAt? } */
async function setNotice(body = {}, actorId = null) {
  const errors = [];
  const message = {};
  const raw = body.message && typeof body.message === 'object' ? body.message : {};
  for (const lang of LANGS) {
    if (raw[lang] == null) continue;
    const textValue = String(raw[lang]).replace(/\s+/g, ' ').trim();
    if (textValue.length > 300) errors.push({ field: `message.${lang}`, message: 'At most 300 characters.' });
    else if (textValue) message[lang] = textValue;
  }
  const active = body.active === true;
  if (active && !Object.keys(message).length) errors.push({ field: 'message', message: 'Write the notice in at least one language.' });
  const level = body.level == null ? 'info' : String(body.level);
  if (!NOTICE_LEVELS.includes(level)) errors.push({ field: 'level', message: `One of ${NOTICE_LEVELS.join(', ')}.` });
  const startsAt = body.startsAt ? toDate(body.startsAt) : null;
  const endsAt = body.endsAt ? toDate(body.endsAt) : null;
  if (body.startsAt && !startsAt) errors.push({ field: 'startsAt', message: 'Not a date.' });
  if (body.endsAt && !endsAt) errors.push({ field: 'endsAt', message: 'Not a date.' });
  if (startsAt && endsAt && endsAt <= startsAt) errors.push({ field: 'endsAt', message: 'Must be after the start.' });
  if (errors.length) throw httpError(400, 'Some fields need attention.', 'VALIDATION_ERROR', { errors });
  const value = { active, level, message, startsAt: startsAt ? startsAt.toISOString() : null, endsAt: endsAt ? endsAt.toISOString() : null };
  await db.query(
    `INSERT INTO platform_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [NOTICE_KEY, JSON.stringify(value), actorId],
  );
  return getNotice();
}

module.exports = { overview, health, auditSearch, auditActions, getNotice, currentNotice, setNotice };
