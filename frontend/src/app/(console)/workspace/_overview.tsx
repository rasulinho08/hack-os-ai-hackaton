"use client";

/**
 * The overview's second layer, from `/api/owner/insights` and
 * `/api/owner/activity`: what is waiting on the owner, money by month, the
 * path from sign-up to an active organisation, the biggest organisations and
 * a live feed of what just happened.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock, Flag, LifeBuoy, Receipt, ServerCrash } from "lucide-react";
import { Card, CardHeader, ErrorState, Skeleton } from "@/components/ds/primitives";
import { BarSeries, FunnelBars } from "@/components/ds/charts";
import { formatMinor, minorDigits } from "@/lib/superadmin/owner";
import { loadActivity, monthLabel, type AuditEntry, type Insights } from "@/lib/superadmin/directory";
import { AuditList, OrgLink, money, num } from "./_ui";

/* ── Waiting on the owner ──────────────────────────────────────────────── */

export function WaitingOnYou({ waiting }: { waiting: Insights["waiting"] }) {
  const items = [
    { n: waiting.ordersToReview, label: "Orders to review", href: "/workspace/orders?status=pending,paid", icon: Receipt, tone: "warn" },
    { n: waiting.orgsAwaitingApproval, label: "Organisations awaiting approval", href: "/workspace/customers?status=pending_review", icon: Building2, tone: "warn" },
    { n: waiting.reportedMessages, label: "Reported chat messages", href: "/workspace/events?sort=reports&dir=desc", icon: Flag, tone: "danger" },
    { n: waiting.escalatedTickets, label: "Help requests escalated", href: "/workspace/support?escalated=true", icon: LifeBuoy, tone: "danger" },
    { n: waiting.failedJobs, label: "Background jobs failed (7 days)", href: "/workspace/health", icon: ServerCrash, tone: "danger" },
    { n: waiting.overdueInvoices, label: "Invoices overdue", href: "/workspace/orders?unpaid=true", icon: Clock, tone: "warn" },
  ] as const;
  const open = items.filter((i) => i.n > 0).length;
  return (
    <section aria-labelledby="waiting-title" className="mb-6">
      <div className="mb-2.5 flex items-center gap-2">
        {open ? <AlertTriangle size={15} style={{ color: "var(--warn)" }} aria-hidden="true" /> : <CheckCircle2 size={15} style={{ color: "var(--ok)" }} aria-hidden="true" />}
        <h2 id="waiting-title" className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
          {open ? "Waiting on you" : "Nothing is waiting on you"}
        </h2>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {items.map((i) => {
          const Icon = i.icon;
          const live = i.n > 0;
          const color = live ? `var(--${i.tone})` : "var(--ink-3)";
          return (
            <li key={i.label}>
              <Link prefetch={false}
                href={i.href}
                className="group flex min-h-[64px] items-center gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 transition-colors"
                style={{
                  borderColor: live ? color : "var(--line)",
                  background: live ? `var(--${i.tone}-weak)` : "var(--surface)",
                }}
              >
                <Icon size={17} className="shrink-0" style={{ color }} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold leading-tight" style={{ color: live ? "var(--ink)" : "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {num(i.n)}
                  </span>
                  <span className="block text-xs leading-snug" style={{ color: "var(--ink-2)" }}>{i.label}</span>
                </span>
                <ArrowRight size={14} className="shrink-0 opacity-50 transition-opacity group-hover:opacity-100" style={{ color: "var(--ink-3)" }} aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── Revenue by month ──────────────────────────────────────────────────── */

export function RevenueByMonth({ series }: { series: Insights["revenueByMonth"] }) {
  // One currency today; with more, each would get its own chart (never summed across).
  const s = series[0];
  const digits = s ? minorDigits(s.currency) : 2;
  const rows = useMemo(
    () =>
      (s?.months ?? []).map((m) => ({
        label: monthLabel(m.month, true),
        month: m.month,
        paid: m.paidMinor / 10 ** digits,
        pending: m.pendingMinor / 10 ** digits,
        paidMinor: m.paidMinor,
        pendingMinor: m.pendingMinor,
        paidOrders: m.paidOrders,
        pendingOrders: m.pendingOrders,
      })),
    [s, digits],
  );
  if (!s) {
    return (
      <Card>
        <CardHeader title="Revenue by month" />
        <p className="py-10 text-center text-sm" style={{ color: "var(--ink-3)" }}>No orders yet.</p>
      </Card>
    );
  }
  const paid = s.months.reduce((n, m) => n + m.paidMinor, 0);
  const pending = s.months.reduce((n, m) => n + m.pendingMinor, 0);
  const fmt = (v: number | string) => formatMinor(Math.round(Number(v) * 10 ** digits), s.currency);
  return (
    <Card>
      <CardHeader
        title="Revenue by month, last 12 months"
        hint={`${formatMinor(paid, s.currency)} paid · ${formatMinor(pending, s.currency)} placed or approved and not paid yet, by the month it was placed`}
      />
      <div aria-hidden="true">
        <BarSeries data={rows} xKey="label" height={230} format={fmt} bars={[{ key: "paid", name: "Paid", slot: 0 }, { key: "pending", name: "Not paid yet", slot: 1 }]} />
      </div>
      <details className="mt-3 text-xs" style={{ color: "var(--ink-2)" }}>
        <summary className="cursor-pointer select-none" style={{ color: "var(--ink-3)" }}>Show as a table</summary>
        <table className="mt-2 w-full text-xs">
          <caption className="sr-only">Paid and unpaid order value per month</caption>
          <thead>
            <tr>
              <th scope="col" className="py-1 text-left font-medium">Month</th>
              <th scope="col" className="py-1 text-right font-medium">Paid</th>
              <th scope="col" className="py-1 text-right font-medium">Not paid yet</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.month} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="py-1">{monthLabel(r.month)}</td>
                <td className="py-1 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{money(r.paidMinor, s.currency)} · {r.paidOrders}</td>
                <td className="py-1 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{money(r.pendingMinor, s.currency)} · {r.pendingOrders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}

/* ── Funnel ────────────────────────────────────────────────────────────── */

export function Funnel({ steps }: { steps: Insights["funnel"] }) {
  return (
    <Card>
      <CardHeader title="From sign-up to an active organisation" hint="All time. The percentage is the share of the step before." />
      <FunnelBars steps={steps.map((s) => ({ label: s.label, value: s.value }))} />
    </Card>
  );
}

/* ── Top organisations ─────────────────────────────────────────────────── */

export function TopOrganisations({ insights }: { insights: Insights }) {
  const list = (rows: { id: number; name: string; value: string; hint: string }[], empty: string) =>
    rows.length === 0 ? (
      <p className="py-6 text-center text-sm" style={{ color: "var(--ink-3)" }}>{empty}</p>
    ) : (
      <ol className="flex flex-col">
        {rows.map((r, i) => (
          <li key={r.id} className="flex items-center gap-3 border-b py-2 last:border-b-0" style={{ borderColor: "var(--line)" }}>
            <span className="w-4 text-xs" style={{ color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm"><OrgLink id={r.id} name={r.name} /></span>
              <span className="block text-[11px]" style={{ color: "var(--ink-3)" }}>{r.hint}</span>
            </span>
            <span className="text-sm font-medium" style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{r.value}</span>
          </li>
        ))}
      </ol>
    );
  return (
    <Card>
      <CardHeader title="Top organisations" hint="By participants across their events, and by revenue paid." />
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>Participants</p>
          {list(
            insights.topByParticipants.map((r) => ({ id: r.id, name: r.name, value: num(r.participants), hint: `${num(r.events)} event${r.events === 1 ? "" : "s"}` })),
            "No registrations yet.",
          )}
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>Revenue paid</p>
          {list(
            insights.topByRevenue.map((r) => ({ id: r.id, name: r.name, value: money(r.paid_minor, r.currency), hint: `${num(r.orders)} paid order${r.orders === 1 ? "" : "s"}` })),
            "No payments yet.",
          )}
        </div>
      </div>
    </Card>
  );
}

/* ── Live activity ─────────────────────────────────────────────────────── */

const POLL_MS = 20_000;

/**
 * The newest audit rows, refreshed every 20 seconds while the tab is visible.
 * Each poll asks only for what is newer than the top row.
 */
export function LiveActivity() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const newest = useRef<string | number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const got = await loadActivity(newest.current, 15);
          if (cancelled) return;
          setFailed(false);
          if (got.length) {
            const first = newest.current === null;
            newest.current = got[0].id;
            setRows((prev) => [...got, ...(prev ?? [])].slice(0, 15));
            if (!first) setFresh(new Set(got.map((g) => String(g.id))));
          } else {
            setRows((prev) => prev ?? []);
          }
        } catch {
          if (!cancelled) setFailed(true);
        }
      }
      if (!cancelled) timer = window.setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            Live activity
            <span className="relative inline-flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none" style={{ background: "var(--ok)" }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: "var(--ok)" }} />
            </span>
          </span>
        }
        hint="Everything recorded in the audit trail, newest first. Updates every 20 seconds."
        action={<Link prefetch={false} href="/workspace/audit" className="text-xs hover:underline" style={{ color: "var(--ink-3)" }}>Audit trail</Link>}
      />
      {failed && !rows ? (
        <ErrorState title="The activity feed did not load" body="It tries again on its own every 20 seconds." />
      ) : rows === null ? (
        <div className="flex flex-col gap-2" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-6" />)}</div>
      ) : (
        <div aria-live="polite">
          <AuditList rows={rows} empty="Nothing has happened yet." />
          {fresh.size ? <span className="sr-only">{fresh.size} new</span> : null}
        </div>
      )}
    </Card>
  );
}
