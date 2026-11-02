/**
 * Prices and discounts, the arithmetic and the words for them — no React,
 * so the pricing page, the checkout and the owner console share one version
 * and the tests can read it.
 *
 * Amounts are minor units (qəpik) end to end, as the API sends them. The
 * server is the one that prices an order: what is computed here is only what
 * a page shows before the server's answer (a campaign price on the pricing
 * page, the live annual check in the console), worked out the same way —
 * percentages in hundredths of a per cent, rounded half up to the qəpik;
 * a fixed amount never more than the price; and no discount more than half
 * the price (MAX_PERCENT_OFF).
 */

import { numberFormatter } from "@/lib/i18n/numbers";

export type BillingPeriod = "per_event" | "annual";

/** No discount takes more than this share of the price; the API enforces it. */
export const MAX_PERCENT_OFF = 50;

/** What a buyer can say they are at checkout, and the campaigns it unlocks. */
export const CLAIMS = ["education", "nonprofit"] as const;
export type Claim = (typeof CLAIMS)[number];
export const PERIODS: BillingPeriod[] = ["per_event", "annual"];
export const SELF_SERVE_PLANS = ["starter", "professional", "business"] as const;

/** Why a code does not apply, as the API names it (discount.service.js). */
export const COUPON_REASONS = [
  "COUPON_NOT_FOUND",
  "COUPON_PAUSED",
  "COUPON_NOT_STARTED",
  "COUPON_EXPIRED",
  "COUPON_USED_UP",
  "COUPON_CUSTOMER_LIMIT",
  "COUPON_FIRST_PURCHASE",
  "COUPON_PLAN",
  "COUPON_PERIOD",
  "COUPON_NOT_YOURS",
] as const;
export type CouponReason = (typeof COUPON_REASONS)[number];

export const isCouponReason = (code: unknown): code is CouponReason =>
  typeof code === "string" && (COUPON_REASONS as readonly string[]).includes(code);

/* ── Money ─────────────────────────────────────────────────────────────── */

/**
 * 49000 → "₼490"; 48950 → "₼489.50" in English, "₼489,50" in Azerbaijani,
 * "₼489,50" in Russian. Qəpik are shown only when there are some, so a
 * round price stays round.
 */
export function formatPriceMinor(minor: number, lang = "en"): string {
  const value = Math.round(Number(minor) || 0);
  const digits = value % 100 === 0 ? 0 : 2;
  const sign = value < 0 ? "−" : "";
  const n = numberFormatter(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value) / 100);
  return `${sign}₼${n}`;
}

/** 149000 → "1490", 48950 → "489.50": the value an input box shows. */
export function minorToInput(minor: number | null | undefined): string {
  if (minor == null) return "";
  const value = Math.round(Number(minor));
  return value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2);
}

/**
 * What the owner typed into a price box, in qəpik. Accepts "1490",
 * "1 490", "1,490", "1490.5", "1490,50" and "₼1,490.00". `null` for an empty
 * box (no price); `NaN` for something that is not an amount.
 */
