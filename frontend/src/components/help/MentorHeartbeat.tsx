"use client";

/**
 * While a mentor has the portal open (and the tab visible), HackOS hears
 * from it once a minute; that is the "online" dot participants see. Nothing
 * is shown.
 */

import { useEffect } from "react";
import { apiPost } from "@/lib/api";
import { staffEventId } from "@/lib/participantEvent";

const EVERY_MS = 60_000;

export function MentorHeartbeat() {
  useEffect(() => {
    let cancelled = false;
    let eventId: number | null = null;
    const beat = () => {
      if (eventId == null || document.visibilityState !== "visible") return;
      apiPost(`/api/events/${eventId}/mentors/me/heartbeat`, {}).catch(() => { /* offline for a moment: the next beat tries again */ });
    };
    const timer = setInterval(beat, EVERY_MS);
    document.addEventListener("visibilitychange", beat);
    void staffEventId("mentor").catch(() => null).then((id) => {
      if (cancelled) return;
      eventId = id;
      beat();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);
  return null;
}
