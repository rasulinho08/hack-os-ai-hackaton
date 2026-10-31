/**
 * @file entitlement.service.js
 * @description What an organisation has bought, and what that switches on.
 *
 * An approved order becomes an entitlement: one event to be started within a
 * year (per-event plans) or a year of events up to the plan's allowance
 * (annual plans). Each event an organisation creates takes one from the
 * entitlement that runs out soonest, and remembers which (events.entitlement_id),
 * so the event keeps that plan's modules and limits for its whole life.
 *
 * Three cases have no entitlement and no limits: the platform owner's own
 * events, events from before plans existed, and organisations the owner has
 * marked plan-exempt (every organisation that existed when plans arrived).
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { PLANS } = require('../constants/plans');
const catalogue = require('./priceCatalogue.service');
const { MODULE_KEYS, modulesForPlan } = require('../constants/modules');

const MANAGER_ROLES = ['owner', 'admin', 'organizer'];
const LIVE_STATUSES = ['active', 'pending_setup'];
const PLAN_RANK = { community: 0, starter: 1, professional: 2, business: 3, enterprise: 4 };

/** Still granting: not revoked and not past its end. */
const LIVE_SQL = 'revoked_at IS NULL AND ends_at > now()';

function addMonths(date, months) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * The limits an order grants: the ones it was placed under (`plan_terms`,
 * kept at checkout), else the catalogue's now — an order raised by the owner,
 * or placed before orders kept them.
 */
async function termsForOrder(client, order) {
  if (!PLANS[order.plan]) throw httpError(409, `Unknown plan ${order.plan}`, 'UNKNOWN_PLAN');
  if (order.plan_terms && typeof order.plan_terms === 'object') return order.plan_terms;
  return catalogue.termsOf(await catalogue.getPlan(order.plan, client));
}

/**
 * The entitlement an approved order grants. Called inside the approval
 * transaction, with its client. The plan's limits are copied in, so a later
 * change to the price list never rewrites what was sold.
 */
