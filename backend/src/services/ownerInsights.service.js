/**
 * @file ownerInsights.service.js
 * @description What the owner console's overview adds to the totals: revenue
 * by month, the path from sign-up to an active organisation, the biggest
 * organisations, what just happened, and what is waiting on the owner.
 *
 * Money is summed per currency and never across currencies. "Paid" is an
 * order with `paid_at`, as on the overview; "pending" is money owed on an
 * order that is placed or approved but not yet paid.
 */

const db = require('../config/db');
const { PHASE_SQL } = require('./ownerDirectory.service');

const MONTHS = 12;

/** GET /api/owner/insights */
async function insights() {
  const [months, funnel, topParticipants, topRevenue, waiting] = await Promise.all([
    db.query(
      `WITH m AS (
         SELECT generate_series(date_trunc('month', now()) - interval '${MONTHS - 1} months',
                                date_trunc('month', now()), interval '1 month') AS month)
       SELECT to_char(m.month, 'YYYY-MM') AS month, cur.currency,
              COALESCE((SELECT SUM(o.amount_minor) FROM orders o
                         WHERE o.currency = cur.currency AND o.paid_at >= m.month
                           AND o.paid_at < m.month + interval '1 month'), 0)::bigint AS paid_minor,
              COALESCE((SELECT COUNT(*) FROM orders o
                         WHERE o.currency = cur.currency AND o.paid_at >= m.month
                           AND o.paid_at < m.month + interval '1 month'), 0)::int AS paid_orders,
              COALESCE((SELECT SUM(o.amount_minor) FROM orders o
                         WHERE o.currency = cur.currency AND o.paid_at IS NULL
                           AND o.status IN ('pending', 'delivered')
                           AND COALESCE(o.placed_at, o.created_at) >= m.month
                           AND COALESCE(o.placed_at, o.created_at) < m.month + interval '1 month'), 0)::bigint AS pending_minor,
              COALESCE((SELECT COUNT(*) FROM orders o
                         WHERE o.currency = cur.currency AND o.paid_at IS NULL
                           AND o.status IN ('pending', 'delivered')
                           AND COALESCE(o.placed_at, o.created_at) >= m.month
                           AND COALESCE(o.placed_at, o.created_at) < m.month + interval '1 month'), 0)::int AS pending_orders
         FROM m CROSS JOIN (SELECT DISTINCT currency FROM orders) cur
        ORDER BY cur.currency, m.month`,
    ),
    db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM users) AS accounts,
         (SELECT COUNT(DISTINCT purchaser_user_id)::int FROM orders
           WHERE purchaser_user_id IS NOT NULL AND status <> 'draft') AS buyers,
         (SELECT COUNT(DISTINCT customer_id)::int FROM orders WHERE status <> 'draft') AS ordering_orgs,
         (SELECT COUNT(DISTINCT customer_id)::int FROM orders WHERE status = 'delivered') AS approved_orgs,
         (SELECT COUNT(DISTINCT e.customer_id)::int FROM events e
            JOIN customers c ON c.id = e.customer_id AND c.archived_at IS NULL
           WHERE e.is_published) AS active_orgs`,
    ),
    db.query(
      `SELECT c.id, c.name, COUNT(p.id)::int AS participants, COUNT(DISTINCT e.id)::int AS events
         FROM customers c
         JOIN events e ON e.customer_id = c.id
         JOIN participants p ON p.event_id = e.id
        WHERE c.archived_at IS NULL
        GROUP BY c.id, c.name
        ORDER BY participants DESC, c.name
        LIMIT 5`,
    ),
    db.query(
      `SELECT c.id, c.name, o.currency, SUM(o.amount_minor)::bigint AS paid_minor, COUNT(*)::int AS orders
         FROM customers c JOIN orders o ON o.customer_id = c.id
        WHERE o.paid_at IS NOT NULL AND o.amount_minor IS NOT NULL
        GROUP BY c.id, c.name, o.currency
        ORDER BY paid_minor DESC, c.name
        LIMIT 5`,
    ),
    db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM orders WHERE status IN ('pending', 'paid')) AS orders_to_review,
         (SELECT COUNT(*)::int FROM customers WHERE status = 'pending_review' AND archived_at IS NULL) AS orgs_awaiting,
         (SELECT COUNT(*)::int FROM chat_reports WHERE resolved_at IS NULL) AS reported_messages,
         (SELECT COUNT(*)::int FROM jobs WHERE status = 'failed' AND COALESCE(finished_at, created_at) > now() - interval '7 days') AS failed_jobs,
         (SELECT COUNT(*)::int FROM help_tickets WHERE escalated_to_admin AND resolved_at IS NULL) AS escalated_tickets,
         (SELECT COUNT(*)::int FROM orders WHERE status = 'delivered' AND paid_at IS NULL
             AND invoice_due_at IS NOT NULL AND invoice_due_at < now()) AS overdue_invoices,
         (SELECT COUNT(*)::int FROM events e WHERE ${PHASE_SQL} = 'running') AS running_events`,
    ),
  ]);

  const byCurrency = {};
  for (const r of months.rows) {
    (byCurrency[r.currency] = byCurrency[r.currency] || []).push({
      month: r.month,
      paidMinor: Number(r.paid_minor),
      paidOrders: r.paid_orders,
      pendingMinor: Number(r.pending_minor),
      pendingOrders: r.pending_orders,
    });
  }
  const f = funnel.rows[0];
  const w = waiting.rows[0];
  return {
    revenueByMonth: Object.entries(byCurrency).map(([currency, rows]) => ({ currency, months: rows })),
    funnel: [
      { key: 'accounts', label: 'Accounts', value: f.accounts },
      { key: 'buyers', label: 'Placed an order', value: f.buyers },
      { key: 'ordering', label: 'Organisations that ordered', value: f.ordering_orgs },
      { key: 'approved', label: 'Organisations approved', value: f.approved_orgs },
      { key: 'active', label: 'Organisations with a published event', value: f.active_orgs },
    ],
    topByParticipants: topParticipants.rows,
    topByRevenue: topRevenue.rows.map((r) => ({ ...r, paid_minor: Number(r.paid_minor) })),
    waiting: {
      ordersToReview: w.orders_to_review,
      orgsAwaitingApproval: w.orgs_awaiting,
      reportedMessages: w.reported_messages,
      failedJobs: w.failed_jobs,
      escalatedTickets: w.escalated_tickets,
      overdueInvoices: w.overdue_invoices,
      runningEvents: w.running_events,
    },
  };
}

