/**
 * The organiser's event home as the page reads it: where the event is, its
 * dates, the counts, what needs attention and the latest activity — from
 * GET /api/events/:id/overview, put into stable shapes and the reader's words.
 *
 * Unknown phases, alert codes and activity types are dropped rather than
 * shown as raw keys: an older page against a newer API stays readable.
 */

import { fill } from "@/lib/i18n/fill";
import { formatRelativeUnit } from "@/lib/i18n/dates";
import type { Tone } from "@/components/ds/primitives";

export const PHASES = ["draft", "upcoming", "registration", "before_start", "hacking", "judging", "results", "ended", "archived"] as const;
export type PhaseKey = (typeof PHASES)[number];

export const MILESTONES = [
  "registration_opens", "registration_closes", "team_deadline", "start", "submission_deadline",
  "judging_start", "judging_end", "demo_day", "results", "end",
] as const;
export type MilestoneKey = (typeof MILESTONES)[number];

export const ALERT_CODES = [
  "not_published", "help_flagged", "help_waiting", "no_mentor_online", "pending_old", "full_waitlist",
  "teams_without_submission", "teamless_near_deadline", "tasks_overdue", "delivery_failures",
  "chat_reports", "judging_unfinished", "reviews_outdated", "no_judges", "results_not_published",
  "certificate_signer_missing", "certificates_not_issued",
] as const;
export type AlertCode = (typeof ALERT_CODES)[number];

