"use client";

/**
 * The audit trail, from GET /api/owner/audit: who did what, newest first.
 *
 * Filters are applied by the API (an action or a whole family of them,
 * organisation, event, the account that acted, a range of days) and carried
 * in the address, so a view can be shared: /workspace/audit?eventId=12.
 * "Load older" pages back by id. "Export CSV" asks the API for the same
 * filters, up to 5,000 rows, written formula-safe.
 *
 * A row says who acted by name and account id only — the trail never shows
 * an e-mail address or other contact details.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, Filter, RotateCcw } from "lucide-react";
import { Badge, Button, Card, ErrorState, TableSkeleton, buttonLook } from "@/components/ds/primitives";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { PageHead } from "../_shell";
import { loadCustomers, type Customer } from "@/lib/superadmin/customers";
import {
  AUDIT_PAGE,
  actionChoices,
  auditCsvUrl,
  auditFiltersFromSearch,
  auditSearchString,
  loadAudit,
  loadAuditActions,
  metaSummary,
  type AuditFilters,
  type AuditRow,
} from "@/lib/superadmin/owner";

const EMPTY: AuditFilters = {};

const fromAddress = (): AuditFilters =>
  typeof window === "undefined" ? EMPTY : auditFiltersFromSearch(window.location.search);

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? { time: iso, date: "" }
    : {
        time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        date: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
      };
};

/** Targets with a page of their own in this console. */
const TARGET_PAGE: Record<string, string> = {
  user: "/workspace/people",
  order: "/workspace/orders",
  customer: "/workspace/customers",
  event: "/workspace/events",
};

const muted = (text: string) => <span style={{ color: "var(--hs-ink-3)" }}>{text}</span>;

