"use client";

import { useEffect, useRef } from "react";
import { apiGet } from "@/lib/api";

/**
 * Problem 12: hacker-side pages must react when an admin changes event
 * timing mid-session.
 *
 * When an admin edits the start/end/submission dates of an event, the
 * hacker's browser holds the old copy — so, e.g., team formation looks
 * "closed" even though the admin just pushed the start date forward,
 * or "Submit" stays greyed out after the admin opens the window.
 *
 * This hook keeps a page honest by periodically re-fetching the event
 * from the backend and invoking `onUpdate` with the fresh row. It also
 * re-checks whenever the tab becomes visible again (catching the case
 * where the admin clicked Save on another device while this tab was
 * backgrounded).
 *
 * `intervalMs` defaults to 30 seconds — small enough that a hacker
 * notices the change within half a minute, large enough that we don't
 * hammer the backend. Pass `0` or `false` to disable the interval and
 * only rely on visibility changes.
 */
export function useEventWatcher(
  eventId: number | null | undefined,
  onUpdate: (event: Record<string, unknown>) => void,
  options: { intervalMs?: number; enabled?: boolean } = {},
): void {
  const { intervalMs = 30_000, enabled = true } = options;

  // Keep a ref to the callback so we don't tear down / rebuild the
  // interval every render just because the caller passed a fresh
  // arrow function.
  const cbRef = useRef(onUpdate);
  useEffect(() => {
    cbRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    if (!enabled) return;
    if (eventId == null || !Number.isFinite(eventId) || eventId <= 0) {
      return;
    }

    let cancelled = false;

    const fetchOnce = () => {
      apiGet<unknown>(`/api/events/${eventId}`)
        .then((raw) => {
          if (cancelled) return;
          if (raw && typeof raw === "object") {
            cbRef.current(raw as Record<string, unknown>);
          }
        })
        .catch(() => {
          // Transient failure — keep the last known state and try
          // again on the next tick / visibility change.
        });
    };

    // Don't fire immediately: the page already loaded the event on
    // mount, so the first refresh should come later. This also avoids
    // double-work for pages that mount + subscribe in the same tick.
    let timer: number | null = null;
    if (intervalMs > 0) {
      timer = window.setInterval(fetchOnce, intervalMs);
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchOnce();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Also refresh when the window regains focus (some browsers fire
    // focus without flipping visibility, e.g. alt-tab in the same
    // monitor on Chrome/Windows).
    const onFocus = () => fetchOnce();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      if (timer != null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [eventId, enabled, intervalMs]);
}
