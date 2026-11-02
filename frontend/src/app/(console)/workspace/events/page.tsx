"use client";

/**
 * Events — every event on the platform, whoever created it, and the way into
 * editing any of them.
 *
 * One request per page (`/api/owner/events`): counts, phase, organisation,
 * plan and directory state come from the server, searched, filtered and
 * sorted there. Ready-made views (live and listed, pinned, test-looking,
 * archived…) are sets of the same filters, so a view can be refined and
 * shared by its address.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Star } from "lucide-react";
import { Badge, ErrorState } from "@/components/ds/primitives";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { PageHead } from "../_shell";
import { PHASES, PHASE_LABEL } from "@/lib/superadmin/owner";
import { PLAN_LABEL } from "@/lib/commerce";
import { ago, loadPage, type CustomerListRow, type EventListRow } from "@/lib/superadmin/directory";
import { EVENT_VIEWS, dateRange, inDirectory, viewOf, type EventDirectoryColumns } from "@/lib/superadmin/ownerEvents";
import { useServerTable } from "@/lib/superadmin/useServerTable";
import { OrgLink, PhaseBadge, hrefFor, num } from "../_ui";
import { SelectInput } from "../_form";

type Row = EventListRow & EventDirectoryColumns;

const FACETS = ["phase", "visibility", "listed", "featured", "archived", "test", "customerId", "unassigned"];

/** The directory column: listed, pinned, or why not, in one badge. */
function DirectoryBadge({ r }: { r: Row }) {
  if (r.is_test) return <Badge tone="warn">Test</Badge>;
  if (!inDirectory(r)) {
    const why = !r.is_published ? "Not published" : r.visibility !== "public" ? (r.visibility === "invite" ? "Invite only" : "Private") : !r.directory_listed ? "Unlisted" : "Hidden";
    return <Badge tone="neutral">{why}</Badge>;
  }
  return r.directory_featured
    ? <Badge tone="brand"><Star size={11} aria-hidden="true" fill="currentColor" /> Pinned{r.directory_featured_rank ? ` #${r.directory_featured_rank}` : ""}</Badge>
    : <Badge tone="ok" dot>Listed</Badge>;
}

/** Organisations to filter by: the 100 with the most events, by name. */
function OrgFilter({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [orgs, setOrgs] = useState<CustomerListRow[] | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    loadPage<CustomerListRow>("/api/owner/customers", { sort: "events", dir: "desc", pageSize: 100 }, ctl.signal)
      .then((d) => setOrgs([...d.rows].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setOrgs([]));
    return () => ctl.abort();
  }, []);
  return (
    <label className="min-w-0 sm:w-56">
      <span className="sr-only">Organisation</span>
      <SelectInput
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-h-9 text-[13px]"
        disabled={orgs === null}
      >
        <option value="">All organisations</option>
        {(orgs ?? []).map((o) => (
          <option key={o.id} value={String(o.id)}>{o.name} ({num(o.events)})</option>
        ))}
      </SelectInput>
    </label>
  );
}

