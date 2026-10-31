/**
 * @file ownerDirectory.service.js
 * @description The owner console's lists and detail pages: organisations,
 * people, orders and events, each answered by one round trip.
 *
 * The console used to build these in the browser — two requests per
 * organisation, four per event — which ran into the rate limiter long before
 * the list was complete and, once `/api/auth/me` was refused too, signed the
 * owner out. Every list here is paginated, searchable and sorted on the
 * server, and every count is computed over the whole table, not the page.
 *
 * What never leaves this file: password hashes, session versions, invite and
 * setup token hashes, calendar tokens. Each SELECT names its columns; there is
 * no `SELECT u.*` anywhere a person's row is read.
 */

const db = require('../config/db');
const customerService = require('./customer.service');
const entitlementService = require('./entitlement.service');
const tenancy = require('./tenancy.service');
const orderService = require('./order.service');
const billingService = require('./billing.service');
const { PLANS } = require('../constants/plans');
const { httpError } = require('../utils/responseFormat');

/* ── Shared ─────────────────────────────────────────────────────────────── */

/** The phase of an event, the way its organisers see it (as on the overview). */
const PHASE_SQL = `CASE
    WHEN LOWER(COALESCE(e.status::text, '')) = 'archived' THEN 'archived'
    WHEN NOT e.is_published THEN 'draft'
    WHEN e.start_date > now() THEN 'upcoming'
    WHEN e.end_date >= now() THEN 'running'
    ELSE 'finished'
  END`;
const PHASES = ['running', 'upcoming', 'draft', 'finished', 'archived'];

const PLAN_RANK_SQL = `CASE plan WHEN 'enterprise' THEN 4 WHEN 'business' THEN 3 WHEN 'professional' THEN 2 ELSE 1 END`;

const MAX_PAGE_SIZE = 100;

const toInt = (v) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** "#42" or "42" typed in a search box, as an id (null otherwise, which matches nothing). */
const idOf = (v) => {
  const m = /^#?(\d{1,9})$/.exec(String(v ?? '').trim());
  return m ? Number(m[1]) : null;
};

