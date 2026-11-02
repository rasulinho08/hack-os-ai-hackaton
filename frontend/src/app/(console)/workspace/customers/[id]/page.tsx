"use client";

/**
 * One organisation, everything the owner needs to see and do about it.
 *
 * Read in one request (`/api/owner/customers/:id`): profile and billing
 * details, the plan and what was bought, usage against the limits, modules
 * and the owner's switches, members and pending invites, orders and revenue,
 * and its recent audit trail. Its events are a paginated list of their own.
 *
 * The actions are the ones the API already offers the owner, nothing new:
 * edit the profile, set the seat limit, switch modules, make the plan exempt,
 * grant the free Community plan or make a launch partner's code (./_grants),
 * archive or restore, and review its orders (on each order's page, where
 * approving and refusing happen with the full order in view).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Archive, ExternalLink, FileText, Mail, Pencil, RotateCcw, ScrollText } from "lucide-react";
import { Badge, Button, Card, ErrorState, Stat } from "@/components/ds/primitives";
import { KeyValues, Panel } from "@/components/ds/board";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { Confirm, Drawer } from "@/components/ds/overlays";
import { PageHead } from "../../_shell";
import { PlanGrants } from "./_grants";
import { api, apiPost } from "@/lib/api";
import { PLAN_LABEL } from "@/lib/commerce";
import {
  MODULE_CATALOG,
  setModuleOverride,
  setPlanExempt,
  setSeatLimit,
  type CustomerPlan,
} from "@/lib/superadmin/customers";
import { PHASES, PHASE_LABEL } from "@/lib/superadmin/owner";
import { day, loadCustomerDetail, when, type CustomerDetail, type EventListRow } from "@/lib/superadmin/directory";
import { useServerTable } from "@/lib/superadmin/useServerTable";
import {
  AuditList,
  BackLink,
  CustomerStatusBadge,
  DetailSkeleton,
  EventLink,
  Meter,
  MiniTable,
  OrderLink,
  OrderStatusBadge,
  PersonLink,
  PhaseBadge,
  RoleBadge,
  hrefFor,
  money,
  num,
} from "../../_ui";

export default function OrganisationPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [data, setData] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) return;
    let cancelled = false;
    loadCustomerDetail(id)
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
        <BackLink href="/workspace/customers">Customers</BackLink>
        <PageHead title="Organisation not found" sub="There is no organisation with this number. It may have been typed wrong." />
      </>
    );
  }
  if (error && !data) {
    return (
      <>
        <BackLink href="/workspace/customers">Customers</BackLink>
        <ErrorState title="Could not load this organisation" body={error.message} onRetry={reload} />
      </>
    );
  }
  if (!data) return <DetailSkeleton />;
  return <Organisation data={data} reload={reload} />;
}

function Organisation({ data, reload }: { data: CustomerDetail; reload: () => void }) {
  const c = data.customer;
  const archived = Boolean(c.archived_at);
  const status = archived ? "archived" : c.status;
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [setupLink, setSetupLink] = useState<{ setupUrl: string; sentTo?: string; mailSent: boolean; mailMessage?: string | null } | null>(null);

  const toReview = data.orders.filter((o) => o.status === "pending" || o.status === "paid");
  // A setup link exists for an approved organisation; the API sends it for the latest approved order.
  const approved = data.orders.some((o) => o.status === "delivered");
  const revenue = data.revenue[0] ?? { currency: "AZN", paidMinor: 0, outstandingMinor: 0, reviewMinor: 0 };
  const plan = data.plan;
  const planLabel = plan.exempt ? "Exempt" : plan.plan ? PLAN_LABEL[plan.plan] ?? plan.plan : "No live plan";

  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setFailed(null);
    try {
      await work();
      reload();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <BackLink href="/workspace/customers">Customers</BackLink>
      <PageHead
        title={c.name}
        sub={[c.legal_name && c.legal_name !== c.name ? c.legal_name : null, [c.city, c.country].filter(Boolean).join(", "), `#${c.id}`, `since ${day(c.created_at)}`]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link prefetch={false}
              href={`/workspace/audit?customerId=${c.id}`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 text-[13px] font-medium"
              style={{ borderColor: "var(--line-strong)", color: "var(--ink)", background: "var(--surface)" }}
            >
              <ScrollText size={14} /> Audit trail
            </Link>
            <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(true)}>
              Edit details
            </Button>
            {approved && !archived ? (
              <Button
                size="sm"
                icon={<Mail size={14} />}
                loading={busy === "setup"}
                disabled={busy !== null}
                onClick={() => run("setup", async () => setSetupLink(await apiPost(`/api/customers/${c.id}/setup-link`, {})))}
              >
                {c.onboarded_at ? "Send setup link again" : "Send setup link"}
              </Button>
            ) : null}
            {archived ? (
              <Button size="sm" icon={<RotateCcw size={14} />} loading={busy === "restore"} disabled={busy !== null} onClick={() => run("restore", () => apiPost(`/api/customers/${c.id}/restore`, {}))}>
                Restore
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={<Archive size={14} />} disabled={busy !== null} onClick={() => setConfirmArchive(true)}>
                Archive
              </Button>
            )}
          </div>
        }
      />

      <div className="-mt-3 mb-5 flex flex-wrap items-center gap-2">
        <CustomerStatusBadge status={status} />
        <Badge tone={plan.exempt ? "neutral" : plan.plan ? "brand" : "neutral"}>{planLabel}</Badge>
        {data.seats.limit != null && data.seats.used > data.seats.limit ? <Badge tone="danger">Over its seats</Badge> : null}
        {c.slug ? <span className="text-xs" style={{ color: "var(--ink-3)" }}>/{c.slug}</span> : null}
      </div>

      {failed ? (
        <p className="mb-4 text-sm" role="alert" style={{ color: "var(--danger)" }}>{failed}</p>
      ) : null}
      {setupLink ? (
        <div className="mb-4 max-w-xl rounded-[var(--radius-sm)] border p-3 text-sm" role="status" style={{ borderColor: setupLink.mailSent ? "var(--ok)" : "var(--warn)", background: "var(--surface)", color: "var(--ink)" }}>
          <p className="font-medium">
            {setupLink.mailSent ? `Setup link e-mailed to ${setupLink.sentTo ?? "the buyer"}.` : `E-mail not sent${setupLink.mailMessage ? `: ${setupLink.mailMessage}` : ""}. Send them this link yourself:`}
          </p>
          <input readOnly value={setupLink.setupUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Setup link" className="mt-2 min-h-9 w-full rounded-[var(--radius-sm)] border px-2 font-mono text-xs" style={{ borderColor: "var(--line-strong)", background: "var(--surface-sunken)", color: "var(--ink)" }} />
        </div>
      ) : null}

      {toReview.length > 0 ? (
        <Card className="mb-5" style={{ borderColor: "var(--warn)", background: "var(--warn-weak)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
                {toReview.length === 1 ? "An order is waiting for your review" : `${toReview.length} orders are waiting for your review`}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: "var(--ink-2)" }}>
                {status === "pending_review"
                  ? "Approving it activates the organisation, grants the plan and sends the buyer a setup link."
                  : "Approving grants what was bought; refusing tells the buyer why."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {toReview.slice(0, 3).map((o) => (
                <Link prefetch={false}
                  key={o.id}
                  href={hrefFor.order(o.id)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-[13px] font-medium"
                  style={{ background: "var(--accent-solid)", color: "#fff" }}
                >
                  Review {o.order_code}
                </Link>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Paid to date" value={money(revenue.paidMinor, revenue.currency)} hint={`${data.orders.filter((o) => o.paid_at).length} paid of ${data.orders.length} orders`} />
        <Stat
          label="Owed"
          value={money(revenue.outstandingMinor + revenue.reviewMinor, revenue.currency)}
          hint={revenue.reviewMinor ? `${money(revenue.reviewMinor, revenue.currency)} awaiting review` : "Approved but not paid"}
        />
        <Stat label="Events" value={num(data.events.total)} hint={`${data.events.byPhase.running ?? 0} running · ${data.events.byPhase.upcoming ?? 0} upcoming`} />
        <Stat label="Participants" value={num(data.usage.participants.total)} hint={`${num(data.usage.participants.people)} people · largest event ${num(data.usage.participants.largestEvent)}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Profile and billing" action={<Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setEditing(true)}>Edit</Button>}>
            <KeyValues
              rows={[
                { label: "Legal name", value: c.legal_name || "—" },
                { label: "VAT / VÖEN", value: c.vat_id || "—" },
                { label: "Billing e-mail", value: c.billing_email ? <a href={`mailto:${c.billing_email}`} className="hover:underline">{c.billing_email}</a> : "—" },
                {
                  label: "Website",
                  value: c.website ? (
                    <a href={/^https?:\/\//.test(c.website) ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:underline">
                      {c.website.replace(/^https?:\/\//, "")} <ExternalLink size={11} />
                    </a>
                  ) : "—",
                },
                { label: "Sector", value: c.sector || "—" },
                { label: "Location", value: [c.city, c.country].filter(Boolean).join(", ") || "—" },
                { label: "Time zone · language", value: [c.timezone, c.locale].filter(Boolean).join(" · ") || "—" },
                { label: "Set up", value: c.onboarded_at ? day(c.onboarded_at) : "Not yet" },
              ]}
            />
            {c.notes ? (
              <div className="mt-4 rounded-[var(--radius-sm)] border px-3 py-2" style={{ borderColor: "var(--line)" }}>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>Your notes</p>
                <p className="whitespace-pre-line text-xs leading-relaxed" style={{ color: "var(--ink-2)" }}>{c.notes}</p>
              </div>
            ) : null}
          </Panel>

          <Panel title="Plan and usage">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm" style={{ color: "var(--ink-2)" }}>
                <span className="font-semibold" style={{ color: "var(--ink)" }}>{planLabel}</span>
                {plan.exempt ? " — every module, unlimited events (from before plans)." : plan.plan ? "" : " — nothing live is bought."}
              </p>
              <span className="text-xs" style={{ color: "var(--ink-3)" }}>
                Events left: {plan.eventsRemaining == null ? "unlimited" : plan.eventsRemaining}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Meter label="Events" used={data.usage.events.used} limit={data.usage.events.allowed} hint="Used of what live plans allow" />
              <SeatMeter customerId={c.id} used={data.seats.used} limit={data.seats.limit} pending={data.seats.pending} onSaved={reload} />
              <Meter
                label="Largest event"
                used={data.usage.participants.largestEvent}
                limit={data.usage.participants.perEventLimit}
                hint={data.usage.participants.perEventLimit == null ? "No per-event participant limit" : "Participants against the per-event limit"}
              />
            </div>
            {plan.entitlements.length > 0 ? (
              <div className="mt-5">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>Bought</p>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {plan.entitlements.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2" style={{ color: e.live ? "var(--ink)" : "var(--ink-3)" }}>
                      <span>
                        {PLAN_LABEL[e.plan] ?? e.plan} · {e.kind === "annual" ? "annual" : "one event"}
                        {e.orderCode ? (
                          <>
                            {" · "}
                            {e.orderId ? <OrderLink id={e.orderId} code={e.orderCode} muted /> : e.orderCode}
                          </>
                        ) : null}
                        {!e.live ? <span className="ml-1.5"><Badge tone="neutral">{e.revokedAt ? "Revoked" : "Ended"}</Badge></span> : null}
                      </span>
                      <span className="text-xs" style={{ color: "var(--ink-3)" }}>
                        {e.eventsUsed}/{e.eventsAllowed ?? "∞"} events · {day(e.startsAt)} – {day(e.endsAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>

          <PlanGrants
            customer={{ id: c.id, name: c.name }}
            communityLive={plan.entitlements.some((e) => e.plan === "community" && e.live)}
            onChanged={reload}
          />

          <ModulesPanel customerId={c.id} plan={plan} onChanged={reload} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title={`Members and seats · ${data.seats.used}${data.seats.limit == null ? "" : ` of ${data.seats.limit}`}`}>
            <MiniTable
              rows={data.members}
              rowKey={(m) => m.id}
              empty="Nobody is linked to this organisation."
              columns={[
                {
                  header: "Person",
                  cell: (m) => (
                    <div className="min-w-0">
                      <p className="truncate" style={{ color: "var(--ink)" }}>
                        {m.user_id ? <PersonLink id={m.user_id} name={m.full_name || m.email} /> : m.full_name || m.email}
                        {m.is_primary ? <span className="ml-1.5"><Badge tone="info">Primary</Badge></span> : null}
                      </p>
                      <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{m.email}{m.role_title ? ` · ${m.role_title}` : ""}</p>
                    </div>
                  ),
                },
                { header: "Role here", cell: (m) => <span className="text-xs">{m.member_role}</span>, width: "90px" },
                {
                  header: "Account",
                  wide: true,
                  cell: (m) =>
                    m.user_id ? (
                      <span className="flex flex-wrap items-center gap-1">
                        {m.platform_role ? <RoleBadge role={m.platform_role} /> : null}
                        {m.email_verified === false ? <Badge tone="warn">Unconfirmed</Badge> : null}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--ink-3)" }}>Billing contact only</span>
                    ),
                  width: "150px",
                },
              ]}
            />
            {data.invites.length > 0 ? (
              <div className="mt-4">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>
                  Invited, holding a seat · {data.invites.length}
                </p>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {data.invites.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 truncate" style={{ color: "var(--ink)" }}>{i.full_name ? `${i.full_name} · ` : ""}{i.email}</span>
                      <span className="text-xs" style={{ color: "var(--ink-3)" }}>
                        {i.grant_role} · by {i.invited_by ? <PersonLink id={i.invited_by} name={i.invited_by_name} muted /> : "—"} · until {day(i.expires_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Orders and payments"
            action={<Link prefetch={false} href={`/workspace/orders?customerId=${c.id}`} className="text-xs hover:underline" style={{ color: "var(--ink-3)" }}>All in Orders</Link>}
          >
            <MiniTable
              rows={data.orders}
              rowKey={(o) => o.id}
              empty="No orders yet."
              columns={[
                {
                  header: "Order",
                  cell: (o) => (
                    <div className="min-w-0">
                      <OrderLink id={o.id} code={o.order_code} />
                      <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>
                        {PLAN_LABEL[o.plan] ?? o.plan} · {o.billing_period === "annual" ? "annual" : "per event"} · {day(o.placed_at || o.created_at)}
                      </p>
                    </div>
                  ),
                },
                { header: "Status", cell: (o) => <OrderStatusBadge status={o.status} deliveredAt={o.delivered_at ?? null} />, width: "150px" },
                { header: "Amount", cell: (o) => <span style={{ color: "var(--ink)" }}>{money(o.amount_minor, o.currency)}</span>, align: "right", width: "110px" },
                {
                  header: "Invoice",
                  wide: true,
                  cell: (o) =>
                    o.invoice_number ? (
                      <a href={`/api/orders/${o.id}/invoice.pdf`} className="inline-flex items-center gap-1 whitespace-nowrap text-xs hover:underline" style={{ color: "var(--ink-2)" }}>
                        <FileText size={12} /> {o.invoice_number}
                      </a>
                    ) : (
                      <span className="text-xs" style={{ color: "var(--ink-3)" }}>—</span>
                    ),
                  width: "130px",
                },
              ]}
            />
            <p className="mt-3 text-xs" style={{ color: "var(--ink-3)" }}>
              Paid {money(revenue.paidMinor, revenue.currency)} · approved and unpaid {money(revenue.outstandingMinor, revenue.currency)} · awaiting review{" "}
              {money(revenue.reviewMinor, revenue.currency)}
            </p>
          </Panel>

          <Panel
            title="Recent activity"
            action={<Link prefetch={false} href={`/workspace/audit?customerId=${c.id}`} className="text-xs hover:underline" style={{ color: "var(--ink-3)" }}>Full trail</Link>}
          >
            <AuditList rows={data.audit} showOrg={false} empty="Nothing recorded for this organisation yet." />
          </Panel>
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-base font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--ink)" }}>
        Events
      </h2>
      <OrganisationEvents customerId={c.id} perEventLimit={data.usage.participants.perEventLimit} />

      <ProfileDrawer open={editing} data={data} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />
      <Confirm
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        title={`Archive ${c.name}?`}
        body="It leaves the lists and its members lose access to the organisation's workspace. Orders, invoices and events are kept, and you can restore it at any time."
        confirmLabel="Archive"
        destructive
        onConfirm={() => {
          setConfirmArchive(false);
          void run("archive", () => api(`/api/customers/${c.id}`, { method: "DELETE" }));
        }}
      />
    </>
  );
}

/** Seats used against the limit, with the limit editable in place. */
function SeatMeter({ customerId, used, limit, pending, onSaved }: { customerId: number; used: number; limit: number | null; pending: number; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(limit == null ? "" : String(limit));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const save = async () => {
    const t = value.trim();
    if (t !== "" && !/^\d+$/.test(t)) {
      setFailed("A whole number, or empty for no limit");
      return;
    }
    setBusy(true);
    setFailed(null);
    try {
      await setSeatLimit(customerId, t === "" ? null : Number(t));
      setEditing(false);
      onSaved();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="min-w-0">
        <label htmlFor={`seat-limit-${customerId}`} className="mb-1.5 block text-xs" style={{ color: "var(--ink-2)" }}>Seat limit</label>
        <div className="flex items-center gap-1.5">
          <input
            id={`seat-limit-${customerId}`}
            value={value}
            autoFocus
            inputMode="numeric"
            placeholder="No limit"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="min-h-8 w-20 rounded-[var(--radius-sm)] border px-2 text-sm"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface-sunken)", color: "var(--ink)" }}
          />
          <Button size="sm" variant="primary" loading={busy} onClick={save}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
        {failed ? <p className="mt-1 text-xs" style={{ color: "var(--danger)" }}>{failed}</p> : null}
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <Meter label="Seats" used={used} limit={limit} hint={pending ? `${pending} held by pending invites` : "Organiser accounts"} />
      <button type="button" onClick={() => setEditing(true)} className="mt-1 text-[11px] underline-offset-2 hover:underline" style={{ color: "var(--ink-2)" }}>
        Change the limit
      </button>
    </div>
  );
}

/** What the plan switches on, and the owner's per-module switches on top. */
function ModulesPanel({ customerId, plan, onChanged }: { customerId: number; plan: CustomerPlan; onChanged: () => void }) {
  const [current, setCurrent] = useState(plan);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => setCurrent(plan), [plan]);

  const run = async (key: string, work: () => Promise<CustomerPlan>) => {
    setBusy(key);
    setFailed(null);
    try {
      setCurrent(await work());
      onChanged();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(null);
    }
  };

  const overrides = new Map(current.overrides.map((o) => [o.module_key, o]));
  const enabled = new Set(current.modules);
  const select = "min-h-8 rounded-[var(--radius-sm)] border px-2 text-xs";
  const selectStyle: React.CSSProperties = { borderColor: "var(--line-strong)", background: "var(--surface)", color: "var(--ink)" };

  return (
    <Panel title={`Modules · ${enabled.size} of ${MODULE_CATALOG.length} on`}>
      <label className="mb-4 flex items-start gap-3 rounded-[var(--radius-sm)] border p-3" style={{ borderColor: "var(--line)" }}>
        <input
          type="checkbox"
          checked={current.exempt}
          disabled={busy !== null}
          onChange={(e) => run("exempt", () => setPlanExempt(customerId, e.target.checked))}
          className="mt-0.5"
        />
        <span className="text-sm" style={{ color: "var(--ink-2)" }}>
          <span className="font-medium" style={{ color: "var(--ink)" }}>Plan-exempt.</span> Every module and unlimited events, as for organisations from
          before plans. Turn off to put them on what they bought.
        </span>
      </label>
      <p className="mb-2 text-xs" style={{ color: "var(--ink-3)" }}>
        “Plan” follows what they bought; “On” and “Off” are your switches on top. Letters show the plans that include a module (Community, Starter,
        Professional, Business, Enterprise).
      </p>
      <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        {MODULE_CATALOG.map((m) => {
          const o = overrides.get(m.key);
          const value = o === undefined ? "plan" : o.enabled ? "on" : "off";
          const on = enabled.has(m.key);
          return (
            <li key={m.key} className="flex items-center justify-between gap-3 border-b py-2" style={{ borderColor: "var(--line)" }}>
              <span className="min-w-0">
                <span className="block truncate text-sm" style={{ color: "var(--ink)" }}>{m.label}</span>
                <span className="text-[11px]" style={{ color: on ? "var(--ok)" : "var(--ink-3)" }}>
                  {on ? "On" : "Off"} · {m.plans.split("").join("/")}
                  {o ? <span style={{ color: "var(--warn)" }}> · your switch{o.set_at ? `, ${day(o.set_at)}` : ""}</span> : null}
                </span>
              </span>
              <select
                aria-label={`${m.label}: plan, on or off`}
                value={value}
                disabled={busy !== null}
                onChange={(e) => run(m.key, () => setModuleOverride(customerId, m.key, e.target.value === "plan" ? null : e.target.value === "on"))}
                className={select}
                style={selectStyle}
              >
                <option value="plan">Plan</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </li>
          );
        })}
      </ul>
      {failed ? <p className="mt-2 text-sm" role="alert" style={{ color: "var(--danger)" }}>{failed}</p> : null}
    </Panel>
  );
}

