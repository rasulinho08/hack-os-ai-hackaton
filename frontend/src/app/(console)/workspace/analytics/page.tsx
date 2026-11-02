"use client";

/**
 * Analytics — platform totals over time, from one request
 * (`/api/owner/analytics`): per month, new accounts, registrations, events,
 * teams and projects; registrations by status; the twelve largest events.
 * This page used to ask four requests per event and add them up here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, ErrorState, Stat, TableSkeleton } from "@/components/ds/primitives";
import { BarSeries, DonutSplit, LineSeries } from "@/components/ds/charts";
import { PageHead } from "../_shell";
import { loadAnalytics, monthLabel, type Analytics } from "@/lib/superadmin/directory";
import { PhaseBadge, hrefFor, num } from "../_ui";

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    loadAnalytics()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Could not load analytics"));
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const monthly = useMemo(() => (data?.monthly ?? []).map((m) => ({ ...m, label: monthLabel(m.month, true) })), [data]);
  const status = useMemo(
    () => (data?.participantStatus ?? []).map((s) => ({ name: s.status[0].toUpperCase() + s.status.slice(1), value: s.n })),
    [data],
  );
  const top = useMemo(
    () => (data?.topEvents ?? []).map((e) => ({ ...e, short: e.name.length > 16 ? `${e.name.slice(0, 15)}…` : e.name })),
    [data],
  );

  if (error && !data) {
    return (
      <>
        <PageHead title="Analytics" />
        <ErrorState title="Could not load analytics" body={error} onRetry={reload} />
      </>
    );
  }

  const tt = data?.totals;
  const perParticipant = tt && tt.participants > 0 ? `${((tt.submissions / tt.participants) * 100).toFixed(1)}%` : "—";

  return (
    <>
      <PageHead title="Analytics" sub="Platform totals over the last twelve months, counted on the server." />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Events" value={tt ? num(tt.events) : "…"} />
        <Stat label="Participants" value={tt ? num(tt.participants) : "…"} />
        <Stat label="Teams" value={tt ? num(tt.teams) : "…"} />
        <Stat label="Projects" value={tt ? num(tt.submissions) : "…"} hint={`${perParticipant} per participant`} />
        <Stat label="Checked in" value={tt ? num(tt.checkins) : "…"} />
        <Stat label="Feedback" value={tt ? num(tt.feedback) : "…"} />
      </div>

      {!data ? (
        <Card className="mt-6" padded={false}>
          <TableSkeleton />
        </Card>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Growth by month" hint="New accounts and event registrations." />
              <LineSeries data={monthly} xKey="label" height={240} lines={[{ key: "accounts", name: "New accounts", slot: 0 }, { key: "registrations", name: "Registrations", slot: 1 }]} />
            </Card>
            <Card>
              <CardHeader title="Activity by month" hint="Events created, teams formed, projects handed in." />
              <BarSeries data={monthly} xKey="label" height={240} bars={[{ key: "events", name: "Events", slot: 0 }, { key: "teams", name: "Teams", slot: 1 }, { key: "submissions", name: "Projects", slot: 2 }]} />
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="The largest events" hint="By participants; teams and projects beside them." />
              <BarSeries data={top} xKey="short" height={280} bars={[{ key: "participants", name: "Participants", slot: 0 }, { key: "teams", name: "Teams", slot: 1 }, { key: "submissions", name: "Projects", slot: 2 }]} />
              <ol className="mt-4 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                {data.topEvents.map((e, i) => (
                  <li key={e.id} className="flex items-center gap-2 border-b py-1.5 text-sm" style={{ borderColor: "var(--line)" }}>
                    <span className="w-5 text-xs" style={{ color: "var(--ink-3)" }}>{i + 1}</span>
                    <Link prefetch={false} href={hrefFor.event(e.id)} className="min-w-0 flex-1 truncate hover:underline" style={{ color: "var(--ink)" }}>{e.name}</Link>
                    <PhaseBadge phase={e.phase} />
                    <span className="w-12 text-right" style={{ fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>{num(e.participants)}</span>
                  </li>
                ))}
              </ol>
            </Card>
            <Card>
              <CardHeader title="Registration status" hint="Everyone, across every event." />
              {status.length ? <DonutSplit data={status} height={200} /> : <p className="py-12 text-center text-sm" style={{ color: "var(--ink-3)" }}>No registrations recorded yet.</p>}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
