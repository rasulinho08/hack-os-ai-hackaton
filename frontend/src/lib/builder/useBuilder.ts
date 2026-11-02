"use client";

/**
 * State of one event in the builder, saved as the organiser types.
 *
 * Field edits are applied on screen at once and sent in batches: a short
 * pause after the last keystroke, or immediately on flush(). While one save
 * is on its way, newer edits wait and go out right after it, so the server
 * always ends with the latest value and a slow answer never overwrites
 * something typed in the meantime. A field the server refuses keeps what
 * the organiser typed, shows the server's message, and is not retried until
 * it changes. A lost connection is retried with growing pauses.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { loadBuilder, patchEvent, syncList } from "./api";
import type { BuilderEvent, BuilderPayload, ListKind, SectionKey, SyncResult } from "./types";

export type SaveStatus = "idle" | "pending" | "saving" | "saved" | "error" | "offline";

const DEBOUNCE_MS = 700;

/** Marks a field error that is a date out of order: "\u0001TIMELINE_BEFORE:start_date". */
export const TIMELINE_TOKEN = "\u0001";

export function useBuilder(eventId: number) {
  const [data, setData] = useState<BuilderPayload | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [blocked, setBlocked] = useState<string | null>(null);

  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const retryDelay = useRef(2000);
  const offline = useRef(false);
  const listInflight = useRef(0);

  const reload = useCallback(async () => {
    try {
      const fresh = await loadBuilder(eventId);
      setData(fresh);
      setLoadError(null);
      return fresh;
    } catch (err) {
      setLoadError(err instanceof ApiError ? err : new ApiError("Could not load the event", 0));
      return null;
    }
  }, [eventId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const send = useCallback(async (): Promise<void> => {
    if (inflight.current) {
      await inflight.current;
    }
    const batch = pending.current;
    if (!Object.keys(batch).length) return;
    pending.current = {};
    setStatus("saving");

    const run = (async () => {
      try {
        const res = await patchEvent(eventId, batch);
        retryDelay.current = 2000;
        offline.current = false;
        setData((prev) => {
          if (!prev) return prev;
          // Keep what was typed after this batch left; it is on its way next.
          const newer = pending.current;
          const merged = { ...res.event } as Record<string, unknown>;
          for (const k of Object.keys(newer)) merged[k] = newer[k];
          return { ...prev, event: merged as unknown as BuilderEvent, checklist: res.checklist, ready: res.ready };
        });
        setFieldErrors((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(batch)) delete next[k];
          return next;
        });
        setBlocked(null);
        setSavedAt(Date.now());
        setStatus(Object.keys(pending.current).length ? "pending" : "saved");
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) {
          const errs: Record<string, string> = {};
          // A date out of order keeps its reason, so the field can say it in the organiser's language.
          for (const fe of err.fieldErrors) {
            errs[fe.field] = fe.other && fe.code?.startsWith("TIMELINE_") ? `${TIMELINE_TOKEN}${fe.code}:${fe.other}` : fe.message || err.message;
          }
          if (!Object.keys(errs).length) errs._ = err.message;
          setFieldErrors((prev) => ({ ...prev, ...errs }));
          setStatus("error");
        } else if (err instanceof ApiError && (err.status === 403 || err.status === 409)) {
          setBlocked(err.message);
          setStatus("error");
        } else {
          // Network or server trouble: put the batch back and try again later.
          pending.current = { ...batch, ...pending.current };
          offline.current = true;
          setStatus("offline");
          const wait = retryDelay.current;
          retryDelay.current = Math.min(wait * 2, 30000);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => { void send(); }, wait);
        }
      }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
    if (Object.keys(pending.current).length && !offline.current) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void send(); }, 50);
    }
  }, [eventId]);

  /** Apply edits on screen now and save them shortly. */
  const setFields = useCallback((fields: Record<string, unknown>) => {
    setData((prev) => (prev ? { ...prev, event: { ...prev.event, ...fields } as BuilderEvent } : prev));
    pending.current = { ...pending.current, ...fields };
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(fields)) {
        delete next[k];
        for (const e of Object.keys(next)) if (e.startsWith(`${k}.`)) delete next[e];
      }
      delete next._;
      return next;
    });
    setStatus("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void send(); }, DEBOUNCE_MS);
  }, [send]);

  /** Save whatever is waiting, now. */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await send();
    if (inflight.current) await inflight.current;
  }, [send]);

  /** Save one whole list; the answer replaces it on screen. */
  const saveList = useCallback(async <T,>(kind: ListKind, items: unknown[]): Promise<SyncResult<T>> => {
    listInflight.current += 1;
    setStatus("saving");
    try {
      const res = await syncList<T>(eventId, kind, items);
      const key = kind === "form" ? "fields" : kind;
      setData((prev) => (prev ? { ...prev, [key]: res.items, checklist: res.checklist, ready: res.ready } : prev));
      setSavedAt(Date.now());
      setBlocked(null);
      setStatus("saved");
      return res;
    } catch (err) {
      setStatus(err instanceof ApiError && err.status >= 400 && err.status < 500 ? "error" : "offline");
      throw err;
    } finally {
      listInflight.current -= 1;
    }
  }, [eventId]);

  /** Remember which sections were opened; the sidebar marks the others as not seen yet. */
  const markVisited = useCallback((section: SectionKey) => {
    setData((prev) => {
      if (!prev) return prev;
      const visited = prev.event.builder_state?.visited || [];
      if (visited.includes(section) && prev.event.builder_state?.last === section) return prev;
      const state = { visited: visited.includes(section) ? visited : [...visited, section], last: section };
      pending.current = { ...pending.current, builder_state: state };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void send(); }, DEBOUNCE_MS);
      return { ...prev, event: { ...prev.event, builder_state: state } };
    });
  }, [send]);

  /** Replace the payload (after publish, staff changes, …). */
  const replace = useCallback((next: BuilderPayload) => setData(next), []);

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length || inflight.current || listInflight.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { data, loadError, status, savedAt, fieldErrors, blocked, setFields, flush, saveList, markVisited, replace, reload };
}

export type BuilderApi = ReturnType<typeof useBuilder>;
