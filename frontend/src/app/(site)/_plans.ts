/**
 * What each plan costs, and how it can be paid.
 *
 * The price that counts is the API's (`GET /api/checkout/plans`, from its
 * `src/constants/plans.js`): the checkout prices the order there and nowhere
 * else. The numbers below are only what a page shows until that answer
 * arrives, so keep them in step with the API.
 *
 * Annual is never dearer than its events bought one by one; the owner set
 * it at about two thirds of them, rounded to a clean price:
 * annual ≈ perEvent × eventsPerYear × 2/3 (Starter ₼390 × 3 → ₼790,
 * Professional ₼990 × 6 → ₼3,990, Business ₼2,490 × 12 → ₼19,900).
 * Amounts are in Azerbaijani manat, before any VAT — whether VAT is added is
 * the seller's setting, which the same answer carries.
 *
 * Community is free and not sold: the owner grants it to student clubs and
 * non-commercial university events (COMMUNITY below; the pricing page's
 * card opens the contact form).
 *
 * The owner sets the prices in the console (Prices & discounts), so the
 * API's answer can differ from the list below: a new price, a struck-through
 * "was" price, a plan off sale, other limits, and campaigns (an automatic
 * discount for everyone, or for universities and non-profits). The `live*`
 * helpers read that answer, in qəpik, and fall back to this list.
 */

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { numberFormatter } from "@/lib/i18n/numbers";
import { bestCampaign, displayPrice, type BillingPeriod, type PublicCampaign } from "@/lib/pricing";

export interface PlanPrice {
  id: string;
  name: string;
  /** One event, paid once. `null` where the plan is only sold annually. */
  perEvent: number | null;
  /** A year of events. `null` where the plan is only sold per event. */
  annual: number | null;
  /** Enterprise is quoted, never listed. */
  quoteOnly?: boolean;
  /** Limits (null = unlimited), the same numbers the API copies into an approved order. */
  participants: number | null;
  seats: number | null;
  eventsPerYear: number | null;
}

export const CURRENCY = "₼";

export const PLAN_PRICES: PlanPrice[] = [
  { id: "starter", name: "Starter", perEvent: 390, annual: 790, participants: 200, seats: 3, eventsPerYear: 3 },
  { id: "professional", name: "Professional", perEvent: 990, annual: 3990, participants: 500, seats: 10, eventsPerYear: 6 },
  { id: "business", name: "Business", perEvent: 2490, annual: 19900, participants: 2000, seats: 25, eventsPerYear: 12 },
  { id: "enterprise", name: "Enterprise", perEvent: null, annual: null, quoteOnly: true, participants: null, seats: null, eventsPerYear: null },
];

/** The free Community plan's limits, until the API's answer has its own. */
export const COMMUNITY = { id: "community", name: "Community", participants: 100 as number | null, eventsPerYear: 2 as number | null };

export const planById = (id: string) =>
  PLAN_PRICES.find((p) => p.id === id) ?? null;

/** ₼7,150 in English, ₼7.150 in Azerbaijani, ₼7 150 in Russian. */
export function formatPrice(amount: number, lang = "en") {
  return `${CURRENCY}${numberFormatter(lang).format(amount)}`;
}

/** What a plan costs on the billing period the reader has selected. */
export function priceFor(plan: PlanPrice, annual: boolean): number | null {
  return annual ? plan.annual : plan.perEvent;
}

export type PaymentMethod = "bank_transfer" | "card";

/** One plan as the API lists it: prices in qəpik (whole manat beside them), limits, on sale or not. */
export interface LivePlan {
  perEvent: number | null;
  annual: number | null;
  perEventMinor: number | null;
  annualMinor: number | null;
  perEventListMinor: number | null;
  annualListMinor: number | null;
  active: boolean;
  seats: number | null;
  participants: number | null;
  eventsPerYear: number | null;
}

export interface CheckoutInfo {
  /** Per plan, from the API once it has answered. */
  prices: Record<string, LivePlan>;
  /** Automatic discounts running now (everyone, or universities and non-profits). */
  campaigns: PublicCampaign[];
  /** Bank transfer always; card only once a card provider is connected. */
  methods: PaymentMethod[];
  /** The seller's VAT status: added at this rate, or not charged at all. */
  vat: { registered: boolean; ratePercent: number | null };
  /** The version of the terms the checkout asks the buyer to accept. */
  termsVersion: string | null;
  loaded: boolean;
}

const FALLBACK: CheckoutInfo = {
  prices: {},
  campaigns: [],
  methods: ["bank_transfer"],
  vat: { registered: false, ratePercent: null },
  termsVersion: null,
  loaded: false,
};

/** Server prices are minor units; the display list is whole manat. */
const fromMinor = (minor: number | null | undefined) => (minor == null ? null : Math.round(minor / 100));

