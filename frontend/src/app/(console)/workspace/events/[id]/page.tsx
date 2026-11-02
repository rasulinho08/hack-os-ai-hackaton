"use client";

/**
 * One event, from one request (`/api/owner/events/:id`): its organisation,
 * plan and the order it was bought with, registrations by status, teams,
 * projects, help and reports, judging coverage, staff, feedback and the
 * recent audit trail, each linked to where it is handled.
 *
 * The one owner action here already existed: which organisation the event
 * belongs to. While it has none, every customer administrator can still open
 * it, exactly as before tenancy; choosing one is what walls it off.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Building2, ExternalLink, Pencil, Search, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, ErrorState, Progress, Stat, buttonLook } from "@/components/ds/primitives";
import { siteOrigin } from "@/lib/hosts";
import { KeyValues, Panel } from "@/components/ds/board";
import { PageHead } from "../../_shell";
import { PLAN_LABEL } from "@/lib/commerce";
import { assignEventCustomer } from "@/lib/superadmin/customers";
import { day, loadEventDetail, loadPage, when, type CustomerListRow, type EventDetail } from "@/lib/superadmin/directory";
import {
  AuditList,
  BackLink,
  CustomerStatusBadge,
  DetailSkeleton,
  OrderLink,
  OrderStatusBadge,
  OrgLink,
  PersonLink,
  PhaseBadge,
  money,
  num,
} from "../../_ui";

export default function EventPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [data, setData] = useState<EventDetail | null>(null);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) return;
    let cancelled = false;
    loadEventDetail(id)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError({ status: (e as { status?: number })?.status, message: e instanceof Error ? e.message : "Could not load" });
      });
    return () => {
      cancelled = true;
    };
  }, [id, nonce]);

  if (!Number.isInteger(id) || id <= 0 || error?.status === 404) {
    return (
      <>
        <BackLink href="/workspace/events">Events</BackLink>
        <PageHead title="Event not found" sub="It may have been deleted, or the number in the address is wrong." />
      </>
    );
  }
  if (error && !data) {
    return (
      <>
        <BackLink href="/workspace/events">Events</BackLink>
        <ErrorState title="Could not load this event" body={error.message} onRetry={reload} />
      </>
    );
  }
  if (!data) return <DetailSkeleton />;
  return <Event data={data} reload={reload} />;
}

function Event({ data, reload }: { data: EventDetail; reload: () => void }) {
  const e = data.event;
  const p = data.participants;
  const total = Object.values(p).reduce((a, b) => a + b, 0);
  const limit = e.participant_limit ?? e.max_participants;
  const coverage = data.coverage == null ? null : Math.round(data.coverage * 100);
  const tickets = Object.values(data.tickets).reduce((a, b) => a + b, 0);

  return (
    <>
      <BackLink href="/workspace/events">Events</BackLink>
      <PageHead
        title={e.name}
        sub={[e.event_code, e.tagline, [e.venue_name, e.city, e.country].filter(Boolean).join(", "), `#${e.id}`].filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link prefetch={false} href={`/workspace/events/${e.id}/edit`} className={buttonLook("primary", "sm").className} style={buttonLook("primary", "sm").style}>
              <Pencil size={14} aria-hidden="true" /> Edit page
            </Link>
            {e.slug && e.is_published && !e.archived_at ? (
              <a href={`${siteOrigin()}/e/${e.slug}`} target="_blank" rel="noopener noreferrer" className={buttonLook("secondary", "sm").className} style={buttonLook("secondary", "sm").style}>
                <ExternalLink size={14} aria-hidden="true" /> View page
              </a>
            ) : null}
            <Link prefetch={false}
              href={`/workspace/audit?eventId=${e.id}`}
              className="inline-flex min-h-9 items-center rounded-[var(--radius-sm)] border px-3 text-[13px] font-medium"
              style={{ borderColor: "var(--line-strong)", color: "var(--ink)", background: "var(--surface)" }}
            >
              Audit trail
            </Link>
          </div>
        }
      />
      <div className="-mt-3 mb-5 flex flex-wrap items-center gap-2">
        <PhaseBadge phase={e.phase} />
        <Badge tone={e.is_published ? "ok" : "neutral"}>{e.is_published ? "Published" : "Not published"}</Badge>
        {e.plan ? <Badge tone="brand">{PLAN_LABEL[e.plan] ?? e.plan}</Badge> : null}
        {e.visibility && e.visibility !== "public" ? <Badge tone="info">{e.visibility === "invite" ? "Invite only" : "Link only"}</Badge> : null}
        {e.directory_featured ? <Badge tone="brand">Pinned{e.directory_featured_rank ? ` #${e.directory_featured_rank}` : ""}</Badge> : null}
        {e.is_test ? <Badge tone="warn">Test</Badge> : null}
        {data.escalated ? <Badge tone="danger">{data.escalated} escalated</Badge> : null}
        {data.counts.open_reports ? <Badge tone="danger">{data.counts.open_reports} reported</Badge> : null}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Participants" value={num(total)} hint={limit != null ? `of ${num(limit)} allowed` : "No limit"} />
        <Stat label="Teams" value={num(data.counts.teams)} hint={`${num(data.counts.checkins)} checked in`} />
        <Stat label="Projects" value={num(data.counts.submissions)} hint="Handed in" />
        <Stat label="Help" value={num(data.tickets.open ?? 0)} hint={`open · ${num(tickets)} raised`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <OrganisationPanel data={data} onChanged={reload} />

          <Panel title="Dates">
            <KeyValues
              rows={[
                { label: "Runs", value: <span title={`${when(e.start_date)} – ${when(e.end_date)}`}>{day(e.start_date)} – {day(e.end_date)}</span> },
                { label: "Registration", value: e.registration_start || e.registration_end ? `${day(e.registration_start)} – ${day(e.registration_end)}` : "—" },
                { label: "Projects due", value: when(e.submission_deadline) },
                { label: "Judging", value: e.judging_start || e.judging_end ? `${when(e.judging_start)} – ${when(e.judging_end)}` : "—" },
                { label: "Results", value: when(e.results_at) },
                { label: "Time zone", value: e.timezone || "—" },
                { label: "Format", value: [e.category, e.format].filter(Boolean).join(" · ") || "—" },
                { label: "Created", value: <>{day(e.created_at)}{e.created_by ? <> by <PersonLink id={e.created_by} name={e.creator_name} /></> : null}</> },
              ]}
            />
          </Panel>

          <Panel title="Registrations">
            {total === 0 ? (
              <p className="py-4 text-center text-sm" style={{ color: "var(--ink-3)" }}>Nobody has registered yet.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {Object.entries(p)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, n]) => (
                    <li key={status}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span style={{ color: "var(--ink-2)" }}>{status}</span>
                        <span style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{num(n)}</span>
                      </div>
                      <Progress value={Math.round((n / total) * 100)} tone={status === "approved" ? "ok" : status === "rejected" ? "danger" : status === "pending" ? "warn" : "info"} />
                    </li>
                  ))}
              </ul>
            )}
            <p className="mt-3 text-xs" style={{ color: "var(--ink-3)" }}>
              Mode: {e.registration_mode || "—"} · teams of up to {e.team_size_limit ?? "—"}
            </p>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title="Judging" hint="Share of the judge × project × criterion grid that has a score." action={<Link prefetch={false} href="/workspace/judging" className="text-xs hover:underline" style={{ color: "var(--ink-3)" }}>All events</Link>} />
            {coverage != null ? (
              <div className="mb-4">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-sm" style={{ color: "var(--ink-2)" }}>Coverage</span>
                  <span className="text-lg font-semibold" style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{coverage}%</span>
                </div>
                <Progress value={coverage} tone={coverage >= 90 ? "ok" : coverage >= 50 ? "warn" : "danger"} />
              </div>
            ) : (
              <p className="mb-4 text-sm" style={{ color: "var(--ink-3)" }}>
                {data.counts.judges === 0 || data.counts.criteria === 0 ? "No judging panel or criteria yet." : "No projects to score yet."}
              </p>
            )}
            <KeyValues
              rows={[
                { label: "Judges", value: num(data.counts.judges) },
                { label: "Criteria", value: num(data.counts.criteria) },
                { label: "Scores", value: num(data.counts.scores) },
                { label: "Projects", value: num(data.counts.submissions) },
              ]}
            />
          </Card>

          <Panel title="Staff, help and feedback">
            <KeyValues
              rows={[
                { label: "Mentors", value: num(data.counts.mentors) },
                { label: "Volunteers", value: num(data.counts.volunteers) },
                {
                  label: "Help requests",
                  value: (
                    <Link prefetch={false} href={`/workspace/support?eventId=${e.id}`} className="hover:underline">
                      {num(data.tickets.open ?? 0)} open · {num(data.tickets.claimed ?? 0)} claimed · {num(data.tickets.resolved ?? 0)} resolved
                    </Link>
                  ),
                },
                { label: "Reported messages", value: num(data.counts.open_reports) },
                {
                  label: "Feedback",
                  value: (
                    <Link prefetch={false} href={`/workspace/feedback?eventId=${e.id}`} className="hover:underline">
                      {num(data.counts.feedback)} response{data.counts.feedback === 1 ? "" : "s"}{data.counts.rating != null ? ` · ${data.counts.rating.toFixed(1)}★` : ""}
                    </Link>
                  ),
                },
                { label: "Checked in", value: num(data.counts.checkins) },
              ]}
            />
          </Panel>

          <Panel title="Recent activity" action={<Link prefetch={false} href={`/workspace/audit?eventId=${e.id}`} className="text-xs hover:underline" style={{ color: "var(--ink-3)" }}>Full trail</Link>}>
            <AuditList rows={data.audit} empty="Nothing recorded for this event yet." />
          </Panel>
        </div>
      </div>
    </>
  );
}

/** The event's organisation, plan and order, and the control that changes the organisation. */
function OrganisationPanel({ data, onChanged }: { data: EventDetail; onChanged: () => void }) {
  const e = data.event;
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const assign = async (customerId: number | null) => {
    setBusy(true);
    setFailed(null);
    try {
      await assignEventCustomer(e.id, customerId);
      setPicking(false);
      onChanged();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Organisation"
      action={
        !picking ? (
          <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
            {e.customer_id ? "Change" : "Assign"}
          </Button>
        ) : undefined
      }
    >
      {e.customer_id ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Building2 size={15} style={{ color: "var(--ink-3)" }} />
          <span className="text-sm font-medium"><OrgLink id={e.customer_id} name={e.customer_name} /></span>
          {e.customer_status ? <CustomerStatusBadge status={e.customer_archived_at ? "archived" : e.customer_status} /> : null}
        </div>
      ) : (
        <p className="mb-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm" style={{ background: "var(--warn-weak)", color: "var(--ink)" }}>
          No organisation. Until it has one, every customer administrator on the installation can open this event.
        </p>
      )}
      <KeyValues
        rows={[
          { label: "Plan", value: e.plan ? `${PLAN_LABEL[e.plan] ?? e.plan}${e.plan_kind ? ` · ${e.plan_kind === "annual" ? "annual" : "one event"}` : ""}` : "None (exempt or not published)" },
          { label: "Participant limit", value: e.participant_limit != null ? num(e.participant_limit) : e.max_participants != null ? `${num(e.max_participants)} (set by organiser)` : "No limit" },
          {
            label: "Bought with",
            value: data.order ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <OrderLink id={data.order.id} code={data.order.order_code} /> <OrderStatusBadge status={data.order.status} /> {money(data.order.amount_minor, data.order.currency)}
              </span>
            ) : (
              "No order for this event"
            ),
          },
        ]}
      />
      {picking ? <OrganisationPicker current={e.customer_id} busy={busy} onPick={assign} onCancel={() => setPicking(false)} /> : null}
      {failed ? <p className="mt-2 text-sm" role="alert" style={{ color: "var(--danger)" }}>{failed}</p> : null}
    </Panel>
  );
}

