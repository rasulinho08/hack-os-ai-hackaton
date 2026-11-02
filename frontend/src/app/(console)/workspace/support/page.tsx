"use client";

/**
 * Support — the help queue across every event.
 *
 * One request per page (`/api/owner/tickets`), with the counts by status over
 * everything that matches, filtered by status, event or escalation on the
 * server. This page used to ask one request per event.
 */

import Link from "next/link";
import { X } from "lucide-react";
import { Badge, ErrorState, Stat } from "@/components/ds/primitives";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { PageHead } from "../_shell";
import { ago, when, type TicketRow } from "@/lib/superadmin/directory";
import { useServerTable } from "@/lib/superadmin/useServerTable";
import { EventLink, PersonLink, hrefFor, num } from "../_ui";

const TONE: Record<string, "warn" | "info" | "ok" | "neutral"> = { open: "warn", claimed: "info", resolved: "ok", closed: "neutral" };

export default function SupportPage() {
  const t = useServerTable<TicketRow, { counts: Record<string, number>; escalated: number }>({
    path: "/api/owner/tickets",
    defaultSort: { id: "created", dir: "desc" },
    facetKeys: ["status", "escalated", "eventId"],
    syncUrl: true,
  });
  const counts = t.data?.counts ?? {};
  const eventId = t.state.facets.eventId?.[0];
  const eventName = eventId ? t.rows.find((r) => String(r.event_id) === eventId)?.event_name : null;

  const columns: Column<TicketRow>[] = [
    {
      id: "topic",
      header: "Request",
      value: (r) => r.topic ?? "",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate" style={{ color: "var(--ink)" }}>
            {r.topic || "—"}
            {r.escalated_to_admin && !r.resolved_at ? <span className="ml-1.5"><Badge tone="danger">Escalated</Badge></span> : null}
          </p>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>
            {r.team_name ? `${r.team_name} · ` : ""}
            <EventLink id={r.event_id} name={r.event_name} muted />
          </p>
        </div>
      ),
    },
    { id: "status", header: "Status", sortable: true, value: (r) => r.status, cell: (r) => <Badge tone={TONE[r.status.toLowerCase()] ?? "neutral"}>{r.status}</Badge>, width: "110px" },
    { id: "priority", header: "Priority", sortable: true, value: (r) => r.priority ?? "", cell: (r) => <span className="text-xs">{r.priority || "—"}</span>, width: "90px", optional: true },
    {
      id: "people",
      header: "Asked by · mentor",
      value: (r) => r.requester_name ?? "",
      cell: (r) => (
        <span className="block text-xs">
          <PersonLink id={r.requester_id} name={r.requester_name} />
          <span className="block" style={{ color: "var(--ink-3)" }}>{r.mentor_id ? <PersonLink id={r.mentor_id} name={r.mentor_name} muted /> : "No mentor yet"}</span>
        </span>
      ),
      width: "200px",
    },
    { id: "created", header: "Raised", sortable: true, value: (r) => r.created_at, cell: (r) => <span className="whitespace-nowrap text-xs" title={when(r.created_at)}>{ago(r.created_at)}</span>, align: "right", width: "110px" },
    { id: "event", header: "Event", sortable: true, value: (r) => r.event_name, cell: (r) => <EventLink id={r.event_id} name={r.event_name} />, optional: true },
  ];

  return (
    <>
      <PageHead title="Support" sub="The help queue across every event." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open" value={t.data ? num(counts.open ?? 0) : "…"} hint="Nobody has claimed these" />
        <Stat label="Claimed" value={t.data ? num(counts.claimed ?? 0) : "…"} hint="A mentor is on it" />
        <Stat label="Resolved" value={t.data ? num((counts.resolved ?? 0) + (counts.closed ?? 0)) : "…"} />
        <Stat label="Escalated" value={t.data ? num(t.data.escalated) : "…"} hint="Sent to the organisers, unresolved" />
      </div>
      {eventId ? (
        <div className="mb-3 flex items-center gap-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Showing the help queue of <Link prefetch={false} href={hrefFor.event(eventId)} className="hover:underline"><Badge tone="info">{eventName ?? `event #${eventId}`}</Badge></Link>
          <button type="button" onClick={() => t.setFacet("eventId", [])} className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: "var(--ink-3)" }}>
            <X size={12} /> Every event
          </button>
        </div>
      ) : null}
      {t.error && !t.data ? (
        <ErrorState title="Could not load the help queue" body={t.error} onRetry={t.reload} />
      ) : (
        <DataTable
          rows={t.rows}
          columns={columns}
          loading={t.loading}
          pageSize={t.pageSize}
          server={t.server}
          getHref={(r) => hrefFor.event(r.event_id)}
          searchPlaceholder="Search requests, teams or events…"
          emptyTitle="No help requests"
          emptyBody="Nobody has asked for help on any event yet."
          facets={[
            { id: "status", label: "Status", options: ["open", "claimed", "resolved", "closed"].map((s) => ({ value: s, label: s })), match: () => true },
            { id: "escalated", label: "Escalation", options: [{ value: "true", label: "Escalated, unresolved" }], match: () => true },
          ]}
        />
      )}
    </>
  );
}