export const ACTIVITY_TYPES = [
  "registered", "team_created", "submitted", "help_asked", "help_resolved", "help_closed", "announced",
  "status_changed", "bulk_status", "team_status", "removed", "promoted", "imported", "member_added",
  "member_moved", "mentor_added", "volunteer_added", "published", "unpublished", "staff_joined",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Statuses an activity line can name (participants and staff roles). */
export const ACTIVITY_STATUSES = ["pending", "approved", "waitlisted", "rejected", "eliminated"] as const;
export const STAFF_ROLES = ["mentor", "judge", "volunteer"] as const;
export const CLOSE_REASONS = ["withdrawn", "event_ended"] as const;

export type Severity = "danger" | "warn" | "info";

/** A judge with reviews still to do (the judging_unfinished alert). */
export interface JudgeBacklog {
  id: number;
  name: string;
  /** Assigned teams not started. */
  todo: number;
  /** Started, not every criterion scored. */
  partial: number;
  of: number;
}

export interface OverviewAlert {
  code: AlertCode;
  severity: Severity;
  count: number;
  href: string;
  at: string | null;
  since: string | null;
  judges?: JudgeBacklog[];
}

export interface Milestone {
  key: MilestoneKey;
  at: string;
  state: "done" | "next" | "upcoming";
}

export interface ActivityItem {
  id: string;
  type: ActivityType;
  at: string;
  actor: string | null;
  subject: string | null;
  meta: Record<string, string | number | boolean | null>;
}

export interface Overview {
  event: { id: number; name: string; slug: string | null; timezone: string | null };
  phase: { key: PhaseKey; until: string | null };
  next: { key: MilestoneKey; at: string } | null;
  milestones: Milestone[];
  formation: { open: boolean; closesAt: string | null };
  kpis: {
    participants: {
      total: number;
      byStatus: Record<(typeof ACTIVITY_STATUSES)[number], number>;
      capacity: { limit: number | null; taken: number; remaining: number | null; full: boolean; waitlistEnabled: boolean };
      new24h: number;
      pendingOld: number;
    };
    teams: { active: number; eliminated: number; withoutSubmission: number; teamlessApproved: number; looking: number };
    submissions: { total: number };
    help: { open: number; inProgress: number; flagged: number; waitingLong: number; oldestOpenAt: string | null; resolved24h: number; medianWaitMin: number | null };
    mentors: { total: number; online: number };
    volunteers: { total: number; tasksOpen: number; tasksOverdue: number; tasksUnassigned: number };
    announcements: { sent: number; scheduled: number; nextScheduledAt: string | null; failed24h: number };
  };
  alerts: OverviewAlert[];
  activity: ActivityItem[];
  generatedAt: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown, d = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const when = (v: unknown): string | null => {
  const s = str(v);
  return s && !Number.isNaN(new Date(s).getTime()) ? s : null;
};
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  (list as readonly string[]).includes(String(v)) ? (v as T) : null;

export function normalizeOverview(raw: unknown): Overview | null {
  const r = obj(raw);
  const ev = obj(r.event);
  const id = num(ev.id);
  if (!id) return null;
  const k = obj(r.kpis);
  const p = obj(k.participants);
  const by = obj(p.byStatus);
  const cap = obj(p.capacity);
  const tm = obj(k.teams);
  const h = obj(k.help);
  const m = obj(k.mentors);
  const v = obj(k.volunteers);
  const a = obj(k.announcements);
  const phase = obj(r.phase);
  const next = obj(r.next);
  const formation = obj(r.formation);

  const milestones: Milestone[] = [];
  for (const row of Array.isArray(r.milestones) ? r.milestones : []) {
    const x = obj(row);
    const key = oneOf(MILESTONES, x.key);
    const at = when(x.at);
    const state = oneOf(["done", "next", "upcoming"] as const, x.state);
    if (key && at && state) milestones.push({ key, at, state });
  }

  const alerts: OverviewAlert[] = [];
  for (const row of Array.isArray(r.alerts) ? r.alerts : []) {
    const x = obj(row);
    const code = oneOf(ALERT_CODES, x.code);
    const count = num(x.count);
    if (!code || count <= 0) continue;
    alerts.push({
      code,
      severity: oneOf(["danger", "warn", "info"] as const, x.severity) ?? "info",
      count,
      href: typeof x.href === "string" && x.href.startsWith("/") ? x.href : "/",
      at: when(x.at),
      since: when(x.since),
      ...(Array.isArray(x.judges) ? {
        judges: x.judges.map((j) => {
          const o = obj(j);
          return { id: num(o.id), name: str(o.name) ?? "—", todo: num(o.todo), partial: num(o.partial), of: num(o.of) };
        }).filter((j) => j.todo + j.partial > 0),
      } : {}),
    });
  }

  const activity: ActivityItem[] = [];
  for (const row of Array.isArray(r.activity) ? r.activity : []) {
    const x = obj(row);
    const type = oneOf(ACTIVITY_TYPES, x.type);
    const at = when(x.at);
    if (!type || !at) continue;
    const meta: ActivityItem["meta"] = {};
    for (const [mk, mv] of Object.entries(obj(x.meta))) {
      if (mv == null || ["string", "number", "boolean"].includes(typeof mv)) meta[mk] = mv as string | number | boolean | null;
    }
    activity.push({ id: String(x.id ?? `${type}:${at}`), type, at, actor: str(x.actor), subject: str(x.subject), meta });
  }

  const phaseKey = oneOf(PHASES, phase.key) ?? "upcoming";
  const nextKey = oneOf(MILESTONES, next.key);
  const nextAt = when(next.at);

  return {
    event: { id, name: str(ev.name) ?? "", slug: str(ev.slug), timezone: str(ev.timezone) },
    phase: { key: phaseKey, until: when(phase.until) },
    next: nextKey && nextAt ? { key: nextKey, at: nextAt } : null,
    milestones,
    formation: { open: formation.open === true, closesAt: when(formation.closesAt) },
    kpis: {
      participants: {
        total: num(p.total),
        byStatus: {
          pending: num(by.pending), approved: num(by.approved), waitlisted: num(by.waitlisted),
          rejected: num(by.rejected), eliminated: num(by.eliminated),
        },
        capacity: {
          limit: numOrNull(cap.limit), taken: num(cap.taken), remaining: numOrNull(cap.remaining),
          full: cap.full === true, waitlistEnabled: cap.waitlistEnabled === true,
        },
        new24h: num(p.new24h),
        pendingOld: num(p.pendingOld),
      },
      teams: {
        active: num(tm.active), eliminated: num(tm.eliminated), withoutSubmission: num(tm.withoutSubmission),
        teamlessApproved: num(tm.teamlessApproved), looking: num(tm.looking),
      },
      submissions: { total: num(obj(k.submissions).total) },
      help: {
        open: num(h.open), inProgress: num(h.inProgress), flagged: num(h.flagged), waitingLong: num(h.waitingLong),
        oldestOpenAt: when(h.oldestOpenAt), resolved24h: num(h.resolved24h), medianWaitMin: numOrNull(h.medianWaitMin),
      },
      mentors: { total: num(m.total), online: num(m.online) },
      volunteers: { total: num(v.total), tasksOpen: num(v.tasksOpen), tasksOverdue: num(v.tasksOverdue), tasksUnassigned: num(v.tasksUnassigned) },
      announcements: { sent: num(a.sent), scheduled: num(a.scheduled), nextScheduledAt: when(a.nextScheduledAt), failed24h: num(a.failed24h) },
    },
    alerts,
    activity,
    generatedAt: when(r.generatedAt),
  };
}

/** The badge colour of a phase. */
export function phaseTone(key: PhaseKey): Tone {
  switch (key) {
    case "hacking": return "brand";
    case "registration": return "ok";
    case "judging": return "warn";
    case "results": return "info";
    case "upcoming":
    case "before_start": return "info";
    default: return "neutral";
  }
}

/** Whether the phase is "live" (shows a pulsing dot). */
export const isLivePhase = (key: PhaseKey) => key === "registration" || key === "hacking" || key === "judging";

type T = (key: string) => string;

/** One alert in the reader's words. `time` formats an ISO date for the sentence. */
export function alertWords(
  a: OverviewAlert, t: T, time: (iso: string) => string, now = Date.now(),
): { title: string; action: string; details: string[] } {
  // Results with a date: "were due" once it passed, "are due" before.
  const key = a.code === "results_not_published" && a.at
    ? (new Date(a.at).getTime() <= now ? "ov.alert.results_not_published_at" : "ov.alert.results_not_published_due")
    : `ov.alert.${a.code}`;
  return {
    title: fill(t(key), { n: a.count, at: a.at ? time(a.at) : "" }),
    action: t(`ov.alert_go.${a.code}`),
    details: (a.judges ?? []).map((j) => judgeBacklogWords(j, t)),
  };
}

/** "Murad — 2 not started, 1 unfinished (of 4)". */
export function judgeBacklogWords(j: JudgeBacklog, t: T): string {
  const parts = [
    j.todo > 0 ? fill(t("ov.alert.judge_todo"), { n: j.todo }) : null,
    j.partial > 0 ? fill(t("ov.alert.judge_partial"), { n: j.partial }) : null,
  ].filter(Boolean);
  return fill(t("ov.alert.judge_line"), { name: j.name, what: parts.join(", "), of: j.of });
}

/** One line of the activity feed. */
export function activityWords(x: ActivityItem, t: T): string {
  const who = x.subject ?? t("ov.someone");
  const by = x.actor ?? t("ov.an_organiser");
  const n = typeof x.meta.count === "number" ? x.meta.count : num(x.meta.count);
  const to = String(x.meta.to ?? "");
  const vars = { who, by, n, what: x.subject ?? "", topic: String(x.meta.topic ?? ""), project: String(x.meta.project ?? ""), team: String(x.meta.team ?? x.subject ?? ""), member: String(x.meta.member ?? t("ov.someone")) };
  const key = (() => {
    switch (x.type) {
      case "submitted": return x.meta.project ? "ov.act.submitted_named" : "ov.act.submitted";
      case "help_asked": return x.meta.topic ? "ov.act.help_asked" : "ov.act.help_asked_plain";
      case "help_resolved": return x.actor ? "ov.act.help_resolved" : "ov.act.help_resolved_plain";
      case "help_closed": return oneOf(CLOSE_REASONS, x.meta.reason) ? `ov.act.help_closed.${x.meta.reason}` : "ov.act.help_resolved_plain";
      case "announced": return x.meta.auto ? "ov.act.announced_auto" : x.actor ? "ov.act.announced" : "ov.act.announced_plain";
      case "status_changed": return oneOf(ACTIVITY_STATUSES, to) ? `ov.act.status.${to}` : "ov.act.status_other";
      case "bulk_status": return oneOf(ACTIVITY_STATUSES, to) ? `ov.act.bulk.${to}` : "ov.act.bulk_other";
      case "team_status": return oneOf(ACTIVITY_STATUSES, to) ? `ov.act.team_status.${to}` : "ov.act.bulk_other";
      case "imported": return "ov.act.imported";
      case "staff_joined": return oneOf(STAFF_ROLES, x.meta.role) ? `ov.act.staff_joined.${x.meta.role}` : "ov.act.staff_joined.mentor";
      default: return `ov.act.${x.type}`;
    }
  })();
  const count = x.type === "imported" ? num(x.meta.created) : n;
  return fill(t(key), { ...vars, n: count });
}

/** Which icon group an activity belongs to (people, teams, projects, help, news, staff, event). */
export function activityGroup(type: ActivityType): "people" | "teams" | "projects" | "help" | "news" | "staff" | "event" {
  if (["registered", "status_changed", "bulk_status", "removed", "promoted", "imported"].includes(type)) return "people";
  if (["team_created", "team_status", "member_added", "member_moved"].includes(type)) return "teams";
  if (type === "submitted") return "projects";
  if (type.startsWith("help_")) return "help";
  if (type === "announced") return "news";
  if (["mentor_added", "volunteer_added", "staff_joined"].includes(type)) return "staff";
  return "event";
}

/** "in 3 hours", "in 2 days", "5 minutes ago" — hours up to two days, for dates ahead. */
export function relativeFrom(iso: string, lang: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 60e3) return formatRelativeUnit(0, "minute", lang);
  if (abs < 3600e3) return formatRelativeUnit(Math.round(diff / 60e3), "minute", lang);
  if (abs < 48 * 3600e3) return formatRelativeUnit(Math.round(diff / 3600e3), "hour", lang);
  return formatRelativeUnit(Math.round(diff / 86400e3), "day", lang);
}