async function grantForOrder(client, order, actorId = null) {
  const plan = await termsForOrder(client, order);
  const annual = order.billing_period === 'annual';
  const startsAt = new Date();
  const result = await client.query(
    `INSERT INTO entitlements
       (customer_id, order_id, plan, kind, starts_at, ends_at, events_allowed,
        participant_limit, seat_limit, storage_gb, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      order.customer_id, order.id, order.plan, annual ? 'annual' : 'per_event',
      startsAt, addMonths(startsAt, 12),
      annual ? plan.eventsPerYear : 1,
      plan.participants, plan.seats, plan.storageGb, actorId,
    ],
  );
  return result.rows[0];
}

/** An order that is cancelled or refunded after approval stops granting. */
async function revokeForOrder(client, orderId) {
  await client.query(
    'UPDATE entitlements SET revoked_at = now() WHERE order_id = $1 AND revoked_at IS NULL',
    [orderId],
  );
}

/**
 * The organisation a new event of this person belongs to: one they own,
 * administer or organise, that has been approved. Null when there is none
 * (the platform owner, and organisers from before organisations existed).
 */
async function organisationForNewEvent(userId) {
  const result = await db.query(
    `SELECT c.id, c.name, c.status, c.plan_exempt
       FROM customer_contacts cc
       JOIN customers c ON c.id = cc.customer_id
      WHERE cc.user_id = $1
        AND cc.member_role = ANY($2::text[])
        AND c.status = ANY($3::text[])
        AND c.archived_at IS NULL
      ORDER BY (cc.member_role = 'owner') DESC, c.id ASC
      LIMIT 1`,
    [userId, MANAGER_ROLES, LIVE_STATUSES],
  );
  return result.rows[0] || null;
}

/**
 * Take one event from the organisation's plan, from the entitlement that
 * runs out soonest. Returns its id, or null for an exempt organisation.
 *
 * 402 NO_EVENT_CREDIT when nothing is left; 422 EVENT_OUTSIDE_PLAN when there
 * is a credit but the event would start after the plan ends.
 */
async function reserveEventCredit(org, { startDate = null } = {}) {
  if (!org || org.plan_exempt) return null;
  const start = startDate ? new Date(startDate) : null;
  const startOk = start && !Number.isNaN(start.getTime()) ? start : null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const candidates = await client.query(
      `SELECT id, ends_at FROM entitlements
        WHERE customer_id = $1 AND ${LIVE_SQL}
          AND (events_allowed IS NULL OR events_used < events_allowed)
        ORDER BY ends_at ASC, id ASC
        FOR UPDATE`,
      [org.id],
    );
    if (candidates.rows.length === 0) {
      await client.query('ROLLBACK');
      throw httpError(
        402,
        'Your plan has no events left. Buy another event or move to an annual plan to create one.',
        'NO_EVENT_CREDIT',
      );
    }
    const fit = candidates.rows.find((r) => !startOk || startOk <= new Date(r.ends_at));
    if (!fit) {
      await client.query('ROLLBACK');
      const last = candidates.rows[candidates.rows.length - 1].ends_at;
      throw httpError(
        422,
        `Your plan covers events that start by ${new Date(last).toISOString().slice(0, 10)}. Choose an earlier start date or renew.`,
        'EVENT_OUTSIDE_PLAN',
      );
    }
    await client.query('UPDATE entitlements SET events_used = events_used + 1 WHERE id = $1', [fit.id]);
    await client.query('COMMIT');
    return fit.id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Give an event back: its creation failed, or it was deleted unpublished. */
async function releaseEventCredit(entitlementId) {
  if (!entitlementId) return;
  await db.query(
    'UPDATE entitlements SET events_used = GREATEST(events_used - 1, 0) WHERE id = $1',
    [entitlementId],
  );
}

async function overridesFor(customerId) {
  const result = await db.query(
    'SELECT module_key, enabled, note, set_at FROM org_module_overrides WHERE customer_id = $1 ORDER BY module_key',
    [customerId],
  );
  return result.rows;
}

function applyOverrides(modules, overrides) {
  for (const o of overrides) {
    if (!MODULE_KEYS.includes(o.module_key)) continue;
    if (o.enabled) modules.add(o.module_key);
    else modules.delete(o.module_key);
  }
  return modules;
}

/**
 * The modules and limits of one event: its entitlement's plan, or everything
 * for the owner's own events, events from before plans and exempt
 * organisations — then the owner's per-organisation switches on top.
 */
async function forEvent(eventId) {
  const result = await db.query(
    `SELECT e.id, e.customer_id, e.entitlement_id,
            COALESCE(c.plan_exempt, false) AS plan_exempt,
            en.plan, en.kind, en.participant_limit, en.storage_gb, en.ends_at
       FROM events e
       LEFT JOIN customers c ON c.id = e.customer_id
       LEFT JOIN entitlements en ON en.id = e.entitlement_id
      WHERE e.id = $1`,
    [eventId],
  );
  const row = result.rows[0];
  if (!row) return null;

  /*
   * An event takes its plan when it is published. Before that — a draft in
   * the builder — it is shown and checked against the plan it would publish
   * under: the organisation's best live entitlement, or Starter when it has
   * none left (publishing will then ask for a purchase). Without this every
   * draft looked unlimited and the builder offered what the plan lacks.
   */
  let { plan } = row;
  let participants = row.participant_limit;
  let storageGb = row.storage_gb;
  if (!plan && row.customer_id && !row.plan_exempt) {
    const live = await db.query(
      `SELECT plan, participant_limit, storage_gb FROM entitlements
        WHERE customer_id = $1 AND ${LIVE_SQL}`,
      [row.customer_id],
    );
    const best = live.rows.reduce((acc, e) => (!acc || PLAN_RANK[e.plan] > PLAN_RANK[acc.plan] ? e : acc), null);
    plan = best ? best.plan : 'starter';
    participants = best ? best.participant_limit : PLANS.starter.participants;
    storageGb = best ? best.storage_gb : PLANS.starter.storageGb;
  }

  const unlimited = row.plan_exempt || !plan;
  const modules = unlimited ? new Set(MODULE_KEYS) : modulesForPlan(plan);
  if (row.customer_id) applyOverrides(modules, await overridesFor(row.customer_id));
  return {
    eventId: row.id,
    plan: unlimited ? null : plan,
    modules,
    limits: {
      participants: unlimited ? null : participants,
      storageGb: unlimited ? null : storageGb,
    },
  };
}

/**
 * Everything about one organisation's plan, for its own dashboard and for
 * the owner console.
 */
async function summaryForCustomer(customerId) {
  const [customer, entitlements, overrides] = await Promise.all([
    db.query('SELECT id, status, plan_exempt FROM customers WHERE id = $1', [customerId]),
    db.query(
      `SELECT en.*, o.order_code,
              (en.revoked_at IS NULL AND en.ends_at > now()) AS live
         FROM entitlements en
         LEFT JOIN orders o ON o.id = en.order_id
        WHERE en.customer_id = $1
        ORDER BY en.created_at DESC`,
      [customerId],
    ),
    overridesFor(customerId),
  ]);
  const c = customer.rows[0];
  if (!c) return null;

  const live = entitlements.rows.filter((e) => e.live);
  const best = live.reduce((acc, e) => (!acc || PLAN_RANK[e.plan] > PLAN_RANK[acc.plan] ? e : acc), null);
  const unlimitedEvents = c.plan_exempt || live.some((e) => e.events_allowed == null);
  const eventsRemaining = unlimitedEvents
    ? null
    : live.reduce((sum, e) => sum + Math.max(0, e.events_allowed - e.events_used), 0);

  const modules = c.plan_exempt
    ? new Set(MODULE_KEYS)
    : live.reduce((set, e) => { modulesForPlan(e.plan).forEach((m) => set.add(m)); return set; }, new Set());
  applyOverrides(modules, overrides);

  return {
    customerId: c.id,
    status: c.status,
    exempt: c.plan_exempt,
    plan: c.plan_exempt ? null : best ? best.plan : null,
    eventsRemaining,
    limits: best && !c.plan_exempt
      ? { participants: best.participant_limit, seats: best.seat_limit, storageGb: best.storage_gb }
      : { participants: null, seats: null, storageGb: null },
    modules: [...modules].sort(),
    overrides,
    entitlements: entitlements.rows.map((e) => ({
      id: e.id,
      orderId: e.order_id,
      orderCode: e.order_code || null,
      plan: e.plan,
      kind: e.kind,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      eventsAllowed: e.events_allowed,
      eventsUsed: e.events_used,
      live: e.live,
      revokedAt: e.revoked_at,
    })),
  };
}

/** The owner switches one module on (true), off (false) or back to the plan (null). */
async function setOverride(customerId, moduleKey, enabled, actorId, note = null) {
  if (!MODULE_KEYS.includes(moduleKey)) {
    throw httpError(400, `Unknown module: ${moduleKey}`, 'UNKNOWN_MODULE');
  }
  if (enabled === null || enabled === undefined) {
    await db.query('DELETE FROM org_module_overrides WHERE customer_id = $1 AND module_key = $2', [customerId, moduleKey]);
    return;
  }
  await db.query(
    `INSERT INTO org_module_overrides (customer_id, module_key, enabled, note, set_by, set_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (customer_id, module_key)
     DO UPDATE SET enabled = EXCLUDED.enabled, note = EXCLUDED.note, set_by = EXCLUDED.set_by, set_at = now()`,
    [customerId, moduleKey, Boolean(enabled), note ? String(note).slice(0, 500) : null, actorId],
  );
}

module.exports = {
  termsForOrder,
  MANAGER_ROLES,
  LIVE_STATUSES,
  grantForOrder,
  revokeForOrder,
  organisationForNewEvent,
  reserveEventCredit,
  releaseEventCredit,
  forEvent,
  summaryForCustomer,
  setOverride,
};
