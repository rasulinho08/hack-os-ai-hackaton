"use client";

/**
 * Events on a calendar, a month at a time.
 *
 * Each month lists the events that run at any time inside it (they start
 * before the month ends and end after it begins), from the server, a page at
 * a time, soonest first. The page used to draw every event on the platform in
 * one long list — on a busy platform, tens of thousands of pixels.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ErrorState } from "@/components/ds/primitives";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { PageHead } from "../_shell";
import { PHASES, PHASE_LABEL } from "@/lib/superadmin/owner";
import { type EventListRow } from "@/lib/superadmin/directory";
import { useServerTable } from "@/lib/superadmin/useServerTable";
import { OrgLink, PhaseBadge, hrefFor, num } from "../_ui";

const monthStart = (y: number, m: number) => new Date(y, m, 1);

/** "12 Oct" or "12 Oct → 14 Oct", in the viewer's time. */
function range(a: string | null, b: string | null) {
  const f = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null);
  const x = f(a);
  const y = f(b);
  if (x && y) return x === y ? x : `${x} → ${y}`;
  return x || y || "Dates not set";
}

export default function CalendarPage() {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const label = monthStart(cursor.y, cursor.m).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const filters = useMemo(
    () => ({ from: monthStart(cursor.y, cursor.m).toISOString(), to: monthStart(cursor.y, cursor.m + 1).toISOString() }),
    [cursor.y, cursor.m],
  );

  const t = useServerTable<EventListRow>({
    path: "/api/owner/events",
    defaultSort: { id: "start", dir: "asc" },
    facetKeys: ["phase"],
    filters,
  });

  const shift = (n: number) => setCursor((c) => {
    const d = new Date(c.y, c.m + n, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const isThisMonth = cursor.y === now.getFullYear() && cursor.m === now.getMonth();

  const columns: Column<EventListRow>[] = [
    {
      id: "start",
      header: "Dates",
      sortable: true,
      value: (r) => r.start_date ?? "",
      cell: (r) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs" style={{ color: "var(--ink-2)" }}>
          <CalendarDays size={14} style={{ color: "var(--ink-3)" }} aria-hidden="true" />
          {range(r.start_date, r.end_date)}
        </span>
      ),
      width: "170px",
    },
    {
      id: "name",
      header: "Event",
      sortable: true,
      value: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <Link prefetch={false} href={hrefFor.event(r.id)} className="block truncate font-medium hover:underline" style={{ color: "var(--ink)" }}>{r.name}</Link>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>
            {r.event_code}
            {r.city ? ` · ${r.city}` : ""}
            {r.customer_id ? <> · <OrgLink id={r.customer_id} name={r.customer_name} muted /></> : null}
          </p>
        </div>
      ),
    },
    { id: "phase", header: "Phase", sortable: true, value: (r) => r.phase, cell: (r) => <PhaseBadge phase={r.phase} />, width: "110px" },
    { id: "participants", header: "Participants", sortable: true, value: (r) => r.participants, cell: (r) => num(r.participants), align: "right", width: "120px" },
  ];

  return (
    <>
      <PageHead
        title="Calendar"
        sub={t.data ? `${label}: ${t.data.total.toLocaleString("en-US")} event${t.data.total === 1 ? "" : "s"} running at some point this month.` : `${label}.`}
        actions={
          <div className="flex items-center gap-1.5">
            <Button size="sm" icon={<ChevronLeft size={14} />} onClick={() => shift(-1)} aria-label="Previous month">Prev</Button>
            <Button size="sm" variant={isThisMonth ? "ghost" : "secondary"} disabled={isThisMonth} onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>
              This month
            </Button>
            <Button size="sm" onClick={() => shift(1)} aria-label="Next month">
              Next <ChevronRight size={14} />
            </Button>
          </div>
        }
      />
      <h2 className="mb-3 text-lg font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>{label}</h2>
      {t.error && !t.data ? (
        <ErrorState title="Could not load this month" body={t.error} onRetry={t.reload} />
      ) : (
        <DataTable
          rows={t.rows}
          columns={columns}
          loading={t.loading}
          pageSize={t.pageSize}
          server={t.server}
          getHref={(r) => hrefFor.event(r.id)}
          searchPlaceholder="Search this month's events…"
          emptyTitle={`Nothing runs in ${label}`}
          emptyBody="No event on the platform has dates in this month."
          facets={[{ id: "phase", label: "Phase", options: PHASES.map((p) => ({ value: p, label: PHASE_LABEL[p] })), match: () => true }]}
        />
      )}
    </>
  );
}
