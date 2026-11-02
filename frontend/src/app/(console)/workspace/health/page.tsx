"use client";

/**
 * System health, from GET /api/owner/health: this API instance, its
 * database, the background worker and the services it talks to.
 *
 * Request counts and timings are this instance's own, kept in memory for an
 * hour (no paths, no ids): a restart starts them afresh, and with several
 * instances each answers for itself. Long polls of the chat are left out of
 * the timings — they wait on purpose.
 *
 * Refreshes itself every 30 seconds; pause it to read a moment at leisure.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Database,
  Pause,
  Play,
  Plug,
  RefreshCw,
  Server,
  Timer,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, ErrorState, Stat, TableSkeleton } from "@/components/ds/primitives";
import { LineSeries } from "@/components/ds/charts";
import { PageHead } from "../_shell";
import {
  ERROR_RATE_WARN,
  JOB_LAG_WARN_S,
  formatDuration,
  healthVerdict,
  loadHealth,
  requestSeries,
  type OwnerHealth,
} from "@/lib/superadmin/owner";

const REFRESH_MS = 30_000;

const time = (iso: string | null | undefined, withDate = false) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return withDate
    ? d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t py-2 first:border-t-0 first:pt-0" style={{ borderColor: "var(--hs-line)" }}>
      <dt className="text-xs" style={{ color: "var(--hs-ink-3)" }}>{label}</dt>
      <dd className="min-w-0 text-right text-sm" style={{ color: "var(--hs-ink)", fontVariantNumeric: "tabular-nums" }}>
        {children}
      </dd>
    </div>
  );
}

const yes = (on: boolean, onLabel = "Configured", offLabel = "Not configured") =>
  on ? <Badge tone="ok" dot>{onLabel}</Badge> : <Badge tone="warn" dot>{offLabel}</Badge>;

function Verdict({ health }: { health: OwnerHealth }) {
  const v = healthVerdict(health);
  const look = {
    ok: { fg: "var(--hs-ok)", bg: "var(--hs-ok-weak)", Icon: CheckCircle2, title: "Everything answers normally" },
    warn: { fg: "var(--hs-warn)", bg: "var(--hs-warn-weak)", Icon: AlertTriangle, title: "Working, with something to look at" },
    danger: { fg: "var(--hs-danger)", bg: "var(--hs-danger-weak)", Icon: AlertOctagon, title: "Something is down" },
  }[v.tone];
  const Icon = look.Icon;
  return (
    <section
      role={v.tone === "danger" ? "alert" : "status"}
      className="mb-6 flex items-start gap-3 rounded-[var(--radius-sm)] border px-4 py-3"
      style={{ borderColor: look.fg, background: look.bg }}
    >
      <Icon size={18} className="mt-0.5 shrink-0" style={{ color: look.fg }} aria-hidden="true" />
      <div className="min-w-0 text-sm" style={{ color: "var(--hs-ink)" }}>
        <p className="font-semibold">{look.title}</p>
        {v.reasons.length ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-4" style={{ color: "var(--hs-ink-2)" }}>
            {v.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function RequestsCard({ r }: { r: OwnerHealth["requests"] }) {
  const series = useMemo(() => requestSeries(r.series), [r.series]);
  const lastHour = series.reduce((n, p) => n + p.requests, 0);
  const ms = (v: number | null) => (v == null ? "—" : `${v} ms`);
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title={`Requests, last ${r.windowMinutes} minutes`}
        hint={`Counted by this instance since ${time(r.since, true)} · ${lastHour.toLocaleString("en-US")} in the last hour`}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Requests", r.requests.toLocaleString("en-US")],
          ["Server errors", r.serverErrors.toLocaleString("en-US")],
          ["Client errors", r.clientErrors.toLocaleString("en-US")],
          ["Error rate", `${r.errorRate}%`],
          ["Average", ms(r.avgMs)],
          ["p95 · max", `${ms(r.p95Ms)} · ${ms(r.maxMs)}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-sm)] px-3 py-2" style={{ background: "var(--hs-raised)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: "var(--hs-ink-3)" }}>{label}</p>
            <p
              className="mt-0.5 text-sm font-semibold"
              style={{
                color: label === "Error rate" && r.errorRate > ERROR_RATE_WARN ? "var(--hs-danger)" : "var(--hs-ink)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {value}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs" style={{ color: "var(--hs-ink-3)" }}>Requests per minute, last 60 minutes</p>
      <div aria-hidden="true">
        <LineSeries
          data={series}
          xKey="label"
          height={200}
          lines={[
            { key: "requests", name: "Requests", slot: 0 },
            { key: "errors", name: "Server errors", slot: 1 },
          ]}
        />
      </div>
      <details className="mt-3 text-xs" style={{ color: "var(--hs-ink-2)" }}>
        <summary className="cursor-pointer select-none" style={{ color: "var(--hs-ink-3)" }}>Show as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Requests and server errors per minute, last 60 minutes</caption>
            <thead>
              <tr>
                <th scope="col" className="py-1 text-left font-medium">Minute</th>
                <th scope="col" className="py-1 text-right font-medium">Requests</th>
                <th scope="col" className="py-1 text-right font-medium">Server errors</th>
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((p, i) => (
                <tr key={`${p.label}-${i}`} className="border-t" style={{ borderColor: "var(--hs-line)" }}>
                  <td className="py-1">{p.label}</td>
                  <td className="py-1 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{p.requests}</td>
                  <td className="py-1 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>{p.errors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}

function JobsCard({ jobs }: { jobs: OwnerHealth["jobs"] }) {
  if (!jobs) {
    return (
      <Card>
        <CardHeader title="Background jobs" hint="Not read: the database did not answer." />
      </Card>
    );
  }
  const statuses = ["queued", "running", "retry", "done", "failed", "cancelled"];
  const lagging = jobs.lagSeconds > JOB_LAG_WARN_S;
  return (
    <Card>
      <CardHeader title="Background jobs" hint="Announcements, e-mail and Telegram deliveries, certificates, checks — last 7 days" />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {statuses.map((s) => (
          <Badge key={s} tone={s === "failed" && (jobs.counts[s] || 0) > 0 ? "danger" : s === "retry" && (jobs.counts[s] || 0) > 0 ? "warn" : "neutral"}>
            {s} {(jobs.counts[s] || 0).toLocaleString("en-US")}
          </Badge>
        ))}
      </div>
      <dl>
        <Row label="Due now">{jobs.due.toLocaleString("en-US")}</Row>
        <Row label="Oldest due job waiting">
          <span style={{ color: lagging ? "var(--hs-danger)" : undefined }}>{formatDuration(jobs.lagSeconds)}</span>
        </Row>
        <Row label="Worker on this instance">
          {jobs.worker.disabled ? <Badge tone="warn" dot>Switched off</Badge> : `Every ${formatDuration(jobs.worker.intervalMs / 1000)}`}
        </Row>
      </dl>
      {jobs.recentFailures.length ? (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium" style={{ color: "var(--hs-ink-2)" }}>Recent failures</p>
          <ul className="space-y-2">
            {jobs.recentFailures.map((f) => (
              <li key={f.id} className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs" style={{ borderColor: "var(--hs-line)" }}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium" style={{ color: "var(--hs-ink)", fontFamily: "var(--font-mono-ui)" }}>
                    {f.type} <span style={{ color: "var(--hs-ink-3)" }}>#{f.id}</span>
                  </span>
                  <span style={{ color: "var(--hs-ink-3)" }}>
                    {f.attempts} attempt{f.attempts === 1 ? "" : "s"} · {time(f.finished_at, true)}
                  </span>
                </div>
                {f.last_error ? (
                  <p className="mt-1 break-words" style={{ color: "var(--hs-danger)" }} title={f.last_error}>
                    {f.last_error.length > 200 ? `${f.last_error.slice(0, 199)}…` : f.last_error}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-xs" style={{ color: "var(--hs-ink-3)" }}>No job has failed.</p>
      )}
    </Card>
  );
}

export default function HealthPage() {
  const [health, setHealth] = useState<OwnerHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [paused, setPaused] = useState(false);

  const read = useCallback(() => {
    setBusy(true);
    loadHealth()
      .then((h) => {
        setHealth(h);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not read the health of the API"))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadHealth()
      .then((h) => {
        if (cancelled) return;
        setHealth(h);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not read the health of the API");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") read();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [paused, read]);

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs" style={{ color: "var(--hs-ink-3)" }} aria-live="polite">
        {health ? `Checked ${time(health.checkedAt)}` : ""}
        {!paused ? " · every 30 s" : " · paused"}
      </span>
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={paused}
        icon={paused ? <Play size={14} /> : <Pause size={14} />}
        onClick={() => setPaused((p) => !p)}
      >
        {paused ? "Resume" : "Pause"}
      </Button>
      <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={read} disabled={busy}>
        Refresh now
      </Button>
    </div>
  );

  if (!health) {
    return (
      <>
        <PageHead title="System health" sub="This API instance, its database and the services it talks to." actions={actions} />
        {error ? (
          <ErrorState title="Could not read the health of the API" body={error} onRetry={read} />
        ) : (
          <Card padded={false}>
            <TableSkeleton rows={5} cols={3} />
          </Card>
        )}
      </>
    );
  }

  const db = health.database;
  const i = health.integrations;
  return (
    <>
      <PageHead title="System health" sub="This API instance, its database and the services it talks to." actions={actions} />
      {error ? (
        <p role="status" className="mb-4 text-sm" style={{ color: "var(--hs-danger)" }}>
          The last check failed ({error}); showing the one before.
        </p>
      ) : null}
      <Verdict health={health} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Database"
          value={db.ok ? `${db.latencyMs} ms` : "Down"}
          hint={db.ok ? "Round trip of SELECT 1" : db.error || "No answer"}
          icon={<Database size={15} />}
        />
        <Stat label="Uptime" value={formatDuration(health.process.uptimeS)} hint={`${health.environment} · ${health.process.node}`} icon={<Server size={15} />} />
        <Stat
          label="Job queue lag"
          value={health.jobs ? formatDuration(health.jobs.lagSeconds) : "—"}
          hint={health.jobs ? `${health.jobs.due.toLocaleString("en-US")} due now` : "Not read"}
          icon={<Timer size={15} />}
        />
        <Stat
          label="Error rate"
          value={`${health.requests.errorRate}%`}
          hint={`${health.requests.requests.toLocaleString("en-US")} requests in ${health.requests.windowMinutes} min`}
          icon={<Activity size={15} />}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Database" hint="PostgreSQL, as this instance sees it" />
          <dl>
            <Row label="Status">{db.ok ? <Badge tone="ok" dot>Answers</Badge> : <Badge tone="danger" dot>Down</Badge>}</Row>
            {db.error ? <Row label="Error"><span className="break-words" style={{ color: "var(--hs-danger)" }}>{db.error}</span></Row> : null}
            <Row label="Latency">{db.latencyMs} ms</Row>
            <Row label="Connections">
              {db.pool.total} open · {db.pool.idle} idle
              {db.pool.waiting > 0 ? <span style={{ color: "var(--hs-danger)" }}> · {db.pool.waiting} waiting</span> : " · none waiting"}
            </Row>
            <Row label="Last migration">
              {db.migration ? (
                <span>
                  <span style={{ fontFamily: "var(--font-mono-ui)" }}>{db.migration.version}</span> {db.migration.name.replace(/\.sql$/, "")}
                  <span className="block text-xs" style={{ color: "var(--hs-ink-3)" }}>{time(db.migration.applied_at, true)}</span>
                </span>
              ) : "—"}
            </Row>
          </dl>
        </Card>

        <Card>
          <CardHeader title="API process" hint="The instance that answered this page" />
          <dl>
            <Row label="Version">
              {health.version ? <span style={{ fontFamily: "var(--font-mono-ui)" }} title={health.version}>{health.version.slice(0, 7)}</span> : <span style={{ color: "var(--hs-ink-3)" }}>Not reported</span>}
            </Row>
            <Row label="Environment">{health.environment}</Row>
            <Row label="Node.js">{health.process.node}</Row>
            <Row label="Uptime">{formatDuration(health.process.uptimeS)}</Row>
            <Row label="Memory">{health.process.rssMb} MB resident · {health.process.heapUsedMb} MB heap</Row>
          </dl>
        </Card>

        <JobsCard jobs={health.jobs} />

        <Card>
          <CardHeader title="Integrations" hint="What this instance can reach, by its configuration" />
          <dl>
            <Row label="E-mail">
              {i.mail.configured ? (
                <span>
                  <Badge tone="ok" dot>{i.mail.provider || "Configured"}</Badge>
                </span>
              ) : (
                <span className="flex flex-col items-end gap-1">
                  <Badge tone="warn" dot>Not configured</Badge>
                  {i.mail.problem ? <span className="text-xs" style={{ color: "var(--hs-ink-3)" }}>{i.mail.problem}</span> : null}
                </span>
              )}
            </Row>
            <Row label="Telegram bot">
              <span className="flex flex-wrap justify-end gap-1">
                {yes(i.telegram.configured)}
                {i.telegram.configured ? yes(i.telegram.webhookReady, "Webhook secret set", "No webhook secret") : null}
              </span>
            </Row>
            <Row label="GitHub check">
              {i.github.tokenConfigured ? (
                <Badge tone="ok" dot>Token set</Badge>
              ) : (
                <span className="flex flex-col items-end gap-1">
                  <Badge tone="neutral" dot>No token</Badge>
                  <span className="text-xs" style={{ color: "var(--hs-ink-3)" }}>Unauthenticated: 60 GitHub requests an hour</span>
                </span>
              )}
            </Row>
            <Row label="Automatic archive">
              {i.autoArchive ? <Badge tone="info" dot>On · 14 days after an event</Badge> : <Badge tone="neutral" dot>Off</Badge>}
            </Row>
            <Row label="Chat delivery">
              <span className="flex flex-col items-end gap-1">
                {i.chat.crossInstance ? (
                  <Badge tone="ok" dot>Across instances</Badge>
                ) : (
                  <Badge tone="neutral" dot>{i.chat.listenEnabled ? "This instance only (LISTEN not connected)" : "This instance only"}</Badge>
                )}
                <span className="text-xs" style={{ color: "var(--hs-ink-3)" }}>
                  {i.chat.waiting.toLocaleString("en-US")} reader{i.chat.waiting === 1 ? "" : "s"} waiting now
                </span>
              </span>
            </Row>
          </dl>
          <p className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: "var(--hs-ink-3)" }}>
            <Plug size={12} aria-hidden="true" /> Keys and secrets are never shown here, only whether they are set.
          </p>
        </Card>

        <RequestsCard r={health.requests} />
      </div>
    </>
  );
}
