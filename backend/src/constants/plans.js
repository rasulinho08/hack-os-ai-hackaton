/**
 * @file plans.js
 * @description What each plan costs and what it includes — the defaults.
 *
 * The prices that count are the owner's, in the database (`plan_prices`,
 * edited in the owner console under Prices & discounts and read through
 * services/priceCatalogue.service.js). The catalogue was seeded from the
 * numbers below, and a plan without a row there still reads them, so they
 * are what a fresh installation sells at.
 *
 * This lives on the server because the browser must never name the price. A
 * checkout that trusts an amount from the client is a checkout where anyone
 * can buy the Business plan for zero, and no amount of validation on the way
 * out fixes that — the number has to originate here.
 *
 * Amounts are in minor units of AZN (qəpik), matching `orders.amount_minor`.
 * `null` means the plan is not sold on that period at all, which is different
 * from free: `enterprise` is quoted, never listed.
 *
 * The seat counts are the same numbers the pricing page advertises, and they
 * become `customers.seat_limit` when an order is approved — so the plan a
 * customer bought is what decides how many colleagues they can invite.
 *
 * Limits (null = unlimited): `participants` per event, `eventsPerYear` on the
 * annual plan (a per-event purchase is always one event), `storageGb` for
 * uploads. An approved order copies them into its entitlement, so changing a
 * number here never rewrites what an existing customer bought.
 *
 * Annual prices. A year must never cost more than buying the same events
 * one at a time, and the owner's pricing (October 2026) sets it at about
 * two thirds of them:
 *
 *   annual ≈ per_event × eventsPerYear × 2/3, rounded to a clean price
 *
 *   Starter       ₼390   × 3  × 2/3 = ₼780    → ₼790
 *   Professional  ₼990   × 6  × 2/3 = ₼3,960  → ₼3,990
 *   Business      ₼2,490 × 12 × 2/3 = ₼19,920 → ₼19,900
 *
 * Community is free and not sold: the owner grants it by hand to student
 * clubs and non-commercial university events (`grantOnly`), from the
 * organisation's page in the console. Checkout refuses it.
 *
 * The same rule is enforced when the owner saves a price
 * (ANNUAL_ABOVE_PER_EVENT); tests/commerce.test.js checks these defaults.
 *
 * `frontend/src/app/(site)/_plans.ts` renders these until the page has read
 * `GET /api/checkout/plans` (the price that counts).
 */

const CURRENCY = 'AZN';

const PLANS = Object.freeze({
  community: {
    id: 'community',
    name: 'Community',
    per_event: null,
    annual: null,
    seats: 3,
    participants: 100,
    eventsPerYear: 2,
    storageGb: 1,
    grantOnly: true,
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    per_event: 39000,      // ₼390
    annual: 79000,         // ₼790   (₼390 × 3 × 2/3 = ₼780)
    seats: 3,
    participants: 200,
    eventsPerYear: 3,
    storageGb: 1,
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    per_event: 99000,      // ₼990
    annual: 399000,        // ₼3,990 (₼990 × 6 × 2/3 = ₼3,960)
    seats: 10,
    participants: 500,
    eventsPerYear: 6,
    storageGb: 5,
  },
  business: {
    id: 'business',
    name: 'Business',
    per_event: 249000,     // ₼2,490
    annual: 1990000,       // ₼19,900 (₼2,490 × 12 × 2/3 = ₼19,920)
    seats: 25,
    participants: 2000,
    eventsPerYear: 12,
    storageGb: 20,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    per_event: null,
    annual: null,
    // No caps agreed in advance; they are part of the quote.
    seats: null,
    participants: null,
    eventsPerYear: null,
    storageGb: null,
    quoteOnly: true,
  },
});

const PLAN_IDS = Object.keys(PLANS);

/**
 * Plans a buyer can actually put through checkout. Enterprise is a
 * conversation; Community is granted by the owner.
 */
const SELF_SERVE_PLAN_IDS = PLAN_IDS.filter((id) => !PLANS[id].quoteOnly && !PLANS[id].grantOnly);

/**
 * What this plan costs on this period by default, in minor units. The price
 * an order is charged comes from the catalogue (priceCatalogue.priceOf),
 * which falls back to this.
 * @returns {number|null} null when the plan is not sold that way.
 */
function priceOf(planId, billingPeriod) {
  const plan = PLANS[planId];
  if (!plan) return null;
  return billingPeriod === 'annual' ? plan.annual : plan.per_event;
}

module.exports = { CURRENCY, PLANS, PLAN_IDS, SELF_SERVE_PLAN_IDS, priceOf };
