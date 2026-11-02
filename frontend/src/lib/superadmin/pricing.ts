/**
 * The owner console's Prices & discounts: the price catalogue, its history,
 * and the discount codes and campaigns.
 *
 *   GET  /api/owner/pricing             → plans, recent history, campaigns running
 *   PUT  /api/owner/pricing/:plan       → a plan's prices, "was" prices, limits, on-sale switch
 *   GET  /api/owner/pricing/history     → every save
 *   GET  /api/owner/coupons             → codes and campaigns with their figures
 *   POST/PATCH/DELETE /api/owner/coupons[/:id], POST …/:id/pause|resume
 *
 * Amounts are qəpik, as everywhere; the forms turn manat into qəpik with
 * `parseManat` (lib/pricing). The server checks every rule again on save.
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import type { BillingPeriod, CouponState, PublicCampaign } from "@/lib/pricing";

export interface CataloguePlan {
  id: string;
  name: string;
  perEventMinor: number | null;
  annualMinor: number | null;
  perEventListMinor: number | null;
  annualListMinor: number | null;
  active: boolean;
  seats: number | null;
  participants: number | null;
  eventsPerYear: number | null;
  storageGb: number | null;
  quoteOnly: boolean;
  /** Community: free, granted by the owner, never sold. */
  grantOnly?: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
  /** false: no row yet, the built-in defaults apply. */
  stored: boolean;
}

/** The fields a save can change, as the API names them. */
export const PLAN_FIELDS = [
  "perEventMinor",
  "annualMinor",
  "perEventListMinor",
  "annualListMinor",
  "active",
  "seats",
  "participants",
  "eventsPerYear",
  "storageGb",
] as const;
export type PlanField = (typeof PLAN_FIELDS)[number];

export const PLAN_FIELD_LABEL: Record<PlanField, string> = {
  perEventMinor: "Per-event price",
  annualMinor: "Annual price",
  perEventListMinor: "Per-event “was” price",
  annualListMinor: "Annual “was” price",
  active: "On sale",
  seats: "Organiser seats",
  participants: "Participants per event",
  eventsPerYear: "Events a year",
  storageGb: "Storage",
};

export const MONEY_FIELDS: PlanField[] = ["perEventMinor", "annualMinor", "perEventListMinor", "annualListMinor"];

export interface PriceChange {
  id: number;
  plan_id: string;
  changes: Partial<Record<PlanField, [unknown, unknown]>>;
  note: string | null;
  changed_by: number | null;
  changed_by_name: string | null;
  changed_at: string;
}

export interface PricingData {
  plans: CataloguePlan[];
  history: PriceChange[];
  campaigns: PublicCampaign[];
}

export const loadPricing = () => apiGet<PricingData>("/api/owner/pricing");
export const loadPriceHistory = (plan?: string) =>
  apiGet<PriceChange[]>(`/api/owner/pricing/history?limit=200${plan ? `&plan=${encodeURIComponent(plan)}` : ""}`);
export const savePlan = (id: string, body: Partial<Record<PlanField, number | boolean | null>> & { note?: string }) =>
  apiPut<{ plan: CataloguePlan; changes: PriceChange["changes"] }>(`/api/owner/pricing/${encodeURIComponent(id)}`, body);

/* ── Coupons ───────────────────────────────────────────────────────────── */

export interface Coupon {
  id: number;
  kind: "code" | "campaign";
  code: string | null;
  name: string;
  eligibility: "all" | "education" | "nonprofit" | null;
  /** A code given to one organisation only (a launch partner's). */
  customerId: number | null;
  customerName: string | null;
  discountType: "percent" | "fixed";
  percentOff: number | null;
  amountOffMinor: number | null;
  plans: string[] | null;
  periods: BillingPeriod[] | null;
  validFrom: string | null;
  validUntil: string | null;
  maxUses: number | null;
  maxUsesPerCustomer: number | null;
  firstPurchaseOnly: boolean;
  active: boolean;
  note: string | null;
  usesCount: number;
  state: CouponState;
  label: string;
  createdAt: string;
  createdByName: string | null;
  updatedAt: string;
  stats: { orders: number; revenueMinor: number; discountMinor: number; claimed: number };
}

export interface CouponOrder {
  id: number;
  order_code: string;
  plan: string;
  billing_period: BillingPeriod;
  status: string;
  amount_minor: number | null;
  list_amount_minor: number | null;
  discount_minor: number | null;
  discount_status: string | null;
  currency: string;
  created_at: string;
  customer_id: number;
  customer_name: string;
  released: boolean;
}

export interface CouponList {
  rows: Coupon[];
  counts: Record<CouponState, number>;
  totals: { orders: number; revenueMinor: number; discountMinor: number };
  total: number;
}

export type CouponInput = Partial<Omit<Coupon, "id" | "state" | "label" | "usesCount" | "createdAt" | "createdByName" | "updatedAt" | "stats" | "customerName">>;

export const loadCoupons = () => apiGet<CouponList>("/api/owner/coupons");
export const loadCoupon = (id: number) => apiGet<Coupon & { orders: CouponOrder[] }>(`/api/owner/coupons/${id}`);
export const createCoupon = (body: CouponInput) => apiPost<Coupon & { orders: CouponOrder[] }>("/api/owner/coupons", body);
export const updateCoupon = (id: number, body: CouponInput) => apiPatch<Coupon & { orders: CouponOrder[] }>(`/api/owner/coupons/${id}`, body);
export const pauseCoupon = (id: number, paused: boolean) =>
  apiPost<Coupon>(`/api/owner/coupons/${id}/${paused ? "pause" : "resume"}`, {});