/** Search organisations on the server and pick one (or none). */
function OrganisationPicker({ current, busy, onPick, onCancel }: { current: number | null; busy: boolean; onPick: (id: number | null) => void; onCancel: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CustomerListRow[] | null>(null);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      ctl.current?.abort();
      const c = new AbortController();
      ctl.current = c;
      loadPage<CustomerListRow>("/api/owner/customers", { q, pageSize: 8, sort: "name", dir: "asc" }, c.signal)
        .then((d) => !c.signal.aborted && setRows(d.rows))
        .catch(() => !c.signal.aborted && setRows([]));
    }, 220);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <div className="mt-4 rounded-[var(--radius-sm)] border p-3" style={{ borderColor: "var(--line-strong)" }}>
      <label className="relative block">
        <span className="sr-only">Find an organisation</span>
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--ink-3)" }} />
        <input
          autoFocus
          value={q}
          onChange={(ev) => setQ(ev.target.value)}
          placeholder="Find an organisation…"
          className="min-h-9 w-full rounded-[var(--radius-sm)] border pl-8 pr-3 text-sm"
          style={{ borderColor: "var(--line-strong)", background: "var(--surface-sunken)", color: "var(--ink)" }}
        />
      </label>
      <ul className="mt-2 flex max-h-64 flex-col overflow-y-auto">
        {rows === null ? (
          <li className="px-2 py-2 text-xs" style={{ color: "var(--ink-3)" }}>Searching…</li>
        ) : rows.length === 0 ? (
          <li className="px-2 py-2 text-xs" style={{ color: "var(--ink-3)" }}>No organisation matches.</li>
        ) : (
          rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={busy || r.id === current}
                onClick={() => onPick(r.id)}
                className="flex min-h-9 w-full items-center justify-between gap-2 rounded-[6px] px-2 text-left text-sm hover:bg-[var(--tint)] disabled:opacity-60"
                style={{ color: "var(--ink)" }}
              >
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 text-xs" style={{ color: "var(--ink-3)" }}>{r.id === current ? "Current" : `${num(r.events)} events`}</span>
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="mt-2 flex flex-wrap justify-between gap-2 border-t pt-2" style={{ borderColor: "var(--line)" }}>
        {current ? (
          <Button size="sm" variant="ghost" icon={<X size={13} />} disabled={busy} onClick={() => onPick(null)}>
            Take it out of its organisation
          </Button>
        ) : <span />}
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
