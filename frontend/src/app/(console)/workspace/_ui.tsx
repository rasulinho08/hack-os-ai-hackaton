"use client";

/**
 * Pieces every owner-console page shares: links between entities, the
 * status badges, the audit list, small tables for detail pages and a usage
 * meter. Kept here so an organisation, a person and an order are linked the
 * same way wherever they appear, and every colour stays a token.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge, Skeleton, type Tone } from "@/components/ds/primitives";
import { PHASE_LABEL, PHASE_TONE, formatMinor, type Phase } from "@/lib/superadmin/owner";
import { orderStage, STAGE_LABEL, STAGE_TONE, STATUS_LABEL, STATUS_TONE, type OrderStatus } from "@/lib/commerce";
import {
  CUSTOMER_STATUS,
  ROLE_LABEL,
  ROLE_TONE,
  actionWords,
  ago,
  when,
  type AuditEntry,
  type CustomerStatus,
} from "@/lib/superadmin/directory";

/* ── Links ─────────────────────────────────────────────────────────────── */

export const hrefFor = {
  organisation: (id: number | string) => `/workspace/customers/${id}`,
  person: (id: number | string) => `/workspace/people/${id}`,
  order: (id: number | string) => `/workspace/orders/${id}`,
  event: (id: number | string) => `/workspace/events/${id}`,
};

function EntityLink({ href, children, muted = false }: { href: string; children: ReactNode; muted?: boolean }) {
  return (
    <Link prefetch={false}
      href={href}
      className="rounded-sm underline-offset-2 hover:underline"
      style={{ color: muted ? "var(--ink-2)" : "var(--ink)" }}
    >
      {children}
    </Link>
  );
}

export const OrgLink = ({ id, name, muted }: { id: number | null | undefined; name?: string | null; muted?: boolean }) =>
  id ? <EntityLink href={hrefFor.organisation(id)} muted={muted}>{name || `Organisation #${id}`}</EntityLink> : <span style={{ color: "var(--ink-3)" }}>{name || "—"}</span>;

export const PersonLink = ({ id, name, muted }: { id: number | null | undefined; name?: string | null; muted?: boolean }) =>
  id ? <EntityLink href={hrefFor.person(id)} muted={muted}>{name || `Account #${id}`}</EntityLink> : <span style={{ color: "var(--ink-3)" }}>{name || "—"}</span>;

export const OrderLink = ({ id, code, muted }: { id: number | null | undefined; code?: string | null; muted?: boolean }) =>
  id ? <EntityLink href={hrefFor.order(id)} muted={muted}>{code || `Order #${id}`}</EntityLink> : <span style={{ color: "var(--ink-3)" }}>—</span>;

export const EventLink = ({ id, name, muted }: { id: number | null | undefined; name?: string | null; muted?: boolean }) =>
  id ? <EntityLink href={hrefFor.event(id)} muted={muted}>{name || `Event #${id}`}</EntityLink> : <span style={{ color: "var(--ink-3)" }}>{name || "—"}</span>;

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link prefetch={false} href={href} className="mb-3 inline-flex min-h-8 items-center gap-1.5 text-sm hover:underline" style={{ color: "var(--ink-3)" }}>
      <ArrowLeft size={15} /> {children}
    </Link>
  );
}

/* ── Badges ────────────────────────────────────────────────────────────── */

export function CustomerStatusBadge({ status }: { status: CustomerStatus | string }) {
  const [label, tone] = CUSTOMER_STATUS[status as CustomerStatus] ?? [status, "neutral" as const];
  return <Badge tone={tone}>{label}</Badge>;
}

/**
 * An order's status in the words the buyer reads (under review, approved ·
 * active, refused, cancelled). With `deliveredAt` a cancelled order is told
 * apart: refused if it was never active, cancelled if it was.
 */
export function OrderStatusBadge({ status, deliveredAt }: { status: OrderStatus | string; deliveredAt?: string | null }) {
  if (deliveredAt !== undefined && status in STATUS_TONE) {
    const stage = orderStage({ status: status as OrderStatus, delivered_at: deliveredAt });
    return <Badge tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>;
  }
  return <Badge tone={STATUS_TONE[status as OrderStatus] ?? "neutral"}>{STATUS_LABEL[status as OrderStatus] ?? status}</Badge>;
}

export function PhaseBadge({ phase }: { phase: Phase | string }) {
  return <Badge tone={PHASE_TONE[phase as Phase] ?? "neutral"}>{PHASE_LABEL[phase as Phase] ?? phase}</Badge>;
}

export function RoleBadge({ role }: { role: string }) {
  return <Badge tone={ROLE_TONE[role] ?? "neutral"}>{ROLE_LABEL[role] ?? role}</Badge>;
}

/* ── Numbers ───────────────────────────────────────────────────────────── */

export const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

/** Minor units → "AZN 1,490.00"; a null amount is not priced, so a dash. */
export const money = (minor: number | null | undefined, currency = "AZN") =>
  minor == null ? "—" : formatMinor(minor, currency);

