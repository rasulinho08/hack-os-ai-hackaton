import { apiGet } from "@/lib/api";
import { readActiveEventIdFromStorage } from "@/lib/activeEventStorage";
import {
  normalizeEventFromApi,
  type EventSummary,
} from "@/lib/eventPhase";
import { normalizeTeamMine } from "@/lib/teamNormalize";

function positiveIntOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type ResolveActiveEventIdOptions = {
  /**
   * When true, skip `hh_active_event` from localStorage (admin dashboard
   * selection). Use for mentor/judge portals so they do not fetch the wrong
   * event after the same browser was used as an organizer.
   */
  ignoreStored?: boolean;
};

function shouldUseStoredActiveEventId(): boolean {
  if (typeof window === "undefined") return true;
  const p = window.location.pathname || "";
  // `hh_active_event` is an organizer-only preference from the admin
  // dashboard event switcher. Never let it leak into role portals; that
  // was causing old admin-selected events to bleed into hacker/judge/
  // mentor/volunteer data views (problem 14).
  if (
    p.startsWith("/hacker") ||
    p === "/judge" ||
    p.startsWith("/judge/") ||
    p === "/mentor" ||
    p.startsWith("/mentor/") ||
    p === "/volunteer" ||
    p.startsWith("/volunteer/") ||
    p.startsWith("/join/") ||
    p.startsWith("/login")
  ) {
    return false;
  }
  return true;
}

async function fetchEventSummariesSorted(): Promise<EventSummary[]> {
  try {
    const rows = await apiGet<Record<string, unknown>[]>("/api/events");
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const out = rows
      .map((r) => normalizeEventFromApi(r))
      .filter((e) => Number.isFinite(e.id) && e.id > 0);
    out.sort((a, b) => b.id - a.id);
    return out;
  } catch {
    return [];
  }
}

/**
 * Prefer the newest non-terminal hackathon so multi-event installs never
 * bind the lobby (or generic fallbacks) to `events[0]` / a stale `/active`
 * row from a previous year (problem: old hackers + wrong approval banner).
 */
export function pickPrimaryLiveEventId(summaries: EventSummary[]): number | null {
  if (summaries.length === 0) return null;
  const terminal = new Set(["archived", "completed", "cancelled"]);
  const live = summaries.filter(
    (e) => !terminal.has(String(e.status || "").toLowerCase().trim()),
  );
  const pool = live.length > 0 ? live : summaries;
  return pool[0]?.id ?? null;
}

/** Active event for API calls: localStorage → single event / active → first → 1 */
export async function resolveActiveEventId(
  options?: ResolveActiveEventIdOptions,
): Promise<number> {
  const ignoreStored =
    Boolean(options?.ignoreStored) || !shouldUseStoredActiveEventId();
  if (!ignoreStored) {
    const stored = readActiveEventIdFromStorage();
    if (stored != null) return stored;
  }
  try {
    const summaries = await fetchEventSummariesSorted();
    if (summaries.length === 1) {
      const n = positiveIntOrNull(summaries[0]?.id);
      if (n != null) return n;
    }
    if (summaries.length > 0) {
      const primary = pickPrimaryLiveEventId(summaries);
      if (primary != null) return primary;
      try {
        const active = await apiGet<{ id?: number }>("/api/events/active");
        const aid = positiveIntOrNull(active?.id);
        if (aid != null && summaries.some((e) => e.id === aid)) return aid;
      } catch {
        /* use newest row */
      }
      const n = positiveIntOrNull(summaries[0]?.id);
      if (n != null) return n;
    }
  } catch {
    /* fall through */
  }
  return 1;
}

/**
 * Event id for lobby team-invites: prefers the **newest live** hackathon
 * from `GET /api/events` (same idea as the admin event switcher), not a
 * blind trust of `GET /api/events/active` or `events[0]` — those pointed at
 * older events and mixed lobby + self-approval state across years.
 * Falls back to the hacker's team event id, then {@link resolveActiveEventId}.
 */
export async function resolveLobbyInviteEventId(): Promise<number | null> {
  const summaries = await fetchEventSummariesSorted();
  const primary = pickPrimaryLiveEventId(summaries);
  if (primary != null) {
    return primary;
  }

  try {
    const active = await apiGet<{ id?: unknown }>("/api/events/active");
    const fromActive = positiveIntOrNull(active?.id);
    if (fromActive != null) return fromActive;
  } catch {
    /* continue */
  }
  try {
    const raw = await apiGet<unknown>("/api/teams/mine");
    const t = normalizeTeamMine(raw);
    const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const fromRow = positiveIntOrNull(row?.event_id ?? row?.eventId ?? t?.event_id);
    if (fromRow != null) return fromRow;
  } catch {
    /* continue */
  }
  // Last resort for lobby must NOT use the admin localStorage event
  // selection. If backend cannot resolve an active/team event, prefer an
  // empty lobby over leaking users from a stale event context.
  const fallback = await resolveActiveEventId({ ignoreStored: true });
  return positiveIntOrNull(fallback);
}

/**
 * Event id for mentor-scoped API calls (announcements, tickets, teams, …).
 * Prefers `mentor_assignments` from the backend; never uses the admin-only
 * stored active event id from localStorage.
 */
export async function resolveMentorEventId(): Promise<number> {
  try {
    const payload = await apiGet<{ event_ids?: number[] }>(
      "/api/mentor/me/events",
    );
    const rawIds = Array.isArray(payload?.event_ids) ? payload.event_ids : [];
    const ids = rawIds
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 1) return ids[0]!;
    if (ids.length > 1) {
      const summaries = await fetchEventSummariesSorted();
      const primary = pickPrimaryLiveEventId(summaries);
      if (primary != null && ids.includes(primary)) return primary;
      return Math.max(...ids);
    }
  } catch {
    /* 403 / network / old backend without route — fall through */
  }
  return resolveActiveEventId({ ignoreStored: true });
}

/**
 * List of event ids the current mentor is assigned to (problem 9).
 *
 * The mentor dashboard was only showing announcements for a single
 * resolved event, so when an admin posted to a different event — even
 * one the same mentor was also assigned to — the mentor saw nothing.
 * This helper returns every assigned event so UIs can fan-out their
 * fetches and merge the results.
 */
export async function resolveMentorEventIds(): Promise<number[]> {
  try {
    const payload = await apiGet<{ event_ids?: number[] }>(
      "/api/mentor/me/events",
    );
    const rawIds = Array.isArray(payload?.event_ids) ? payload.event_ids : [];
    const ids = rawIds
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length > 0) return [...ids].sort((a, b) => b - a);
  } catch {
    /* fall through */
  }
  // Never fabricate an event id from "newest hackathon" — mentors are only
  // valid on events returned by /mentor/me/events (same idea as judges).
  return [];
}

/**
 * List of event ids the current judge is assigned to (problem 9).
 *
 * Mirrors `resolveMentorEventIds`. Needed because the judge dashboard
 * was previously picking a single resolved event and silently dropping
 * announcements that belonged to other events the same judge was
 * assigned to.
 */
export async function resolveJudgeEventIds(): Promise<number[]> {
  try {
    const payload = await apiGet<{ event_ids?: number[] }>(
      "/api/judge/me/events",
    );
    const rawIds = Array.isArray(payload?.event_ids) ? payload.event_ids : [];
    const ids = rawIds
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length > 0) return [...ids].sort((a, b) => b - a);
  } catch {
    /* fall through */
  }
  // Do not fall back to resolveActiveEventId: a global "active" event can be
  // one the judge was never assigned to → 403 on submissions/scores.
  return [];
}
