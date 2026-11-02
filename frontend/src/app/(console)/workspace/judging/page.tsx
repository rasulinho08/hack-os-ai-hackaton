"use client";

/**
 * Judging — how much of each event's scoring grid is filled in.
 *
 * One request per page (`/api/owner/judging`): judges, criteria, projects and
 * scores per event, and the share of the judge × project × criterion grid
 * that has a score, all counted on the server. This page used to ask four
 * requests per event.
 */

import Link from "next/link";
import { ErrorState, Progress } from "@/components/ds/primitives";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { PageHead } from "../_shell";
import { PHASES, PHASE_LABEL } from "@/lib/superadmin/owner";
import { day, type JudgingRow } from "@/lib/superadmin/directory";
import { useServerTable } from "@/lib/superadmin/useServerTable";
import { OrgLink, PhaseBadge, hrefFor, num } from "../_ui";

export default function JudgingPage() {
  const t = useServerTable<JudgingRow>({
    path: "/api/owner/judging",
    defaultSort: { id: "phase", dir: "asc" },
    facetKeys: ["phase", "panel"],
    syncUrl: true,
  });

  const columns: Column<JudgingRow>[] = [
    {
      id: "name",
      header: "Event",
      sortable: true,
      value: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <Link prefetch={false} href={hrefFor.event(r.id)} className="block truncate font-medium hover:underline" style={{ color: "var(--ink)" }}>{r.name}</Link>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>
            {r.event_code} · {r.customer_id ? <OrgLink id={r.customer_id} name={r.customer_name} muted /> : "No organisation"}
          </p>
        </div>
      ),
    },
    { id: "phase", header: "Phase", sortable: true, value: (r) => r.phase, cell: (r) => <PhaseBadge phase={r.phase} />, width: "110px" },
    {
      id: "window",
      header: "Judging window",
      value: (r) => r.judging_start ?? "",
      cell: (r) => <span className="whitespace-nowrap text-xs">{r.judging_start || r.judging_end ? `${day(r.judging_start)} – ${day(r.judging_end)}` : "—"}</span>,
      width: "200px",
      optional: true,
    },
    { id: "judges", header: "Judges", sortable: true, value: (r) => r.judges, cell: (r) => num(r.judges), align: "right", width: "80px" },
    { id: "criteria", header: "Criteria", value: (r) => r.criteria, cell: (r) => num(r.criteria), align: "right", width: "80px" },
    { id: "submissions", header: "Projects", sortable: true, value: (r) => r.submissions, cell: (r) => num(r.submissions), align: "right", width: "90px" },
    { id: "scores", header: "Scores", value: (r) => r.scores, cell: (r) => num(r.scores), align: "right", width: "80px" },
    {
      id: "coverage",
      header: "Coverage",
      sortable: true,
      value: (r) => r.coverage ?? -1,
      cell: (r) => {
        if (r.coverage == null) {
          return <span className="text-xs" style={{ color: "var(--ink-3)" }}>{r.judges === 0 || r.criteria === 0 ? "No panel" : "Nothing to score"}</span>;
        }
        const pct = Math.round(r.coverage * 100);
        return (
          <div className="flex items-center gap-2">
            <Progress value={pct} tone={pct >= 90 ? "ok" : pct >= 50 ? "warn" : "danger"} className="w-20" />
            <span className="w-9 text-right text-xs" style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{pct}%</span>
          </div>
        );
      },
      width: "150px",
    },
  ];

  return (
    <>
      <PageHead title="Judging" sub="How much of each event's scoring grid is filled in: judges × projects × criteria." />
      {t.error && !t.data ? (
        <ErrorState title="Could not load judging" body={t.error} onRetry={t.reload} />
      ) : (
        <DataTable
          rows={t.rows}
          columns={columns}
          loading={t.loading}
          pageSize={t.pageSize}
          server={t.server}
          getHref={(r) => hrefFor.event(r.id)}
          searchPlaceholder="Search events…"
          emptyTitle="No events yet"
          emptyBody="There is nothing to judge until an event exists."
          facets={[
            { id: "phase", label: "Phase", options: PHASES.map((p) => ({ value: p, label: PHASE_LABEL[p] })), match: () => true },
            { id: "panel", label: "Panel", options: [{ value: "true", label: "Has judges or criteria" }], match: () => true },
          ]}
        />
      )}
    </>
  );
}