/** "3 of 10 used", with a bar; `limit: null` means none was set. */
export function Meter({ label, used, limit, unit = "", hint }: { label: string; used: number; limit: number | null; unit?: string; hint?: string }) {
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;
  const tone: Tone = pct == null ? "info" : used > (limit ?? 0) ? "danger" : pct >= 85 ? "warn" : "ok";
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs" style={{ color: "var(--ink-2)" }}>{label}</span>
        <span className="text-sm font-medium" style={{ color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
          {num(used)}
          <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>
            {limit == null ? ` · no limit${unit}` : ` of ${num(limit)}${unit}`}
          </span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--tint)" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct == null ? 100 : Math.max(pct, used > 0 ? 3 : 0)}%`,
            background: pct == null ? "var(--line-strong)" : `var(--${tone === "danger" ? "danger" : tone === "warn" ? "warn" : "ok"})`,
          }}
        />
      </div>
      {hint ? <p className="mt-1 text-[11px]" style={{ color: "var(--ink-3)" }}>{hint}</p> : null}
    </div>
  );
}

/* ── Compact tables for detail pages ───────────────────────────────────── */

export interface MiniColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  width?: string;
  /** Left out below the `sm` breakpoint. */
  wide?: boolean;
}

/**
 * A short list inside a panel. The table scrolls inside its panel on a narrow
 * screen rather than widening the page; secondary columns drop off first.
 */
export function MiniTable<T>({
  rows,
  columns,
  rowKey,
  empty,
}: {
  rows: T[];
  columns: MiniColumn<T>[];
  rowKey: (row: T) => string | number;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm" style={{ color: "var(--ink-3)" }}>{empty}</p>;
  }
  return (
    <div className="hs-scroll-x -mx-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left" style={{ borderColor: "var(--line)" }}>
            {columns.map((c) => (
              <th
                key={c.header}
                className={`px-4 py-2 text-xs font-medium ${c.align === "right" ? "text-right" : ""} ${c.wide ? "hidden sm:table-cell" : ""}`}
                style={{ color: "var(--ink-3)", width: c.width }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b last:border-b-0" style={{ borderColor: "var(--line)" }}>
              {columns.map((c) => (
                <td
                  key={c.header}
                  className={`px-4 py-2.5 align-top ${c.align === "right" ? "text-right" : ""} ${c.wide ? "hidden sm:table-cell" : ""}`}
                  style={{ color: "var(--ink-2)", fontVariantNumeric: c.align === "right" ? "tabular-nums" : undefined }}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── The audit trail ───────────────────────────────────────────────────── */

/** Where an audit row's target lives in the console, when it has a page. */
function targetLink(a: AuditEntry): ReactNode {
  if (!a.target_id) return null;
  switch (a.target_type) {
    case "order":
      return <OrderLink id={Number(a.target_id)} code={`order #${a.target_id}`} muted />;
    case "user":
      return <PersonLink id={Number(a.target_id)} name={`account #${a.target_id}`} muted />;
    case "customer":
      return <OrgLink id={Number(a.target_id)} name={a.customer_name || `organisation #${a.target_id}`} muted />;
    case "coupon": {
      const meta = (a.meta ?? {}) as { code?: string | null; name?: string | null };
      return <EntityLink href={`/workspace/pricing?tab=discounts&coupon=${a.target_id}`} muted>{meta.code || meta.name || `discount #${a.target_id}`}</EntityLink>;
    }
    case "plan":
      return <EntityLink href="/workspace/pricing?tab=history" muted>{`${a.target_id} plan`}</EntityLink>;
    default:
      return null;
  }
}

/**
 * Who did what, newest first: the actor (a link to their page), the action
 * in words, what it was about, and when.
 */
export function AuditList({ rows, empty = "Nothing recorded yet.", showOrg = true }: { rows: AuditEntry[]; empty?: string; showOrg?: boolean }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm" style={{ color: "var(--ink-3)" }}>{empty}</p>;
  return (
    <ol className="flex flex-col">
      {rows.map((a) => {
        const target = targetLink(a);
        return (
          <li key={a.id} className="flex items-start justify-between gap-3 border-b py-2.5 last:border-b-0" style={{ borderColor: "var(--line)" }}>
            <div className="min-w-0 text-sm leading-relaxed" style={{ color: "var(--ink-2)" }}>
              <span className="font-medium">
                {a.actor_user_id ? <PersonLink id={a.actor_user_id} name={a.actor_name} /> : <span style={{ color: "var(--ink)" }}>The platform</span>}
              </span>{" "}
              {actionWords(a.action)}
              {target ? <> · {target}</> : null}
              {a.event_id ? <> · <EventLink id={a.event_id} name={a.event_name} muted /></> : null}
              {showOrg && a.customer_id && a.target_type !== "customer" ? <> · <OrgLink id={a.customer_id} name={a.customer_name} muted /></> : null}
              <span className="ml-1.5 font-mono text-[10px]" style={{ color: "var(--ink-3)", fontFamily: "var(--font-mono-ui)" }}>{a.action}</span>
            </div>
            <time dateTime={a.created_at} title={when(a.created_at)} className="shrink-0 pt-0.5 text-xs" style={{ color: "var(--ink-3)" }}>
              {ago(a.created_at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Loading ───────────────────────────────────────────────────────────── */

export function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-4 w-28" />
      <Skeleton className="mb-6 h-8 w-72" />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48" />)}
      </div>
    </div>
  );
}

/** A small label above a figure, as on the stat tiles. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>
      {children}
    </p>
  );
}
