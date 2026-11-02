/**
 * The pricing, solutions and contact pages' copy: the three languages say
 * the same things (same sections, same number of items, nothing empty, the
 * same {slots}), the comparison table has words for every row in every
 * language, and what the pages state about plans agrees with ../_plans.ts.
 */
import { describe, expect, it } from "vitest";
import { PRICING_COPY } from "@/app/(site)/pricing/copy";
import { MATRIX, TIER_IDS } from "@/app/(site)/pricing/matrix";
import { SOLUTIONS_COPY } from "@/app/(site)/solutions/copy";
import { CONTACT_COPY, ROLE_VALUES, SIZE_VALUES } from "@/app/(site)/contact/copy";
import { PLAN_PRICES } from "@/app/(site)/_plans";

const LANGS = ["en", "az", "ru"] as const;

/** Every leaf of an object as path → value. */
function leaves(v: unknown, path = ""): [string, unknown][] {
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
  return [[path, v]];
}
const slots = (s: string) => (s.match(/\{[a-z]+\}/gi) || []).sort().join(",");

const COPIES = {
  pricing: PRICING_COPY,
  solutions: SOLUTIONS_COPY,
  contact: CONTACT_COPY,
} as const;

describe.each(Object.entries(COPIES))("%s copy", (_, copy) => {
  it("has the same shape and the same {slots} in every language", () => {
    const en = new Map(leaves(copy.en));
    for (const l of ["az", "ru"] as const) {
      const other = new Map(leaves(copy[l]));
      expect([...other.keys()].sort()).toEqual([...en.keys()].sort());
      for (const [p, v] of en) expect(slots(String(other.get(p))), `${l}:${p}`).toBe(slots(String(v)));
    }
  });

  it.each(LANGS)("has no empty or placeholder text in %s", (l) => {
    for (const [p, v] of leaves(copy[l])) {
      expect(typeof v, p).toBe("string");
      expect(String(v).trim(), p).not.toBe("");
      expect(String(v), p).not.toMatch(/TODO|lorem|\[[A-Z]+\]/);
    }
  });
});

describe("pricing", () => {
  it("lists the plans the price list has, in its order", () => {
    expect(TIER_IDS).toEqual(PLAN_PRICES.map((p) => p.id));
    for (const l of LANGS) expect(Object.keys(PRICING_COPY[l].tiers).sort()).toEqual([...TIER_IDS].sort());
  });

  it("has words for every row of the comparison table, and none left over", () => {
    for (const l of LANGS) {
      for (const g of MATRIX) {
        const words = PRICING_COPY[l].matrix[g.group] as { title: string; rows: Record<string, string> };
        expect(Object.keys(words.rows).sort(), `${l}:${g.group}`).toEqual(g.rows.map((r) => r.key).sort());
        for (const r of g.rows) expect(r.values, `${g.group}.${r.key}`).toHaveLength(TIER_IDS.length);
      }
      expect(Object.keys(PRICING_COPY[l].matrix).sort()).toEqual(MATRIX.map((g) => g.group).sort());
    }
  });

  it("follows the plan/module split: certificates in every plan; report, branding and analytics from Professional; webhooks from Business", () => {
    const row = (group: string, key: string) => MATRIX.find((g) => g.group === group)?.rows.find((r) => r.key === key)?.values;
    expect(row("event", "mentors")?.[0]).toBe(false);
    expect(row("judging", "certificates")).toEqual([true, true, true, true]);
    for (const [g, k] of [["judging", "report"], ["platform", "branding"], ["platform", "analytics"]]) {
      expect(row(g, k), k).toEqual([false, true, true, true]);
    }
    expect(row("platform", "webhooks")).toEqual([false, false, true, true]);
    expect(row("platform", "chat")?.slice(0, 2)).toEqual([false, false]);
    expect(row("event", "announcements")).toEqual([true, true, true, true]);
    expect(row("platform", "telegram")).toEqual([true, true, true, true]);
  });

  it("takes limits from the price list instead of stating its own", () => {
    for (const l of LANGS) {
      const all = JSON.stringify(PRICING_COPY[l]);
      // The numbers are slots, never typed in.
      for (const p of PLAN_PRICES) {
        if (p.participants != null) expect(all, `${l}:${p.id}`).not.toContain(String(p.participants));
      }
      expect(PRICING_COPY[l].tiers.business.includes.join(" ")).toMatch(/\{events\}.*\{participants\}/);
    }
    // The page used to say there was no public price list while showing prices.
    expect(JSON.stringify(PRICING_COPY.en)).not.toMatch(/no price|no public price|unlimited participants/i);
  });
});

describe("contact", () => {
  it("labels every option the form sends, in every language", () => {
    for (const l of LANGS) {
      expect(CONTACT_COPY[l].form.roles).toHaveLength(ROLE_VALUES.length);
      expect(CONTACT_COPY[l].form.sizes).toHaveLength(SIZE_VALUES.length);
    }
    // What reaches the sales inbox stays English.
    expect(CONTACT_COPY.en.form.roles).toEqual([...ROLE_VALUES]);
    expect(CONTACT_COPY.en.form.sizes).toEqual([...SIZE_VALUES]);
  });
});

describe("solutions", () => {
  it("names a figure label for every figure the page shows", () => {
    for (const l of LANGS) expect(SOLUTIONS_COPY[l].segments.corporates.proof).toHaveLength(2);
  });
});
