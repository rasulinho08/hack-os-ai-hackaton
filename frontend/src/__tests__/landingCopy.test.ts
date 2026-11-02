/**
 * The home page's copy: the three languages say the same things (same
 * sections, same number of items, nothing left empty), the prices come from
 * the plan list rather than the prose, and the figures come from the API.
 */
import { describe, expect, it } from "vitest";
import { LANDING_COPY, type Lang } from "@/app/(site)/welcome/copy";
import { PLAN_PRICES } from "@/app/(site)/_plans";
import { normalizeStats } from "@/lib/publicStats";

const LANGS: Lang[] = ["en", "az", "ru"];

/** Every leaf of an object as path → value. */
function leaves(v: unknown, path = ""): [string, unknown][] {
  if (Array.isArray(v)) return v.flatMap((x, i) => leaves(x, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
  return [[path, v]];
}

describe("home page copy", () => {
  it("has the same shape in every language", () => {
    const shape = (l: Lang) => leaves(LANDING_COPY[l]).map(([p]) => p).sort();
    expect(shape("az")).toEqual(shape("en"));
    expect(shape("ru")).toEqual(shape("en"));
  });

  it.each(LANGS)("has no empty or placeholder text in %s", (l) => {
    for (const [p, v] of leaves(LANDING_COPY[l])) {
      expect(typeof v, p).toBe("string");
      expect(String(v).trim(), p).not.toBe("");
      expect(String(v), p).not.toMatch(/TODO|lorem|\[[A-Z]+\]/);
    }
  });

  it.each(LANGS)("keeps the {n} and {plan} slots the pricing block fills in (%s)", (l) => {
    const p = LANDING_COPY[l].pricing;
    for (const k of ["upTo", "seats", "eventsYear"] as const) expect(p[k], k).toContain("{n}");
    expect(p.choose).toContain("{plan}");
  });

  it("names a tagline for every plan with a listed price", () => {
    for (const plan of PLAN_PRICES.filter((x) => !x.quoteOnly)) {
      for (const l of LANGS) {
        expect(LANDING_COPY[l].pricing.taglines[plan.id as keyof (typeof LANDING_COPY)["en"]["pricing"]["taglines"]], `${l}:${plan.id}`).toBeTruthy();
      }
    }
  });

  it("does not type figures into the copy (they come from the API)", () => {
    for (const l of LANGS) {
      const s = LANDING_COPY[l].stats;
      for (const label of [s.events, s.participants, s.teams, s.projects]) expect(label).not.toMatch(/\d/);
    }
  });

  it("does not promise webhooks or a security page that no longer exist", () => {
    const all = JSON.stringify(LANDING_COPY);
    expect(all).not.toMatch(/webhook/i);
    expect(all).not.toMatch(/\/security/);
  });
});

describe("normalizeStats", () => {
  it("reads the API's answer, wrapped or not", () => {
    const data = { events: 3, participants: 213, teams: 38, projects: 37, countedAt: "2026-10-19T10:00:00.000Z" };
    expect(normalizeStats({ success: true, data })).toEqual(data);
    expect(normalizeStats(data)).toEqual(data);
    expect(normalizeStats({ data: { ...data, events: "4" } })?.events).toBe(4);
  });

  it("gives nothing rather than a wrong number", () => {
    expect(normalizeStats(null)).toBeNull();
    expect(normalizeStats({ data: { events: 1, participants: 2, teams: 3 } })).toBeNull();
    expect(normalizeStats({ data: { events: -1, participants: 2, teams: 3, projects: 4 } })).toBeNull();
    expect(normalizeStats({ data: { events: "x", participants: 2, teams: 3, projects: 4 } })).toBeNull();
  });
});
