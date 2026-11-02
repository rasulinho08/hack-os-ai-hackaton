"use client";

/**
 * Feedback — ratings and comments from every event.
 *
 * One request per page (`/api/owner/feedback`); the average, the spread of
 * ratings and the counts above cover everything that matches the search, not
 * only the page. This page used to ask one request per event. Feedback is
 * read as the event's: who wrote it is not part of the answer.
 */

import { useMemo } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Badge, Card, CardHeader, ErrorState, Stat } from "@/components/ds/primitives";
import { BarSeries } from "@/components/ds/charts";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { PageHead } from "../_shell";
import { day, type FeedbackRow } from "@/lib/superadmin/directory";
import { useServerTable } from "@/lib/superadmin/useServerTable";
import { EventLink, OrgLink, hrefFor, num } from "../_ui";

interface Summary {
  responses: number;
  average: number | null;
  comments: number;
  events: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}

export default function FeedbackPage() {
  const t = useServerTable<FeedbackRow, { summary: Summary }>({
    path: "/api/owner/feedback",
    defaultSort: { id: "created", dir: "desc" },
    facetKeys: ["rating", "withComment", "eventId"],
    syncUrl: true,
  });
  const s = t.data?.summary;
  const distribution = useMemo(
    () => (s ? (["1", "2", "3", "4", "5"] as const).map((k) => ({ star: `${k}★`, responses: s.distribution[k] ?? 0 })) : []),
    [s],
  );
  const rated = distribution.reduce((n, d) => n + d.responses, 0);
  const eventId = t.state.facets.eventId?.[0];
  const eventName = eventId ? t.rows.find((r) => String(r.event_id) === eventId)?.event_name : null;

  const columns: Column<FeedbackRow>[] = [
    {
      id: "comment",
      header: "Comment",
      value: (r) => r.comment ?? "",
      cell: (r) => (
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm leading-relaxed" style={{ color: r.comment ? "var(--ink)" : "var(--ink-3)" }}>{r.comment || "No comment"}</p>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>
            <EventLink id={r.event_id} name={r.event_name} muted />
            {r.customer_id ? <> · <OrgLink id={r.customer_id} name={r.customer_name} muted /></> : null}
          </p>
        </div>
      ),
    },
    {
      id: "rating",
      header: "Rating",
      sortable: true,
      value: (r) => r.rating ?? -1,
      cell: (r) => (r.rating ? <span style={{ color: "var(--ink)" }}>{r.rating}★</span> : r.nps != null ? <span className="text-xs">NPS {r.nps}</span> : "—"),
      align: "right",
      width: "90px",
    },
    { id: "created", header: "When", sortable: true, value: (r) => r.created_at, cell: (r) => <span className="whitespace-nowrap text-xs">{day(r.created_at)}</span>, align: "right", width: "110px" },
  ];

  return (
    <>
      <PageHead title="Feedback" sub="Ratings and comments from every event." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Responses" value={s ? num(s.responses) : "…"} hint={s ? `From ${num(s.events)} event${s.events === 1 ? "" : "s"}` : undefined} />
        <Stat label="Average rating" value={s ? (s.average != null ? `${s.average.toFixed(1)}★` : "—") : "…"} hint={rated ? `From ${num(rated)} rated responses` : "Nothing rated yet"} />
        <Stat label="With a comment" value={s ? num(s.comments) : "…"} />
        <Stat label="Rated 1–2★" value={s ? num((s.distribution["1"] ?? 0) + (s.distribution["2"] ?? 0)) : "…"} hint="Worth reading first" />
      </div>

      {rated > 0 ? (
        <Card className="mt-6">
          <CardHeader title="Rating distribution" hint="How the scores are spread, for everything that matches." />
          <BarSeries data={distribution} xKey="star" bars={[{ key: "responses", name: "Responses" }]} height={200} />
        </Card>
      ) : null}

      {eventId ? (
        <div className="mt-6 flex items-center gap-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Showing the feedback of <Link prefetch={false} href={hrefFor.event(eventId)} className="hover:underline"><Badge tone="info">{eventName ?? `event #${eventId}`}</Badge></Link>
          <button type="button" onClick={() => t.setFacet("eventId", [])} className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: "var(--ink-3)" }}>
            <X size={12} /> Every event
          </button>
        </div>
      ) : null}

      <div className="mt-4">
        {t.error && !t.data ? (
          <ErrorState title="Could not load the feedback" body={t.error} onRetry={t.reload} />
        ) : (
          <DataTable
            rows={t.rows}
            columns={columns}
            loading={t.loading}
            pageSize={t.pageSize}
            server={t.server}
            getHref={(r) => hrefFor.event(r.event_id)}
            searchPlaceholder="Search comments or events…"
            emptyTitle="No feedback yet"
            emptyBody="Participants' ratings and comments appear here once an event asks for them."
            facets={[
              { id: "rating", label: "Rating", options: ["1", "2", "3", "4", "5"].map((r) => ({ value: r, label: `${r}★` })), match: () => true },
              { id: "withComment", label: "Comment", options: [{ value: "true", label: "With a comment" }], match: () => true },
            ]}
          />
        )}
      </div>
    </>
  );
}