/** page (1-based), pageSize (1–100, default 25) and the matching OFFSET. */
function paging(q = {}, fallbackSize = 25) {
  const pageSize = Math.min(toInt(q.pageSize) || fallbackSize, MAX_PAGE_SIZE);
  const page = Math.min(toInt(q.page) || 1, 100000);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * The ORDER BY for a whitelisted sort key. Unknown keys fall back to the
 * default; the direction is one of two literals. Nothing the caller sends is
 * ever pasted into SQL.
 */
function ordering(q, columns, fallback) {
  const key = Object.prototype.hasOwnProperty.call(columns, q.sort) ? q.sort : fallback.sort;
  const dir = q.dir === 'asc' || q.dir === 'desc' ? q.dir : fallback.dir;
  return { key, dir, sql: `${columns[key]} ${dir.toUpperCase()} NULLS LAST` };
}

/** A search box's text as an ILIKE pattern (wildcards in it are literal), or null. */
function pattern(raw) {
  const text = String(raw ?? '').trim().slice(0, 100);
  if (!text) return null;
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const listOf = (v, allowed) => String(v ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => allowed.includes(s));

const page = (rows, total, p) => ({ rows, total, page: p.page, pageSize: p.pageSize });

const money = (v) => (v == null ? null : Number(v));

/* ── Organisations ──────────────────────────────────────────────────────── */

const CUSTOMER_STATUSES = ['pending_review', 'pending_setup', 'active', 'suspended', 'cancelled', 'archived'];

/*
 * Per-organisation figures, each grouped once over its table. The page then
 * joins them by id. Cheap at this size (a few thousand rows per table) and,
 * unlike a correlated subquery per row, it can be sorted on.
 */
const CUSTOMER_AGGREGATES = `
  seats AS (
    SELECT customer_id, COUNT(DISTINCT user_id)::int AS linked
      FROM customer_contacts WHERE user_id IS NOT NULL GROUP BY customer_id),
  invites AS (
    SELECT customer_id, COUNT(*)::int AS pending
      FROM customer_invites
     WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     GROUP BY customer_id),
  evs AS (
    SELECT e.customer_id, COUNT(*)::int AS events,
           COUNT(*) FILTER (WHERE ${PHASE_SQL} = 'running')::int AS running,
           COUNT(*) FILTER (WHERE ${PHASE_SQL} = 'upcoming')::int AS upcoming
      FROM events e WHERE e.customer_id IS NOT NULL GROUP BY e.customer_id),
  parts AS (
    SELECT e.customer_id, COUNT(*)::int AS participants
      FROM participants p JOIN events e ON e.id = p.event_id
     WHERE e.customer_id IS NOT NULL GROUP BY e.customer_id),
  ords AS (
    SELECT customer_id, COUNT(*)::int AS orders,
           COUNT(*) FILTER (WHERE status IN ('pending', 'paid'))::int AS to_review,
           SUM(amount_minor) FILTER (WHERE paid_at IS NOT NULL)::bigint AS paid_minor,
           MIN(currency) AS currency
      FROM orders GROUP BY customer_id),
  plans AS (
    SELECT DISTINCT ON (customer_id) customer_id, plan, kind, ends_at
      FROM entitlements
     WHERE revoked_at IS NULL AND ends_at > now()
     ORDER BY customer_id, ${PLAN_RANK_SQL} DESC, ends_at DESC)`;

const CUSTOMER_SORTS = {
  name: 'LOWER(c.name)',
  created: 'c.created_at',
  status: 'c.status',
  seats: 'COALESCE(seats.linked, 0) + COALESCE(invites.pending, 0)',
  events: 'COALESCE(evs.events, 0)',
  participants: 'COALESCE(parts.participants, 0)',
  orders: 'COALESCE(ords.orders, 0)',
  revenue: 'COALESCE(ords.paid_minor, 0)',
  activity: 'acts.last_activity',
};

/**
 * GET /api/owner/customers?q=&status=a,b&plan=&flags=overSeats,toReview&sort=&dir=&page=&pageSize=
 * Every organisation with its seats, events, participants, orders, revenue,
 * live plan and last activity.
 */
async function listCustomers(q = {}) {
  const p = paging(q);
  const order = ordering(q, CUSTOMER_SORTS, { sort: 'name', dir: 'asc' });
  const params = [];
  const where = [];
  const like = pattern(q.q);
  if (like) {
    params.push(like, idOf(q.q));
    const n = params.length - 1;
    where.push(`(c.name ILIKE $${n} OR c.legal_name ILIKE $${n} OR c.billing_email ILIKE $${n}
                 OR c.slug ILIKE $${n} OR c.city ILIKE $${n} OR c.id = $${n + 1}::int)`);
  }
  const statuses = listOf(q.status, CUSTOMER_STATUSES);
  if (statuses.length) {
    const live = statuses.filter((s) => s !== 'archived');
    const parts = [];
    if (live.length) { params.push(live); parts.push(`(c.archived_at IS NULL AND c.status = ANY($${params.length}::text[]))`); }
    if (statuses.includes('archived')) parts.push('c.archived_at IS NOT NULL');
    where.push(`(${parts.join(' OR ')})`);
  } else if (String(q.archived) !== 'include') {
    where.push('c.archived_at IS NULL');
  }
  const plans = listOf(q.plan, [...Object.keys(PLANS), 'exempt', 'none']);
  if (plans.length) {
    const parts = [];
    const named = plans.filter((x) => PLANS[x]);
    if (named.length) { params.push(named); parts.push(`(NOT c.plan_exempt AND plans.plan = ANY($${params.length}::text[]))`); }
    if (plans.includes('exempt')) parts.push('c.plan_exempt');
    if (plans.includes('none')) parts.push('(NOT c.plan_exempt AND plans.plan IS NULL)');
    where.push(`(${parts.join(' OR ')})`);
  }
  // "Needs attention": any of the flags asked for (flags=overSeats,toReview).
  const flags = listOf(q.flags, ['overSeats', 'toReview']);
  if (q.overSeats === 'true' && !flags.includes('overSeats')) flags.push('overSeats');
  if (q.toReview === 'true' && !flags.includes('toReview')) flags.push('toReview');
  if (flags.length) {
    const parts = [];
    if (flags.includes('overSeats')) {
      parts.push('(c.seat_limit IS NOT NULL AND COALESCE(seats.linked, 0) + COALESCE(invites.pending, 0) > c.seat_limit)');
    }
    if (flags.includes('toReview')) parts.push('COALESCE(ords.to_review, 0) > 0');
    where.push(`(${parts.join(' OR ')})`);
  }

  params.push(p.pageSize, p.offset);
  const r = await db.query(
    `WITH ${CUSTOMER_AGGREGATES}
     SELECT c.id, c.name, c.legal_name, c.sector, c.country, c.city, c.billing_email, c.slug,
            c.status, c.plan_exempt, c.seat_limit, c.archived_at, c.created_at, c.onboarded_at,
            COALESCE(seats.linked, 0) AS seats_linked, COALESCE(invites.pending, 0) AS seats_pending,
            COALESCE(evs.events, 0) AS events, COALESCE(evs.running, 0) AS events_running,
            COALESCE(evs.upcoming, 0) AS events_upcoming,
            COALESCE(parts.participants, 0) AS participants,
            COALESCE(ords.orders, 0) AS orders, COALESCE(ords.to_review, 0) AS orders_to_review,
            COALESCE(ords.paid_minor, 0) AS paid_minor, COALESCE(ords.currency, 'AZN') AS currency,
            plans.plan, plans.kind AS plan_kind, plans.ends_at AS plan_ends_at,
            acts.last_activity,
            COUNT(*) OVER () AS total
       FROM customers c
       LEFT JOIN seats ON seats.customer_id = c.id
       LEFT JOIN invites ON invites.customer_id = c.id
       LEFT JOIN evs ON evs.customer_id = c.id
       LEFT JOIN parts ON parts.customer_id = c.id
       LEFT JOIN ords ON ords.customer_id = c.id
       LEFT JOIN plans ON plans.customer_id = c.id
       -- The newest audit row per organisation, by index (the log only grows).
       LEFT JOIN LATERAL (
         SELECT a.created_at AS last_activity FROM audit_log a
          WHERE a.customer_id = c.id ORDER BY a.created_at DESC LIMIT 1) acts ON true
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${order.sql}, c.id ${order.dir.toUpperCase()}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const total = r.rows[0] ? Number(r.rows[0].total) : await countAfterLastPage(listCustomers, q, p);
  return {
    ...page(r.rows.map((row) => {
      const { total: _t, seats_linked: linked, seats_pending: pending, paid_minor: paid, ...rest } = row;
      const used = linked + pending;
      return {
        ...rest,
        status: row.archived_at ? 'archived' : row.status,
        plan: row.plan_exempt ? null : row.plan,
        seats: {
          limit: row.seat_limit,
          used,
          linked,
          pending,
          over: row.seat_limit != null && used > row.seat_limit,
        },
        paid_minor: money(paid),
      };
    }), total, p),
    sort: order.key,
    dir: order.dir,
  };
}

/**
 * A page past the end has no rows to carry the window total; ask once more
 * for the first page so the caller still learns how many there are.
 */
async function countAfterLastPage(fn, q, p) {
  if (p.page === 1) return 0;
  const first = await fn({ ...q, page: 1, pageSize: 1 });
  return first.total;
}

/** GET /api/owner/customers/:id — everything about one organisation. */
async function customerDetail(id) {
  const customer = await customerService.getCustomerById(id);
  if (!customer) return null;
  const [plan, seats, members, invites, phases, usage, orders, audit] = await Promise.all([
    entitlementService.summaryForCustomer(id),
    tenancy.getSeatUsage(id),
    db.query(
      `SELECT cc.id, cc.user_id, cc.email, cc.role_title, cc.is_primary, cc.member_role, cc.created_at,
              COALESCE(u.full_name, cc.full_name) AS full_name,
              u.role AS platform_role, (u.email_verified_at IS NOT NULL) AS email_verified
         FROM customer_contacts cc
         LEFT JOIN users u ON u.id = cc.user_id
        WHERE cc.customer_id = $1
        ORDER BY cc.is_primary DESC, cc.created_at ASC
        LIMIT 200`,
      [id],
    ),
    // Never the token hash: an invite is identified by its row, not its secret.
    db.query(
      `SELECT i.id, i.email, i.full_name, i.role_title, i.grant_role, i.created_at, i.expires_at,
              u.full_name AS invited_by_name, i.invited_by
         FROM customer_invites i
         LEFT JOIN users u ON u.id = i.invited_by
        WHERE i.customer_id = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
        ORDER BY i.created_at DESC
        LIMIT 100`,
      [id],
    ),
    db.query(
      `SELECT ${PHASE_SQL} AS phase, COUNT(*)::int AS n FROM events e WHERE e.customer_id = $1 GROUP BY 1`,
      [id],
    ),
    db.query(
      `SELECT COUNT(DISTINCT e.id)::int AS events,
              COUNT(p.id)::int AS participants,
              COALESCE(MAX(per.n), 0)::int AS largest_event,
              COUNT(DISTINCT p.user_id)::int AS people
         FROM events e
         LEFT JOIN participants p ON p.event_id = e.id
         LEFT JOIN (SELECT p2.event_id, COUNT(*)::int AS n FROM participants p2
                      JOIN events e2 ON e2.id = p2.event_id AND e2.customer_id = $1
                     GROUP BY p2.event_id) per ON per.event_id = e.id
        WHERE e.customer_id = $1`,
      [id],
    ),
    db.query(
      `SELECT o.id, o.order_code, o.plan, o.billing_period, o.status, o.currency, o.amount_minor, o.tax_minor,
              o.placed_at, o.paid_at, o.delivered_at, o.cancelled_at, o.created_at,
              o.invoice_number, o.invoice_issued_at, o.invoice_due_at, o.payment_method,
              o.event_id, e.name AS event_name, o.purchaser_user_id, u.full_name AS purchaser_name
         FROM orders o
         LEFT JOIN events e ON e.id = o.event_id
         LEFT JOIN users u ON u.id = o.purchaser_user_id
        WHERE o.customer_id = $1
        ORDER BY o.created_at DESC
        LIMIT 200`,
      [id],
    ),
    db.query(
      `SELECT a.id, a.actor_user_id, u.full_name AS actor_name, a.event_id, e.name AS event_name,
              a.action, a.target_type, a.target_id, a.meta, a.created_at
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_user_id
         LEFT JOIN events e ON e.id = a.event_id
        WHERE a.customer_id = $1
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 25`,
      [id],
    ),
  ]);

  const revenue = {};
  for (const o of orders.rows) {
    const cur = o.currency;
    revenue[cur] = revenue[cur] || { currency: cur, paidMinor: 0, outstandingMinor: 0, reviewMinor: 0 };
    const amount = Number(o.amount_minor || 0);
    if (o.paid_at) revenue[cur].paidMinor += amount;
    else if (o.status === 'delivered') revenue[cur].outstandingMinor += amount;
    else if (o.status === 'pending') revenue[cur].reviewMinor += amount;
  }
  const u = usage.rows[0];
  const live = plan.entitlements.filter((e) => e.live);
  return {
    customer,
    plan,
    seats,
    members: members.rows,
    invites: invites.rows,
    events: {
      total: u.events,
      byPhase: Object.fromEntries(phases.rows.map((r) => [r.phase, r.n])),
    },
    usage: {
      events: {
        used: live.reduce((n, e) => n + e.eventsUsed, 0),
        allowed: plan.exempt || live.some((e) => e.eventsAllowed == null) ? null
          : live.reduce((n, e) => n + (e.eventsAllowed || 0), 0),
      },
      participants: { total: u.participants, people: u.people, largestEvent: u.largest_event, perEventLimit: plan.limits.participants },
      seats: { used: seats.used, limit: seats.limit },
    },
    orders: orders.rows.map((o) => ({ ...o, amount_minor: money(o.amount_minor), tax_minor: money(o.tax_minor) })),
    revenue: Object.values(revenue),
    audit: audit.rows,
  };
}

/* ── Events ─────────────────────────────────────────────────────────────── */

const EVENT_SORTS = {
  name: 'LOWER(e.name)',
  start: 'e.start_date',
  created: 'e.created_at',
  customer: 'LOWER(c.name)',
  participants: 'COALESCE(pa.total, 0)',
  teams: 'COALESCE(te.n, 0)',
  submissions: 'COALESCE(su.n, 0)',
  tickets: 'COALESCE(ti.open, 0)',
  reports: 'COALESCE(rp.n, 0)',
  phase: `CASE ${PHASE_SQL} WHEN 'running' THEN 0 WHEN 'upcoming' THEN 1 WHEN 'draft' THEN 2 WHEN 'finished' THEN 3 ELSE 4 END`,
  end: 'e.end_date',
  plan: `CASE en.plan WHEN 'enterprise' THEN 4 WHEN 'business' THEN 3 WHEN 'professional' THEN 2 WHEN 'starter' THEN 1 ELSE 0 END`,
  featured: 'CASE WHEN e.directory_featured THEN COALESCE(e.directory_featured_rank, 1000) ELSE 2000 END',
  updated: 'e.updated_at',
};

/*
 * An event whose name reads like an automated run or a rehearsal: a run id
 * (a long token of letters and digits), a long number, or a word such as
 * test, demo, e2e, probe. A hint for the owner's "test-looking" filter only;
 * what hides an event is the owner's own "test" mark (is_test).
 */
const TEST_LOOKING_SQL = `(
  e.name ~ '\\m(?=[a-z0-9]*[0-9])(?=[a-z0-9]*[a-z])[a-z0-9]{8,}\\M'
  OR e.name ~ '\\d{5,}'
  OR e.name ~* '(^|[^[:alpha:]])(test|testing|demo|e2e|probe|sample|dummy|qa|verify|tmp|fixture|smoke|aud)([^[:alpha:]]|$)'
)`;
const VISIBILITIES = ['public', 'private', 'invite'];
const TEST_FILTERS = ['marked', 'looks', 'clean'];

/**
 * GET /api/owner/events?q=&phase=a,b&customerId=&unassigned=true&from=&to=&sort=&dir=&page=&pageSize=
 *                       &visibility=public,private,invite&listed=yes|no&featured=yes|no
 *                       &archived=hide|only&test=marked,looks,clean
 * Every event with its key counts, phase, organisation and directory state.
 * test: marked = the owner marked it; looks = its name reads like a test and
 * it is not marked; clean = neither.
 */
async function listEvents(q = {}) {
  const p = paging(q);
  const order = ordering(q, EVENT_SORTS, { sort: 'phase', dir: 'asc' });
  const params = [];
  const where = [];
  const like = pattern(q.q);
  if (like) {
    params.push(like);
    const n = params.length;
    where.push(`(e.name ILIKE $${n} OR e.event_code ILIKE $${n} OR e.slug ILIKE $${n} OR c.name ILIKE $${n})`);
  }
  const phases = listOf(q.phase, PHASES);
  if (phases.length) { params.push(phases); where.push(`${PHASE_SQL} = ANY($${params.length}::text[])`); }
  if (toInt(q.customerId)) { params.push(toInt(q.customerId)); where.push(`e.customer_id = $${params.length}`); }
  if (q.unassigned === 'true') where.push('e.customer_id IS NULL');
  // A date range (the calendar's month): events that run at any time inside it.
  const from = q.from && !Number.isNaN(Date.parse(q.from)) ? new Date(q.from) : null;
  const to = q.to && !Number.isNaN(Date.parse(q.to)) ? new Date(q.to) : null;
  if (from) { params.push(from); where.push(`e.end_date >= $${params.length}`); }
  if (to) { params.push(to); where.push(`e.start_date < $${params.length}`); }
  const visibility = listOf(q.visibility, VISIBILITIES);
  if (visibility.length) { params.push(visibility); where.push(`e.visibility = ANY($${params.length}::text[])`); }
  const yesNo = (v) => (v === 'yes' || v === 'true' ? true : v === 'no' || v === 'false' ? false : null);
  const listed = yesNo(q.listed);
  if (listed != null) where.push(listed ? 'e.directory_listed' : 'NOT e.directory_listed');
  const featured = yesNo(q.featured);
  if (featured != null) where.push(featured ? 'e.directory_featured' : 'NOT e.directory_featured');
  const archivedSql = "(e.archived_at IS NOT NULL OR LOWER(COALESCE(e.status::text, '')) = 'archived')";
  if (q.archived === 'hide') where.push(`NOT ${archivedSql}`);
  else if (q.archived === 'only') where.push(archivedSql);
  const tests = listOf(q.test, TEST_FILTERS);
  if (tests.length && tests.length < TEST_FILTERS.length) {
    where.push(`(${tests.map((t) => (t === 'marked' ? 'e.is_test'
      : t === 'looks' ? `(NOT e.is_test AND ${TEST_LOOKING_SQL})`
        : `(NOT e.is_test AND NOT ${TEST_LOOKING_SQL})`)).join(' OR ')})`);
  }
  params.push(p.pageSize, p.offset);
  // Within a phase, the order the overview uses: upcoming soonest, the rest latest first.
  const tiebreak = order.key === 'phase'
    ? `, CASE WHEN ${PHASE_SQL} = 'upcoming' THEN e.start_date END ASC, e.end_date DESC NULLS LAST`
    : '';
  const r = await db.query(
    `WITH pa AS (
        SELECT event_id, COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE LOWER(status::text) = 'approved')::int AS approved,
               COUNT(*) FILTER (WHERE LOWER(status::text) = 'pending')::int AS pending,
               COUNT(*) FILTER (WHERE LOWER(status::text) = 'waitlisted')::int AS waitlisted
          FROM participants GROUP BY event_id),
      te AS (SELECT event_id, COUNT(*)::int AS n FROM teams GROUP BY event_id),
      su AS (SELECT event_id, COUNT(*)::int AS n FROM submissions GROUP BY event_id),
      ti AS (SELECT event_id, COUNT(*) FILTER (WHERE LOWER(status) = 'open')::int AS open,
                    COUNT(*) FILTER (WHERE escalated_to_admin AND resolved_at IS NULL)::int AS escalated
               FROM help_tickets GROUP BY event_id),
      rp AS (SELECT event_id, COUNT(*)::int AS n FROM chat_reports WHERE resolved_at IS NULL GROUP BY event_id)
     SELECT e.id, e.name, e.event_code, e.slug, e.customer_id, c.name AS customer_name,
            e.start_date, e.end_date, e.created_at, e.is_published, e.max_participants, e.format, e.city,
            e.visibility, e.directory_listed, e.directory_featured, e.directory_featured_rank, e.is_test,
            e.archived_at, e.updated_at, e.timezone, ${TEST_LOOKING_SQL} AS test_looking,
            ${PHASE_SQL} AS phase,
            en.plan, en.participant_limit,
            COALESCE(pa.total, 0) AS participants, COALESCE(pa.approved, 0) AS approved,
            COALESCE(pa.pending, 0) AS pending, COALESCE(pa.waitlisted, 0) AS waitlisted,
            COALESCE(te.n, 0) AS teams, COALESCE(su.n, 0) AS submissions,
            COALESCE(ti.open, 0) AS open_tickets, COALESCE(ti.escalated, 0) AS escalated,
            COALESCE(rp.n, 0) AS open_reports,
            COUNT(*) OVER () AS total
       FROM events e
       LEFT JOIN customers c ON c.id = e.customer_id
       LEFT JOIN entitlements en ON en.id = e.entitlement_id
       LEFT JOIN pa ON pa.event_id = e.id
       LEFT JOIN te ON te.event_id = e.id
       LEFT JOIN su ON su.event_id = e.id
       LEFT JOIN ti ON ti.event_id = e.id
       LEFT JOIN rp ON rp.event_id = e.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${order.sql}${tiebreak}, e.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const total = r.rows[0] ? Number(r.rows[0].total) : await countAfterLastPage(listEvents, q, p);
  return {
    ...page(r.rows.map(({ total: _t, ...row }) => row), total, p),
    sort: order.key,
    dir: order.dir,
  };
}

/**
 * GET /api/owner/events/:id — one event with its organisation, plan, the
 * order it was bought with, registrations by status, teams, projects, help
 * and reports, judging coverage, staff and its recent audit trail.
 */
async function eventDetail(id) {
  const ev = (await db.query(
    `SELECT e.id, e.name, e.event_code, e.slug, e.tagline, e.category, e.format, e.city, e.country, e.venue_name,
            e.timezone, e.start_date, e.end_date, e.registration_start, e.registration_end, e.submission_deadline,
            e.judging_start, e.judging_end, e.results_at, e.is_published, e.status, e.max_participants,
            e.registration_mode, e.team_size_limit, e.created_at, e.updated_at,
            e.visibility, e.directory_listed, e.directory_featured, e.directory_featured_rank, e.is_test, e.archived_at,
            e.customer_id, c.name AS customer_name, c.status AS customer_status, c.archived_at AS customer_archived_at,
            e.created_by, u.full_name AS creator_name,
            e.entitlement_id, en.plan, en.kind AS plan_kind, en.participant_limit,
            ${PHASE_SQL} AS phase
       FROM events e
       LEFT JOIN customers c ON c.id = e.customer_id
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN entitlements en ON en.id = e.entitlement_id
      WHERE e.id = $1`,
    [id],
  )).rows[0];
  if (!ev) return null;
  const [participants, counts, tickets, order, audit] = await Promise.all([
    db.query(`SELECT LOWER(status::text) AS status, COUNT(*)::int AS n FROM participants WHERE event_id = $1 GROUP BY 1`, [id]),
    db.query(
      `SELECT (SELECT COUNT(*)::int FROM teams WHERE event_id = $1) AS teams,
              (SELECT COUNT(*)::int FROM submissions WHERE event_id = $1) AS submissions,
              (SELECT COUNT(*)::int FROM judges WHERE event_id = $1) AS judges,
              (SELECT COUNT(*)::int FROM mentor_assignments WHERE event_id = $1) AS mentors,
              (SELECT COUNT(*)::int FROM volunteers WHERE event_id = $1) AS volunteers,
              (SELECT COUNT(*)::int FROM scoring_criteria WHERE event_id = $1) AS criteria,
              (SELECT COUNT(*)::int FROM scores x JOIN submissions s ON s.id = x.submission_id WHERE s.event_id = $1) AS scores,
              (SELECT COUNT(*)::int FROM chat_reports WHERE event_id = $1 AND resolved_at IS NULL) AS open_reports,
              (SELECT COUNT(*)::int FROM event_checkins WHERE event_id = $1) AS checkins,
              (SELECT COUNT(*)::int FROM feedback WHERE event_id = $1) AS feedback,
              (SELECT ROUND(AVG(rating) FILTER (WHERE rating > 0), 2) FROM feedback WHERE event_id = $1) AS rating`,
      [id],
    ),
    db.query(
      `SELECT LOWER(status) AS status, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE escalated_to_admin AND resolved_at IS NULL)::int AS escalated
         FROM help_tickets WHERE event_id = $1 GROUP BY 1`,
      [id],
    ),
    db.query(
      `SELECT id, order_code, status, plan, billing_period, amount_minor, currency, paid_at
         FROM orders WHERE event_id = $1 LIMIT 1`,
      [id],
    ),
    auditRows('a.event_id = $1', [id], 20),
  ]);
  const c = counts.rows[0];
  const expected = c.judges * c.criteria * c.submissions;
  const o = order.rows[0];
  return {
    event: ev,
    participants: Object.fromEntries(participants.rows.map((r) => [r.status, r.n])),
    counts: { ...c, rating: c.rating == null ? null : Number(c.rating) },
    coverage: expected > 0 ? Math.min(1, c.scores / expected) : null,
    tickets: Object.fromEntries(tickets.rows.map((r) => [r.status, r.n])),
    escalated: tickets.rows.reduce((n, r) => n + r.escalated, 0),
    order: o ? { ...o, amount_minor: money(o.amount_minor) } : null,
    audit,
  };
}

/* ── People ─────────────────────────────────────────────────────────────── */

const ROLES = ['superadmin', 'admin', 'org_admin', 'hacker', 'pending', 'mentor', 'judge', 'volunteer'];

const USER_SORTS = {
  name: 'LOWER(u.full_name)',
  email: 'LOWER(u.email)',
  created: 'u.created_at',
  role: 'u.role',
  events: 'COALESCE(pa.n, 0) + COALESCE(st.n, 0)',
  organisations: 'COALESCE(cc.n, 0)',
};

/**
 * GET /api/owner/users?q=&role=a,b&verified=true|false&sort=&dir=&page=&pageSize=
 * Accounts by name or e-mail, with how many events and organisations each is in.
 */
async function listUsers(q = {}) {
  const p = paging(q);
  const order = ordering(q, USER_SORTS, { sort: 'created', dir: 'desc' });
  const params = [];
  const where = [];
  const like = pattern(q.q);
  if (like) {
    params.push(like, idOf(q.q));
    const n = params.length - 1;
    where.push(`(u.full_name ILIKE $${n} OR u.email ILIKE $${n} OR u.id = $${n + 1}::int)`);
  }
  const roles = listOf(q.role, ROLES);
  if (roles.length) { params.push(roles); where.push(`u.role = ANY($${params.length}::text[])`); }
  if (q.verified === 'true') where.push('u.email_verified_at IS NOT NULL');
  if (q.verified === 'false') where.push('u.email_verified_at IS NULL');
  if (toInt(q.customerId)) {
    params.push(toInt(q.customerId));
    where.push(`EXISTS (SELECT 1 FROM customer_contacts x WHERE x.user_id = u.id AND x.customer_id = $${params.length})`);
  }
  params.push(p.pageSize, p.offset);
  const r = await db.query(
    `WITH pa AS (SELECT user_id, COUNT(*)::int AS n FROM participants GROUP BY user_id),
          st AS (SELECT user_id, COUNT(*)::int AS n FROM (
                   SELECT user_id FROM judges UNION ALL SELECT user_id FROM mentor_assignments
                   UNION ALL SELECT user_id FROM volunteers) s GROUP BY user_id),
          cc AS (SELECT user_id, COUNT(DISTINCT customer_id)::int AS n FROM customer_contacts
                  WHERE user_id IS NOT NULL GROUP BY user_id)
     SELECT u.id, u.full_name, u.email, u.role, u.created_at,
            (u.email_verified_at IS NOT NULL) AS email_verified,
            COALESCE(pa.n, 0) AS participations, COALESCE(st.n, 0) AS staff_roles,
            COALESCE(cc.n, 0) AS organisations,
            COUNT(*) OVER () AS total
       FROM users u
       LEFT JOIN pa ON pa.user_id = u.id
       LEFT JOIN st ON st.user_id = u.id
       LEFT JOIN cc ON cc.user_id = u.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${order.sql}, u.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const total = r.rows[0] ? Number(r.rows[0].total) : await countAfterLastPage(listUsers, q, p);
  return {
    ...page(r.rows.map(({ total: _t, ...row }) => row), total, p),
    sort: order.key,
    dir: order.dir,
  };
}

/** The account fields the owner sees. No hash, no session or calendar version. */
const USER_FIELDS = `u.id, u.full_name, u.email, u.role, u.avatar, u.country, u.university, u.github_link,
  u.linkedin, u.created_at, u.updated_at, u.email_verified_at`;

/** GET /api/owner/users/:id — the account, where it belongs, what it did and what was done to it. */
async function userDetail(id) {
  const user = (await db.query(`SELECT ${USER_FIELDS} FROM users u WHERE u.id = $1`, [id])).rows[0];
  if (!user) return null;
  const [memberships, invites, roles, teams, orders, by, about] = await Promise.all([
    db.query(
      `SELECT cc.id, cc.customer_id, c.name AS customer_name, c.status AS customer_status, c.archived_at,
              cc.member_role, cc.role_title, cc.is_primary, cc.created_at
         FROM customer_contacts cc JOIN customers c ON c.id = cc.customer_id
        WHERE cc.user_id = $1
        ORDER BY cc.created_at DESC`,
      [id],
    ),
    db.query(
      `SELECT i.id, i.customer_id, c.name AS customer_name, i.grant_role, i.created_at, i.expires_at
         FROM customer_invites i JOIN customers c ON c.id = i.customer_id
        WHERE LOWER(i.email) = LOWER($1) AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
        ORDER BY i.created_at DESC`,
      [user.email],
    ),
    // Every way this person is part of an event, one row per role.
    db.query(
      `SELECT x.role, x.status, x.since, x.team_id, t.name AS team_name,
              e.id AS event_id, e.name AS event_name, e.event_code, e.customer_id, c.name AS customer_name,
              ${PHASE_SQL} AS phase, e.start_date
         FROM (
           SELECT 'participant' AS role, p.event_id, p.status::text AS status, p.registered_at AS since, p.team_id
             FROM participants p WHERE p.user_id = $1
           UNION ALL SELECT 'judge', j.event_id, NULL, j.assigned_at, NULL FROM judges j WHERE j.user_id = $1
           UNION ALL SELECT 'mentor', m.event_id, m.presence, m.assigned_at, NULL FROM mentor_assignments m WHERE m.user_id = $1
           UNION ALL SELECT 'volunteer', v.event_id, NULL, v.created_at, NULL FROM volunteers v WHERE v.user_id = $1
           UNION ALL SELECT 'creator', ev.id, NULL, ev.created_at, NULL FROM events ev WHERE ev.created_by = $1
         ) x
         JOIN events e ON e.id = x.event_id
         LEFT JOIN customers c ON c.id = e.customer_id
         LEFT JOIN teams t ON t.id = x.team_id
        ORDER BY x.since DESC NULLS LAST
        LIMIT 300`,
      [id],
    ),
    db.query(
      `SELECT t.id, t.name, t.status, tm.is_leader, tm.joined_at, t.event_id, e.name AS event_name,
              (SELECT COUNT(*)::int FROM team_members x WHERE x.team_id = t.id) AS members,
              (SELECT COUNT(*)::int FROM submissions s WHERE s.team_id = t.id) AS submissions
         FROM team_members tm
         JOIN teams t ON t.id = tm.team_id
         JOIN events e ON e.id = t.event_id
        WHERE tm.user_id = $1
        ORDER BY tm.joined_at DESC
        LIMIT 100`,
      [id],
    ),
    db.query(
      `SELECT o.id, o.order_code, o.customer_id, c.name AS customer_name, o.plan, o.billing_period, o.status,
              o.currency, o.amount_minor, o.placed_at, o.paid_at, o.created_at
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.purchaser_user_id = $1
        ORDER BY o.created_at DESC
        LIMIT 100`,
      [id],
    ),
    auditRows('a.actor_user_id = $1', [id], 30),
    auditRows(`a.target_type = 'user' AND a.target_id = $1`, [String(id)], 30),
  ]);
  return {
    user: { ...user, email_verified: Boolean(user.email_verified_at) },
    // Sign-ins are not recorded on this installation: null says "not known", not "never".
    lastSignInAt: null,
    memberships: memberships.rows,
    invites: invites.rows,
    roles: roles.rows,
    teams: teams.rows,
    orders: orders.rows.map((o) => ({ ...o, amount_minor: money(o.amount_minor) })),
    auditBy: by,
    auditAbout: about,
  };
}

async function auditRows(condition, params, limit) {
  const r = await db.query(
    `SELECT a.id, a.actor_user_id, u.full_name AS actor_name, a.customer_id, c.name AS customer_name,
            a.event_id, e.name AS event_name, a.action, a.target_type, a.target_id, a.meta, a.created_at
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
       LEFT JOIN customers c ON c.id = a.customer_id
       LEFT JOIN events e ON e.id = a.event_id
      WHERE ${condition}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${Number(limit)}`,
    params,
  );
  return r.rows;
}

/* ── Orders ─────────────────────────────────────────────────────────────── */

const ORDER_STATUSES = ['draft', 'pending', 'paid', 'delivered', 'cancelled', 'refunded'];
const ORDER_SORTS = {
  placed: 'COALESCE(o.placed_at, o.created_at)',
  amount: 'o.amount_minor',
  customer: 'LOWER(c.name)',
  status: 'o.status',
  code: 'o.id',
  paid: 'o.paid_at',
};

/**
 * GET /api/owner/orders?q=&status=a,b&customerId=&unpaid=true&discount=claimed&couponId=&sort=&dir=&page=&pageSize=
 * Orders with their organisation and buyer, plus totals by status over every
 * order that matches the search (not only this page).
 */
async function listOrders(q = {}) {
  const p = paging(q);
  const order = ordering(q, ORDER_SORTS, { sort: 'placed', dir: 'desc' });
  const params = [];
  const where = [];
  const like = pattern(q.q);
  if (like) {
    params.push(like);
    const n = params.length;
    where.push(`(o.order_code ILIKE $${n} OR o.invoice_number ILIKE $${n} OR c.name ILIKE $${n}
                 OR u.full_name ILIKE $${n} OR u.email ILIKE $${n} OR o.payment_reference ILIKE $${n}
                 OR o.discount_code ILIKE $${n})`);
  }
  if (toInt(q.customerId)) { params.push(toInt(q.customerId)); where.push(`o.customer_id = $${params.length}`); }
  if (q.unpaid === 'true') where.push(`o.paid_at IS NULL AND o.status = 'delivered'`);
  // Orders with a discount the buyer claimed, waiting for the owner.
  if (q.discount === 'claimed') where.push(`o.discount_status = 'claimed'`);
  if (toInt(q.couponId)) { params.push(toInt(q.couponId)); where.push(`o.coupon_id = $${params.length}`); }
  // The status filter applies to the rows, not to the totals by status beside them.
  const baseWhere = [...where];
  const baseParams = [...params];
  const statuses = listOf(q.status, ORDER_STATUSES);
  if (statuses.length) { params.push(statuses); where.push(`o.status = ANY($${params.length}::text[])`); }
  params.push(p.pageSize, p.offset);
  const from = `FROM orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.purchaser_user_id
       LEFT JOIN events e ON e.id = o.event_id`;
  const [rows, totals] = await Promise.all([
    db.query(
      `SELECT o.id, o.order_code, o.customer_id, c.name AS customer_name, o.event_id, e.name AS event_name,
              o.purchaser_user_id, u.full_name AS purchaser_name,
              o.plan, o.billing_period, o.status, o.currency, o.amount_minor, o.tax_minor,
              o.placed_at, o.paid_at, o.delivered_at, o.cancelled_at, o.created_at,
              o.invoice_number, o.invoice_due_at, o.payment_method, o.card_brand, o.card_last4,
              o.discount_code, o.discount_label, o.discount_minor, o.discount_status,
              COUNT(*) OVER () AS total
         ${from}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${order.sql}, o.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
    db.query(
      `SELECT o.status, o.currency, COUNT(*)::int AS n, SUM(o.amount_minor)::bigint AS minor,
              COUNT(*) FILTER (WHERE o.amount_minor IS NULL)::int AS unpriced,
              SUM(o.amount_minor) FILTER (WHERE o.paid_at IS NOT NULL)::bigint AS paid_minor,
              COUNT(*) FILTER (WHERE o.paid_at IS NOT NULL)::int AS paid_n
         ${from}
        ${baseWhere.length ? `WHERE ${baseWhere.join(' AND ')}` : ''}
        GROUP BY o.status, o.currency`,
      baseParams,
    ),
  ]);
  const total = rows.rows[0] ? Number(rows.rows[0].total) : await countAfterLastPage(listOrders, q, p);
  return {
    ...page(rows.rows.map(({ total: _t, ...o }) => ({
      ...o, amount_minor: money(o.amount_minor), tax_minor: money(o.tax_minor), discount_minor: money(o.discount_minor),
    })), total, p),
    sort: order.key,
    dir: order.dir,
    totals: totals.rows.map((t) => ({
      status: t.status, currency: t.currency, count: t.n, minor: money(t.minor) || 0, unpriced: t.unpriced,
      paidMinor: money(t.paid_minor) || 0, paidCount: t.paid_n,
    })),
  };
}

/**
 * GET /api/owner/orders/:id — the order with what it was for, who placed it,
 * the plan it granted, its status history and its audit trail.
 */
async function orderDetail(id) {
  const order = await orderService.getOrderById(id);
  if (!order) return null;
  const [history, audit, entitlement, purchaser, customer, billing] = await Promise.all([
    orderService.getOrderHistory(id),
    auditRows(`a.target_type = 'order' AND a.target_id = $1`, [String(id)], 50),
    db.query(
      `SELECT id, plan, kind, starts_at, ends_at, events_allowed, events_used, participant_limit, seat_limit,
              storage_gb, revoked_at, (revoked_at IS NULL AND ends_at > now()) AS live
         FROM entitlements WHERE order_id = $1`,
      [id],
    ),
    order.purchaser_user_id
      ? db.query(`SELECT id, full_name, email, role, (email_verified_at IS NOT NULL) AS email_verified FROM users WHERE id = $1`, [order.purchaser_user_id])
      : Promise.resolve({ rows: [] }),
    db.query(
      `SELECT id, name, legal_name, vat_id, billing_email, country, city, status, plan_exempt, archived_at, onboarded_at
         FROM customers WHERE id = $1`,
      [order.customer_id],
    ),
    billingService.getBilling(),
  ]);
  const amount = money(order.amount_minor);
  const tax = money(order.tax_minor);
  const plan = PLANS[order.plan];
  // A discount still on the order is a line of its own, under the plan at
  // its price; a removed one is not, and the plan line is the amount again.
  const discountMinor = order.discount_minor > 0 && order.discount_status !== 'removed' ? money(order.discount_minor) : 0;
  const listMinor = order.list_amount_minor != null ? money(order.list_amount_minor) : amount;
  const lines = [{
    label: `${plan ? plan.name : order.plan} plan · ${order.billing_period === 'annual' ? 'annual' : 'one event'}`,
    detail: order.event_name ? `For ${order.event_name}` : null,
    quantity: 1,
    amountMinor: discountMinor ? listMinor : amount,
  }];
  if (discountMinor) {
    lines.push({
      label: `Discount · ${order.discount_label}`,
      detail: order.discount_status === 'claimed' ? 'Claimed at checkout, waiting for your review' : null,
      quantity: 1,
      amountMinor: -discountMinor,
      discount: true,
    });
  }
  return {
    order: {
      ...order,
      amount_minor: amount,
      tax_minor: tax,
      list_amount_minor: order.list_amount_minor == null ? null : money(order.list_amount_minor),
      discount_minor: order.discount_minor == null ? null : money(order.discount_minor),
    },
    lines,
    discount: order.discount_status ? {
      couponId: order.coupon_id,
      code: order.discount_code,
      label: order.discount_label,
      minor: money(order.discount_minor),
      status: order.discount_status,
      claim: order.discount_claim || null,
      listMinor,
      // Removable while the claim waits and the amount is not on an invoice yet.
      removable: order.discount_status === 'claimed' && ['draft', 'pending'].includes(order.status) && !order.invoice_number,
    } : null,
    totals: {
      listMinor: discountMinor ? listMinor : amount,
      discountMinor,
      netMinor: amount,
      taxMinor: tax,
      grossMinor: amount == null ? null : amount + (tax || 0),
      currency: order.currency,
      // An issued invoice states the VAT line it was issued with.
      vatNote: tax ? null : ((order.invoice_snapshot && order.invoice_snapshot.amounts.vatLine) || billingService.vatLine(billing)).split(' · ')[1],
    },
    // A card order placed before card payment was switched off was never charged.
    cardNotCharged: order.payment_method === 'card' && !order.paid_at,
    setupDone: Boolean(customer.rows[0] && customer.rows[0].onboarded_at),
    billingReady: billing.ready,
    history,
    audit,
    entitlement: entitlement.rows[0] || null,
    purchaser: purchaser.rows[0] || null,
    customer: customer.rows[0] || null,
    invoicePdf: `/api/orders/${order.id}/invoice.pdf`,
  };
}

/* ── Judging, support and feedback across events ────────────────────────── */

const JUDGING_SORTS = {
  coverage: 'coverage',
  name: 'LOWER(e.name)',
  start: 'e.start_date',
  submissions: 'COALESCE(su.n, 0)',
  judges: 'COALESCE(ju.n, 0)',
  phase: EVENT_SORTS.phase,
};

/**
 * GET /api/owner/judging?q=&phase=&panel=true&sort=&dir=&page=&pageSize=
 * Per event: judges, criteria, submissions, scores and the share of the
 * judge × submission × criterion grid that has a score. `panel=true` keeps
 * the events that have judges or criteria.
 */
async function listJudging(q = {}) {
  const p = paging(q);
  const order = ordering(q, JUDGING_SORTS, { sort: 'phase', dir: 'asc' });
  const params = [];
  const where = [];
  const like = pattern(q.q);
  if (like) { params.push(like); where.push(`(e.name ILIKE $${params.length} OR e.event_code ILIKE $${params.length})`); }
  const phases = listOf(q.phase, PHASES);
  if (phases.length) { params.push(phases); where.push(`${PHASE_SQL} = ANY($${params.length}::text[])`); }
  if (q.panel === 'true') where.push('(COALESCE(ju.n, 0) > 0 OR COALESCE(cr.n, 0) > 0)');
  params.push(p.pageSize, p.offset);
  const r = await db.query(
    `WITH ju AS (SELECT event_id, COUNT(*)::int AS n FROM judges GROUP BY event_id),
          cr AS (SELECT event_id, COUNT(*)::int AS n FROM scoring_criteria GROUP BY event_id),
          su AS (SELECT event_id, COUNT(*)::int AS n FROM submissions GROUP BY event_id),
          sc AS (SELECT s.event_id, COUNT(*)::int AS n FROM scores x JOIN submissions s ON s.id = x.submission_id GROUP BY s.event_id)
     SELECT e.id, e.name, e.event_code, e.customer_id, c.name AS customer_name, ${PHASE_SQL} AS phase,
            e.start_date, e.judging_start, e.judging_end,
            COALESCE(ju.n, 0) AS judges, COALESCE(cr.n, 0) AS criteria,
            COALESCE(su.n, 0) AS submissions, COALESCE(sc.n, 0) AS scores,
            CASE WHEN COALESCE(ju.n, 0) * COALESCE(cr.n, 0) * COALESCE(su.n, 0) > 0
                 THEN LEAST(1, COALESCE(sc.n, 0)::numeric / (ju.n * cr.n * su.n)) END AS coverage,
            COUNT(*) OVER () AS total
       FROM events e
       LEFT JOIN customers c ON c.id = e.customer_id
       LEFT JOIN ju ON ju.event_id = e.id
       LEFT JOIN cr ON cr.event_id = e.id
       LEFT JOIN su ON su.event_id = e.id
       LEFT JOIN sc ON sc.event_id = e.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${order.sql}, e.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const total = r.rows[0] ? Number(r.rows[0].total) : await countAfterLastPage(listJudging, q, p);
  return {
    ...page(r.rows.map(({ total: _t, coverage, ...row }) => ({ ...row, coverage: coverage == null ? null : Number(coverage) })), total, p),
    sort: order.key,
    dir: order.dir,
  };
}

const TICKET_STATUSES = ['open', 'claimed', 'resolved', 'closed'];
const TICKET_SORTS = { created: 't.created_at', status: 't.status', event: 'LOWER(e.name)', priority: 't.priority' };

/**
 * GET /api/owner/tickets?q=&status=&eventId=&escalated=true&sort=&dir=&page=&pageSize=
 * The help queue across every event, with counts by status over everything
 * that matches the search.
 */
async function listTickets(q = {}) {
  const p = paging(q);
  const order = ordering(q, TICKET_SORTS, { sort: 'created', dir: 'desc' });
  const params = [];
  const where = [];
  const like = pattern(q.q);
  if (like) {
    params.push(like);
    const n = params.length;
    where.push(`(t.topic ILIKE $${n} OR tm.name ILIKE $${n} OR e.name ILIKE $${n} OR e.event_code ILIKE $${n})`);
  }
  if (toInt(q.eventId)) { params.push(toInt(q.eventId)); where.push(`t.event_id = $${params.length}`); }
  if (toInt(q.customerId)) { params.push(toInt(q.customerId)); where.push(`e.customer_id = $${params.length}`); }
  if (q.escalated === 'true') where.push('t.escalated_to_admin AND t.resolved_at IS NULL');
  const baseWhere = [...where];
  const baseParams = [...params];
  const statuses = listOf(q.status, TICKET_STATUSES);
  if (statuses.length) { params.push(statuses); where.push(`LOWER(t.status) = ANY($${params.length}::text[])`); }
  params.push(p.pageSize, p.offset);
  const from = `FROM help_tickets t
       JOIN events e ON e.id = t.event_id
       LEFT JOIN teams tm ON tm.id = t.team_id
       LEFT JOIN users m ON m.id = t.mentor_id
       LEFT JOIN users rq ON rq.id = t.requester_id`;
  const [rows, counts] = await Promise.all([
    db.query(
      `SELECT t.id, t.event_id, e.name AS event_name, e.customer_id, t.team_id, tm.name AS team_name,
              t.topic, t.status, t.priority, t.escalated_to_admin, t.created_at, t.claimed_at, t.resolved_at,
              t.mentor_id, m.full_name AS mentor_name, t.requester_id, rq.full_name AS requester_name,
              COUNT(*) OVER () AS total
         ${from}
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${order.sql}, t.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
    db.query(
      `SELECT LOWER(t.status) AS status, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE t.escalated_to_admin AND t.resolved_at IS NULL)::int AS escalated
         ${from}
        ${baseWhere.length ? `WHERE ${baseWhere.join(' AND ')}` : ''}
        GROUP BY 1`,
      baseParams,
    ),
  ]);
  const total = rows.rows[0] ? Number(rows.rows[0].total) : await countAfterLastPage(listTickets, q, p);
  return {
    ...page(rows.rows.map(({ total: _t, ...row }) => row), total, p),
    sort: order.key,
    dir: order.dir,
    counts: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])),
    escalated: counts.rows.reduce((n, c) => n + c.escalated, 0),
  };
}