export default function EventsPage() {
  const t = useServerTable<Row>({
    path: "/api/owner/events",
    defaultSort: { id: "phase", dir: "asc" },
    facetKeys: FACETS,
    syncUrl: true,
  });
  const facets = t.state.facets;
  const view = viewOf(facets);
  const customerId = facets.customerId?.[0] ?? null;

  const columns: Column<Row>[] = [
    {
      id: "name",
      header: "Event",
      sortable: true,
      value: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <Link prefetch={false} href={hrefFor.event(r.id)} className="block truncate font-medium hover:underline" style={{ color: "var(--ink)" }}>
            {r.name}
          </Link>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: "var(--ink-3)" }}>
            <span className="truncate" style={{ fontFamily: "var(--font-mono-ui)" }}>{r.slug ? `/e/${r.slug}` : r.event_code}</span>
            {r.test_looking && !r.is_test ? <Badge tone="neutral">Looks like a test</Badge> : null}
          </p>
        </div>
      ),
    },
    {
      id: "customer",
      header: "Organisation",
      sortable: true,
      value: (r) => r.customer_name ?? "",
      cell: (r) => (r.customer_id ? <span className="block truncate text-xs"><OrgLink id={r.customer_id} name={r.customer_name} /></span> : <Badge tone="warn">Unassigned</Badge>),
      width: "180px",
    },
    { id: "start", header: "Dates", sortable: true, value: (r) => r.start_date ?? "", cell: (r) => <span className="whitespace-nowrap text-xs">{dateRange(r.start_date, r.end_date, r.timezone)}</span>, width: "150px" },
    { id: "phase", header: "Phase", sortable: true, value: (r) => r.phase, cell: (r) => <PhaseBadge phase={r.phase} />, width: "105px" },
    {
      id: "participants",
      header: "People",
      sortable: true,
      value: (r) => r.participants,
      cell: (r) => (
        <span title={`${r.approved} approved · ${r.pending} pending · ${r.waitlisted} waitlisted`}>
          {num(r.participants)}
          {r.participant_limit != null ? <span className="text-xs" style={{ color: "var(--ink-3)" }}> / {num(r.participant_limit)}</span> : null}
        </span>
      ),
      align: "right",
      width: "95px",
    },
    { id: "plan", header: "Plan", sortable: true, value: (r) => r.plan ?? "", cell: (r) => (r.plan ? <span className="text-xs">{PLAN_LABEL[r.plan] ?? r.plan}</span> : <span className="text-xs" style={{ color: "var(--ink-3)" }}>—</span>), width: "110px" },
    { id: "featured", header: "Directory", sortable: true, value: (r) => (r.directory_featured ? 0 : 1), cell: (r) => <DirectoryBadge r={r} />, width: "130px" },
    { id: "teams", header: "Teams", sortable: true, value: (r) => r.teams, cell: (r) => num(r.teams), align: "right", width: "80px", optional: true },
    { id: "submissions", header: "Projects", sortable: true, value: (r) => r.submissions, cell: (r) => num(r.submissions), align: "right", width: "90px", optional: true },
    {
      id: "reports",
      header: "Reports",
      sortable: true,
      value: (r) => r.open_reports,
      cell: (r) => (r.open_reports ? <Badge tone="danger">{r.open_reports}</Badge> : <span style={{ color: "var(--ink-3)" }}>0</span>),
      align: "right",
      width: "90px",
      optional: true,
    },
    { id: "updated", header: "Changed", sortable: true, value: (r) => r.updated_at ?? "", cell: (r) => <span className="text-xs">{ago(r.updated_at)}</span>, width: "110px", optional: true },
    {
      id: "edit",
      header: "",
      value: () => "",
      cell: (r) => (
        <Link
          prefetch={false}
          href={`${hrefFor.event(r.id)}/edit`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--tint)]"
          style={{ color: "var(--ink-2)" }}
          aria-label={`Edit the page of ${r.name}`}
          title="Edit the page"
        >
          <Pencil size={14} aria-hidden="true" />
        </Link>
      ),
      width: "52px",
      hideOnCard: true,
    },
  ];

  const filtered = Boolean(t.state.q) || Object.values(facets).some((v) => v.length);

  return (
    <>
      <PageHead
        title="Events"
        sub={t.data
          ? `${t.data.total.toLocaleString("en-US")} event${t.data.total === 1 ? "" : "s"}${filtered ? " match" : " on the platform, whoever created them"}. Open one to fix its page, its place in the directory or its status.`
          : "Every event on the platform, whoever created it."}
      />

      <div className="-mt-2 mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Views">
        {EVENT_VIEWS.map((v) => {
          const on = view === v.id;
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={on}
              onClick={() => t.server.onFacets?.(customerId ? { ...v.facets, customerId: [customerId] } : v.facets)}
              className="min-h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors"
              style={{
                borderColor: on ? "var(--ink)" : "var(--line-strong)",
                background: on ? "var(--ink)" : "var(--surface)",
                color: on ? "var(--surface-sunken)" : "var(--ink-2)",
              }}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      {t.error && !t.data ? (
        <ErrorState title="Could not load the events" body={t.error} onRetry={t.reload} />
      ) : (
        <DataTable
          rows={t.rows}
          columns={columns}
          loading={t.loading}
          pageSize={t.pageSize}
          server={t.server}
          getHref={(r) => hrefFor.event(r.id)}
          searchPlaceholder="Search name, address, code or organisation…"
          emptyTitle="No events yet"
          emptyBody="Events created by any organiser will appear here."
          toolbarExtra={<OrgFilter value={customerId} onChange={(id) => t.setFacet("customerId", id ? [id] : [])} />}
          facets={[
            { id: "phase", label: "Phase", options: PHASES.map((p) => ({ value: p, label: PHASE_LABEL[p] })), match: () => true },
            { id: "visibility", label: "Who can open it", options: [{ value: "public", label: "Public" }, { value: "private", label: "Link only" }, { value: "invite", label: "Invite only" }], match: () => true },
            { id: "listed", label: "Directory switch", options: [{ value: "yes", label: "On" }, { value: "no", label: "Off" }], match: () => true },
            { id: "featured", label: "Pinned", options: [{ value: "yes", label: "Pinned" }, { value: "no", label: "Not pinned" }], match: () => true },
            { id: "archived", label: "Archive", options: [{ value: "hide", label: "Hide archived" }, { value: "only", label: "Only archived" }], match: () => true },
            { id: "test", label: "Tests", options: [{ value: "marked", label: "Marked as test" }, { value: "looks", label: "Looks like a test" }, { value: "clean", label: "Neither" }], match: () => true },
            { id: "unassigned", label: "Organisation", options: [{ value: "true", label: "No organisation" }], match: () => true },
          ]}
        />
      )}
    </>
  );
}
