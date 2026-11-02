/**
 * The two event homes as the pages read them: the organiser's overview
 * (phase, alerts, counts, activity in words) and the participant's progress
 * (stages, next step, countdown) — shapes from the API made stable, unknown
 * values dropped instead of shown as keys, and the sentences filled in.
 */
import { describe, expect, it } from "vitest";
import {
  activityGroup, activityWords, alertWords, normalizeOverview, phaseTone, relativeFrom,
  type ActivityItem,
} from "@/lib/eventOverview";
import { countdownTarget, normalizeProgress, statusTone, timeLeft } from "@/lib/participantProgress";
import { resolveDemoRead } from "@/lib/demo/resolve";
import { fill } from "@/lib/i18n/fill";
import en from "@/lib/i18n/ops/en";

const t = (k: string) => en[k] ?? k;
const H = 3600e3;

describe("organiser overview", () => {
  const raw = {
    event: { id: 7, name: "Baku Hack", slug: "baku-hack", timezone: "Asia/Baku" },
    phase: { key: "hacking", until: "2026-10-19T15:00:00.000Z" },
    next: { key: "submission_deadline", at: "2026-10-19T15:00:00.000Z" },
    milestones: [
      { key: "start", at: "2026-10-18T09:00:00.000Z", state: "done" },
      { key: "submission_deadline", at: "2026-10-19T15:00:00.000Z", state: "next" },
      { key: "party", at: "2026-10-20T15:00:00.000Z", state: "upcoming" },
    ],
    kpis: {
      participants: { total: "12", byStatus: { approved: 9, pending: 2, waitlisted: 1 }, capacity: { limit: 10, taken: 11, full: true }, new24h: 3, pendingOld: 1 },
      teams: { active: 3, withoutSubmission: 1 },
      help: { open: 2, medianWaitMin: "4", oldestOpenAt: "nope" },
      mentors: { total: 2, online: 0 },
    },
    alerts: [
      { code: "help_waiting", severity: "danger", count: 2, href: "/help-queue" },
      { code: "made_up", severity: "warn", count: 4, href: "/x" },
      { code: "pending_old", severity: "warn", count: 0, href: "/participants" },
      { code: "teams_without_submission", severity: "weird", count: 1, href: "https://evil.example", at: "2026-10-19T15:00:00.000Z" },
    ],
    activity: [
      { id: "registered:1", type: "registered", at: "2026-10-19T10:00:00.000Z", subject: "Aysel" },
      { id: "x:1", type: "exploded", at: "2026-10-19T10:00:00.000Z" },
      { id: "y:1", type: "registered", at: "not a date" },
    ],
  };

  it("reads the API's answer and drops what it does not know", () => {
    const o = normalizeOverview(raw)!;
    expect(o.event).toEqual({ id: 7, name: "Baku Hack", slug: "baku-hack", timezone: "Asia/Baku" });
    expect(o.phase.key).toBe("hacking");
    expect(o.milestones.map((m) => m.key)).toEqual(["start", "submission_deadline"]);
    expect(o.kpis.participants.total).toBe(12);
    expect(o.kpis.participants.byStatus).toEqual({ pending: 2, approved: 9, waitlisted: 1, rejected: 0, eliminated: 0 });
    expect(o.kpis.participants.capacity).toMatchObject({ limit: 10, full: true, remaining: null });
    expect(o.kpis.help).toMatchObject({ open: 2, medianWaitMin: 4, oldestOpenAt: null, flagged: 0 });
    expect(o.kpis.announcements).toEqual({ sent: 0, scheduled: 0, nextScheduledAt: null, failed24h: 0 });
    expect(o.alerts.map((a) => [a.code, a.severity, a.href])).toEqual([
      ["help_waiting", "danger", "/help-queue"],
      ["teams_without_submission", "info", "/"],
    ]);
    expect(o.activity.map((a) => a.id)).toEqual(["registered:1"]);
    expect(normalizeOverview({ event: {} })).toBeNull();
    expect(normalizeOverview(null)).toBeNull();
  });

  it("puts alerts into sentences with their count and time", () => {
    const o = normalizeOverview(raw)!;
    const words = alertWords(o.alerts[1], t, () => "19 Oct, 19:00");
    expect(words.title).toBe("Teams without a project (due 19 Oct, 19:00): 1");
    expect(words.action).toBe("See projects");
    expect(alertWords(o.alerts[0], t, () => "").title).toBe("Waiting over 15 minutes for help: 2");
  });

  it("the late phases: judges with work left, results and certificates waiting", () => {
    const o = normalizeOverview({
      ...raw,
      phase: { key: "judging", until: null },
      alerts: [
        { code: "judging_unfinished", severity: "warn", count: 2, href: "/judges", judges: [
          { id: 1, name: "Murad", todo: 2, partial: 1, of: 4 },
          { id: 2, name: "Nigar", todo: 4, partial: 0, of: 4 },
          { id: 3, name: "Done", todo: 0, partial: 0, of: 4 },
        ] },
        { code: "results_not_published", severity: "danger", count: 6, href: "/results", at: "2026-10-19T15:00:00.000Z" },
        { code: "certificate_signer_missing", severity: "danger", count: 1, href: "/create-event/7?section=certificates" },
        { code: "chat_reports", severity: "warn", count: 3, href: "/chat?tab=reports" },
      ],
    })!;
    expect(o.alerts.map((a) => a.code)).toEqual(["judging_unfinished", "results_not_published", "certificate_signer_missing", "chat_reports"]);
    const judging = alertWords(o.alerts[0], t, () => "15:00");
    expect(judging.title).toBe("Judges who have not finished: 2");
    expect(judging.details).toEqual(["Murad — 2 not started, 1 unfinished (of 4)", "Nigar — 4 not started (of 4)"]);
    const due = Date.parse("2026-10-19T15:00:00.000Z");
    expect(alertWords(o.alerts[1], t, () => "19 Oct, 15:00", due + 60e3).title).toBe("Projects are in (6); results were due 19 Oct, 15:00 and are not published yet");
    expect(alertWords(o.alerts[1], t, () => "19 Oct, 15:00", due - 60e3).title).toBe("Projects are in (6); results are due 19 Oct, 15:00 and not published yet");
    expect(alertWords(o.alerts[3], t, () => "").action).toBe("Review the reports");
    expect(o.alerts[3].href).toBe("/chat?tab=reports");
  });

  it("words each kind of activity, with a fallback for a missing name", () => {
    const at = "2026-10-19T10:00:00.000Z";
    const item = (type: ActivityItem["type"], extra: Partial<ActivityItem> = {}): ActivityItem =>
      ({ id: `${type}:1`, type, at, actor: null, subject: null, meta: {}, ...extra });
    expect(activityWords(item("registered", { subject: "Aysel" }), t)).toBe("Aysel registered");
    expect(activityWords(item("status_changed", { subject: "Aysel", actor: "Rauf", meta: { to: "approved", from: "pending" } }), t)).toBe("Rauf admitted Aysel");
    expect(activityWords(item("status_changed", { subject: "Aysel", meta: { to: "strange" } }), t)).toBe("An organiser changed the status of Aysel");
    expect(activityWords(item("bulk_status", { actor: "Rauf", meta: { to: "waitlisted", count: 4 } }), t)).toBe("Rauf moved people to the waiting list: 4");
    expect(activityWords(item("submitted", { subject: "Kod" }), t)).toBe("Kod handed in their project");
    expect(activityWords(item("submitted", { subject: "Kod", meta: { project: "MedBot" } }), t)).toBe("Kod handed in MedBot");
    expect(activityWords(item("help_asked", { subject: "Kod", meta: { topic: "CORS" } }), t)).toBe("Kod asked for help: CORS");
    expect(activityWords(item("help_resolved", { subject: "Kod" }), t)).toBe("A help request from Kod was resolved");
    expect(activityWords(item("help_closed", { subject: "Kod", meta: { reason: "withdrawn" } }), t)).toBe("Kod withdrew a help request");
    expect(activityWords(item("announced", { subject: "Lunch", meta: { auto: true } }), t)).toBe("Automatic announcement: Lunch");
    expect(activityWords(item("imported", { actor: "Rauf", meta: { created: 20, skipped: 2 } }), t)).toBe("Rauf imported participants: 20");
    expect(activityWords(item("member_added", { actor: "Rauf", subject: "Kod", meta: { team: "Kod", member: "Leyla" } }), t)).toBe("Rauf added Leyla to team Kod");
    expect(activityWords(item("staff_joined", { subject: "Nigar", meta: { role: "judge" } }), t)).toBe("Nigar joined as a judge");
    expect(activityWords(item("registered"), t)).toBe("Someone registered");
    expect(activityGroup("help_closed")).toBe("help");
    expect(activityGroup("member_moved")).toBe("teams");
    expect(activityGroup("published")).toBe("event");
  });

  it("chooses a colour per phase and short relative times", () => {
    expect(phaseTone("hacking")).toBe("brand");
    expect(phaseTone("draft")).toBe("neutral");
    const now = Date.UTC(2026, 9, 19, 12);
    expect(relativeFrom(new Date(now + 3 * H).toISOString(), "en", now)).toBe("in 3 hours");
    expect(relativeFrom(new Date(now - 5 * 60e3).toISOString(), "en", now)).toBe("5 minutes ago");
    expect(relativeFrom(new Date(now + 3 * 24 * H).toISOString(), "en", now)).toBe("in 3 days");
  });

  it("the walkthrough answers with an overview the page can read", () => {
    const o = normalizeOverview(resolveDemoRead("/api/events/1/overview"));
    expect(o?.phase.key).toBe("judging");
    expect(o?.kpis.participants.total).toBeGreaterThan(0);
    expect(o?.activity.length).toBeGreaterThan(0);
    for (const a of o!.activity) expect(activityWords(a, t)).not.toMatch(/\{|ov\./);
  });
});

describe("participant progress", () => {
  const now = Date.UTC(2026, 9, 19, 12);
  const at = (h: number) => new Date(now + h * H).toISOString();
  const raw = (over: Record<string, unknown> = {}) => ({
    eventId: 9,
    participantStatus: "approved",
    registrationMode: "both",
    team: { id: 4, name: " Kod ", size: 3, isLead: true },
    submitted: false,
    stages: [
      { key: "registration", state: "done", until: at(-24) },
      { key: "team", state: "done", until: at(-2) },
      { key: "hacking", state: "current", at: at(-2), until: at(5) },
      { key: "submission", state: "current", at: at(-2), until: at(5) },
      { key: "judging", state: "upcoming", at: at(6) },
      { key: "results", state: "upcoming" },
      { key: "afterparty", state: "current" },
    ],
    next: { code: "submit", at: at(5), href: "/hacker/submit" },
    ...over,
  });

  it("reads stages and the next step, and only keeps buttons to pages that exist", () => {
    const p = normalizeProgress(raw())!;
    expect(p.stages.map((s) => s.key)).toEqual(["registration", "team", "hacking", "submission", "judging", "results"]);
    expect(p.team).toEqual({ id: 4, name: "Kod", size: 3, isLead: true });
    expect(p.next).toEqual({ code: "submit", at: at(5), href: "/hacker/submit" });
    expect(normalizeProgress(raw({ next: { code: "see_results", href: "/hacker/results" } }))!.next.href).toBe("/hacker/results");
    expect(normalizeProgress(raw({ next: { code: "see_results", href: "/hacker/nowhere" } }))!.next.href).toBeNull();
    expect(normalizeProgress(raw({ next: { code: "teleport" } }))!.next.code).toBe("wait_results");
    expect(normalizeProgress(raw({ team: null }))!.team).toBeNull();
    expect(normalizeProgress({})).toBeNull();
  });

  it("counts down to the start, then to the project deadline", () => {
    const p = normalizeProgress(raw())!;
    expect(countdownTarget(p, now)).toEqual({ kind: "deadline", at: at(5) });
    const before = normalizeProgress(raw({
      stages: [{ key: "hacking", state: "upcoming", at: at(10), until: at(30) }, { key: "submission", state: "upcoming", at: at(10), until: at(30) }],
    }))!;
    expect(countdownTarget(before, now)).toEqual({ kind: "start", at: at(10) });
    const handedIn = normalizeProgress(raw({
      submitted: true,
      stages: [{ key: "hacking", state: "current", at: at(-2), until: at(5) }, { key: "submission", state: "done", at: at(-2), until: at(5) }],
    }))!;
    expect(countdownTarget(handedIn, now)).toEqual({ kind: "deadline", at: at(5) });
    const over = normalizeProgress(raw({
      stages: [{ key: "hacking", state: "done", at: at(-30), until: at(-1) }, { key: "submission", state: "missed", until: at(-1) }],
    }))!;
    expect(countdownTarget(over, now)).toBeNull();
  });

  it("splits the time left and colours the status", () => {
    expect(timeLeft(new Date(now + (26 * 3600 + 61) * 1000).toISOString(), now)).toEqual({ total: 93661, d: 1, h: 2, m: 1, s: 1 });
    expect(timeLeft(at(-1), now).total).toBe(0);
    expect(statusTone("approved")).toBe("ok");
    expect(statusTone("waitlisted")).toBe("info");
    expect(statusTone("eliminated")).toBe("danger");
    expect(fill(t("pg.when.submit"), { at: "19 Oct, 17:00", when: "in 5 hours" })).toBe("Due 19 Oct, 17:00 · in 5 hours");
  });
});
