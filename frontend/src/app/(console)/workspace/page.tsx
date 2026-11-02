"use client";

/**
 * Platform overview, from one read: GET /api/owner/overview.
 *
 * The server counts every organisation, order, account and event, so a
 * total no longer depends on dozens of per-event requests all answering —
 * the page this replaced added numbers up in the browser and had to show "—"
 * whenever one of them failed. The event list is capped by the API (it says
 * so with `truncated`); the totals never are.
 *
 * What needs the owner's hand comes first (from /api/owner/insights): orders
 * waiting for review, organisations not yet approved, reported chat messages,
 * escalated help, failed jobs and overdue invoices, each a link to the page
 * that handles it. Then money by month, the funnel from sign-up to an active
 * organisation, the largest organisations and a live activity feed.
 *
 * The event list is a paginated server list (/api/owner/events): every event,
 * not the first 300.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Coins,
  FileText,
  Flag,
  LifeBuoy,
  RefreshCw,
  Receipt,
  Trophy,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorState,
  Stat,
  TableSkeleton,
} from "@/components/ds/primitives";
import { LineSeries } from "@/components/ds/charts";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { PageHead } from "./_shell";
import { Funnel, LiveActivity, RevenueByMonth, TopOrganisations, WaitingOnYou } from "./_overview";
import { hrefFor } from "./_ui";
import { loadInsights, type EventListRow, type Insights } from "@/lib/superadmin/directory";
import { useServerTable } from "@/lib/superadmin/useServerTable";
import { fmt } from "@/lib/superadmin/platform";
import { loadCustomers, type Customer } from "@/lib/superadmin/customers";
import {
  BILLING_FIELD_LABEL,
  PHASES,
  PHASE_LABEL,
  PHASE_TONE,
  dayLabel,
  loadBillingSetting,
  formatMinor,
  loadOverview,
  signupSummary,
  type OwnerOverview,
} from "@/lib/superadmin/owner";

const ORDER_LABEL: Record<string, string> = {
  pending: "awaiting review",
  paid: "paid, awaiting review",
  delivered: "active",
  draft: "draft",
  cancelled: "cancelled",
  refunded: "refunded",
};

const ORG_STATUS_LABEL: Record<string, string> = {
  pending_review: "Under review",
  pending_setup: "Setting up",
  active: "Active",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

const shortDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

function SignupChart({ rows }: { rows: OwnerOverview["signups"] }) {
  const s = useMemo(() => signupSummary(rows), [rows]);
  return (
    <Card>
      <CardHeader
        title="Sign-ups, last 30 days"
        hint={`${s.users.toLocaleString("en-US")} new accounts and ${s.registrations.toLocaleString("en-US")} event registrations${
          s.busiest ? ` · busiest day ${dayLabel(s.busiest.day)} (${s.busiest.registrations} registrations)` : ""
        }`}
      />
      <div aria-hidden="true">
        <LineSeries
          data={s.data}
          xKey="label"
          height={220}
          lines={[
            { key: "users", name: "New accounts", slot: 0 },
            { key: "registrations", name: "Event registrations", slot: 1 },
          ]}
        />
      </div>
      <details className="mt-3 text-xs" style={{ color: "var(--hs-ink-2)" }}>
        <summary className="cursor-pointer select-none" style={{ color: "var(--hs-ink-3)" }}>
          Show as a table
        </summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">New accounts and event registrations per day, last 30 days</caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 text-left font-medium">Day</th>
                <th scope="col" className="py-1 text-right font-medium">New accounts</th>
                <th scope="col" className="py-1 text-right font-medium">Registrations</th>
              </tr>
            </thead>
            <tbody>
              {[...s.data].reverse().map((r) => (
                <tr key={r.day} className="border-t" style={{ borderColor: "var(--hs-line)" }}>
                  <td className="py-1">{r.label}</td>
                  <td className="py-1 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{r.users}</td>
                  <td className="py-1 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{r.registrations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function PhaseCard({ byPhase, total }: { byPhase: OwnerOverview["events"]["byPhase"]; total: number }) {
  return (
    <Card>
      <CardHeader title="Events by phase" hint={`${total.toLocaleString("en-US")} events in all`} />
      <ul className="space-y-2.5">
        {PHASES.map((p) => {
          const n = byPhase[p] || 0;
          const pct = total ? Math.round((n / total) * 100) : 0;
          return (
            <li key={p}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <Badge tone={PHASE_TONE[p]}>{PHASE_LABEL[p]}</Badge>
                <span style={{ color: "var(--hs-ink)", fontVariantNumeric: "tabular-nums" }}>
                  {n.toLocaleString("en-US")}
                  <span className="ml-2" style={{ color: "var(--hs-ink-3)" }}>{pct}%</span>
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--hs-tint)" }} aria-hidden="true">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--hs-ink-3)" }} />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const num = (v: number) => (
  <span style={{ fontVariantNumeric: "tabular-nums" }}>{v.toLocaleString("en-US")}</span>
);

const EVENT_COLUMNS: Column<EventListRow>[] = [
  {
    id: "name",
    header: "Event",
    value: (r) => r.name,
    cell: (r) => (
      <div className="min-w-0">
        <Link prefetch={false} href={hrefFor.event(r.id)} className="block truncate font-medium hover:underline" style={{ color: "var(--hs-ink)" }}>{r.name}</Link>
        <p className="truncate text-xs" style={{ color: "var(--hs-ink-3)" }}>
          {r.event_code || `#${r.id}`} · {r.customer_name || "No organisation"}
        </p>
      </div>
    ),
    sortable: true,
  },
  {
    id: "phase",
    header: "Phase",
    value: (r) => PHASES.indexOf(r.phase),
    cell: (r) => <Badge tone={PHASE_TONE[r.phase]}>{PHASE_LABEL[r.phase]}</Badge>,
    sortable: true,
  },
  {
    id: "start",
    header: "Dates",
    value: (r) => (r.start_date ? new Date(r.start_date).getTime() : 0),
    cell: (r) => (
      <span className="whitespace-nowrap text-xs" style={{ color: "var(--hs-ink-2)" }}>
        {shortDate(r.start_date)} – {shortDate(r.end_date)}
      </span>
    ),
    sortable: true,
    optional: true,
  },
  {
    id: "participants",
    header: "Participants",
    align: "right",
    value: (r) => r.participants,
    cell: (r) => (
      <div className="text-right">
        {num(r.participants)}
        <p className="text-[11px]" style={{ color: "var(--hs-ink-3)" }} title="approved / pending / waitlisted">
          {r.approved} · {r.pending} · {r.waitlisted}
        </p>
      </div>
    ),
    sortable: true,
  },
  { id: "teams", header: "Teams", align: "right", value: (r) => r.teams, cell: (r) => num(r.teams), sortable: true },
  { id: "submissions", header: "Projects", align: "right", value: (r) => r.submissions, cell: (r) => num(r.submissions), sortable: true },
  {
    id: "tickets",
    header: "Open help",
    align: "right",
    value: (r) => r.open_tickets,
    cell: (r) => (
      <div className="text-right">
        {num(r.open_tickets)}
        {r.escalated > 0 ? (
          <p className="text-[11px]" style={{ color: "var(--hs-danger)" }}>{r.escalated} escalated</p>
        ) : null}
      </div>
    ),
    sortable: true,
  },
  {
    id: "reports",
    header: "Reports",
    align: "right",
    value: (r) => r.open_reports,
    cell: (r) =>
      r.open_reports > 0 ? <Badge tone="danger">{r.open_reports}</Badge> : <span style={{ color: "var(--hs-ink-3)" }}>0</span>,
    sortable: true,
  },
];

/** The overview's events: every one, paginated on the server, one organisation's when scoped. */
function OverviewEvents({ customerId, scoped }: { customerId: number | null; scoped: boolean }) {
  const t = useServerTable<EventListRow>({
    path: "/api/owner/events",
    pageSize: 15,
    defaultSort: { id: "phase", dir: "asc" },
    facetKeys: ["phase"],
    filters: { customerId },
  });
  if (t.error && !t.data) return <ErrorState title="Could not load the events" body={t.error} onRetry={t.reload} />;
  return (
    <DataTable
      rows={t.rows}
      columns={EVENT_COLUMNS}
      loading={t.loading}
      pageSize={t.pageSize}
      server={t.server}
      getHref={(r) => hrefFor.event(r.id)}
      searchPlaceholder="Search events, codes or organisations…"
      emptyTitle={scoped ? "This organisation has no events yet" : "There are no events on the platform yet"}
      facets={[{ id: "phase", label: "Phase", options: PHASES.map((p) => ({ value: p, label: PHASE_LABEL[p] })), match: () => true }]}
    />
  );
}

