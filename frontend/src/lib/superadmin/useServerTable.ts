"use client";

/**
 * One server-paginated list: its search, sort, filters and page, the request
 * they make, and the answer.
 *
 * Each change sends one request and cancels the one before it, so a reader
 * paging quickly never sees an older page land on top of a newer one. With
 * `syncUrl`, the state is written to the address (`?q=…&status=…&page=2`) and
 * read back from it, so a filtered view can be shared or reloaded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadPage, type ListQuery, type Page } from "./directory";
import type { ServerTable } from "@/components/ds/DataTable";

export interface ServerTableState {
  q: string;
  sort: { id: string; dir: "asc" | "desc" } | null;
  /** 0-based. */
  page: number;
  facets: Record<string, string[]>;
}

const RESERVED = new Set(["q", "sort", "dir", "page"]);

function readUrl(facetKeys: string[]): Partial<ServerTableState> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const out: Partial<ServerTableState> = {};
  const q = p.get("q");
  if (q) out.q = q;
  const sort = p.get("sort");
  const dir = p.get("dir");
  if (sort) out.sort = { id: sort, dir: dir === "desc" ? "desc" : "asc" };
  const page = Number(p.get("page"));
  if (Number.isInteger(page) && page > 1) out.page = page - 1;
  const facets: Record<string, string[]> = {};
  for (const k of facetKeys) {
    const v = p.get(k);
    if (v) facets[k] = v.split(",").filter(Boolean);
  }
  if (Object.keys(facets).length) out.facets = facets;
  return out;
}

function writeUrl(state: ServerTableState, defaults: ServerTableState, facetKeys: string[]) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search);
  for (const k of [...RESERVED, ...facetKeys]) p.delete(k);
  if (state.q) p.set("q", state.q);
  if (state.sort && (state.sort.id !== defaults.sort?.id || state.sort.dir !== defaults.sort?.dir)) {
    p.set("sort", state.sort.id);
    p.set("dir", state.sort.dir);
  }
  if (state.page > 0) p.set("page", String(state.page + 1));
  for (const [k, v] of Object.entries(state.facets)) if (v.length) p.set(k, v.join(","));
  const qs = p.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, "", next);
  }
}

export function useServerTable<T, X extends object = Record<string, never>>({
  path,
  pageSize = 25,
  defaultSort = null,
  facetKeys = [],
  filters = {},
  syncUrl = false,
}: {
  path: string;
  pageSize?: number;
  defaultSort?: { id: string; dir: "asc" | "desc" } | null;
  /** Filters the reader sets in the table (each a query parameter of the same name). */
  facetKeys?: string[];
  /** Fixed filters the page sets (e.g. one organisation's events). */
  filters?: ListQuery["filters"];
  syncUrl?: boolean;
}) {
  const defaults: ServerTableState = useMemo(
    () => ({ q: "", sort: defaultSort, page: 0, facets: {} }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defaultSort?.id, defaultSort?.dir],
  );
  const facetKey = facetKeys.join(",");
  const [state, setState] = useState<ServerTableState>(() => ({
    ...defaults,
    ...(syncUrl ? readUrl(facetKeys) : {}),
  }));
  const [data, setData] = useState<(Page<T> & X) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const filterKey = JSON.stringify(filters);
  const controller = useRef<AbortController | null>(null);

  // New fixed filters (another month, another organisation) start at page 1.
  const [seenFilters, setSeenFilters] = useState(filterKey);
  if (seenFilters !== filterKey) {
    setSeenFilters(filterKey);
    setState((s) => (s.page === 0 ? s : { ...s, page: 0 }));
  }

  useEffect(() => {
    if (syncUrl) writeUrl(state, defaults, facetKey ? facetKey.split(",") : []);
  }, [syncUrl, state, defaults, facetKey]);

  useEffect(() => {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    setLoading(true);
    setError(null);
    const fixed = JSON.parse(filterKey) as ListQuery["filters"];
    loadPage<T>(path, {
      q: state.q,
      sort: state.sort?.id,
      dir: state.sort?.dir,
      page: state.page + 1,
      pageSize,
      filters: { ...fixed, ...state.facets },
    }, ctl.signal)
      .then((d) => {
        if (ctl.signal.aborted) return;
        setData(d as Page<T> & X);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : "Could not load this list");
        setLoading(false);
      });
    return () => ctl.abort();
  }, [path, pageSize, state, filterKey, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setQuery = useCallback((q: string) => setState((s) => ({ ...s, q, page: 0 })), []);
  const setSort = useCallback((sort: { id: string; dir: "asc" | "desc" }) => setState((s) => ({ ...s, sort, page: 0 })), []);
  const setPage = useCallback((page: number) => setState((s) => ({ ...s, page: Math.max(0, page) })), []);
  const setFacets = useCallback((facets: Record<string, string[]>) => setState((s) => ({ ...s, facets, page: 0 })), []);
  const setFacet = useCallback(
    (key: string, values: string[]) => setState((s) => ({ ...s, facets: { ...s.facets, [key]: values }, page: 0 })),
    [],
  );

  const server: ServerTable = {
    total: data?.total ?? 0,
    page: state.page,
    onPage: setPage,
    query: state.q,
    onQuery: setQuery,
    sort: state.sort,
    onSort: setSort,
    facets: state.facets,
    onFacets: setFacets,
  };

  return {
    data,
    rows: data?.rows ?? [],
    loading,
    /** True only before the first answer: show the skeleton then, the dimmed page after. */
    initial: loading && data === null,
    error,
    reload,
    state,
    setFacet,
    setQuery,
    server,
    pageSize,
  };
}
