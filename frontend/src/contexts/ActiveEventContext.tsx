"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiGet } from "@/lib/api";
import {
  normalizeEventFromApi,
  type EventSummary,
} from "@/lib/eventPhase";
import {
  readActiveEventIdFromStorage,
  writeActiveEventIdToStorage,
  clearActiveEventIdFromStorage,
} from "@/lib/activeEventStorage";

interface ActiveEventContextValue {
  /** Events from GET /api/events (newest first) */
  events: EventSummary[];
  /** Currently selected event for admin APIs */
  primaryEvent: EventSummary | null;
  activeEventId: number | null;
  setActiveEventId: (id: number) => void;
  loading: boolean;
  refetch: () => Promise<void>;
}

const Ctx = createContext<ActiveEventContextValue>({
  events: [],
  primaryEvent: null,
  activeEventId: null,
  setActiveEventId: () => {},
  // Must be false: judge/mentor/hacker shells render outside ActiveEventProvider.
  // `true` here blocked NotificationsBell forever (eventId never resolved).
  loading: false,
  refetch: async () => {},
});

function pickActiveId(
  sorted: EventSummary[],
  previous: number | null,
): number | null {
  if (sorted.length === 0) return null;
  if (previous != null && sorted.some((e) => e.id === previous)) {
    return previous;
  }
  const stored = readActiveEventIdFromStorage();
  if (stored != null && sorted.some((e) => e.id === stored)) {
    return stored;
  }
  return sorted[0]?.id ?? null;
}

export function ActiveEventProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [activeEventId, setActiveEventIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const rows = await apiGet<Record<string, unknown>[]>("/api/events");
      if (!rows || rows.length === 0) {
        setEvents([]);
        setActiveEventIdState(null);
        clearActiveEventIdFromStorage();
        return;
      }
      const normalized = rows
        .map((r) => normalizeEventFromApi(r))
        .filter((e) => Number.isFinite(e.id) && e.id > 0);
      const sorted = [...normalized].sort((a, b) => b.id - a.id);
      setEvents(sorted);

      setActiveEventIdState((prev) => {
        const next = pickActiveId(sorted, prev);
        if (next != null) writeActiveEventIdToStorage(next);
        else clearActiveEventIdFromStorage();
        return next;
      });
    } catch {
      setEvents([]);
      setActiveEventIdState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const setActiveEventId = useCallback((id: number) => {
    setActiveEventIdState(id);
    writeActiveEventIdToStorage(id);
  }, []);

  const primaryEvent = useMemo(() => {
    if (activeEventId == null) return null;
    return events.find((e) => e.id === activeEventId) ?? null;
  }, [events, activeEventId]);

  return (
    <Ctx.Provider
      value={{
        events,
        primaryEvent,
        activeEventId,
        setActiveEventId,
        loading,
        refetch,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useActiveEvent() {
  return useContext(Ctx);
}

/** Selected event id for dashboard API calls; null if none selected or no events. */
export function useActiveEventId(): number | null {
  return useContext(Ctx).activeEventId;
}
