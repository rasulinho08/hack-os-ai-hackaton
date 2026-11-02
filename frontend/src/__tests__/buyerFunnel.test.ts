/**
 * The buyer funnel's shared rules: one status vocabulary for an order (the
 * same stage everywhere, in AZ, EN and RU), annual never dearer than its
 * events bought one by one, and every string the checkout, the account page
 * and the setup page ask for defined in all three languages with the same
 * {placeholders}.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/lib/i18n/en";
import az from "@/lib/i18n/az";
import ru from "@/lib/i18n/ru";
import { orderStage, paymentState, STAGE_LABEL, type OrderStage } from "@/lib/commerce";
import { PLAN_PRICES, vatMinorOn, type CheckoutInfo } from "@/app/(site)/_plans";

const ROOT = join(__dirname, "..");
const PAGES = [
  join(ROOT, "app", "(site)", "checkout", "page.tsx"),
  join(ROOT, "app", "(site)", "account", "page.tsx"),
  join(ROOT, "app", "setup", "[token]", "page.tsx"),
  join(ROOT, "app", "(site)", "pricing", "page.tsx"),
];
const STAGES: OrderStage[] = ["draft", "under_review", "active", "refused", "cancelled", "refunded"];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("one vocabulary for an order", () => {
  it("names the stage the same way for every status", () => {
    expect(orderStage({ status: "pending" })).toBe("under_review");
    expect(orderStage({ status: "paid" })).toBe("under_review");
    expect(orderStage({ status: "delivered" })).toBe("active");
    expect(orderStage({ status: "cancelled", delivered_at: null })).toBe("refused");
    expect(orderStage({ status: "cancelled", delivered_at: "2026-10-01T00:00:00Z" })).toBe("cancelled");
    expect(orderStage({ status: "refunded" })).toBe("refunded");
  });

  it("keeps payment apart from the status", () => {
    const due = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
    expect(paymentState({ status: "pending" })).toBeNull();
    expect(paymentState({ status: "delivered", invoice_number: "INV-1", invoice_due_at: due(3) })).toBe("awaiting");
    expect(paymentState({ status: "delivered", invoice_number: "INV-1", invoice_due_at: due(-1) })).toBe("overdue");
    expect(paymentState({ status: "paid", paid_at: due(0) })).toBe("paid");
    expect(paymentState({ status: "cancelled", invoice_number: "INV-1" })).toBeNull();
  });

  it("has every stage and payment state in AZ, EN and RU, and the console uses the English words", () => {
    for (const map of [en, az, ru]) {
      for (const s of STAGES) expect(map[`order.stage.${s}`], s).toBeTruthy();
      for (const p of ["paid", "awaiting", "overdue"]) expect(map[`order.pay.${p}`], p).toBeTruthy();
    }
    for (const s of STAGES) expect(STAGE_LABEL[s]).toBe(en[`order.stage.${s}`]);
  });
});

describe("prices", () => {
  it("never charges more for a year than for its events one by one", () => {
    for (const p of PLAN_PRICES.filter((x) => !x.quoteOnly)) {
      expect(p.annual! <= p.eventsPerYear! * p.perEvent!, p.id).toBe(true);
    }
  });

  it("adds VAT only when the seller is registered", () => {
    const info = (registered: boolean): CheckoutInfo => ({ prices: {}, methods: ["bank_transfer"], vat: { registered, ratePercent: registered ? 18 : null }, termsVersion: null, loaded: true });
    expect(vatMinorOn(490, info(false))).toBe(0);
    expect(vatMinorOn(490, info(true))).toBe(8820);
  });
});

describe("the funnel's words", () => {
  const keys = new Set<string>();
  for (const file of PAGES) {
    for (const m of readFileSync(file, "utf8").matchAll(/\bt\(\s*"((?:checkout|portal|setup|vat|order)\.[\w.]+)"/g)) keys.add(m[1]);
  }

  it("finds the keys it checks", () => {
    expect(keys.size).toBeGreaterThan(60);
  });

  it.each([...keys].sort())("%s exists in AZ, EN and RU with the same slots", (key) => {
    expect(en[key], `en ${key}`).toBeTruthy();
    expect(az[key], `az ${key}`).toBeTruthy();
    expect(ru[key], `ru ${key}`).toBeTruthy();
    expect(placeholders(az[key])).toEqual(placeholders(en[key]));
    expect(placeholders(ru[key])).toEqual(placeholders(en[key]));
  });

  it("no longer says the card is in test mode or that VAT is 'not applied'", () => {
    for (const map of [en, az, ru]) {
      const all = Object.entries(map).filter(([k]) => /^(checkout|portal|vat)\./.test(k)).map(([, v]) => v).join("\n");
      expect(all).not.toMatch(/test mode|test rejim|тестов/i);
      expect(all).not.toMatch(/VAT not applied|tətbiq edilmir|не применяется/i);
    }
  });
});
