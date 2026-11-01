"use client";

/**
 * The enterprise table the whole workspace is built on.
 *
 * One component covers search, sorting, faceted filters, column visibility,
 * bulk selection with actions, pagination, and the loading / empty / error
 * states — so every list screen behaves identically instead of each one
 * re-inventing a slightly different table.
 *
 * On narrow screens it stops being a table. A shrunken enterprise grid is
 * unusable on a phone, so below the breakpoint each row renders as a card
 * built from the same column definitions — no second data path, no second
 * source of truth.
 */

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  TableSkeleton,
  cx,
} from "./primitives";

export interface Column<T> {
  id: string;
  header: string;
  /** Value used for sorting and search. */
  value: (row: T) => string | number;
  /** What renders in the cell. Falls back to `value`. */
  cell?: (row: T) => ReactNode;
  width?: string;
  align?: "left" | "right";
  /** Hidden by default but available in the column menu. */
  optional?: boolean;
  /** Never shown in the mobile card. */
  hideOnCard?: boolean;
  sortable?: boolean;
}

/**
 * Server mode: the page owns the query, the sort, the filters and the page
 * number, and `rows` is just the page it fetched. The table only draws them and
 * reports what the reader changed. Search is debounced here, so typing sends
 * one request when the reader pauses, not one per key.
 */
export interface ServerTable {
  total: number;
  /** 0-based. */
  page: number;
  onPage: (page: number) => void;
  query: string;
  onQuery: (query: string) => void;
  sort: { id: string; dir: "asc" | "desc" } | null;
  onSort: (sort: { id: string; dir: "asc" | "desc" }) => void;
  facets?: Record<string, string[]>;
  onFacets?: (facets: Record<string, string[]>) => void;
}

export interface Facet<T> {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  match: (row: T, selected: string[]) => boolean;
}

/** The table's own words; English unless the screen passes its translations. */
export interface TableLabels {
  filters: string;
  clearAll: string;
  columns: string;
  count: (shown: number, total: number) => string;
  selected: (n: number) => string;
  clearSelection: string;
  noMatches: string;
  nothingMatches: string;
  clearFilters: string;
  selectAllPage: string;
  selectRow: string;
  page: (n: number, of: number) => string;
  prev: string;
  next: string;
  prevPage: string;
  nextPage: string;
}

export const DEFAULT_TABLE_LABELS: TableLabels = {
  filters: "Filters",
  clearAll: "Clear all",
  columns: "Columns",
  count: (shown, total) => `${shown} of ${total}`,
  selected: (n) => `${n} selected`,
  clearSelection: "Clear",
  noMatches: "No matches",
  nothingMatches: "Nothing matches the current search and filters.",
  clearFilters: "Clear filters",
  selectAllPage: "Select all on this page",
  selectRow: "Select row",
  page: (n, of) => `Page ${n} of ${of}`,
  prev: "Prev",
  next: "Next",
  prevPage: "Previous page",
  nextPage: "Next page",
};

export interface BulkAction {
  id: string;
  label: string;
  onRun: (ids: string[]) => void;
  tone?: "danger";
}

/**
 * `id` may be a string or a number: participants carry string ids, teams carry
 * numeric ones, and a table that only accepts one of those is a table half the
 * product cannot use. Selection keys are strings internally.
 */
