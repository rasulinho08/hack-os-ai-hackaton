"use client";

/**
 * Local editing of one builder list (tracks, prizes, sponsors, criteria,
 * the registration form), saved whole a moment after the last change.
 *
 * New rows get a client key so the answer can hand back their ids; edits
 * made while a save is on its way are sent right after it. Errors come back
 * as items.<index>.<field> and are shown on the row they belong to.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import type { ListKind, SyncResult } from "@/lib/builder/types";

type WithIds = { id?: number | null; cid?: string };

let seq = 0;
export const newCid = () => `n${Date.now().toString(36)}${(seq += 1)}`;

export function useListDraft<T extends WithIds>(
  kind: ListKind,
  serverItems: T[],
  toPayload: (item: T) => Record<string, unknown>,
  save: <R>(kind: ListKind, items: unknown[]) => Promise<SyncResult<R>>,
) {
  const [items, setItems] = useState<T[]>(serverItems);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [listError, setListError] = useState<string | null>(null);
  const dirty = useRef(false);
  const busy = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(items);
  latest.current = items;

  // A fresh server list (another tab, a reload) replaces ours when we hold no edits.
  useEffect(() => {
    if (!dirty.current && !busy.current) setItems(serverItems);
  }, [serverItems]);

  const run = useCallback(async () => {
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    dirty.current = false;
    const snapshot = latest.current;
    try {
      const res = await save<T>(kind, snapshot.map((it) => ({ ...toPayload(it), ...(it.id ? { id: it.id } : { cid: it.cid }) })));
      setErrors({});
      setListError(null);
      setItems((now) => now.map((it) => (!it.id && it.cid && res.idsByCid[it.cid] ? { ...it, id: res.idsByCid[it.cid] } : it)));
      if (!dirty.current) {
        // Nothing typed meanwhile: take the server's version, keeping our client keys.
        setItems(res.items.map((srv) => {
          const local = snapshot.find((l) => l.id === (srv as WithIds).id || (l.cid && res.idsByCid[l.cid] === (srv as WithIds).id));
          return { ...srv, cid: local?.cid } as T;
        }));
      }
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors.length) {
        const map: Record<string, string> = {};
        let general: string | null = null;
        for (const fe of err.fieldErrors) {
          const msg = fe.message || err.message;
          if (/^items\.\d+/.test(fe.field)) map[fe.field] = msg;
          else general = general ? `${general} ${msg}` : msg;
        }
        setErrors(map);
        setListError(general);
      } else {
        setListError(err instanceof Error ? err.message : String(err));
        dirty.current = true;
      }
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void run();
      }
    }
  }, [kind, save, toPayload]);

  const schedule = useCallback((delay = 800) => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void run(); }, delay);
  }, [run]);

  const update = useCallback((index: number, patch: Partial<T>) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
    setErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(patch)) delete next[`items.${index}.${k}`];
      return next;
    });
    schedule();
  }, [schedule]);

  const add = useCallback((item: T) => {
    setItems((prev) => [...prev, { ...item, cid: item.cid || newCid() }]);
    schedule(400);
  }, [schedule]);

  const remove = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setErrors({});
    schedule(200);
  }, [schedule]);

  const move = useCallback((from: number, to: number) => {
    setItems((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
    setErrors({});
    schedule(300);
  }, [schedule]);

  const errorOf = (index: number, field: string) => errors[`items.${index}.${field}`] || null;

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { items, update, add, remove, move, errorOf, listError, setItems };
}