export const deleteCoupon = (id: number) => apiDelete<{ id: number }>(`/api/owner/coupons/${id}`);

export const COUPON_STATE_LABEL: Record<CouponState, [string, "ok" | "info" | "neutral" | "warn" | "danger"]> = {
  active: ["Active", "ok"],
  scheduled: ["Scheduled", "info"],
  paused: ["Paused", "neutral"],
  expired: ["Expired", "warn"],
  used_up: ["Used up", "danger"],
};

export const ELIGIBILITY_LABEL: Record<"all" | "education" | "nonprofit", string> = {
  all: "Everyone, automatically",
  education: "Universities & schools (reviewed)",
  nonprofit: "Non-profits (reviewed)",
};

/** No discount takes more than this share of the price; the API refuses more. */
export { MAX_PERCENT_OFF } from "@/lib/pricing";

export const PERIOD_LABEL: Record<BillingPeriod, string> = { per_event: "Per event", annual: "Annual" };

/* ── Presets ───────────────────────────────────────────────────────────── */

/**
 * One-click templates for a new discount, from the owner's pricing
 * (October 2026). They only fill in the form: nothing exists, and nothing
 * applies, until the owner creates it. The largest discount that applies
 * wins and none takes more than half the price; the API enforces both.
 *
 * The checkout sells one plan for one event or one year, so "two events on
 * one invoice" and the multi-year prepayments are codes the owner hands to
 * the buyer who asked for them, not something the checkout works out.
 */
export interface Preset {
  id: string;
  label: string;
  hint: string;
  form: {
    kind: "code" | "campaign";
    code?: string;
    name: string;
    eligibility?: "all" | "education" | "nonprofit";
    percentOff: number;
    periods?: BillingPeriod[];
    firstPurchaseOnly?: boolean;
    maxUsesPerCustomer?: number | null;
    note: string;
  };
}

export const PRESETS: Preset[] = [
  {
    id: "education",
    label: "Education −40%",
    hint: "Universities and schools say so at checkout; you approve it on the order.",
    form: { kind: "campaign", name: "Education", eligibility: "education", percentOff: 40, note: "Universities and schools. Check the institution before approving the order." },
  },
  {
    id: "nonprofit",
    label: "Non-profit −30%",
    hint: "Registered non-profits say so at checkout; you approve it on the order.",
    form: { kind: "campaign", name: "Non-profit", eligibility: "nonprofit", percentOff: 30, note: "Registered non-profits. Check the registration before approving the order." },
  },
  {
    id: "first-event",
    label: "First event −20%",
    hint: "Applied by itself to an organisation's first order.",
    form: { kind: "campaign", name: "First event", eligibility: "all", percentOff: 20, firstPurchaseOnly: true, note: "Applied automatically to an organisation's first order." },
  },
  {
    id: "two-events",
    label: "Two events on one invoice −10%",
    hint: "A code for a buyer who orders two events together.",
    form: { kind: "code", code: "TWOEVENTS", name: "Two events on one invoice", percentOff: 10, periods: ["per_event"], maxUsesPerCustomer: 2, note: "For two events invoiced together: give it to the buyer for both orders." },
  },
  {
    id: "prepay-2y",
    label: "2-year prepay −10%",
    hint: "A code on the annual plan for a buyer paying two years ahead.",
    form: { kind: "code", code: "PREPAY2Y", name: "2-year prepay", percentOff: 10, periods: ["annual"], maxUsesPerCustomer: 2, note: "Two years paid in advance: the buyer places the annual order twice with this code." },
  },
  {
    id: "prepay-3y",
    label: "3-year prepay −15%",
    hint: "A code on the annual plan for a buyer paying three years ahead.",
    form: { kind: "code", code: "PREPAY3Y", name: "3-year prepay", percentOff: 15, periods: ["annual"], maxUsesPerCustomer: 3, note: "Three years paid in advance: the buyer places the annual order three times with this code." },
  },
];

/** How long a launch partner's price is locked. */
export const LAUNCH_PARTNER_MONTHS = 24;

/**
 * The launch-partner code for one organisation: −50% (the most any discount
 * takes), usable by that organisation alone, for 24 months. The "price lock"
 * is the code's end date plus a note of the prices it was given at: the
 * catalogue can still change, and the owner honours the note by hand.
 */
export function launchPartnerCoupon(customer: { id: number; name: string }, plans: CataloguePlan[], now = new Date()): CouponInput {
  const until = new Date(now);
  until.setUTCMonth(until.getUTCMonth() + LAUNCH_PARTNER_MONTHS);
  const slug = customer.name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || String(customer.id);
  const prices = plans
    .filter((p) => !p.quoteOnly && !p.grantOnly)
    .map((p) => `${p.name} ₼${((p.perEventMinor ?? 0) / 100).toLocaleString("en-US")} / ₼${((p.annualMinor ?? 0) / 100).toLocaleString("en-US")}`)
    .join(", ");
  return {
    kind: "code",
    code: `PARTNER-${slug}`,
    name: `Launch partner · ${customer.name}`.slice(0, 120),
    discountType: "percent",
    percentOff: 50,
    customerId: customer.id,
    validUntil: until.toISOString(),
    maxUsesPerCustomer: null,
    active: true,
    note: `Launch partner: price locked for ${LAUNCH_PARTNER_MONTHS} months, until ${until.toISOString().slice(0, 10)}. Prices when given (per event / year): ${prices}.`,
  };
}
