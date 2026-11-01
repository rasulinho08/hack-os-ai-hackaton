"use client";

/**
 * The four things a screen can be, in one place.
 *
 * A data screen is never just "loading" or "loaded". It is one of:
 *
 *   loading    the request is in flight
 *   failed     the request did not come back
 *   empty      it came back, and there is genuinely nothing
 *   filtered   there is something, but the current filter excludes all of it
 *   ready      render the children
 *
 * Every screen in this application used to decide that for itself, and most
 * decided two of the five. The measured result was error states on 20 of 40
 * screens and empty states on 3 — so a failed request and an empty table were
 * the same picture, and an organiser could not tell "nobody has registered"
 * from "this did not load".
 *
 * Distinguishing *empty* from *filtered to nothing* matters more than it
 * sounds: they need different actions. One says wait, the other says clear
 * your filter.
 */

import type { ReactNode } from "react";
import { AlertTriangle, Inbox, SearchX } from "lucide-react";

interface DataStateProps {
  isLoading: boolean;
  isError: boolean;
  /** How many rows exist before any filter is applied. */
  total: number;
  /** How many survive the current filter. Defaults to `total`. */
  shown?: number;
  onRetry?: () => void;
  onClearFilters?: () => void;
  /** Shown while loading — a shape matching the eventual content beats a spinner. */
  skeleton?: ReactNode;
  emptyTitle?: string;
  emptyBody?: string;
  emptyAction?: ReactNode;
  errorTitle?: string;
  /** Names the reads that failed, when a screen loads several. */
  failed?: string[];
  children: ReactNode;
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-xl border px-6 py-12 text-center"
      style={{ borderColor: "var(--app-card-line)", background: "var(--app-card-a)" }}
    >
      {children}
    </div>
  );
}

export function DataState({
  isLoading,
  isError,
  total,
  shown,
  onRetry,
  onClearFilters,
  skeleton,
  emptyTitle = "Nothing here yet",
  emptyBody,
  emptyAction,
  errorTitle = "This did not load",
  failed,
  children,
}: DataStateProps) {
  const visible = shown ?? total;

  if (isLoading) {
    return <>{skeleton ?? <TableSkeleton />}</>;
  }

  if (isError) {
    return (
      <Panel>
        <AlertTriangle size={20} className="mx-auto mb-3" style={{ color: "var(--app-warn)" }} />
        <p className="text-[15px] font-semibold text-[var(--app-heading)]">{errorTitle}</p>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[var(--app-muted)]">
          {failed && failed.length > 0
            ? `These did not answer: ${failed.join(", ")}. Nothing below is up to date.`
            : "The request did not reach the server, so nothing below is up to date."}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 inline-flex min-h-10 items-center rounded-lg border px-4 text-[14px] font-medium text-[var(--app-heading)]"
            style={{ borderColor: "var(--app-card-line)" }}
          >
            Try again
          </button>
        )}
      </Panel>
    );
  }

  // Something exists but the filter hides all of it — a different problem with
  // a different fix, and the user is the only one who can apply it.
  if (total > 0 && visible === 0) {
    return (
      <Panel>
        <SearchX size={20} className="mx-auto mb-3" style={{ color: "var(--app-muted)" }} />
        <p className="text-[15px] font-semibold text-[var(--app-heading)]">
          Nothing matches this filter
        </p>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[var(--app-muted)]">
          {total.toLocaleString()} {total === 1 ? "row is" : "rows are"} hidden by the
          filters you have set.
        </p>
        {onClearFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-5 inline-flex min-h-10 items-center rounded-lg border px-4 text-[14px] font-medium text-[var(--app-heading)]"
            style={{ borderColor: "var(--app-card-line)" }}
          >
            Clear filters
          </button>
        )}
      </Panel>
    );
  }

  if (total === 0) {
    return (
      <Panel>
        <Inbox size={20} className="mx-auto mb-3" style={{ color: "var(--app-muted)" }} />
        <p className="text-[15px] font-semibold text-[var(--app-heading)]">{emptyTitle}</p>
        {emptyBody && (
          <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[var(--app-muted)]">
            {emptyBody}
          </p>
        )}
        {emptyAction && <div className="mt-5">{emptyAction}</div>}
      </Panel>
    );
  }

  return <>{children}</>;
}

/** A loading shape rather than a spinner: the page does not jump when it fills. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--app-card-line)", background: "var(--app-card-a)" }}
      aria-hidden="true"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b px-5 py-4 last:border-b-0"
          style={{ borderColor: "var(--app-card-line)" }}
        >
          <div className="hh-skeleton h-9 w-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="hh-skeleton h-3 rounded" style={{ width: `${45 + ((i * 13) % 30)}%` }} />
            <div className="hh-skeleton h-2.5 rounded" style={{ width: `${25 + ((i * 7) % 20)}%` }} />
          </div>
          <div className="hh-skeleton h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border p-5"
          style={{ borderColor: "var(--app-card-line)", background: "var(--app-card-a)" }}
        >
          <div className="hh-skeleton mb-4 h-2.5 w-24 rounded" />
          <div className="hh-skeleton h-8 w-20 rounded" />
        </div>
      ))}
    </div>
  );
}
