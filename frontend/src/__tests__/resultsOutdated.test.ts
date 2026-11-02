/**
 * Publishing over outdated reviews, as the organiser's screens read it: the
 * API's `outdated` (by judge and project), the refusal REVIEWS_OUTDATED, the
 * confirmation kept with the publication, the judge's notification, the
 * organiser home's alert, and the builder's rolling-judging rule.
 */
import { describe, expect, it } from "vitest";
import { normalizeOrganiserResults, outdatedByProject, publishRefusal, readOutdated, resultsErrorKey } from "@/lib/results";
import { describe as describeNotification, groupOf, pathFor, type AppNotification } from "@/lib/notifications";
import { alertWords, normalizeOverview } from "@/lib/eventOverview";
import { isRollingJudging } from "@/lib/judging";
import { resolve } from "@/lib/i18n";

const outdated = {
  count: 3,
  rolling: true,
  window: { state: "open" },
  reviews: [
    { judgeId: 1, judgeName: "Murad", teamId: 10, teamName: "Owls", projectName: "MetroMind", reviewedAt: "2026-10-20T10:00:00Z", changedAt: "2026-10-21T09:00:00Z" },
    { judgeId: 2, judgeName: "Aysel", teamId: 10, teamName: "Owls", projectName: "MetroMind", reviewedAt: "2026-10-20T11:00:00Z", changedAt: "2026-10-21T09:00:00Z" },
    { judgeId: 1, judgeName: "Murad", teamId: 11, teamName: "Foxes", projectName: null, reviewedAt: "2026-10-20T12:00:00Z", changedAt: "2026-10-22T09:00:00Z" },
    { judgeId: "x" },
  ],
  judges: [{ judgeId: 1, name: "Murad", count: 2 }, { judgeId: 2, name: "Aysel", count: 1 }],
  projects: [{ teamId: 10, teamName: "Owls", projectName: "MetroMind", count: 2 }, { teamId: 11, teamName: "Foxes", projectName: null, count: 1 }],
};

describe("outdated reviews on the results page", () => {
  it("are read from the results, and dropped once published", () => {
    const r = normalizeOrganiserResults({ outdated });
    expect(r.outdated?.count).toBe(3);
    expect(r.outdated?.reviews).toHaveLength(3);
    expect(r.outdated?.windowState).toBe("open");
    expect(r.outdated?.rolling).toBe(true);
    const published = normalizeOrganiserResults({ outdated, published: { at: "2026-10-23T10:00:00Z", outdatedConfirmed: { count: 3, at: "2026-10-23T10:00:00Z" } } });
    expect(published.outdated).toBeNull();
    expect(published.published?.outdatedConfirmed).toEqual({ count: 3, at: "2026-10-23T10:00:00Z" });
    expect(normalizeOrganiserResults({ published: { at: "2026-10-23T10:00:00Z", outdatedConfirmed: { count: 0 } } }).published?.outdatedConfirmed).toBeNull();
    expect(readOutdated(null)).toBeNull();
  });

  it("group by project, the latest change first, judges by name", () => {
    const groups = outdatedByProject(readOutdated(outdated)!);
    expect(groups.map((g) => g.teamName)).toEqual(["Foxes", "Owls"]);
    expect(groups[1].reviews.map((r) => r.judgeName)).toEqual(["Aysel", "Murad"]);
  });

  it("the refusal says how many, which judges and which projects", () => {
    const r = publishRefusal("REVIEWS_OUTDATED", [
      { field: "count", message: "3" }, { field: "judge", message: "Murad" }, { field: "judge", message: "Aysel" }, { field: "project", message: "MetroMind" },
    ]);
    expect(r).toEqual({ code: "REVIEWS_OUTDATED", count: 3, judges: ["Murad", "Aysel"], projects: ["MetroMind"] });
    expect(resultsErrorKey("REVIEWS_OUTDATED")).toBe("rs.err.REVIEWS_OUTDATED");
    for (const lang of ["en", "az", "ru"] as const) expect(resolve(lang, "rs.err.REVIEWS_OUTDATED")).not.toBe("rs.err.REVIEWS_OUTDATED");
  });
});

describe("the judge's notification", () => {
  const n: AppNotification = {
    id: 1, eventId: 5, eventName: "Caspian AI", kind: "judging.recheck", target: "home", title: null, body: null,
    data: { count: 2, projects: ["MetroMind", "Owl Eye"] }, count: 1, createdAt: "2026-10-23T10:00:00Z", read: false,
  };

  it("names the event, how many and the projects, and opens the judge's screen", () => {
    const t = (k: string) => resolve("en", k);
    const w = describeNotification(n, t, "judge");
    expect(w.line).toContain("Caspian AI");
    expect(w.line).toContain("2");
    expect(w.detail).toBe("MetroMind, Owl Eye");
    expect(groupOf(n.kind)).toBe("judging");
    expect(pathFor(n, "judge")).toBe("/judge");
    for (const lang of ["az", "ru"] as const) expect(describeNotification(n, (k) => resolve(lang, k), "judge").line).toContain("Caspian AI");
  });
});

describe("the organiser home", () => {
  it("lists outdated reviews among the things that need attention", () => {
    const o = normalizeOverview({ event: { id: 5, name: "Caspian AI" }, alerts: [{ code: "reviews_outdated", severity: "warn", count: 3, href: "/judges?tab=progress" }] });
    const a = o?.alerts.find((x) => x.code === "reviews_outdated");
    expect(a?.href).toBe("/judges?tab=progress");
    const w = alertWords(a!, (k) => resolve("en", k), (x) => x);
    expect(w.title).toContain("3");
    expect(w.action).not.toBe("ov.alert_go.reviews_outdated");
  });
});

describe("rolling judging in the builder", () => {
  it("is a judging start before submissions close (the deadline, else the end)", () => {
    expect(isRollingJudging({ judging_start: "2026-10-20T10:00:00Z", submission_deadline: "2026-10-21T10:00:00Z", end_date: "2026-10-22T10:00:00Z" })).toBe(true);
    expect(isRollingJudging({ judging_start: "2026-10-21T10:00:00Z", submission_deadline: "2026-10-21T10:00:00Z" })).toBe(false);
    expect(isRollingJudging({ judging_start: "2026-10-21T12:00:00Z", submission_deadline: null, end_date: "2026-10-22T10:00:00Z" })).toBe(true);
    expect(isRollingJudging({ judging_start: null, submission_deadline: "2026-10-21T10:00:00Z" })).toBe(false);
    expect(isRollingJudging({ judging_start: "2026-10-23T10:00:00Z", submission_deadline: "2026-10-21T10:00:00Z" })).toBe(false);
  });
});
