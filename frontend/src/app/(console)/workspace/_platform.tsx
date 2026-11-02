"use client";

/**
 * The event list, loaded once and shared.
 *
 * Nearly every screen in this console starts from "which events exist"; without
 * a shared load, opening four pages means four identical requests and four
 * chances for them to disagree. Details stay with the page that needs them —
 * this only holds the spine.
 *
 * It is loaded the first time a page asks for it, not on every console page:
 * most screens now read their own paginated list from the server, and the
 * full event list is a large answer on a busy platform.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { loadEvents, type PlatformEvent } from "@/lib/superadmin/platform";

interface PlatformContextValue {
  events: PlatformEvent[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  request: () => void;
}

const PlatformContext = createContext<PlatformContextValue>({
  events: [],
  loading: true,
  error: null,
  reload: () => {},
  request: () => {},
});

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [wanted, setWanted] = useState(false);
  const request = useCallback(() => setWanted(true), []);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    loadEvents()
      .then((rows) => {
        if (cancelled) return;
        setEvents(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load events");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce, wanted]);

  return (
    <PlatformContext.Provider value={{ events, loading, error, reload, request }}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  const ctx = useContext(PlatformContext);
  const { request } = ctx;
  useEffect(() => request(), [request]);
  return ctx;
}