interface PlansAnswer {
  plans?: {
    id: string;
    perEventMinor: number | null;
    annualMinor: number | null;
    perEventListMinor?: number | null;
    annualListMinor?: number | null;
    active?: boolean;
    seats?: number | null;
    participants?: number | null;
    eventsPerYear?: number | null;
  }[];
  campaigns?: PublicCampaign[];
  payment?: { methods?: string[] };
  vat?: { registered?: boolean; ratePercent?: number | null };
  termsVersion?: string;
}

/** The price list, payment methods, VAT and terms version, as the API states them. */
export function useCheckoutInfo(): CheckoutInfo {
  const [info, setInfo] = useState<CheckoutInfo>(FALLBACK);
  useEffect(() => {
    let cancelled = false;
    apiGet<PlansAnswer>("/api/checkout/plans")
      .then((data) => {
        if (cancelled || !data?.plans) return;
        const prices: CheckoutInfo["prices"] = {};
        for (const p of data.plans) {
          const fallback = planById(p.id);
          prices[p.id] = {
            perEvent: fromMinor(p.perEventMinor),
            annual: fromMinor(p.annualMinor),
            perEventMinor: p.perEventMinor,
            annualMinor: p.annualMinor,
            perEventListMinor: p.perEventListMinor ?? null,
            annualListMinor: p.annualListMinor ?? null,
            active: p.active !== false,
            seats: p.seats !== undefined ? p.seats : fallback?.seats ?? null,
            participants: p.participants !== undefined ? p.participants : fallback?.participants ?? null,
            eventsPerYear: p.eventsPerYear !== undefined ? p.eventsPerYear : fallback?.eventsPerYear ?? null,
          };
        }
        const methods = (data.payment?.methods ?? ["bank_transfer"]).filter((m): m is PaymentMethod => m === "bank_transfer" || m === "card");
        setInfo({
          prices,
          campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
          methods: methods.length ? methods : ["bank_transfer"],
          vat: { registered: Boolean(data.vat?.registered), ratePercent: data.vat?.ratePercent ?? null },
          termsVersion: data.termsVersion ?? null,
          loaded: true,
        });
      })
      .catch(() => { /* the built-in list stands in; the server prices the order anyway */ });
    return () => { cancelled = true; };
  }, []);
  return info;
}

/** The plan's price on that period: the API's when it has answered, else the list above. */
export function livePrice(plan: PlanPrice, annual: boolean, info: CheckoutInfo): number | null {
  const s = info.prices[plan.id];
  return s ? (annual ? s.annual : s.perEvent) : priceFor(plan, annual);
}

/**
 * VAT on a whole-manat amount under the seller's setting, in minor units
 * (qəpik) the way the API rounds it; 0 when the seller is not registered.
 */
export function vatMinorOn(amount: number | null, info: CheckoutInfo): number {
  if (amount == null || !info.vat.registered || !info.vat.ratePercent) return 0;
  return Math.round((amount * 100 * info.vat.ratePercent) / 100);
}

/* ── In qəpik, from the owner's catalogue ─────────────────────────────── */

const periodOf = (annual: boolean): BillingPeriod => (annual ? "annual" : "per_event");

/** The plan's price in qəpik: the API's when it has answered, else the list above. */
export function livePriceMinor(plan: PlanPrice, annual: boolean, info: CheckoutInfo): number | null {
  const s = info.prices[plan.id];
  if (s) return annual ? s.annualMinor : s.perEventMinor;
  const whole = priceFor(plan, annual);
  return whole == null ? null : whole * 100;
}

/** The plan with the limits the API states (seats, participants, events a year). */
export function livePlan(plan: PlanPrice, info: CheckoutInfo): PlanPrice {
  const s = info.prices[plan.id];
  return s ? { ...plan, seats: s.seats, participants: s.participants, eventsPerYear: s.eventsPerYear } : plan;
}

/** Listed but switched off by the owner: shown, not sold. */
export const onSale = (plan: PlanPrice, info: CheckoutInfo) => !plan.quoteOnly && info.prices[plan.id]?.active !== false;

/**
 * How the price reads on a card: what is charged, what is struck through
 * beside it (the owner's "was" price, or the price before a campaign for
 * everyone) and that campaign.
 */
export function liveOffer(plan: PlanPrice, annual: boolean, info: CheckoutInfo) {
  const price = livePriceMinor(plan, annual, info);
  const s = info.prices[plan.id];
  const list = s ? (annual ? s.annualListMinor : s.perEventListMinor) : null;
  return displayPrice(price, list, bestCampaign(info.campaigns, plan.id, periodOf(annual), price));
}

/**
 * The campaign a buyer can claim on this plan and period — for universities
 * and schools ("education") or for non-profits — if one runs.
 */
export function educationOffer(plan: PlanPrice, annual: boolean, info: CheckoutInfo, claim: "education" | "nonprofit" = "education") {
  return bestCampaign(info.campaigns, plan.id, periodOf(annual), livePriceMinor(plan, annual, info), claim);
}

/** Community's limits as the API states them. */
export function liveCommunity(info: CheckoutInfo) {
  const s = info.prices.community;
  return s ? { ...COMMUNITY, participants: s.participants, eventsPerYear: s.eventsPerYear } : COMMUNITY;
}
