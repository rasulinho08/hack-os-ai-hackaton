/**
 * The platform's event list, for the few console screens that need every
 * event at once (the calendar, a story's event picker).
 *
 * Counts and per-event figures are not assembled here any more: the console
 * used to list the events and then read four collections per event in the
 * browser, which on a busy platform meant thousands of requests and the rate
 * limiter. Those figures now come from /api/owner/* (see directory.ts), one
 * request per page, counted on the server.
 */

import { apiGet } from "@/lib/api";

export interface PlatformEvent {
  id: number;
  name: string;
  event_code?: string;
  start_date?: string;
  end_date?: string;
  status?: string;
  derived_status?: string;
  location?: string;
  is_published?: boolean;
  /**
   * Which customer the event was delivered for. `null` on every event created
   * before tenancy existed, and on any the owner has not assigned — which is
   * why customer administrators can still see those. Assigning one is what
   * walls it off.
   */
  customer_id?: number | null;
}

export interface PlatformUser {
  id: number;
  full_name?: string;
  name?: string;
  email?: string;
  role?: string;
  created_at?: string;
}

/* ─── helpers ──────────────────────────────────────────────────────── */

/**
 * Express hands some collections back bare and others wrapped. Normalising
 * here keeps every caller from re-deriving the same three fallbacks.
 */
function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of ["data", "items", "rows", "results", "participants", "teams"]) {
      const inner = o[key];
      if (Array.isArray(inner)) return inner;
    }
  }
  return [];
}

/** A read that records its own failure instead of collapsing to an empty list. */
/* ─── loaders ──────────────────────────────────────────────────────── */

export async function loadEvents(): Promise<PlatformEvent[]> {
  const rows = asArray(await apiGet<unknown>("/api/events"));
  return rows
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? r.title ?? "").trim() || `Event #${r.id}`,
      event_code: r.event_code ? String(r.event_code) : undefined,
      start_date: r.start_date ? String(r.start_date) : undefined,
      end_date: r.end_date ? String(r.end_date) : undefined,
      status: r.status ? String(r.status) : undefined,
      derived_status: r.derived_status ? String(r.derived_status) : undefined,
      location: r.location ? String(r.location) : undefined,
      is_published:
        typeof r.is_published === "boolean" ? r.is_published : undefined,
      // Kept explicitly. This mapper is a whitelist, so a field added to the
      // interface but not here silently arrives as `undefined` — which for
      // `customer_id` reads as "unassigned" and is indistinguishable from the
      // truth until you check the database.
      customer_id:
        r.customer_id == null ? null : Number(r.customer_id),
    }))
    .filter((e) => Number.isFinite(e.id) && e.id > 0)
    .sort((a, b) => b.id - a.id);
}

/* ─── aggregate ────────────────────────────────────────────────────── */

export const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");