export function DataTable<T extends { id: string | number }>({
  rows,
  columns,
  facets = [],
  getHref,
  onRowClick,
  searchPlaceholder = "Search…",
  bulkActions = [],
  pageSize = 10,
  loading = false,
  error = false,
  onRetry,
  emptyTitle = "Nothing here yet",
  emptyBody,
  toolbarExtra,
  dense = false,
  labels: labelOverrides,
  server,
}: {
  rows: T[];
  columns: Column<T>[];
  facets?: Facet<T>[];
  getHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  searchPlaceholder?: string;
  bulkActions?: BulkAction[];
  pageSize?: number;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyBody?: string;
  toolbarExtra?: ReactNode;
  dense?: boolean;
  labels?: Partial<TableLabels>;
  server?: ServerTable;
}) {
  const L: TableLabels = { ...DEFAULT_TABLE_LABELS, ...labelOverrides };
  const router = useRouter();
  const [localQuery, setQuery] = useState(server?.query ?? "");
  const [localSort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(null);
  const [localPage, setPage] = useState(0);
  const query = localQuery;
  const sort = server ? server.sort : localSort;
  const page = server ? server.page : localPage;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.optional).map((c) => c.id)),
  );
  const [openMenu, setOpenMenu] = useState<"columns" | "filters" | null>(null);
  const [localFacets, setFacetState] = useState<Record<string, string[]>>({});
  const facetState = server?.facets ?? localFacets;

  // Server search: one request when the reader pauses typing.
  // (`onQuery` should be a stable callback, as useServerTable's is.)
  const onQuery = server?.onQuery;
  const serverQuery = server?.query;
  const isServer = Boolean(server);
  useEffect(() => {
    if (!onQuery || localQuery === (serverQuery ?? "")) return;
    const t = window.setTimeout(() => onQuery(localQuery), 300);
    return () => window.clearTimeout(t);
  }, [onQuery, localQuery, serverQuery]);

  const go = (row: T) => {
    if (getHref) router.push(getHref(row));
    else onRowClick?.(row);
  };

  const visibleColumns = columns.filter((c) => !hidden.has(c.id));
  const activeFacetCount = Object.values(facetState).reduce((n, v) => n + v.length, 0);

  const filtered = useMemo(() => {
    if (isServer) return rows;
    let out = rows;

    for (const f of facets) {
      const sel = facetState[f.id] ?? [];
      if (sel.length) out = out.filter((r) => f.match(r, sel));
    }

    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        columns.some((c) => String(c.value(r)).toLowerCase().includes(q)),
      );
    }

    if (sort) {
      const col = columns.find((c) => c.id === sort.id);
      if (col) {
        out = [...out].sort((a, b) => {
          const av = col.value(a);
          const bv = col.value(b);
          const cmp =
            typeof av === "number" && typeof bv === "number"
              ? av - bv
              : String(av).localeCompare(String(bv));
          return sort.dir === "asc" ? cmp : -cmp;
        });
      }
    }
    return out;
  }, [isServer, rows, columns, facets, facetState, query, sort]);

  const total = server ? server.total : filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = server ? page : Math.min(page, pageCount - 1);
  const pageRows = server ? rows : filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const toPage = (n: number) => (server ? server.onPage(n) : setPage(n));
  const isSortable = (c: Column<T>) => (server ? c.sortable === true : c.sortable !== false);

  const allOnPageSelected =
    pageRows.length > 0 && pageRows.every((r) => selected.has(String(r.id)));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allOnPageSelected) pageRows.forEach((r) => next.delete(String(r.id)));
    else pageRows.forEach((r) => next.add(String(r.id)));
    setSelected(next);
  };

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const applySort = (id: string) => {
    const next: { id: string; dir: "asc" | "desc" } =
      sort?.id === id ? { id, dir: sort.dir === "asc" ? "desc" : "asc" } : { id, dir: "asc" };
    if (server) server.onSort(next);
    else setSort(next);
  };

  const setFacets = (next: Record<string, string[]>) => {
    if (server) server.onFacets?.(next);
    else setFacetState(next);
    toPage(0);
  };

  const resetFilters = () => {
    setFacets({});
    setQuery("");
    if (server) server.onQuery("");
    toPage(0);
  };

  const cellPad = dense ? "px-3 py-2" : "px-4 py-3";

  return (
    <Card padded={false} className="overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-2 border-b p-3"
        style={{ borderColor: "var(--line)" }}
      >
        <label className="relative min-w-0 basis-full sm:basis-auto sm:flex-1 sm:max-w-xs">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--ink-3)" }}
          />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!server) setPage(0);
            }}
            placeholder={searchPlaceholder}
            className="min-h-10 w-full rounded-[var(--radius-sm)] border pl-9 pr-3 text-sm outline-none focus:border-[var(--ink-3)]"
            style={{
              background: "var(--surface-sunken)",
              borderColor: "var(--line-strong)",
              color: "var(--ink)",
            }}
          />
        </label>

        {facets.length > 0 && (
          <div className="relative">
            <Button
              size="sm"
              icon={<SlidersHorizontal size={14} />}
              onClick={() => setOpenMenu((m) => (m === "filters" ? null : "filters"))}
            >
              {L.filters}
              {activeFacetCount > 0 && (
                <Badge tone="brand" className="ml-1">
                  {activeFacetCount}
                </Badge>
              )}
            </Button>
            {openMenu === "filters" && (
              <div
                className="hs-scale-in absolute right-0 z-30 mt-2 w-64 rounded-[var(--radius)] border p-3 shadow-xl"
                style={{ background: "var(--surface)", borderColor: "var(--line-strong)" }}
              >
                {facets.map((f) => (
                  <div key={f.id} className="mb-3 last:mb-0">
                    <p
                      className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]"
                      style={{ color: "var(--ink-3)" }}
                    >
                      {f.label}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {f.options.map((o) => {
                        const sel = (facetState[f.id] ?? []).includes(o.value);
                        return (
                          <button
                            key={o.value}
                            onClick={() => {
                              const cur = facetState[f.id] ?? [];
                              setFacets({
                                ...facetState,
                                [f.id]: sel ? cur.filter((v) => v !== o.value) : [...cur, o.value],
                              });
                            }}
                            aria-pressed={sel}
                            className="rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors"
                            style={{
                              background: sel ? "var(--ink)" : "var(--tint)",
                              color: sel ? "var(--surface-sunken)" : "var(--ink-2)",
                            }}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {activeFacetCount > 0 && (
                  <Button size="sm" variant="ghost" className="mt-1 w-full" onClick={resetFilters}>
                    {L.clearAll}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="relative hidden sm:block">
          <Button
            size="sm"
            icon={<Columns3 size={14} />}
            onClick={() => setOpenMenu((m) => (m === "columns" ? null : "columns"))}
          >
            {L.columns}
          </Button>
          {openMenu === "columns" && (
            <div
              className="hs-scale-in absolute right-0 z-30 mt-2 w-52 rounded-[var(--radius)] border p-2 shadow-xl"
              style={{ background: "var(--surface)", borderColor: "var(--line-strong)" }}
            >
              {columns.map((c) => (
                <label
                  key={c.id}
                  className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-sm"
                  style={{ color: "var(--ink-2)" }}
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.id)}
                    onChange={() =>
                      setHidden((h) => {
                        const next = new Set(h);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                  />
                  {c.header}
                </label>
              ))}
            </div>
          )}
        </div>

        {toolbarExtra}

        <span className="ml-auto text-xs" style={{ color: "var(--ink-3)" }}>
          {server
            ? total === 0
              ? L.count(0, 0)
              : `${(safePage * pageSize + 1).toLocaleString("en-US")}–${(safePage * pageSize + pageRows.length).toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`
            : L.count(filtered.length, rows.length)}
        </span>
      </div>

      {/* ── Bulk bar ────────────────────────────────────────────────── */}
      {selected.size > 0 && bulkActions.length > 0 && (
        <div
          className="hs-fade flex flex-wrap items-center gap-2 border-b px-3 py-2"
          style={{ background: "var(--accent-weak)", borderColor: "var(--line)" }}
        >
          <span className="text-xs font-medium" style={{ color: "var(--ink)" }}>
            {L.selected(selected.size)}
          </span>
          {bulkActions.map((a) => (
            <Button
              key={a.id}
              size="sm"
              variant={a.tone === "danger" ? "danger" : "secondary"}
              onClick={() => {
                a.onRun([...selected]);
                setSelected(new Set());
              }}
            >
              {a.label}
            </Button>
          ))}
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto inline-flex min-h-8 items-center gap-1 text-xs"
            style={{ color: "var(--ink-2)" }}
          >
            <X size={13} /> {L.clearSelection}
          </button>
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────── */}
      {error ? (
        <div className="p-4">
          <ErrorState onRetry={onRetry} />
        </div>
      ) : loading && !(server && rows.length > 0) ? (
        <TableSkeleton rows={pageSize > 6 ? 6 : pageSize} cols={visibleColumns.length || 4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={query || activeFacetCount ? L.noMatches : emptyTitle}
          body={
            query || activeFacetCount
              ? L.nothingMatches
              : emptyBody
          }
          action={
            query || activeFacetCount ? (
              <Button size="sm" onClick={resetFilters}>
                {L.clearFilters}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Desktop grid. While the next page loads, the current one stays, dimmed. */}
          <div
            className="hs-scroll-x hidden transition-opacity md:block"
            style={{ opacity: loading ? 0.55 : 1 }}
            aria-busy={loading || undefined}
          >
            <table className="w-full text-sm" style={{ minWidth: 720 }}>
              <thead>
                <tr className="border-b text-left" style={{ borderColor: "var(--line)" }}>
                  {bulkActions.length > 0 && (
                    <th className={cx(cellPad, "w-10")}>
                      <input
                        type="checkbox"
                        aria-label={L.selectAllPage}
                        checked={allOnPageSelected}
                        onChange={toggleAll}
                      />
                    </th>
                  )}
                  {visibleColumns.map((c) => (
                    <th
                      key={c.id}
                      className={cx(cellPad, "font-medium", c.align === "right" && "text-right")}
                      style={{ color: "var(--ink-3)", width: c.width }}
                      aria-sort={sort?.id === c.id ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    >
                      {!isSortable(c) ? (
                        c.header
                      ) : (
                        <button
                          onClick={() => applySort(c.id)}
                          className={cx(
                            "inline-flex min-h-8 items-center gap-1 transition-colors",
                            c.align === "right" && "flex-row-reverse",
                          )}
                          style={{ color: sort?.id === c.id ? "var(--ink)" : "inherit" }}
                        >
                          {c.header}
                          {sort?.id === c.id ? (
                            sort.dir === "asc" ? (
                              <ArrowUp size={12} />
                            ) : (
                              <ArrowDown size={12} />
                            )
                          ) : null}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const clickable = Boolean(getHref || onRowClick);
                  return (
                    <tr
                      key={row.id}
                      onClick={(e) => {
                        // A link or control inside the row does its own thing.
                        if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return;
                        go(row);
                      }}
                      className={cx(
                        "border-b transition-colors",
                        clickable && "cursor-pointer hover:bg-[var(--tint)]",
                      )}
                      style={{ borderColor: "var(--line)" }}
                    >
                      {bulkActions.length > 0 && (
                        <td className={cellPad} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`${L.selectRow} ${row.id}`}
                            checked={selected.has(String(row.id))}
                            onChange={() => toggleRow(String(row.id))}
                          />
                        </td>
                      )}
                      {visibleColumns.map((c) => (
                        <td
                          key={c.id}
                          className={cx(cellPad, c.align === "right" && "text-right")}
                          style={{
                            color: "var(--ink-2)",
                            fontVariantNumeric: c.align === "right" ? "tabular-nums" : undefined,
                          }}
                        >
                          {c.cell ? c.cell(row) : c.value(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards — same columns, different shape */}
          <ul className="hs-stagger divide-y md:hidden" style={{ borderColor: "var(--line)" }}>
            {pageRows.map((row) => {
              const [primary, ...rest] = visibleColumns.filter((c) => !c.hideOnCard);
              return (
                <li
                  key={row.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a,button,input,select,textarea,label")) return;
                    go(row);
                  }}
                  className={cx("relative px-4 py-3.5", (getHref || onRowClick) && "cursor-pointer pr-9 transition-colors active:bg-[var(--tint)]")}
                  style={{ borderColor: "var(--line)" }}
                >
                  {getHref || onRowClick ? (
                    <ChevronRight size={16} aria-hidden="true" className="absolute right-3 top-4" style={{ color: "var(--ink-3)" }} />
                  ) : null}
                  <div className="min-w-0 text-sm font-medium" style={{ color: "var(--ink)" }}>
                    {primary ? (primary.cell ? primary.cell(row) : primary.value(row)) : row.id}
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                    {rest.slice(0, 4).map((c) => (
                      <div key={c.id} className="min-w-0">
                        <dt className="text-[10px] uppercase tracking-[0.08em]" style={{ color: "var(--ink-3)" }}>
                          {c.header}
                        </dt>
                        <dd className="truncate text-xs" style={{ color: "var(--ink-2)" }}>
                          {c.cell ? c.cell(row) : c.value(row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>

          {/* ── Pagination ─────────────────────────────────────────── */}
          {pageCount > 1 && (
            <div
              className="flex items-center justify-between gap-3 border-t px-3 py-2.5"
              style={{ borderColor: "var(--line)" }}
            >
              <span className="text-xs" style={{ color: "var(--ink-3)" }}>
                {L.page(safePage + 1, pageCount)}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  disabled={safePage === 0}
                  onClick={() => toPage(safePage - 1)}
                  icon={<ChevronLeft size={14} />}
                  aria-label={L.prevPage}
                >
                  {L.prev}
                </Button>
                <Button
                  size="sm"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => toPage(safePage + 1)}
                  aria-label={L.nextPage}
                >
                  {L.next}
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
