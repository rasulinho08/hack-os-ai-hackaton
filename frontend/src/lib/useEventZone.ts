"use client";

/**
 * The event's own time zone (times are entered and shown in it, whatever
 * the browser's zone), with its "GMT+4" label. Baku until the event says
 * otherwise.
 */

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { zoneLabel } from "@/lib/builder/datetime";

export function useEventZone(eventId: number | null): { timeZone: string; zone: string } {
  const [timeZone, setTimeZone] = useState("Asia/Baku");
  useEffect(() => {
    if (eventId == null) return;
    let cancelled = false;
    apiGet<{ timezone?: string }>(`/api/events/${eventId}`)
      .then((e) => { if (!cancelled && e?.timezone) setTimeZone(e.timezone); })
      .catch(() => { /* keep the default */ });
    return () => { cancelled = true; };
  }, [eventId]);
  const zone = useMemo(() => {
    try {
      return zoneLabel(timeZone);
    } catch {
      return timeZone;
    }
  }, [timeZone]);
  return { timeZone, zone };
}