export function parseManat(raw: string): number | null {
  let s = String(raw ?? "").replace(/[₼\s]|AZN|manat/gi, "").trim();
  if (s === "") return null;
  // A comma with one or two digits after it, and no dot, is a decimal comma.
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

/* ── Discounts ─────────────────────────────────────────────────────────── */

export interface DiscountRule {
  discountType: "percent" | "fixed";
  percentOff: number | null;
  amountOffMinor: number | null;
}

/** What the discount takes off a price, in qəpik — the server's arithmetic. */
export function discountFor(rule: DiscountRule, priceMinor: number): number {
  const price = Math.max(0, Math.round(Number(priceMinor) || 0));
  if (price === 0) return 0;
  if (rule.discountType === "percent") {
    const hundredths = Math.round(Number(rule.percentOff) * 100);
    return Math.min(price, Math.floor((price * hundredths + 5000) / 10000));
  }
  return Math.min(price, Math.round(Number(rule.amountOffMinor) || 0));
}

/** The discount as the server applies it: never more than half the price. */
export const cappedDiscount = (rule: DiscountRule, priceMinor: number) =>
  Math.min(discountFor(rule, priceMinor), Math.floor((Math.max(0, Math.round(Number(priceMinor) || 0)) * MAX_PERCENT_OFF) / 100));

/** "−20%" or "−₼100" in the reader's number style. */
export function discountValueText(rule: DiscountRule, lang = "en"): string {
  if (rule.discountType === "percent") {
    const n = numberFormatter(lang, { maximumFractionDigits: 2 }).format(Number(rule.percentOff));
    return `−${n}%`;
  }
  return `−${formatPriceMinor(Number(rule.amountOffMinor), lang)}`;
}

/** A campaign as the public price list sends it. */
export interface PublicCampaign extends DiscountRule {
  id: number;
  name: string;
  eligibility: "all" | Claim;
  plans: string[] | null;
  periods: BillingPeriod[] | null;
  validUntil: string | null;
  firstPurchaseOnly?: boolean;
}

export const appliesTo = (c: { plans: string[] | null; periods: string[] | null }, plan: string, period: BillingPeriod) =>
  (!c.plans || c.plans.includes(plan)) && (!c.periods || c.periods.includes(period));

/** The largest campaign for these buyers on this plan and period, with its saving (capped). */
export function bestCampaign(campaigns: PublicCampaign[], plan: string, period: BillingPeriod, priceMinor: number | null, eligibility: "all" | Claim = "all") {
  if (priceMinor == null) return null;
  let best: { campaign: PublicCampaign; discountMinor: number } | null = null;
  for (const c of campaigns) {
    if (c.eligibility !== eligibility || !appliesTo(c, plan, period)) continue;
    const d = cappedDiscount(c, priceMinor);
    if (d > 0 && (!best || d > best.discountMinor)) best = { campaign: c, discountMinor: d };
  }
  return best;
}

/**
 * How a price reads on the pricing page: what is charged (`nowMinor`), the
 * figure struck through beside it (`wasMinor`, null for none) and the
 * campaign behind it. A running campaign strikes through the higher of the
 * price and the owner's "was" price; without one, a "was" price above the
 * price is struck through.
 */
export function displayPrice(
  priceMinor: number | null,
  listMinor: number | null,
  campaign: { discountMinor: number; campaign: PublicCampaign } | null,
): { nowMinor: number | null; wasMinor: number | null; campaign: PublicCampaign | null } {
  if (priceMinor == null) return { nowMinor: null, wasMinor: null, campaign: null };
  const was = listMinor != null && listMinor > priceMinor ? listMinor : null;
  if (campaign && campaign.discountMinor > 0) {
    return { nowMinor: priceMinor - campaign.discountMinor, wasMinor: was ?? priceMinor, campaign: campaign.campaign };
  }
  return { nowMinor: priceMinor, wasMinor: was, campaign: null };
}

/** Whole per cent saved between a struck-through figure and the price: 980 → 790 is 19. */
export const savingPercent = (wasMinor: number, nowMinor: number) =>
  wasMinor > 0 && nowMinor < wasMinor ? Math.round(((wasMinor - nowMinor) / wasMinor) * 100) : 0;

/* ── The annual rule ───────────────────────────────────────────────────── */

/**
 * A year never costs more than its events bought one by one:
 * annual ≤ eventsPerYear × perEvent. `ok` null when there is nothing to
 * compare (no per-event price, no annual price, or unlimited events).
 */
export function annualRule(perEventMinor: number | null, annualMinor: number | null, eventsPerYear: number | null) {
  if (perEventMinor == null || annualMinor == null || eventsPerYear == null) {
    return { ok: null as boolean | null, oneByOneMinor: null as number | null, savingPercent: 0 };
  }
  const oneByOne = eventsPerYear * perEventMinor;
  return { ok: annualMinor <= oneByOne, oneByOneMinor: oneByOne, savingPercent: savingPercent(oneByOne, annualMinor) };
}

/* ── Coupons in the console ────────────────────────────────────────────── */

export type CouponState = "active" | "scheduled" | "paused" | "expired" | "used_up";
export const COUPON_STATES: CouponState[] = ["active", "scheduled", "paused", "expired", "used_up"];

/** Where a coupon stands, as the API works it out (for a form being edited). */
export function couponState(
  c: { active: boolean; validFrom: string | null; validUntil: string | null; maxUses: number | null; usesCount: number },
  now = Date.now(),
): CouponState {
  if (!c.active) return "paused";
  if (c.validFrom && new Date(c.validFrom).getTime() > now) return "scheduled";
  if (c.validUntil && new Date(c.validUntil).getTime() <= now) return "expired";
  if (c.maxUses != null && c.usesCount >= c.maxUses) return "used_up";
  return "active";
}

/** A readable code nobody will guess: "HACK-7K3QX". */
export function suggestCode(prefix = "HACK", random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 5; i += 1) tail += alphabet[Math.floor(random() * alphabet.length)];
  return `${prefix}-${tail}`;
}