/**
 * GET /api/owner/activity?after=&limit= — the newest audit rows, for the
 * overview's live feed. `after` (an id) returns only what is newer, so the
 * feed can poll cheaply.
 */
async function activity({ after = null, limit = 15 } = {}) {
  const a = Number.parseInt(String(after ?? ''), 10);
  const n = Math.min(Math.max(Number.parseInt(String(limit), 10) || 15, 1), 50);
  const r = await db.query(
    `SELECT a.id, a.actor_user_id, u.full_name AS actor_name, a.customer_id, c.name AS customer_name,
            a.event_id, e.name AS event_name, a.action, a.target_type, a.target_id, a.created_at
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.actor_user_id
       LEFT JOIN customers c ON c.id = a.customer_id
       LEFT JOIN events e ON e.id = a.event_id
      WHERE ($1::bigint IS NULL OR a.id > $1::bigint)
      ORDER BY a.id DESC
      LIMIT $2`,
    [Number.isInteger(a) && a > 0 ? a : null, n],
  );
  return r.rows;
}

/**
 * GET /api/owner/analytics — platform totals over time: per month, new
 * accounts, registrations, events created, teams and submissions; the split
 * of registrations by status; and the twelve largest events. Events the
 * owner marked as tests (and the people, teams and projects in them) are
 * left out of every figure here.
 */
async function analytics() {
  const [monthly, statuses, top, totals] = await Promise.all([
    db.query(
      `WITH test_events AS (SELECT id FROM events WHERE is_test),
       m AS (
         SELECT generate_series(date_trunc('month', now()) - interval '${MONTHS - 1} months',
                                date_trunc('month', now()), interval '1 month') AS month)
       SELECT to_char(m.month, 'YYYY-MM') AS month,
              (SELECT COUNT(*)::int FROM users u WHERE u.created_at >= m.month AND u.created_at < m.month + interval '1 month') AS accounts,
              (SELECT COUNT(*)::int FROM participants p WHERE p.registered_at >= m.month AND p.registered_at < m.month + interval '1 month'
                  AND p.event_id NOT IN (SELECT id FROM test_events)) AS registrations,
              (SELECT COUNT(*)::int FROM events e WHERE e.created_at >= m.month AND e.created_at < m.month + interval '1 month' AND NOT e.is_test) AS events,
              (SELECT COUNT(*)::int FROM teams t WHERE t.created_at >= m.month AND t.created_at < m.month + interval '1 month'
                  AND t.event_id NOT IN (SELECT id FROM test_events)) AS teams,
              (SELECT COUNT(*)::int FROM submissions s WHERE s.submitted_at >= m.month AND s.submitted_at < m.month + interval '1 month'
                  AND s.event_id NOT IN (SELECT id FROM test_events)) AS submissions
         FROM m ORDER BY m.month`,
    ),
    db.query(
      `SELECT LOWER(p.status::text) AS status, COUNT(*)::int AS n
         FROM participants p JOIN events e ON e.id = p.event_id AND NOT e.is_test
        GROUP BY 1 ORDER BY 2 DESC`,
    ),
    db.query(
      `SELECT e.id, e.name, e.event_code, ${PHASE_SQL} AS phase,
              (SELECT COUNT(*)::int FROM participants p WHERE p.event_id = e.id) AS participants,
              (SELECT COUNT(*)::int FROM teams t WHERE t.event_id = e.id) AS teams,
              (SELECT COUNT(*)::int FROM submissions s WHERE s.event_id = e.id) AS submissions
         FROM events e
        WHERE NOT e.is_test
        ORDER BY participants DESC, e.id DESC
        LIMIT 12`,
    ),
    db.query(
      `WITH live AS (SELECT id FROM events WHERE NOT is_test)
       SELECT (SELECT COUNT(*)::int FROM live) AS events,
              (SELECT COUNT(*)::int FROM participants WHERE event_id IN (SELECT id FROM live)) AS participants,
              (SELECT COUNT(*)::int FROM teams WHERE event_id IN (SELECT id FROM live)) AS teams,
              (SELECT COUNT(*)::int FROM submissions WHERE event_id IN (SELECT id FROM live)) AS submissions,
              (SELECT COUNT(*)::int FROM feedback WHERE event_id IN (SELECT id FROM live)) AS feedback,
              (SELECT COUNT(*)::int FROM event_checkins WHERE event_id IN (SELECT id FROM live)) AS checkins`,
    ),
  ]);
  return {
    monthly: monthly.rows,
    participantStatus: statuses.rows,
    topEvents: top.rows,
    totals: totals.rows[0],
  };
}

module.exports = { insights, activity, analytics };
