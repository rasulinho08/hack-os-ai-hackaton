/**
 * The home page's figures: counted by the API from the events run on the
 * platform (GET /api/public/stats, cached there for ten minutes). Nothing
 * here is typed in by hand — when the API does not answer, the page shows
 * no figures rather than made-up ones.
 */

export interface PublicStats {
  events: number;
  participants: number;
  teams: number;
  projects: number;
  countedAt: string | null;
}

const count = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/** The answer's figures, or null when any of them is missing or not a count. */
export function normalizeStats(raw: unknown): PublicStats | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const d = o && o.data && typeof o.data === "object" ? (o.data as Record<string, unknown>) : o;
  if (!d) return null;
  const events = count(d.events);
  const participants = count(d.participants);
  const teams = count(d.teams);
  const projects = count(d.projects);
  if (events == null || participants == null || teams == null || projects == null) return null;
  return {
    events,
    participants,
    teams,
    projects,
    countedAt: typeof d.countedAt === "string" ? d.countedAt : null,
  };
}

export async function fetchPublicStats(signal?: AbortSignal): Promise<PublicStats | null> {
  try {
    const res = await fetch("/api/public/stats", { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return normalizeStats(await res.json());
  } catch {
    return null;
  }
}