export default function OwnerOverview() {
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const [data, setData] = useState<OwnerOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsFailed, setInsightsFailed] = useState(false);
  // Invoices cannot be paid until the seller's legal and bank details are in.
  const [billingMissing, setBillingMissing] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadBillingSetting()
      .then((b) => { if (!cancelled) setBillingMissing(b.ready ? null : b.missing); })
      .catch(() => { /* the settings page says what is wrong */ });
    return () => { cancelled = true; };
  }, [nonce]);

  const fetchInsights = useCallback(() => {
    loadInsights()
      .then((i) => {
        setInsights(i);
        setInsightsFailed(false);
      })
      .catch(() => setInsightsFailed(true));
  }, []);
  useEffect(() => {
    fetchInsights();
  }, [fetchInsights, nonce]);

  useEffect(() => {
    let cancelled = false;
    loadOverview(customerId, { list: false })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load the overview");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, nonce]);

  useEffect(() => {
    let cancelled = false;
    loadCustomers()
      .then((rows) => {
        if (!cancelled) setCustomers([...rows].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        /* the filter stays at "All organisations" */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = () => {
    setLoading(true);
    setNonce((n) => n + 1);
  };

  const pickCustomer = (value: string) => {
    setLoading(true);
    setCustomerId(value ? Number(value) : null);
  };

  const selectStyle: React.CSSProperties = { borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" };
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="overview-org">Organisation</label>
      <select
        id="overview-org"
        value={customerId ?? ""}
        onChange={(e) => pickCustomer(e.target.value)}
        className="min-h-9 max-w-[16rem] rounded-[var(--radius-sm)] border px-3 text-sm outline-none"
        style={selectStyle}
      >
        <option value="">All organisations</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={reload} disabled={loading}>
        Refresh
      </Button>
    </div>
  );

  const scopedCustomer = customerId ? customers.find((c) => c.id === customerId) ?? null : null;
  const scope = customerId ? scopedCustomer?.name ?? `organisation #${customerId}` : null;

  if (error && !data) {
    return (
      <>
        <PageHead title="Overview" actions={actions} />
        <ErrorState title="Could not load the overview" body={error} onRetry={reload} />
      </>
    );
  }

  const d = data;
  const orderHint = d
    ? Object.entries(d.orders)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => `${n.toLocaleString("en-US")} ${ORDER_LABEL[s] ?? s}`)
        .join(" · ") || "None yet"
    : undefined;
  const orderTotal = d ? Object.values(d.orders).reduce((a, b) => a + b, 0) : 0;
  // One organisation: its status, as the server counted it (archived ones are not counted).
  const orgStatusKey = d ? Object.entries(d.customers).find(([, n]) => n > 0)?.[0] : undefined;
  const orgStatus = d ? (orgStatusKey ? ORG_STATUS_LABEL[orgStatusKey] ?? orgStatusKey : "Archived") : "—";
  const customerTotal = d ? Object.values(d.customers).reduce((a, b) => a + b, 0) : 0;
  const revenue = d?.revenue ?? [];

  return (
    <>
      <PageHead
        title="Overview"
        sub={scope ? `${scope}: its orders, people and events.` : "Every organisation, order and event on the platform."}
        actions={actions}
      />

      {!scope && billingMissing ? (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-4 py-3 text-sm" style={{ borderColor: "var(--warn)", background: "var(--warn-weak)", color: "var(--ink)" }}>
          <p className="min-w-0">
            <strong>Invoices cannot be paid yet.</strong> Your seller and bank details are incomplete
            {billingMissing.length ? ` (missing: ${billingMissing.map((m) => BILLING_FIELD_LABEL[m] ?? m).join(", ")})` : ""}, so every invoice says the bank details follow by e-mail.
          </p>
          <Link prefetch={false} href="/workspace/settings#billing" className="inline-flex min-h-9 shrink-0 items-center rounded-[var(--radius-sm)] px-3 text-[13px] font-medium" style={{ background: "var(--accent-solid)", color: "#fff" }}>
            Add billing details
          </Link>
        </div>
      ) : null}
      {!scope && insights ? <WaitingOnYou waiting={insights.waiting} /> : null}
      {!scope && insightsFailed ? (
        <p role="status" className="mb-4 text-sm" style={{ color: "var(--hs-warn)" }}>
          What is waiting on you could not be loaded. <button type="button" className="underline" onClick={fetchInsights}>Try again</button>
        </p>
      ) : null}
      {error && d ? (
        <p role="status" className="mb-4 text-sm" style={{ color: "var(--hs-danger)" }}>
          The last refresh failed ({error}); showing what was loaded before.
        </p>
      ) : null}

      {scope ? (
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.09em]" style={{ color: "var(--hs-ink-3)" }}>
          {scope}&rsquo;s own figures
        </h2>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {scope ? (
          <Stat
            label="Organisation"
            value={loading && !d ? "…" : orgStatus}
            hint={scopedCustomer?.plan_exempt ? "From before plans: every module" : "Its status on the platform"}
            icon={<Building2 size={15} />}
          />
        ) : (
          <Stat
            label="Organisations"
            value={loading && !d ? "…" : fmt(d?.customers.active ?? 0)}
            hint={d ? `active · ${customerTotal.toLocaleString("en-US")} in all, ${(d.customers.pending_review || 0).toLocaleString("en-US")} awaiting approval` : undefined}
            icon={<Building2 size={15} />}
          />
        )}
        <Stat
          label={scope ? "Its orders" : "Orders"}
          value={loading && !d ? "…" : fmt(orderTotal)}
          hint={orderHint}
          icon={<Receipt size={15} />}
        />
        <Stat
          label={scope ? "Paid by it" : "Paid revenue"}
          value={
            loading && !d ? "…" : revenue.length === 0 ? "—" : (
              <span className="flex flex-col gap-0.5 text-xl sm:text-2xl">
                {revenue.map((r) => (
                  <span key={r.currency}>{formatMinor(r.paidMinor, r.currency)}</span>
                ))}
              </span>
            )
          }
          hint={revenue.length ? `${revenue.reduce((n, r) => n + r.orders, 0).toLocaleString("en-US")} paid orders, per currency` : "No payment recorded yet"}
          icon={<Coins size={15} />}
        />
        <Stat
          label={scope ? "Its people" : "Accounts"}
          value={loading && !d ? "…" : fmt(d?.users.total)}
          hint={
            d
              ? `${scope ? "Members and everyone on its events · " : ""}+${d.users.last7.toLocaleString("en-US")} in 7 days · ${d.users.unverified.toLocaleString("en-US")} e-mail not confirmed`
              : undefined
          }
          icon={<UserPlus size={15} />}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Events"
          value={loading && !d ? "…" : fmt(d?.events.total)}
          hint={d ? `${d.events.byPhase.running || 0} running · ${d.events.byPhase.upcoming || 0} upcoming` : undefined}
          icon={<Trophy size={15} />}
        />
        <Stat label="Participants" value={loading && !d ? "…" : fmt(d?.totals.participants)} hint="Registered, all statuses" icon={<Users size={15} />} />
        <Stat label="Teams" value={loading && !d ? "…" : fmt(d?.totals.teams)} icon={<UsersRound size={15} />} />
        <Stat label="Projects" value={loading && !d ? "…" : fmt(d?.totals.submissions)} hint="Handed in" icon={<FileText size={15} />} />
        <Stat label="Open help" value={loading && !d ? "…" : fmt(d?.totals.openTickets)} hint="Waiting for a mentor" icon={<LifeBuoy size={15} />} />
        <Stat label="Reported" value={loading && !d ? "…" : fmt(d?.totals.openReports)} hint="Chat messages to review" icon={<Flag size={15} />} />
      </div>

      {!scope && insights ? (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <RevenueByMonth series={insights.revenueByMonth} />
          </div>
          <Funnel steps={insights.funnel} />
        </div>
      ) : null}

      {d ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <SignupChart rows={d.signups} />
          </div>
          <PhaseCard byPhase={d.events.byPhase} total={d.events.total} />
        </div>
      ) : null}

      {!scope ? (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {insights ? <TopOrganisations insights={insights} /> : <Card padded={false}><TableSkeleton rows={5} cols={2} /></Card>}
          <LiveActivity />
        </div>
      ) : null}

      <section id="events" className="mt-6 scroll-mt-20" aria-labelledby="events-title">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="events-title" className="text-sm font-semibold" style={{ color: "var(--hs-ink)" }}>Events</h2>
          <p className="text-xs" style={{ color: "var(--hs-ink-3)" }}>
            Running first, then upcoming, drafts, finished and archived. Every event, a page at a time.
          </p>
        </div>
        <OverviewEvents customerId={customerId} scoped={Boolean(scope)} />
      </section>
    </>
  );
}