const COLUMNS: Column<AuditRow>[] = [
  {
    id: "when",
    header: "When",
    value: (r) => r.created_at,
    cell: (r) => {
      const w = when(r.created_at);
      return (
        <span className="whitespace-nowrap" title={r.created_at}>
          <span style={{ color: "var(--hs-ink)", fontVariantNumeric: "tabular-nums" }}>{w.time}</span>
          <span className="block text-[11px]" style={{ color: "var(--hs-ink-3)" }}>{w.date}</span>
        </span>
      );
    },
    sortable: true,
  },
  {
    id: "action",
    header: "Action",
    value: (r) => r.action,
    cell: (r) => (
      <Badge tone={r.action.includes("fail") || r.action.includes("remove") ? "warn" : "neutral"}>
        <span style={{ fontFamily: "var(--font-mono-ui)" }}>{r.action}</span>
      </Badge>
    ),
    sortable: true,
  },
  {
    id: "who",
    header: "Who",
    value: (r) => r.actor_name || (r.actor_user_id ? `#${r.actor_user_id}` : "System"),
    cell: (r) =>
      r.actor_user_id ? (
        <span className="block min-w-0">
          <Link prefetch={false} href={`/workspace/people/${r.actor_user_id}`} className="block truncate hover:underline" style={{ color: "var(--hs-ink)" }}>
            {r.actor_name || "Account"}
          </Link>
          <span className="block text-[11px]" style={{ color: "var(--hs-ink-3)" }}>#{r.actor_user_id}</span>
        </span>
      ) : (
        muted("System")
      ),
    sortable: true,
  },
  {
    id: "organisation",
    header: "Organisation",
    value: (r) => r.customer_name || "",
    cell: (r) =>
      r.customer_id ? (
        <Link prefetch={false} href={`/workspace/customers/${r.customer_id}`} className="hover:underline" style={{ color: "var(--hs-ink-2)" }}>
          {r.customer_name || `Organisation #${r.customer_id}`}
        </Link>
      ) : (
        muted("—")
      ),
    sortable: true,
  },
  {
    id: "event",
    header: "Event",
    value: (r) => r.event_name || (r.event_id ? `#${r.event_id}` : ""),
    cell: (r) =>
      r.event_id ? (
        <Link prefetch={false} href={`/workspace/events/${r.event_id}`} className="hover:underline" style={{ color: "var(--hs-ink)" }}>
          {r.event_name || `Event #${r.event_id}`}
        </Link>
      ) : (
        muted("—")
      ),
    sortable: true,
  },
  {
    id: "target",
    header: "Target",
    value: (r) => `${r.target_type || ""} ${r.target_id || ""}`.trim(),
    cell: (r) =>
      r.target_type ? (
        TARGET_PAGE[r.target_type] && r.target_id && /^\d+$/.test(r.target_id) ? (
          <Link prefetch={false} href={`${TARGET_PAGE[r.target_type]}/${r.target_id}`} className="whitespace-nowrap text-xs hover:underline" style={{ color: "var(--hs-ink-2)" }}>
            {r.target_type} <span style={{ color: "var(--hs-ink-3)" }}>#{r.target_id}</span>
          </Link>
        ) : (
          <span className="whitespace-nowrap text-xs" style={{ color: "var(--hs-ink-2)" }}>
            {r.target_type}
            {r.target_id ? <span style={{ color: "var(--hs-ink-3)" }}> #{r.target_id}</span> : null}
          </span>
        )
      ) : (
        muted("—")
      ),
  },
  {
    id: "details",
    header: "Details",
    value: (r) => metaSummary(r.meta, 400),
    cell: (r) => {
      const text = metaSummary(r.meta);
      return text ? (
        <span className="block max-w-[22rem] truncate text-xs" style={{ color: "var(--hs-ink-2)" }} title={JSON.stringify(r.meta)}>
          {text}
        </span>
      ) : (
        muted("—")
      );
    },
  },
  {
    id: "ip",
    header: "Address",
    value: (r) => r.ip || "",
    cell: (r) => (r.ip ? <span className="text-xs" style={{ fontFamily: "var(--font-mono-ui)", color: "var(--hs-ink-2)" }}>{r.ip}</span> : muted("—")),
    optional: true,
  },
];

export default function AuditPage() {
  const [draft, setDraft] = useState<AuditFilters>(fromAddress);
  const [applied, setApplied] = useState<AuditFilters>(fromAddress);
  const [nonce, setNonce] = useState(0);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [actions, setActions] = useState<{ value: string; label: string }[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadAudit(applied)
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setError(null);
        setHasMore(r.length === AUDIT_PAGE);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRows([]);
        setError(e instanceof Error ? e.message : "Could not load the audit trail");
      });
    return () => {
      cancelled = true;
    };
  }, [applied, nonce]);

  useEffect(() => {
    let cancelled = false;
    loadAuditActions()
      .then((list) => {
        if (!cancelled) setActions(actionChoices(list));
      })
      .catch(() => {
        /* the action filter offers only "All actions" */
      });
    loadCustomers()
      .then((list) => {
        if (!cancelled) setCustomers([...list].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {
        /* the organisation filter offers only "All organisations" */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = (filters: AuditFilters) => {
    setRows(null);
    setMoreError(null);
    setApplied({ ...filters });
    setNonce((n) => n + 1);
    try {
      window.history.replaceState(null, "", `${window.location.pathname}${auditSearchString(filters)}`);
    } catch {
      /* the address keeps its old filters */
    }
  };

  const loadOlder = () => {
    if (!rows || !rows.length || loadingMore) return;
    const last = rows[rows.length - 1].id;
    setLoadingMore(true);
    setMoreError(null);
    loadAudit(applied, last)
      .then((older) => {
        setRows((current) => [...(current ?? []), ...older.filter((o) => !(current ?? []).some((c) => c.id === o.id))]);
        setHasMore(older.length === AUDIT_PAGE);
      })
      .catch((e: unknown) => setMoreError(e instanceof Error ? e.message : "Could not load older entries"))
      .finally(() => setLoadingMore(false));
  };

  const set = (k: keyof AuditFilters, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const field = "min-h-10 w-full rounded-[var(--radius-sm)] border px-3 text-sm outline-none";
  const fieldStyle: React.CSSProperties = { borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" };
  const label = "mb-1 block text-xs font-medium";
  const labelStyle: React.CSSProperties = { color: "var(--hs-ink-2)" };
  const active = Object.values(applied).some((v) => v != null && String(v).trim());

  return (
    <>
      <PageHead
        title="Audit trail"
        sub="Who did what on the platform, newest first."
        actions={
          <a href={auditCsvUrl(applied)} download {...buttonLook("secondary", "sm")}>
            <Download size={14} aria-hidden="true" /> Export CSV
          </a>
        }
      />

      <Card className="mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(draft);
          }}
          aria-label="Filter the audit trail"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="sm:col-span-2 lg:col-span-1 xl:col-span-2">
              <label htmlFor="au-action" className={label} style={labelStyle}>Action</label>
              <select id="au-action" value={draft.action ?? ""} onChange={(e) => set("action", e.target.value)} className={field} style={fieldStyle}>
                <option value="">All actions</option>
                {actions.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="au-org" className={label} style={labelStyle}>Organisation</label>
              <select id="au-org" value={String(draft.customerId ?? "")} onChange={(e) => set("customerId", e.target.value)} className={field} style={fieldStyle}>
                <option value="">All organisations</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="au-event" className={label} style={labelStyle}>Event id</label>
              <input id="au-event" inputMode="numeric" pattern="[0-9]*" value={String(draft.eventId ?? "")} onChange={(e) => set("eventId", e.target.value.replace(/\D/g, ""))} placeholder="e.g. 12" className={field} style={fieldStyle} />
            </div>
            <div>
              <label htmlFor="au-actor" className={label} style={labelStyle}>Account id</label>
              <input id="au-actor" inputMode="numeric" pattern="[0-9]*" value={String(draft.actorId ?? "")} onChange={(e) => set("actorId", e.target.value.replace(/\D/g, ""))} placeholder="Who acted" className={field} style={fieldStyle} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-6 xl:max-w-md">
              <div>
                <label htmlFor="au-from" className={label} style={labelStyle}>From</label>
                <input id="au-from" type="date" value={draft.from ?? ""} max={draft.to || undefined} onChange={(e) => set("from", e.target.value)} className={field} style={fieldStyle} />
              </div>
              <div>
                <label htmlFor="au-to" className={label} style={labelStyle}>To (included)</label>
                <input id="au-to" type="date" value={draft.to ?? ""} min={draft.from || undefined} onChange={(e) => set("to", e.target.value)} className={field} style={fieldStyle} />
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="primary" icon={<Filter size={14} />}>Apply</Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon={<RotateCcw size={14} />}
              disabled={!active && !Object.values(draft).some((v) => v != null && String(v).trim())}
              onClick={() => {
                setDraft(EMPTY);
                run(EMPTY);
              }}
            >
              Reset
            </Button>
            {active ? <span className="text-xs" style={{ color: "var(--hs-ink-3)" }}>Filtered — Export CSV uses the same filters.</span> : null}
          </div>
        </form>
      </Card>

      {error ? (
        <ErrorState title="Could not load the audit trail" body={error} onRetry={() => run(applied)} />
      ) : rows === null ? (
        <Card padded={false}>
          <TableSkeleton rows={8} cols={6} />
        </Card>
      ) : (
        <>
          <DataTable
            rows={rows}
            columns={COLUMNS}
            pageSize={50}
            dense
            searchPlaceholder="Search the loaded entries…"
            emptyTitle={active ? "Nothing matches these filters" : "The audit trail is empty"}
            emptyBody={active ? "Widen the dates or choose another action." : undefined}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {hasMore ? (
              <Button size="sm" variant="secondary" onClick={loadOlder} loading={loadingMore} disabled={loadingMore}>
                Load older
              </Button>
            ) : rows.length ? (
              <span className="text-xs" style={{ color: "var(--hs-ink-3)" }}>That is everything for these filters.</span>
            ) : null}
            <span className="text-xs" style={{ color: "var(--hs-ink-3)" }} aria-live="polite">
              {rows.length.toLocaleString("en-US")} entr{rows.length === 1 ? "y" : "ies"} loaded
            </span>
            {moreError ? <span role="alert" className="text-xs" style={{ color: "var(--hs-danger)" }}>{moreError}</span> : null}
          </div>
        </>
      )}
    </>
  );
}
