/** API-dən gələn event xülasəsi (camelCase və ya snake_case normalizasiya olunur) */
export interface EventSummary {
  id: number;
  name: string;
  event_code?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  /**
   * Where the event actually is, worked out from its dates by the API.
   * `status` is whatever an organiser last set by hand and nothing ever
   * advances it — every event in the live database still says `upcoming`
   * months after it finished.
   */
  derived_status?: string;
  /**
   * The phase by the organiser home's rule (the dates, and whether results
   * were published): the one word every badge and list uses. See
   * eventOverview.service.js phaseOf.
   */
  phase?: EventPhase;
  is_published?: boolean;
  registration_start?: string | null;
  registration_end?: string | null;
  submission_deadline?: string | null;
  judging_start?: string | null;
  judging_end?: string | null;
  results_at?: string | null;
  results_published_at?: string | null;
}

/** Where an event is, in the order an event goes through them. */
export const EVENT_PHASES = ["draft", "upcoming", "registration", "before_start", "hacking", "judging", "results", "ended", "archived"] as const;
export type EventPhase = (typeof EVENT_PHASES)[number];

export const isEventPhase = (v: unknown): v is EventPhase => (EVENT_PHASES as readonly string[]).includes(String(v));

const HOUR = 3600e3;
const ms = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * The phase of an event: the API's when it sent one, else the same rule
 * worked out here (older answers, the walkthrough's sample data).
 */
export function eventPhaseOf(
  e: Partial<EventSummary> & { derived_status?: string | null } | null | undefined,
  now = Date.now(),
): EventPhase | null {
  if (!e) return null;
  if (isEventPhase(e.phase)) return e.phase;
  const status = String(e.status || "").trim().toLowerCase();
  if (status === "archived") return "archived";
  if (status === "draft" || e.is_published === false) return "draft";
  const regStart = ms(e.registration_start);
  const regEnd = ms(e.registration_end);
  const start = ms(e.start_date);
  const end = ms(e.end_date);
  const subClose = ms(e.submission_deadline) ?? end;
  const results = ms(e.results_at);
  const judgingStart = ms(e.judging_start);
  const judgingEnd = ms(e.judging_end) ?? results ?? (judgingStart != null ? judgingStart + 6 * HOUR : null);
  if (start == null || now < start) {
    if (regStart != null && now < regStart) return "upcoming";
    if (regEnd == null || now < regEnd) return "registration";
    return "before_start";
  }
  if (subClose == null || now <= subClose) return "hacking";
  if (e.results_published_at) return "results";
  if (judgingEnd != null && now < judgingEnd) return "judging";
  if (results != null) return "judging";
  return "ended";
}

/** The phase's word: one map (ov.phase.*) for the header, the home, the builder and the lists. */
export const phaseLabelKey = (phase: EventPhase) => `ov.phase.${phase}`;

/** Başlıq yanındakı status nişanı üçün tərcümə açarı */
export function getHeaderPhaseBadgeKey(
  event: EventSummary | null,
): string | null {
  const phase = eventPhaseOf(event);
  return phase ? phaseLabelKey(phase) : null;
}

export function normalizeEventFromApi(raw: Record<string, unknown>): EventSummary {
  const id = raw.id;
  return {
    id: typeof id === "number" ? id : Number(id),
    name: String(raw.name ?? raw.title ?? ""),
    event_code: (raw.event_code ?? raw.eventCode) as string | undefined,
    start_date: (raw.start_date ?? raw.startDate) as string | undefined,
    end_date: (raw.end_date ?? raw.endDate) as string | undefined,
    status: raw.status as string | undefined,
    derived_status: (raw.derived_status ?? raw.derivedStatus) as
      | string
      | undefined,
    phase: isEventPhase(raw.phase) ? raw.phase : undefined,
    is_published: typeof (raw.is_published ?? raw.isPublished) === "boolean" ? Boolean(raw.is_published ?? raw.isPublished) : undefined,
    registration_start: (raw.registration_start ?? null) as string | null,
    registration_end: (raw.registration_end ?? null) as string | null,
    submission_deadline: (raw.submission_deadline ?? null) as string | null,
    judging_start: (raw.judging_start ?? null) as string | null,
    judging_end: (raw.judging_end ?? null) as string | null,
    results_at: (raw.results_at ?? null) as string | null,
    results_published_at: (raw.results_published_at ?? null) as string | null,
  };
}

/**
 * True once the event has reached or passed its scheduled start_date.
 * Mirrors the backend's event.service.hasEventStarted check — used by
 * the hacker UI to disable team-formation actions (create team, send
 * invite, accept invite, add member, join via code) once the event
 * clock is running (problem 24).
 *
 * Returns false if start_date is missing/invalid so we don't accidentally
 * lock the UI before the event is even scheduled.
 */
export function hasEventStarted(
  event: { start_date?: string | null; startDate?: string | null } | null | undefined,
): boolean {
  if (!event) return false;
  const sd = event.start_date ?? event.startDate;
  if (!sd) return false;
  const startMs = new Date(sd).getTime();
  if (!Number.isFinite(startMs)) return false;
  return startMs <= Date.now();
}

/**
 * Phrase the UI shows when team-formation actions are blocked because
 * the event already started. Centralised so every page (lobby, team,
 * join) speaks with the same voice. Callers pass their local `t`
 * function so the message respects the active language; the hard-coded
 * fallback keeps the API safe if a caller forgets to pass `t`.
 */
export const TEAM_FORMATION_CLOSED_KEY = "common.team_formation_closed";
export const TEAM_FORMATION_CLOSED_FALLBACK =
  "Team formation is closed — the event has already started.";

export function teamFormationClosedMessage(
  t?: (key: string) => string,
): string {
  if (typeof t !== "function") return TEAM_FORMATION_CLOSED_FALLBACK;
  const out = t(TEAM_FORMATION_CLOSED_KEY);
  return out || TEAM_FORMATION_CLOSED_FALLBACK;
}

/**
 * @deprecated Use {@link teamFormationClosedMessage} with the caller's
 * `t` so the message is localised. Kept as a string so pre-i18n call
 * sites continue to compile.
 */
export const TEAM_FORMATION_CLOSED_MESSAGE = TEAM_FORMATION_CLOSED_FALLBACK;

/**
 * State of the submission window for a given event. Used by the hacker
 * submit page (and anywhere else that wants to gate the "Submit" button)
 * so the rule is declared in one place. Mirrors the backend guard in
 * `submission.controller.assertSubmissionWindow`.
 */
export type SubmissionWindowState =
  | "not_started"
  | "open"
  | "closed";

interface EventWindowInput {
  start_date?: string | null;
  startDate?: string | null;
  end_date?: string | null;
  endDate?: string | null;
  submission_deadline?: string | null;
  submissionDeadline?: string | null;
  allow_late_submissions?: boolean | null;
  allowLateSubmissions?: boolean | null;
}

export function getSubmissionWindowState(
  event: EventWindowInput | null | undefined,
): SubmissionWindowState {
  if (!event) return "not_started";
  const now = Date.now();
  const sd = event.start_date ?? event.startDate;
  const start = sd ? new Date(sd).getTime() : NaN;
  if (Number.isFinite(start) && now < start) return "not_started";

  const deadlineRaw =
    event.submission_deadline ??
    event.submissionDeadline ??
    event.end_date ??
    event.endDate;
  const deadline = deadlineRaw ? new Date(deadlineRaw).getTime() : NaN;
  const allowLate = Boolean(
    event.allow_late_submissions ?? event.allowLateSubmissions,
  );
  if (Number.isFinite(deadline) && now > deadline && !allowLate) {
    return "closed";
  }
  return "open";
}

/** The event is over: its end has passed (the entrance ticket has no use any more). */
export function eventEnded(event: { end_date?: string | null; endDate?: string | null } | null | undefined, now = Date.now()): boolean {
  const raw = event?.end_date ?? event?.endDate;
  const end = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(end) && now > end;
}

/**
 * Teams can still be formed or changed: the organisers allow it and the team
 * deadline (else the start) is ahead — the API's rule (teamFormationState).
 * Unknown (no event yet) counts as open, so nothing disappears while loading.
 */
export function teamFormationOpen(event: {
  team_deadline?: string | null; start_date?: string | null; allow_team_formation?: boolean | null;
} | null | undefined, now = Date.now()): boolean {
  if (!event) return true;
  if (event.allow_team_formation === false) return false;
  const raw = event.team_deadline || event.start_date;
  const cutoff = raw ? new Date(raw).getTime() : NaN;
  return !Number.isFinite(cutoff) || cutoff > now;
}
