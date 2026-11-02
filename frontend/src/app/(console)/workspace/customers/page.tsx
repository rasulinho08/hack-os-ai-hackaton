"use client";

/**
 * Customers — every organisation on the platform.
 *
 * One request per page (`/api/owner/customers`): seats, events,
 * participants, orders, paid revenue, the live plan and the last activity of
 * each organisation are counted on the server over the whole table, searched,
 * filtered and sorted there. This page used to ask for two more requests per
 * organisation, which with a few hundred of them ran into the rate limiter.
 *
 * Two rules the rendering follows:
 *   - A `null` seat limit prints "no limit", never a number: nothing was agreed.
 *   - Opening a row goes to the organisation's own page, where the plan,
 *     modules, members, events, orders and audit trail live.
 */

import Link from "next/link";
import { Badge, ErrorState } from "@/components/ds/primitives";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { PageHead } from "../_shell";
import { PLAN_LABEL } from "@/lib/commerce";
import { CUSTOMER_STATUS, ago, day, type CustomerListRow } from "@/lib/superadmin/directory";
import { useServerTable } from "@/lib/superadmin/useServerTable";
import { CustomerStatusBadge, hrefFor, money, num } from "../_ui";

export default function CustomersPage() {
  const t = useServerTable<CustomerListRow>({
    path: "/api/owner/customers",
    defaultSort: { id: "name", dir: "asc" },
    facetKeys: ["status", "plan", "flags"],
    syncUrl: true,
  });

  const columns: Column<CustomerListRow>[] = [
    {
      id: "name",
      header: "Organisation",
      sortable: true,
      value: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <Link prefetch={false} href={hrefFor.organisation(r.id)} className="block truncate font-medium hover:underline" style={{ color: "var(--ink)" }}>
            {r.name}
          </Link>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>
            {[r.sector, [r.city, r.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || r.billing_email || "—"}
          </p>
        </div>
      ),
    },
    {
      id: "status",
      header: "State",
      sortable: true,
      value: (r) => r.status,
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <CustomerStatusBadge status={r.status} />
          {r.orders_to_review > 0 ? <Badge tone="warn">{r.orders_to_review} to review</Badge> : null}
        </span>
      ),
      width: "170px",
    },
    {
      id: "plan",
      header: "Plan",
      value: (r) => r.plan ?? "",
      cell: (r) =>
        r.plan_exempt ? (
          <Badge tone="neutral">Exempt</Badge>
        ) : r.plan ? (
          <span className="block min-w-0 text-xs" title={r.plan_ends_at ? `Until ${day(r.plan_ends_at)}` : undefined}>
            <span className="block truncate" style={{ color: "var(--ink)" }}>{PLAN_LABEL[r.plan] ?? r.plan}</span>
            <span className="block truncate" style={{ color: "var(--ink-3)" }}>{r.plan_kind === "annual" ? "Annual" : "Per event"}</span>
          </span>
        ) : (
          <span className="text-xs" style={{ color: "var(--ink-3)" }}>No live plan</span>
        ),
      width: "120px",
    },
    {
      id: "seats",
      header: "Seats",
      sortable: true,
      value: (r) => r.seats.used,
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-1.5" style={{ fontVariantNumeric: "tabular-nums" }}>
          <span style={{ color: "var(--ink)" }}>{r.seats.used}</span>
          <span className="whitespace-nowrap" style={{ color: "var(--ink-3)" }}>{r.seats.limit == null ? "· no limit" : `of ${r.seats.limit}`}</span>
          {r.seats.over ? <Badge tone="danger">Over</Badge> : r.seats.pending ? <Badge tone="info">{r.seats.pending} invited</Badge> : null}
        </span>
      ),
      width: "150px",
    },
    {
      id: "events",
      header: "Events",
      sortable: true,
      value: (r) => r.events,
      cell: (r) => (
        <span title={`${r.events_running} running, ${r.events_upcoming} upcoming`}>
          {num(r.events)}
          {r.events_running ? <span className="ml-1 text-xs" style={{ color: "var(--warn)" }}>· {r.events_running} live</span> : null}
        </span>
      ),
      align: "right",
      width: "110px",
    },
    { id: "participants", header: "Participants", sortable: true, value: (r) => r.participants, cell: (r) => num(r.participants), align: "right", width: "110px" },
    {
      id: "revenue",
      header: "Paid",
      sortable: true,
      value: (r) => r.paid_minor,
      cell: (r) => <span style={{ color: r.paid_minor ? "var(--ink)" : "var(--ink-3)" }}>{r.paid_minor ? money(r.paid_minor, r.currency) : "—"}</span>,
      align: "right",
      width: "130px",
    },
    { id: "orders", header: "Orders", sortable: true, value: (r) => r.orders, cell: (r) => num(r.orders), align: "right", width: "80px", optional: true },
    {
      id: "activity",
      header: "Last activity",
      sortable: true,
      value: (r) => r.last_activity ?? "",
      cell: (r) => <span className="text-xs" title={r.last_activity ?? undefined}>{ago(r.last_activity)}</span>,
      width: "120px",
      optional: true,
    },
    { id: "created", header: "Created", sortable: true, value: (r) => r.created_at, cell: (r) => <span className="text-xs">{day(r.created_at)}</span>, width: "110px", optional: true },
  ];

  return (
    <>
      <PageHead
        title="Customers"
        sub={
          t.data
            ? `${t.data.total.toLocaleString("en-US")} organisation${t.data.total === 1 ? "" : "s"}${t.state.q || Object.values(t.state.facets).some((v) => v.length) ? " match" : ""}: who we sell to, what their plan includes, and what they have used.`
            : "Who we sell to, what their plan includes, and what they have used."
        }
      />
      {t.error && !t.data ? (
        <ErrorState title="Could not load the organisations" body={t.error} onRetry={t.reload} />
      ) : (
        <DataTable
          rows={t.rows}
          columns={columns}
          loading={t.loading}
          error={Boolean(t.error && t.data)}
          onRetry={t.reload}
          pageSize={t.pageSize}
          server={t.server}
          getHref={(r) => hrefFor.organisation(r.id)}
          searchPlaceholder="Search name, e-mail, city or #id…"
          emptyTitle="No organisations yet"
          emptyBody="An organisation is created when somebody places the first order for it."
          facets={[
            {
              id: "status",
              label: "State",
              options: Object.entries(CUSTOMER_STATUS).map(([value, [label]]) => ({ value, label })),
              match: () => true,
            },
            {
              id: "plan",
              label: "Plan",
              options: [
                ...Object.entries(PLAN_LABEL).map(([value, label]) => ({ value, label })),
                { value: "exempt", label: "Exempt" },
                { value: "none", label: "No live plan" },
              ],
              match: () => true,
            },
            {
              id: "flags",
              label: "Needs attention",
              options: [
                { value: "toReview", label: "Orders to review" },
                { value: "overSeats", label: "Over their seats" },
              ],
              match: () => true,
            },
          ]}
        />
      )}
    </>
  );
}