/** This organisation's events, paginated on the server. */
function OrganisationEvents({ customerId, perEventLimit }: { customerId: number; perEventLimit: number | null }) {
  const t = useServerTable<EventListRow>({
    path: "/api/owner/events",
    pageSize: 10,
    defaultSort: { id: "phase", dir: "asc" },
    facetKeys: ["phase"],
    filters: { customerId },
  });
  const columns: Column<EventListRow>[] = [
    {
      id: "name",
      header: "Event",
      sortable: true,
      value: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium"><EventLink id={r.id} name={r.name} /></p>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{r.event_code}{r.plan ? ` · ${PLAN_LABEL[r.plan] ?? r.plan}` : ""}</p>
        </div>
      ),
    },
    { id: "phase", header: "Phase", sortable: true, value: (r) => r.phase, cell: (r) => <PhaseBadge phase={r.phase} />, width: "110px" },
    { id: "start", header: "Dates", sortable: true, value: (r) => r.start_date ?? "", cell: (r) => <span className="text-xs">{day(r.start_date)}</span>, width: "120px" },
    {
      id: "participants",
      header: "Participants",
      sortable: true,
      value: (r) => r.participants,
      cell: (r) => {
        const limit = r.participant_limit ?? perEventLimit;
        return (
          <span>
            <span style={{ color: limit != null && r.participants > limit ? "var(--danger)" : "var(--ink)" }}>{num(r.participants)}</span>
            {limit != null ? <span className="text-xs" style={{ color: "var(--ink-3)" }}> / {num(limit)}</span> : null}
          </span>
        );
      },
      align: "right",
      width: "120px",
    },
    { id: "teams", header: "Teams", sortable: true, value: (r) => r.teams, cell: (r) => num(r.teams), align: "right", width: "80px" },
    { id: "submissions", header: "Projects", sortable: true, value: (r) => r.submissions, cell: (r) => num(r.submissions), align: "right", width: "90px" },
    {
      id: "tickets",
      header: "Open help",
      sortable: true,
      value: (r) => r.open_tickets,
      cell: (r) => <span style={{ color: r.escalated ? "var(--danger)" : undefined }}>{num(r.open_tickets)}{r.escalated ? ` (${r.escalated} escalated)` : ""}</span>,
      align: "right",
      width: "110px",
    },
  ];
  if (t.error && !t.data) return <ErrorState title="Could not load the events" body={t.error} onRetry={t.reload} />;
  return (
    <DataTable
      rows={t.rows}
      columns={columns}
      loading={t.loading}
      pageSize={t.pageSize}
      server={t.server}
      getHref={(r) => hrefFor.event(r.id)}
      searchPlaceholder="Search this organisation's events…"
      emptyTitle="No events yet"
      emptyBody="Events this organisation creates appear here."
      facets={[{ id: "phase", label: "Phase", options: PHASES.map((p) => ({ value: p, label: PHASE_LABEL[p] })), match: () => true }]}
    />
  );
}

