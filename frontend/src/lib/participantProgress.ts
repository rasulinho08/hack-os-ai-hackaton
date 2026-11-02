/**
 * Where a participant stands in their event, as their home page reads it:
 * six stages (registration → results), each done, current, upcoming, skipped
 * or missed, and the one next step — from GET /api/me/event-progress.
 *
 * Unknown stages and steps are dropped rather than shown as raw keys.
 */

export const STAGES = ["registration", "team", "hacking", "submission", "judging", "results"] as const;
export type StageKey = (typeof STAGES)[number];

export const STAGE_STATES = ["done", "current", "upcoming", "skipped", "missed"] as const;
export type StageState = (typeof STAGE_STATES)[number];

export const NEXT_CODES = [
  "eliminated", "rejected", "waitlisted", "wait_approval", "find_team", "wait_start", "submit", "lead_submits",
  "update_submission", "see_results", "prepare_pitch", "missed_submission", "wait_results",
] as const;
export type NextCode = (typeof NEXT_CODES)[number];

/** Steps that carry a time worth showing (a deadline, the start, demo day, results). */
export const TIMED_STEPS: readonly NextCode[] = ["find_team", "wait_start", "submit", "lead_submits", "update_submission", "prepare_pitch", "wait_results"];

/** Steps with a button, when the API points them at a page that exists. */
export const STEPS_WITH_BUTTON: readonly NextCode[] = ["eliminated", "find_team", "submit", "lead_submits", "update_submission", "see_results"];

/** Pages that exist yet; a step pointing elsewhere is shown without a button. */
const KNOWN_PAGES = ["/hacker/lobby", "/hacker/team", "/hacker/submit", "/hacker/eliminated", "/hacker/help", "/hacker/announcements", "/hacker/results"];

export interface Stage { key: StageKey; state: StageState; at: string | null; until: string | null }

export interface Progress {
  eventId: number;
  participantStatus: string;
  /** "solo", "team" or "both" — whether a skipped team stage means "solo event" or "teams closed". */
  registrationMode: string | null;
  team: { id: number; name: string; size: number; isLead: boolean } | null;
  submitted: boolean;
  stages: Stage[];
  next: { code: NextCode; at: string | null; href: string | null };
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const when = (v: unknown): string | null =>
  typeof v === "string" && v && !Number.isNaN(new Date(v).getTime()) ? v : null;
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  (list as readonly string[]).includes(String(v)) ? (v as T) : null;

export function normalizeProgress(raw: unknown): Progress | null {
  const r = obj(raw);
  const eventId = Number(r.eventId);
  if (!Number.isFinite(eventId) || eventId <= 0) return null;
  const stages: Stage[] = [];
  for (const row of Array.isArray(r.stages) ? r.stages : []) {
    const s = obj(row);
    const key = oneOf(STAGES, s.key);
    const state = oneOf(STAGE_STATES, s.state);
    if (key && state) stages.push({ key, state, at: when(s.at), until: when(s.until) });
  }
  const n = obj(r.next);
  const code = oneOf(NEXT_CODES, n.code) ?? "wait_results";
  const href = typeof n.href === "string" && KNOWN_PAGES.includes(n.href) ? n.href : null;
  const tm = obj(r.team);
  const teamId = Number(tm.id);
  return {
    eventId,
    participantStatus: String(r.participantStatus ?? "pending"),
    registrationMode: typeof r.registrationMode === "string" ? r.registrationMode : null,
    team: Number.isFinite(teamId) && teamId > 0
      ? { id: teamId, name: String(tm.name ?? "").trim(), size: Number(tm.size) || 0, isLead: tm.isLead === true }
      : null,
    submitted: r.submitted === true,
    stages,
    next: { code, at: when(n.at), href },
  };
}

/** What the big countdown counts to: the start, or the project deadline while hacking. */
export function countdownTarget(p: Progress | null, now = Date.now()): { kind: "start" | "deadline"; at: string } | null {
  if (!p) return null;
  const hacking = p.stages.find((s) => s.key === "hacking");
  const submission = p.stages.find((s) => s.key === "submission");
  if (hacking?.state === "upcoming" && hacking.at && new Date(hacking.at).getTime() > now) return { kind: "start", at: hacking.at };
  if (submission && (submission.state === "current" || (submission.state === "done" && hacking?.state === "current")) && submission.until
    && new Date(submission.until).getTime() > now) {
    return { kind: "deadline", at: submission.until };
  }
  return null;
}

/** Days, hours, minutes and seconds left until `at`. */
export function timeLeft(at: string, now = Date.now()) {
  const total = Math.max(0, Math.floor((new Date(at).getTime() - now) / 1000));
  return { total, d: Math.floor(total / 86400), h: Math.floor((total % 86400) / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

/** The participant's status in the badge's colour. */
export function statusTone(status: string): "ok" | "warn" | "info" | "danger" | "neutral" {
  switch (status) {
    case "approved": return "ok";
    case "pending": return "warn";
    case "waitlisted": return "info";
    case "rejected":
    case "eliminated": return "danger";
    default: return "neutral";
  }
}

/** What the "registration in review" screen says: the same facts as the registration e-mail. */
export interface RegistrationFacts {
  eventName: string;
  teamName: string | null;
  registeredAt: string | null;
  /** null when the API did not say. */
  emailVerified: boolean | null;
}

/** From GET /api/me/event-progress and GET /api/auth/me; null without an event to name. */
export function registrationFacts(progress: unknown, me: unknown): RegistrationFacts | null {
  const p = progress && typeof progress === "object" ? (progress as Record<string, unknown>) : null;
  const u = me && typeof me === "object" ? (me as Record<string, unknown>) : null;
  const eventName = typeof p?.eventName === "string" && p.eventName.trim() ? p.eventName.trim() : null;
  if (!eventName) return null;
  const team = p?.team && typeof p.team === "object" ? (p.team as Record<string, unknown>) : null;
  const registeredAt = typeof p?.registeredAt === "string" && !Number.isNaN(Date.parse(p.registeredAt)) ? p.registeredAt : null;
  return {
    eventName,
    teamName: typeof team?.name === "string" && team.name.trim() ? team.name.trim() : null,
    registeredAt,
    emailVerified: typeof u?.email_verified === "boolean" ? u.email_verified : null,
  };
}