const FEEDBACK_SORTS = { created: 'f.created_at', rating: 'f.rating', event: 'LOWER(e.name)' };

/**
 * GET /api/owner/feedback?q=&eventId=&rating=1,2&sort=&dir=&page=&pageSize=
 * Ratings and comments from every event, with the average and the spread of
 * ratings over everything that matches. Who wrote it is not part of this
 * list: feedback is read as the event's, not the person's.
 */
async function listFeedback(q = {}) {
  const p = paging(q);
  const order = ordering(q, FEEDBACK_SORTS, { sort: 'created', dir: 'desc' });
  const params = [];
  const where = [];
  const like = pattern(q.q);
  if (like) { params.push(like); where.push(`(f.comment ILIKE $${params.length} OR e.name ILIKE $${params.length})`); }
  if (toInt(q.eventId)) { params.push(toInt(q.eventId)); where.push(`f.event_id = $${params.length}`); }
  if (q.withComment === 'true') where.push(`COALESCE(TRIM(f.comment), '') <> ''`);
  const baseWhere = [...where];
  const baseParams = [...params];
  const ratings = listOf(q.rating, ['1', '2', '3', '4', '5']).map(Number);
  if (ratings.length) { params.push(ratings); where.push(`f.rating = ANY($${params.length}::int[])`); }
  params.push(p.pageSize, p.offset);
  const [rows, summary] = await Promise.all([
    db.query(
      `SELECT f.id, f.event_id, e.name AS event_name, e.customer_id, c.name AS customer_name,
              f.rating, f.nps, f.comment, f.type, f.created_at,
              COUNT(*) OVER () AS total
         FROM feedback f JOIN events e ON e.id = f.event_id LEFT JOIN customers c ON c.id = e.customer_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${order.sql}, f.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
    db.query(
      `SELECT COUNT(*)::int AS responses, ROUND(AVG(f.rating) FILTER (WHERE f.rating > 0), 2) AS average,
              COUNT(*) FILTER (WHERE COALESCE(TRIM(f.comment), '') <> '')::int AS comments,
              COUNT(DISTINCT f.event_id)::int AS events,
              json_build_object(
                '1', COUNT(*) FILTER (WHERE f.rating = 1), '2', COUNT(*) FILTER (WHERE f.rating = 2),
                '3', COUNT(*) FILTER (WHERE f.rating = 3), '4', COUNT(*) FILTER (WHERE f.rating = 4),
                '5', COUNT(*) FILTER (WHERE f.rating = 5)) AS distribution
         FROM feedback f JOIN events e ON e.id = f.event_id
        ${baseWhere.length ? `WHERE ${baseWhere.join(' AND ')}` : ''}`,
      baseParams,
    ),
  ]);
  const total = rows.rows[0] ? Number(rows.rows[0].total) : await countAfterLastPage(listFeedback, q, p);
  const s = summary.rows[0];
  return {
    ...page(rows.rows.map(({ total: _t, ...row }) => row), total, p),
    sort: order.key,
    dir: order.dir,
    summary: { ...s, average: s.average == null ? null : Number(s.average) },
  };
}

/* ── Global search ──────────────────────────────────────────────────────── */

/**
 * GET /api/owner/search?q= — up to `limit` (≤ 8) of each: organisations,
 * people by name or e-mail, orders by number, events by name or code.
 * Prefix matches rank first.
 */
async function search(rawQ, { limit = 5 } = {}) {
  const text = String(rawQ ?? '').trim().slice(0, 100);
  const empty = { q: text, organisations: [], people: [], orders: [], events: [] };
  if (text.length < 2) return empty;
  const like = pattern(text);
  const prefix = `${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const n = Math.min(Math.max(Number(limit) || 5, 1), 8);
  const [orgs, people, orders, events] = await Promise.all([
    db.query(
      `SELECT id, name, status, city, country, archived_at FROM customers
        WHERE name ILIKE $1 OR legal_name ILIKE $1 OR slug ILIKE $1 OR billing_email ILIKE $1
        ORDER BY (name ILIKE $2) DESC, archived_at IS NOT NULL, LOWER(name) LIMIT $3`,
      [like, prefix, n],
    ),
    db.query(
      `SELECT id, full_name, email, role FROM users
        WHERE full_name ILIKE $1 OR email ILIKE $1
        ORDER BY (full_name ILIKE $2 OR email ILIKE $2) DESC, LOWER(full_name) LIMIT $3`,
      [like, prefix, n],
    ),
    db.query(
      `SELECT o.id, o.order_code, o.status, o.invoice_number, c.name AS customer_name, o.amount_minor, o.currency
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.order_code ILIKE $1 OR o.invoice_number ILIKE $1
        ORDER BY (o.order_code ILIKE $2) DESC, o.id DESC LIMIT $3`,
      [like, prefix, n],
    ),
    db.query(
      `SELECT e.id, e.name, e.event_code, ${PHASE_SQL} AS phase, c.name AS customer_name
         FROM events e LEFT JOIN customers c ON c.id = e.customer_id
        WHERE e.name ILIKE $1 OR e.event_code ILIKE $1 OR e.slug ILIKE $1
        ORDER BY (e.name ILIKE $2 OR e.event_code ILIKE $2) DESC, e.start_date DESC LIMIT $3`,
      [like, prefix, n],
    ),
  ]);
  return {
    q: text,
    organisations: orgs.rows,
    people: people.rows,
    orders: orders.rows.map((o) => ({ ...o, amount_minor: money(o.amount_minor) })),
    events: events.rows,
  };
}

/* ── Owner actions on a person ──────────────────────────────────────────── */

/** Bump the session version: every session the person has ends at its next request. */
async function signOutEverywhere(userId) {
  const r = await db.query(
    'UPDATE users SET token_version = token_version + 1, updated_at = now() WHERE id = $1 RETURNING id',
    [userId],
  );
  if (!r.rows[0]) throw httpError(404, 'User not found', 'NOT_FOUND');
}

module.exports = {
  PHASE_SQL,
  paging,
  pattern,
  listCustomers,
  customerDetail,
  listEvents,
  eventDetail,
  listUsers,
  userDetail,
  listOrders,
  orderDetail,
  listJudging,
  listTickets,
  listFeedback,
  search,
  signOutEverywhere,
};