/** The organisation's details, as the owner corrects them (PATCH /api/customers/:id). */
function ProfileDrawer({ open, data, onClose, onSaved }: { open: boolean; data: CustomerDetail; onClose: () => void; onSaved: () => void }) {
  const c = data.customer;
  const initial = {
    name: c.name ?? "",
    legal_name: c.legal_name ?? "",
    vat_id: c.vat_id ?? "",
    billing_email: c.billing_email ?? "",
    website: c.website ?? "",
    sector: c.sector ?? "",
    city: c.city ?? "",
    country: c.country ?? "",
    notes: c.notes ?? "",
  };
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm(initial);
      setErrors(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, c.updated_at]);

  const save = async () => {
    const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== initial[k as keyof typeof initial]));
    if (!Object.keys(changed).length) {
      onClose();
      return;
    }
    if (!form.name.trim()) {
      setErrors("The organisation needs a name.");
      return;
    }
    setBusy(true);
    setErrors(null);
    try {
      await api(`/api/customers/${c.id}`, { method: "PATCH", body: JSON.stringify(changed) });
      onSaved();
    } catch (e) {
      setErrors(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const field = "min-h-10 w-full rounded-[var(--radius-sm)] border px-3 text-sm";
  const fieldStyle: React.CSSProperties = { borderColor: "var(--line-strong)", background: "var(--surface-sunken)", color: "var(--ink)" };
  const input = (key: keyof typeof initial, label: string, type = "text") => (
    <label className="block text-xs" style={{ color: "var(--ink-3)" }}>
      {label}
      <input type={type} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className={`${field} mt-1`} style={fieldStyle} />
    </label>
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Edit organisation"
      description="Profile and billing details. Changes are recorded in the audit trail (which fields, not their values)."
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {input("name", "Name")}
        {input("legal_name", "Legal name (on invoices)")}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {input("vat_id", "VAT / VÖEN")}
          {input("billing_email", "Billing e-mail", "email")}
          {input("website", "Website")}
          {input("sector", "Sector")}
          {input("city", "City")}
          {input("country", "Country")}
        </div>
        <label className="block text-xs" style={{ color: "var(--ink-3)" }}>
          Your notes (only the owner sees these)
          <textarea rows={4} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={`${field} mt-1 py-2`} style={fieldStyle} />
        </label>
        {errors ? <p className="text-sm" role="alert" style={{ color: "var(--danger)" }}>{errors}</p> : null}
        <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>Last changed {when(c.updated_at)}.</p>
      </div>
    </Drawer>
  );
}
