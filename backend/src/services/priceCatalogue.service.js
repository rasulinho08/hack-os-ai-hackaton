/**
 * @file priceCatalogue.service.js
 * @description What each plan costs and allows, as the owner has set it.
 *
 * The prices live in `plan_prices` (migration 0038), one row per plan, edited
 * in the owner console (Prices & discounts → `PUT /api/owner/pricing/:plan`).
 * A plan without a row reads `constants/plans.js`, which is also what the
 * rows were seeded from, so a fresh installation sells at the same prices.
 *
 * Every reader of a price goes through here: the public price list, the
 * checkout that prices an order, and approval, which grants the limits.
 * Nothing here touches an order already placed: an order stores its amount,
 * its discount and the plan's limits as they were (`orders.plan_terms`), and
 * an issued invoice its snapshot.
 *
 * Rules a save must keep, refused with a code the console shows:
 *
 *   - ANNUAL_ABOVE_PER_EVENT  an annual plan never costs more than its
 *                             events bought one by one
 *                             (annual ≤ eventsPerYear × per_event).
 *   - LIST_PRICE_NOT_ABOVE    the struck-through "was" price is above the
 *                             price, or there is nothing to strike through.
 *   - PLAN_NEEDS_PRICE        a plan on sale has a price on at least one
 *                             period.
 *   - PLAN_QUOTE_ONLY         Enterprise is quoted; it has no list price.
 *   - PLAN_GRANT_ONLY         Community is free and granted by the owner; its
 *                             limits can change, it never has a price.
 *
 * Each save writes one `plan_price_history` row with every changed field as
 * [old, new], and who changed it.
 */

const db = require('../config/db');
const { httpError } = require('../utils/responseFormat');
const { PLANS, PLAN_IDS } = require('../constants/plans');

/** API field → column, with the kind of value it takes. */
const FIELDS = {
  perEventMinor: { column: 'per_event_minor', kind: 'money' },
  annualMinor: { column: 'annual_minor', kind: 'money' },
  perEventListMinor: { column: 'per_event_list_minor', kind: 'money' },
  annualListMinor: { column: 'annual_list_minor', kind: 'money' },
  active: { column: 'active', kind: 'bool' },
  seats: { column: 'seats', kind: 'count' },
  participants: { column: 'participants', kind: 'count' },
  eventsPerYear: { column: 'events_per_year', kind: 'count' },
  storageGb: { column: 'storage_gb', kind: 'count' },
};

/** ₼1,000,000 — a typo guard, not a business rule. */
const MAX_PRICE_MINOR = 100000000;
const MAX_COUNT = 1000000;

