/**
 * Prices and discounts in the browser: amounts in qəpik formatted in each
 * language, what the owner types into a price box, the discount arithmetic
 * (the server's, so a page never shows a price the order will not charge),
 * how a struck-through price and a campaign read, and the annual rule the
 * console checks as the owner types.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_PERCENT_OFF,
  annualRule,
  bestCampaign,
  cappedDiscount,
  couponState,
  discountFor,
  discountValueText,
  displayPrice,
  formatPriceMinor,
  isCouponReason,
  minorToInput,
  parseManat,
  savingPercent,
  suggestCode,
  type PublicCampaign,
} from "@/lib/pricing";
import { liveOffer, livePriceMinor, onSale, planById, type CheckoutInfo } from "@/app/(site)/_plans";

const NBSP = " ";

describe("formatting a price", () => {
  it("shows manat, with qəpik only when there are some", () => {
    expect(formatPriceMinor(49000)).toBe("₼490");
    expect(formatPriceMinor(715000)).toBe("₼7,150");
    expect(formatPriceMinor(48950)).toBe("₼489.50");
    expect(formatPriceMinor(48905)).toBe("₼489.05");
    expect(formatPriceMinor(0)).toBe("₼0");
  });

  it("follows the reader's number style", () => {
    expect(formatPriceMinor(715000, "az")).toBe("₼7.150");
    expect(formatPriceMinor(48950, "az")).toBe("₼489,50");
    expect(formatPriceMinor(3900000, "ru")).toBe(`₼39${NBSP}000`);
    expect(formatPriceMinor(48950, "ru")).toBe("₼489,50");
  });

  it("writes a discount with a real minus sign", () => {
    expect(formatPriceMinor(-9800)).toBe("−₼98");
    expect(discountValueText({ discountType: "percent", percentOff: 20, amountOffMinor: null })).toBe("−20%");
    expect(discountValueText({ discountType: "percent", percentOff: 12.5, amountOffMinor: null }, "az")).toBe("−12,5%");
    expect(discountValueText({ discountType: "fixed", percentOff: null, amountOffMinor: 9050 })).toBe("−₼90.50");
  });
});

describe("reading a price box", () => {
  it("turns manat into qəpik, however it is typed", () => {
    expect(parseManat("490")).toBe(49000);
    expect(parseManat(" 1 490 ")).toBe(149000);
    expect(parseManat("1,490")).toBe(149000);
    expect(parseManat("₼1,490.00")).toBe(149000);
    expect(parseManat("489.5")).toBe(48950);
    expect(parseManat("489,50")).toBe(48950);
    expect(parseManat("39 000 AZN")).toBe(3900000);
  });

  it("tells an empty box from one that is not an amount", () => {
    expect(parseManat("")).toBeNull();
    expect(parseManat("   ")).toBeNull();
    expect(parseManat("abc")).toBeNaN();
    expect(parseManat("4.999")).toBeNaN();
    expect(parseManat("-5")).toBeNaN();
  });

  it("writes qəpik back as the box shows them", () => {
    expect(minorToInput(49000)).toBe("490");
    expect(minorToInput(48950)).toBe("489.50");
    expect(minorToInput(null)).toBe("");
    for (const m of [49000, 48950, 1, 3900000]) expect(parseManat(minorToInput(m))).toBe(m);
  });
});

describe("the discount arithmetic", () => {
  const pct = (p: number) => ({ discountType: "percent" as const, percentOff: p, amountOffMinor: null });
  const fixed = (m: number) => ({ discountType: "fixed" as const, percentOff: null, amountOffMinor: m });

  it("matches the server's, in qəpik", () => {
    expect(discountFor(pct(20), 49000)).toBe(9800);
    expect(discountFor(pct(12.5), 49000)).toBe(6125);
    expect(discountFor(pct(33.33), 149000)).toBe(49662);
    expect(discountFor(pct(0.01), 49999)).toBe(5);
    expect(discountFor(pct(100), 715000)).toBe(715000);
    expect(discountFor(fixed(10000), 49000)).toBe(10000);
    expect(discountFor(fixed(60000), 49000)).toBe(49000);
  });

  const campaign = (over: Partial<PublicCampaign>): PublicCampaign => ({
    id: 1, name: "Launch", eligibility: "all", discountType: "percent", percentOff: 10, amountOffMinor: null,
    plans: null, periods: null, validUntil: null, ...over,
  });

  it("never takes more than half the price, as the server does", () => {
    expect(MAX_PERCENT_OFF).toBe(50);
    expect(cappedDiscount(fixed(39000), 39000)).toBe(19500);
    expect(cappedDiscount(pct(40), 99000)).toBe(39600);
    expect(cappedDiscount(fixed(1), 1)).toBe(0);
  });

  it("keeps universities and non-profits apart", () => {
    const list = [campaign({ id: 7, eligibility: "education", percentOff: 40 }), campaign({ id: 8, eligibility: "nonprofit", percentOff: 30 })];
    expect(bestCampaign(list, "business", "annual", 1990000, "education")?.campaign.id).toBe(7);
    expect(bestCampaign(list, "business", "annual", 1990000, "nonprofit")?.campaign.id).toBe(8);
    expect(bestCampaign(list, "business", "annual", 1990000)).toBeNull();
  });

  it("picks the larger campaign that fits the plan and period", () => {
    const list = [
      campaign({ id: 1, percentOff: 10 }),
      campaign({ id: 2, percentOff: 25, plans: ["business"] }),
      campaign({ id: 3, percentOff: 40, periods: ["annual"] }),
      campaign({ id: 4, percentOff: 30, eligibility: "education" }),
    ];
    expect(bestCampaign(list, "starter", "per_event", 49000)?.campaign.id).toBe(1);
    expect(bestCampaign(list, "business", "per_event", 390000)?.campaign.id).toBe(2);
    expect(bestCampaign(list, "starter", "annual", 79000)?.campaign.id).toBe(3);
    expect(bestCampaign(list, "starter", "per_event", 49000, "education")?.discountMinor).toBe(14700);
    expect(bestCampaign(list, "starter", "per_event", null)).toBeNull();
  });

  it("strikes through the right figure", () => {
    expect(displayPrice(49000, null, null)).toEqual({ nowMinor: 49000, wasMinor: null, campaign: null });
    expect(displayPrice(45000, 49000, null)).toEqual({ nowMinor: 45000, wasMinor: 49000, campaign: null });
    expect(displayPrice(49000, 45000, null).wasMinor, "a 'was' below the price is not shown").toBeNull();
    const c = campaign({});
    expect(displayPrice(49000, null, { campaign: c, discountMinor: 4900 })).toEqual({ nowMinor: 44100, wasMinor: 49000, campaign: c });
    expect(displayPrice(45000, 49000, { campaign: c, discountMinor: 4500 }).wasMinor, "the higher one").toBe(49000);
    expect(displayPrice(null, 49000, null).nowMinor).toBeNull();
    expect(savingPercent(98000, 79000)).toBe(19);
    expect(savingPercent(0, 10)).toBe(0);
  });
});

describe("the annual rule", () => {
  it("is kept when a year costs no more than its events one by one", () => {
    expect(annualRule(49000, 79000, 2)).toEqual({ ok: true, oneByOneMinor: 98000, savingPercent: 19 });
    expect(annualRule(49000, 98000, 2).ok).toBe(true);
    expect(annualRule(49000, 98001, 2).ok).toBe(false);
    expect(annualRule(49000, 79000, 1).ok).toBe(false);
  });

  it("has nothing to compare without both prices or with unlimited events", () => {
    expect(annualRule(null, 79000, 2).ok).toBeNull();
    expect(annualRule(49000, null, 2).ok).toBeNull();
    expect(annualRule(49000, 79000, null).ok).toBeNull();
  });
});

describe("coupons in the console", () => {
  const now = Date.parse("2026-06-01T12:00:00Z");
  const base = { active: true, validFrom: null, validUntil: null, maxUses: null, usesCount: 0 };
  it("reads the state the way the API does", () => {
    expect(couponState(base, now)).toBe("active");
    expect(couponState({ ...base, active: false }, now)).toBe("paused");
    expect(couponState({ ...base, validFrom: "2026-06-02T00:00:00Z" }, now)).toBe("scheduled");
    expect(couponState({ ...base, validUntil: "2026-06-01T12:00:00Z" }, now)).toBe("expired");
    expect(couponState({ ...base, maxUses: 3, usesCount: 3 }, now)).toBe("used_up");
  });

  it("suggests codes the API accepts", () => {
    for (let i = 0; i < 20; i += 1) expect(suggestCode()).toMatch(/^[A-Z0-9][A-Z0-9_-]{2,39}$/);
    expect(suggestCode("EDU", () => 0)).toBe("EDU-AAAAA");
  });

  it("knows the API's reasons", () => {
    expect(isCouponReason("COUPON_EXPIRED")).toBe(true);
    expect(isCouponReason("ORGANISATION_NAME_TAKEN")).toBe(false);
  });
});

describe("the live price list", () => {
  const starter = planById("starter")!;
  const info = (over: Partial<CheckoutInfo["prices"][string]> = {}, campaigns: PublicCampaign[] = []): CheckoutInfo => ({
    prices: {
      starter: {
        perEvent: 450, annual: 790, perEventMinor: 45000, annualMinor: 79000, perEventListMinor: 49000, annualListMinor: null,
        active: true, seats: 3, participants: 150, eventsPerYear: 2, ...over,
      },
    },
    campaigns,
    methods: ["bank_transfer"],
    vat: { registered: false, ratePercent: null },
    termsVersion: null,
    loaded: true,
  });

  it("reads the owner's catalogue, and the built-in list before it answers", () => {
    expect(livePriceMinor(starter, false, info())).toBe(45000);
    const before: CheckoutInfo = { ...info(), prices: {}, loaded: false };
    expect(livePriceMinor(starter, false, before), "the approved ₼390 until the API answers").toBe(39000);
    expect(liveOffer(starter, false, info())).toMatchObject({ nowMinor: 45000, wasMinor: 49000 });
    expect(onSale(starter, info({ active: false }))).toBe(false);
    expect(onSale(planById("enterprise")!, info())).toBe(false);
  });

  it("shows the price after a campaign for everyone", () => {
    const c: PublicCampaign = { id: 9, name: "Launch", eligibility: "all", discountType: "percent", percentOff: 20, amountOffMinor: null, plans: ["starter"], periods: null, validUntil: null };
    expect(liveOffer(starter, true, info({}, [c]))).toMatchObject({ nowMinor: 63200, wasMinor: 79000 });
  });
});
