"use client";

/**
 * Kanban board, activity timeline, breadcrumb, period switcher and the animated
 * counter — the pieces several workspace screens share.
 *
 * The board uses native HTML5 drag-and-drop rather than a library: it is a
 * handful of events, it keeps the bundle honest, and a keyboard fallback is
 * built in (each card has a stage menu) so the board is not mouse-only.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, GripVertical } from "lucide-react";
import { Badge, Card, cx } from "./primitives";
import type { Tone } from "./primitives";

/* ── Animated counter ──────────────────────────────────────────────────── */

/**
 * Counts up to `value` on mount. The rendered number never depends on the
 * animation: if motion is reduced, the tab is hidden, or rAF never fires, the
 * real figure is what shows.
 */
export function AnimatedNumber({
  value,
  format = (n: number) => n.toLocaleString("en-US"),
  duration = 900,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [shown, setShown] = useState<number | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof document === "undefined" || document.hidden) return;

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setShown(null);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{format(shown ?? value)}</>;
}

/* ── Breadcrumb ────────────────────────────────────────────────────────── */

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-xs">
      {items.map((it, i) => (
        <span key={it.label} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={12} style={{ color: "var(--hs-ink-3)" }} />}
          {it.href && i < items.length - 1 ? (
            <a
              href={it.href}
              className="inline-flex min-h-7 items-center hover:underline"
              style={{ color: "var(--hs-ink-3)" }}
            >
              {it.label}
            </a>
          ) : (
            <span
              className="inline-flex min-h-7 items-center"
              style={{ color: i === items.length - 1 ? "var(--hs-ink)" : "var(--hs-ink-3)" }}
            >
              {it.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

/* ── Period switcher ───────────────────────────────────────────────────── */

export type Period = "today" | "week" | "month" | "quarter" | "year";

export const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "year", label: "Year" },
];

export function PeriodSwitcher({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Time period"
      className="hs-scroll-x inline-flex items-center rounded-[var(--hs-radius-sm)] border p-0.5"
      style={{ borderColor: "var(--hs-line-2)", background: "var(--hs-surface)" }}
    >
      {PERIODS.map((p) => {
        const active = p.id === value;
        return (
          <button
            key={p.id}
            onClick={() => onChange(p.id)}
            aria-pressed={active}
            className="min-h-8 whitespace-nowrap rounded-[5px] px-2.5 text-xs font-medium transition-colors"
            style={{
              background: active ? "var(--hs-ink)" : "transparent",
              color: active ? "var(--hs-bg)" : "var(--hs-ink-2)",
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Timeline ──────────────────────────────────────────────────────────── */

export function Timeline({
  items,
}: {
  items: {
    id: string;
    title: string;
    detail?: string;
    at: string;
    tone?: Tone;
    icon?: ReactNode;
  }[];
}) {
  if (items.length === 0) return null;
  return (
    <ol className="relative">
      <span
        aria-hidden="true"
        className="absolute bottom-3 left-[13px] top-3 w-px"
        style={{ background: "var(--hs-line)" }}
      />
      {items.map((it) => (
        <li key={it.id} className="relative flex gap-3.5 pb-5 last:pb-0">
          <span
            className="relative z-10 mt-0.5 flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full border"
            style={{
              background: "var(--hs-surface)",
              borderColor: "var(--hs-line-2)",
              color: "var(--hs-ink-3)",
            }}
          >
            {it.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-sm font-medium" style={{ color: "var(--hs-ink)" }}>
                {it.title}
              </p>
              <time className="text-[11px]" style={{ color: "var(--hs-ink-3)" }}>
                {it.at}
              </time>
            </div>
            {it.detail && (
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
                {it.detail}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── Kanban ────────────────────────────────────────────────────────────── */

export interface BoardColumn {
  id: string;
  label: string;
  tone?: Tone;
}

export function Kanban<T extends { id: string }>({
  columns,
  items,
  columnOf,
  onMove,
  renderCard,
  summary,
}: {
  columns: BoardColumn[];
  items: T[];
  columnOf: (item: T) => string;
  onMove: (itemId: string, columnId: string) => void;
  renderCard: (item: T) => ReactNode;
  summary?: (columnItems: T[]) => ReactNode;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  return (
    <div className="hs-scroll-x -mx-1 flex gap-3 px-1 pb-2">
      {columns.map((col) => {
        const colItems = items.filter((i) => columnOf(i) === col.id);
        const isOver = over === col.id;
        return (
          <section
            key={col.id}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.id);
            }}
            onDragLeave={() => setOver((c) => (c === col.id ? null : c))}
            onDrop={() => {
              if (dragging) onMove(dragging, col.id);
              setDragging(null);
              setOver(null);
            }}
            className="flex w-[268px] shrink-0 flex-col rounded-[var(--hs-radius)] border transition-colors"
            style={{
              background: isOver ? "var(--hs-brand-weak)" : "var(--hs-raised)",
              borderColor: isOver ? "var(--hs-brand)" : "var(--hs-line)",
            }}
          >
            <header className="flex items-center justify-between gap-2 px-3 py-2.5">
              <span className="flex items-center gap-2">
                <h3 className="text-xs font-semibold" style={{ color: "var(--hs-ink)" }}>
                  {col.label}
                </h3>
                <Badge tone={col.tone ?? "neutral"}>{colItems.length}</Badge>
              </span>
              {summary ? (
                <span className="text-[11px]" style={{ color: "var(--hs-ink-3)" }}>
                  {summary(colItems)}
                </span>
              ) : null}
            </header>

            <div className="flex-1 space-y-2 px-2 pb-2">
              {colItems.length === 0 ? (
                <p
                  className="rounded-[var(--hs-radius-sm)] border border-dashed px-3 py-6 text-center text-[11px]"
                  style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink-3)" }}
                >
                  Nothing in this stage
                </p>
              ) : (
                colItems.map((item) => (
                  <article
                    key={item.id}
                    draggable
                    onDragStart={() => setDragging(item.id)}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={cx(
                      "group cursor-grab rounded-[var(--hs-radius-sm)] border p-3 active:cursor-grabbing",
                      dragging === item.id && "opacity-50",
                    )}
                    style={{ background: "var(--hs-surface)", borderColor: "var(--hs-line)" }}
                  >
                    <div className="mb-2 flex items-start gap-2">
                      <GripVertical
                        size={13}
                        className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
                        style={{ color: "var(--hs-ink-3)" }}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">{renderCard(item)}</div>
                    </div>
                    {/* Keyboard path — the board is not drag-only. */}
                    <label className="mt-1 block">
                      <span className="sr-only">Move to stage</span>
                      <select
                        value={col.id}
                        onChange={(e) => onMove(item.id, e.target.value)}
                        className="min-h-8 w-full rounded-[5px] border px-2 text-[11px]"
                        style={{
                          background: "var(--hs-bg)",
                          borderColor: "var(--hs-line)",
                          color: "var(--hs-ink-3)",
                        }}
                      >
                        {columns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </article>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ── Panel used across detail pages ────────────────────────────────────── */

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card padded={false} className={className}>
      <div
        className="flex items-center justify-between gap-3 border-b px-4 py-3"
        style={{ borderColor: "var(--hs-line)" }}
      >
        <h3 className="text-sm font-semibold" style={{ color: "var(--hs-ink)" }}>
          {title}
        </h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

export function KeyValues({
  rows,
}: {
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <dt
            className="text-[10px] font-medium uppercase tracking-[0.09em]"
            style={{ color: "var(--hs-ink-3)" }}
          >
            {r.label}
          </dt>
          <dd className="mt-0.5 truncate text-sm" style={{ color: "var(--hs-ink)" }}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