/** 149000 → "₼1,490", 49050 → "₼490.50": for the messages a refusal carries. */
function manat(minor) {
  const n = Number(minor || 0) / 100;
  return `₼${n.toLocaleString('en-US', { minimumFractionDigits: Number(minor) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** The constants' plan in the shape the catalogue answers with. */
function fromConstants(id) {
  const p = PLANS[id];
  return {
    id,
    name: p.name,
    perEventMinor: p.per_event,
    annualMinor: p.annual,
    perEventListMinor: null,
    annualListMinor: null,
    active: true,
    seats: p.seats,
    participants: p.participants,
    eventsPerYear: p.eventsPerYear,
    storageGb: p.storageGb,
    quoteOnly: Boolean(p.quoteOnly),
    grantOnly: Boolean(p.grantOnly),
    updatedAt: null,
    updatedBy: null,
    updatedByName: null,
    stored: false,
  };
}

const intOrNull = (v) => (v == null ? null : Number(v));

/** A `plan_prices` row (with `updated_by_name` when joined) as a plan. */
function fromRow(row) {
  const base = fromConstants(row.plan_id);
  return {
    ...base,
    perEventMinor: intOrNull(row.per_event_minor),
    annualMinor: intOrNull(row.annual_minor),
    perEventListMinor: intOrNull(row.per_event_list_minor),
    annualListMinor: intOrNull(row.annual_list_minor),
    active: row.active !== false,
    seats: intOrNull(row.seats),
    participants: intOrNull(row.participants),
    eventsPerYear: intOrNull(row.events_per_year),
    storageGb: intOrNull(row.storage_gb),
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null,
    updatedByName: row.updated_by_name || null,
    stored: true,
  };
}

/**
 * Every plan, in the order the site lists them: the stored row where there
 * is one, the constants otherwise. Rows for plans the code does not know are
 * ignored — a plan is code (its modules, its limits' meaning), not data.
 */
async function getCatalogue(client = db) {
  const r = await client.query(
    `SELECT p.*, u.full_name AS updated_by_name
       FROM plan_prices p LEFT JOIN users u ON u.id = p.updated_by`,
  );
  const rows = new Map(r.rows.map((row) => [row.plan_id, row]));
  return PLAN_IDS.map((id) => (rows.has(id) ? fromRow(rows.get(id)) : fromConstants(id)));
}

/** One plan as the catalogue has it; null for a plan that does not exist. */
async function getPlan(planId, client = db) {
  if (!PLANS[planId]) return null;
  const r = await client.query('SELECT * FROM plan_prices WHERE plan_id = $1', [planId]);
  return r.rows[0] ? fromRow(r.rows[0]) : fromConstants(planId);
}

/** The plan's price on a period, in minor units; null when not sold that way. */
const priceIn = (plan, period) => (plan ? (period === 'annual' ? plan.annualMinor : plan.perEventMinor) : null);

/** The struck-through "was" price on a period, if one is set. */
const listPriceIn = (plan, period) => (plan ? (period === 'annual' ? plan.annualListMinor : plan.perEventListMinor) : null);

/**
 * What this plan costs on this period now, in minor units — the catalogue's
 * price, or the constants' where the plan has no row. null when not sold.
 */
async function priceOf(planId, period, client = db) {
  return priceIn(await getPlan(planId, client), period);
}

/** The limits an order for this plan grants, kept on the order (`plan_terms`). */
const termsOf = (plan) => ({
  seats: plan.seats,
  participants: plan.participants,
  eventsPerYear: plan.eventsPerYear,
  storageGb: plan.storageGb,
});

/**
 * Why this plan, as it would be saved, breaks a rule; null when it does not.
 * Shared by the save and by the tests, so both read the same rule.
 */
function ruleProblem(plan) {
  const name = plan.name || plan.id;
  if (plan.quoteOnly) {
    if (plan.perEventMinor != null || plan.annualMinor != null || plan.perEventListMinor != null || plan.annualListMinor != null) {
      return { code: 'PLAN_QUOTE_ONLY', field: 'perEventMinor', message: `${name} is quoted individually; it has no list price.` };
    }
    return null;
  }
  if (plan.grantOnly) {
    if (plan.perEventMinor != null || plan.annualMinor != null || plan.perEventListMinor != null || plan.annualListMinor != null) {
      return { code: 'PLAN_GRANT_ONLY', field: 'perEventMinor', message: `${name} is free and granted by hand; it has no price. Its limits can change.` };
    }
    return null;
  }
  if (plan.active && plan.perEventMinor == null && plan.annualMinor == null) {
    return { code: 'PLAN_NEEDS_PRICE', field: 'perEventMinor', message: `${name} is on sale, so it needs a price per event, per year or both. To stop selling it, switch it off instead.` };
  }
  for (const [list, price, label, field] of [
    [plan.perEventListMinor, plan.perEventMinor, 'per-event', 'perEventListMinor'],
    [plan.annualListMinor, plan.annualMinor, 'annual', 'annualListMinor'],
  ]) {
    if (list == null) continue;
    if (price == null) {
      return { code: 'LIST_PRICE_NOT_ABOVE', field, message: `${name} has a struck-through ${label} price but no ${label} price to show beside it.` };
    }
    if (list <= price) {
      return { code: 'LIST_PRICE_NOT_ABOVE', field, message: `The struck-through ${label} price (${manat(list)}) has to be above the price (${manat(price)}), or it reads as a mistake. Leave it empty to show no "was" price.` };
    }
  }
  if (plan.annualMinor != null && plan.perEventMinor != null && plan.eventsPerYear != null) {
    const oneByOne = plan.eventsPerYear * plan.perEventMinor;
    if (plan.annualMinor > oneByOne) {
      return {
        code: 'ANNUAL_ABOVE_PER_EVENT',
        field: 'annualMinor',
        message: `A year of ${name} (${manat(plan.annualMinor)}) would cost more than its ${plan.eventsPerYear} events bought one by one (${plan.eventsPerYear} × ${manat(plan.perEventMinor)} = ${manat(oneByOne)}). Lower the annual price, raise the per-event price or include more events.`,
        limitMinor: oneByOne,
      };
    }
  }
  return null;
}

/** A field's value from the request, checked; `undefined` when it was not sent. */
function readField(body, key, spec, errors) {
  if (body[key] === undefined) return undefined;
  const raw = body[key];
  if (spec.kind === 'bool') {
    if (typeof raw !== 'boolean') errors.push({ field: key, message: 'true or false.' });
    return raw;
  }
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    errors.push({ field: key, message: spec.kind === 'money' ? 'A whole number of qəpik, 0 or more.' : 'A whole number, 0 or more — or empty for unlimited.' });
    return undefined;
  }
  if (spec.kind === 'money' && n > MAX_PRICE_MINOR) errors.push({ field: key, message: `At most ${manat(MAX_PRICE_MINOR)}.` });
  if (spec.kind === 'count' && n > MAX_COUNT) errors.push({ field: key, message: `At most ${MAX_COUNT.toLocaleString('en-US')}.` });
  return n;
}

/** The plan with the request's changes on top, without saving anything. */
function merged(current, body = {}) {
  const errors = [];
  const next = { ...current };
  for (const [key, spec] of Object.entries(FIELDS)) {
    const v = readField(body, key, spec, errors);
    if (v !== undefined) next[key] = v;
  }
  return { next, errors };
}

/**
 * PUT /api/owner/pricing/:plan — any of the fields; one left out keeps its
 * value, null clears it (no price on that period, no "was" price, no limit).
 * Returns the plan as saved and the changes, `{ field: [old, new] }`.
 */
async function updatePlan(planId, body = {}, actorId = null) {
  if (!PLANS[planId]) throw httpError(404, 'There is no such plan.', 'PLAN_NOT_FOUND');
  const note = body.note == null ? null : String(body.note).trim().slice(0, 500) || null;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // A plan with no row yet gets one with the constants' values, so the
    // first save records the change from what the site was showing.
    const seed = fromConstants(planId);
    await client.query(
      `INSERT INTO plan_prices (plan_id, per_event_minor, annual_minor, seats, participants, events_per_year, storage_gb)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (plan_id) DO NOTHING`,
      [planId, seed.perEventMinor, seed.annualMinor, seed.seats, seed.participants, seed.eventsPerYear, seed.storageGb],
    );
    // Locked, so two saves at once apply one after the other and each
    // history row compares against what the other wrote.
    const locked = await client.query('SELECT * FROM plan_prices WHERE plan_id = $1 FOR UPDATE', [planId]);
    const current = fromRow(locked.rows[0]);

    if (current.quoteOnly) {
      throw httpError(409, `${current.name} is quoted individually; it has no list price to edit.`, 'PLAN_QUOTE_ONLY');
    }
    const { next, errors } = merged(current, body);
    if (errors.length) throw httpError(400, 'Some fields need attention.', 'VALIDATION_ERROR', { errors });
    const problem = ruleProblem(next);
    if (problem) {
      throw httpError(400, problem.message, problem.code, { errors: [{ field: problem.field, message: problem.message }] });
    }

    const changes = {};
    for (const key of Object.keys(FIELDS)) {
      if (next[key] !== current[key]) changes[key] = [current[key], next[key]];
    }
    if (Object.keys(changes).length === 0) {
      await client.query('ROLLBACK');
      return { plan: await getPlan(planId), changes };
    }

    const sets = Object.keys(changes).map((key, i) => `${FIELDS[key].column} = $${i + 2}`);
    await client.query(
      `UPDATE plan_prices SET ${sets.join(', ')}, updated_at = now(), updated_by = $${sets.length + 2} WHERE plan_id = $1`,
      [planId, ...Object.keys(changes).map((key) => next[key]), actorId],
    );
    await client.query(
      'INSERT INTO plan_price_history (plan_id, changes, note, changed_by) VALUES ($1, $2::jsonb, $3, $4)',
      [planId, JSON.stringify(changes), note, actorId],
    );
    await client.query('COMMIT');
    return { plan: (await getCatalogue()).find((p) => p.id === planId), changes };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Saves, newest first, with who made them. */
async function history({ planId = null, limit = 50 } = {}) {
  const params = [];
  const where = [];
  if (planId) { params.push(planId); where.push(`h.plan_id = $${params.length}`); }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));
  const r = await db.query(
    `SELECT h.id, h.plan_id, h.changes, h.note, h.changed_by, u.full_name AS changed_by_name, h.changed_at
       FROM plan_price_history h LEFT JOIN users u ON u.id = h.changed_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY h.changed_at DESC, h.id DESC
      LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

module.exports = {
  FIELDS, getCatalogue, getPlan, priceOf, priceIn, listPriceIn, termsOf, ruleProblem, merged, updatePlan, history, manat,
};
