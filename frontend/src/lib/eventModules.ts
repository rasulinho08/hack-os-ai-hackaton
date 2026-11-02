/**
 * Which plan modules an event has (GET /api/events/:eventId/modules).
 *
 * `null` while unknown or when the read fails: the shells then draw no locks
 * and leave the decision to the API, which refuses a disabled module with
 * 403 MODULE_DISABLED either way.
 */

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

export interface EventModules {
  eventId: number;
  plan: string | null;
  modules: string[];
  limits: { participants: number | null; storageGb: number | null };
}

export function useEventModules(eventId: number | null | undefined, enabled = true): Set<string> | null {
  return useEventModulesState(eventId, enabled).modules;
}

/**
 * Same, plus whether the answer is in (`ready` turns true on success and on
 * failure), so a shell can hold a page until it knows whether to show it.
 */
export function useEventModulesState(
  eventId: number | null | undefined,
  enabled = true,
): { modules: Set<string> | null; ready: boolean } {
  const [state, setState] = useState<{ id: number; modules: Set<string> | null } | null>(null);
  useEffect(() => {
    if (!enabled || !eventId) return;
    let cancelled = false;
    apiGet<EventModules>(`/api/events/${eventId}/modules`)
      .then((data) => {
        if (!cancelled) setState({ id: eventId, modules: Array.isArray(data?.modules) ? new Set(data.modules) : null });
      })
      .catch(() => {
        // No locks drawn; the API still decides.
        if (!cancelled) setState({ id: eventId, modules: null });
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, enabled]);
  if (!enabled || !eventId) return { modules: null, ready: true };
  const current = state && state.id === eventId ? state : null;
  return { modules: current ? current.modules : null, ready: Boolean(current) };
}
