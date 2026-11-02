/**
 * The organiser console's shell: the sidebar grouped by phase with every
 * address kept, sub-pages marked under their parent, and one phase word for
 * an event wherever it is shown.
 */
import { describe, expect, it } from "vitest";
import { adminSearchPages, adminSidebarGroups, adminSidebarMenu, adminSubPages, sidebarPageFor } from "@/lib/sidebarMenu";
import { EVENT_PHASES, eventPhaseOf, getHeaderPhaseBadgeKey, normalizeEventFromApi } from "@/lib/eventPhase";
import { PHASES } from "@/lib/eventOverview";
import { resolve } from "@/lib/i18n";
import core from "@/lib/i18n/en";
import coreAz from "@/lib/i18n/az";
import coreRu from "@/lib/i18n/ru";
import ops from "@/lib/i18n/ops/en";
import opsAz from "@/lib/i18n/ops/az";
import opsRu from "@/lib/i18n/ops/ru";

const OLD_ADDRESSES = [
  "/", "/participants", "/invitations", "/teams", "/submissions", "/presentations", "/results", "/leaderboard", "/judges", "/mentors",
  "/volunteers", "/help-queue", "/chat", "/announcements", "/feedback", "/eliminate", "/certificates", "/gallery",
  "/checkin", "/archive", "/analytics", "/resources", "/settings",
];

describe("the sidebar", () => {
  it("groups the pages by phase, as the builder does, and keeps every address", () => {
    expect(adminSidebarGroups.map((g) => g.key)).toEqual(["setup", "registration", "during", "judging", "after"]);
    const inSidebar = adminSidebarMenu.map((m) => m.href);
    expect(new Set(inSidebar).size).toBe(inSidebar.length);
    expect(inSidebar).not.toContain("/leaderboard");
    expect(inSidebar).not.toContain("/eliminate");
    expect(adminSearchPages.map((p) => p.href).sort()).toEqual([...OLD_ADDRESSES].sort());
  });

  it("marks the big screen under Results and elimination under Teams, keeping the plan module", () => {
    expect(sidebarPageFor("/leaderboard")).toMatchObject({ current: "/results" });
    const el = sidebarPageFor("/eliminate");
    expect(el.current).toBe("/teams");
    expect(el.page?.module).toBe("elimination");
    expect(sidebarPageFor("/checkin/scan")).toMatchObject({ current: "/checkin" });
    expect(sidebarPageFor("/")).toMatchObject({ current: "/" });
    expect(sidebarPageFor("/demo/eliminate", "/demo")).toMatchObject({ current: "/teams" });
    expect(sidebarPageFor("/demo", "/demo")).toMatchObject({ current: "/" });
    expect(adminSubPages.every((p) => adminSidebarMenu.some((m) => m.href === p.parent))).toBe(true);
  });

  it("has every heading and label in AZ, EN and RU, in sentence case", () => {
    for (const map of [core, coreAz, coreRu]) for (const g of adminSidebarGroups) expect(map[g.labelKey], g.labelKey).toBeTruthy();
    for (const lang of ["en", "az", "ru"] as const) {
      for (const p of adminSearchPages) expect(resolve(lang, p.labelKey), `${lang} ${p.labelKey}`).not.toBe(p.labelKey);
    }
    expect(core["nav.help_queue"]).toBe("Help queue");
  });
});

describe("one phase word", () => {
  const NOW = Date.UTC(2026, 9, 19, 12);
  const at = (h: number) => new Date(NOW + h * 3600e3).toISOString();

  it("takes the API's phase, the same keys the organiser home uses", () => {
    expect([...EVENT_PHASES]).toEqual([...PHASES]);
    const e = normalizeEventFromApi({ id: 1, name: "X", phase: "results", status: "upcoming", start_date: at(-50), end_date: at(-20) });
    expect(eventPhaseOf(e, NOW)).toBe("results");
    expect(getHeaderPhaseBadgeKey(e)).toBe("ov.phase.results");
  });

  it("works it out the same way when the answer has none", () => {
    const base = { id: 1, name: "X", status: "upcoming", is_published: true, start_date: at(-50), end_date: at(-20) };
    expect(eventPhaseOf(normalizeEventFromApi({ ...base, results_published_at: at(-1) }), NOW)).toBe("results");
    expect(eventPhaseOf(normalizeEventFromApi({ ...base, results_at: at(-2) }), NOW)).toBe("judging");
    expect(eventPhaseOf(normalizeEventFromApi(base), NOW)).toBe("ended");
    expect(eventPhaseOf(normalizeEventFromApi({ ...base, end_date: at(5) }), NOW)).toBe("hacking");
    expect(eventPhaseOf(normalizeEventFromApi({ ...base, start_date: at(5), end_date: at(9), registration_end: at(-1) }), NOW)).toBe("before_start");
    expect(eventPhaseOf(normalizeEventFromApi({ ...base, is_published: false }), NOW)).toBe("draft");
    expect(eventPhaseOf(normalizeEventFromApi({ ...base, status: "archived" }), NOW)).toBe("archived");
  });

  it("every phase has its word in AZ, EN and RU", () => {
    for (const map of [ops, opsAz, opsRu]) for (const p of EVENT_PHASES) expect(map[`ov.phase.${p}`], p).toBeTruthy();
  });
});
