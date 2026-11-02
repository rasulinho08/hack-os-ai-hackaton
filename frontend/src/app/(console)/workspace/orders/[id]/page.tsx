"use client";

/**
 * One order: what was bought, what it costs, how it is being paid, who
 * bought it, the plan it granted, every status it went through and the audit
 * trail behind them.
 *
 * The decisions are the ones the API already offers: approve (the
 * organisation goes live, the plan is granted, the invoice is issued and —
 * for an organisation not set up yet — a setup link goes to the buyer),
 * refuse (with a reason the buyer reads), record a payment, send the setup
 * link again, issue the invoice early. The setup link is shown here too, so it
 * can be passed on by hand while e-mail is not configured.
 *
 * Statuses read as the buyer reads them: under review → approved · active →
 * paid, or refused / cancelled.
 *
 * A discount is a line under the plan, and its own panel: the code or the
 * campaign, what it took off, and — for a university or non-profit claim —
 * the institution the buyer named. A claim is accepted by approving the
 * order; if it does not apply, the owner removes it first and the order goes
 * back to the plan's price.
 *
 * `amount_minor` of `null` still renders as a dash: an order nobody has priced
 * is not an order worth zero.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { BadgePercent, Check, Copy, CreditCard, Download, FileText, GraduationCap, Landmark, Mail, X } from "lucide-react";
import { Badge, Button, Card, ErrorState } from "@/components/ds/primitives";
import { KeyValues, Panel } from "@/components/ds/board";
import { PageHead } from "../../_shell";
import { apiPost } from "@/lib/api";
import { orderStage, PAYMENT_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_TONE, paymentState, PLAN_LABEL, STAGE_LABEL, STATUS_LABEL, type OrderStatus } from "@/lib/commerce";
import { BRAND_LABEL, type CardBrand } from "@/lib/card";
import { day, loadOrderDetail, when, type OrderDetail } from "@/lib/superadmin/directory";
import {
  AuditList,
  BackLink,
  CustomerStatusBadge,
  DetailSkeleton,
  EventLink,
  OrderStatusBadge,
  OrgLink,
  PersonLink,
  RoleBadge,
  money,
} from "../../_ui";

/** A discount's state in the owner's words. */
const DISCOUNT_STATUS: Record<"applied" | "claimed" | "approved" | "removed", [string, "ok" | "info" | "neutral" | "warn"]> = {
  applied: ["Applied", "ok"],
  claimed: ["Claimed · to review", "info"],
  approved: ["Accepted", "ok"],
  removed: ["Removed", "neutral"],
};

interface LinkResult {
  setupUrl: string | null;
  setupExpiresAt?: string | null;
  /** Approval of an organisation that is already set up: no link was issued. */
  setupSkipped?: boolean;
  mailSent: boolean;
  mailMessage?: string | null;
}

export default function OrderPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const [data, setData] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) return;
    let cancelled = false;
    loadOrderDetail(id)
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
        <BackLink href="/workspace/orders">Orders</BackLink>
        <PageHead title="Order not found" sub="There is no order with this number." />
      </>
    );
  }
  if (error && !data) {
    return (
      <>
        <BackLink href="/workspace/orders">Orders</BackLink>
        <ErrorState title="Could not load this order" body={error.message} onRetry={reload} />
      </>
    );
  }
  if (!data) return <DetailSkeleton />;
  return <Order data={data} reload={reload} />;
}

function paymentText(o: OrderDetail["order"]): string {
  if (o.payment_method === "card") {
    const brand = BRAND_LABEL[(o.card_brand || "other") as CardBrand] ?? "Card";
    return `${brand} •••• ${o.card_last4 ?? "????"}${o.paid_at ? "" : " · not charged"}`;
  }
  return o.payment_method ? PAYMENT_METHOD_LABEL[o.payment_method] ?? o.payment_method : "Not chosen";
}

function Order({ data, reload }: { data: OrderDetail; reload: () => void }) {
  const o = data.order;
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [mode, setMode] = useState<null | "refuse" | "payment" | "discount">(null);
  const [reason, setReason] = useState("");
  const [payment, setPayment] = useState({ method: "bank_transfer", reference: "", paidAt: new Date().toISOString().slice(0, 10) });
  const [link, setLink] = useState<LinkResult | null>(null);
  const [copied, setCopied] = useState(false);

  const act = async (what: string, run: () => Promise<unknown>) => {
    setBusy(what);
    setFailed(null);
    try {
      await run();
      setMode(null);
      reload();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(null);
    }
  };

  const approve = () => act("approve", async () => setLink(await apiPost<LinkResult>(`/api/orders/${o.id}/approve`, {})));
  const refuse = () => act("refuse", () => apiPost(`/api/orders/${o.id}/reject`, { reason: reason.trim() }));
  const recordPayment = () =>
    act("payment", () =>
      apiPost(`/api/orders/${o.id}/payment`, {
        method: payment.method,
        reference: payment.reference.trim() || undefined,
        paidAt: payment.paidAt ? new Date(`${payment.paidAt}T12:00:00`).toISOString() : undefined,
      }),
    );
  const resend = () => act("link", async () => setLink(await apiPost<LinkResult>(`/api/orders/${o.id}/setup-link`, {})));
  const invoice = () => act("invoice", () => apiPost(`/api/orders/${o.id}/invoice`, {}));
  const removeDiscount = () => act("discount", () => apiPost(`/api/orders/${o.id}/discount/remove`, { reason: reason.trim() || undefined }));
  const disc = data.discount ?? null;
  const claimWaiting = disc?.status === "claimed";

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the link is selectable */
    }
  };

  const reviewable = o.status === "pending" || o.status === "paid";
  const canPay = (o.status === "pending" || o.status === "delivered") && !o.paid_at;
  const pay = paymentState(o);
  const overdue = pay === "overdue" && o.status === "delivered";
  const stage = orderStage(o);
  const field = "min-h-10 w-full rounded-[var(--radius-sm)] border px-3 text-sm";
  const fieldStyle: React.CSSProperties = { borderColor: "var(--line-strong)", background: "var(--surface-sunken)", color: "var(--ink)" };
  const plan = `${PLAN_LABEL[o.plan] ?? o.plan} · ${o.billing_period === "annual" ? "annual" : "per event"}`;

  return (
    <>
      <BackLink href="/workspace/orders">Orders</BackLink>
      <PageHead
        title={`Order ${o.order_code}`}
        sub={`${data.customer?.name ?? `Organisation #${o.customer_id}`} · ${plan} · placed ${when(o.placed_at || o.created_at)}`}
        actions={
          <a
            href={data.invoicePdf}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 text-[13px] font-medium"
            style={{ borderColor: "var(--line-strong)", color: "var(--ink)", background: "var(--surface)" }}
          >
            <Download size={14} /> Invoice PDF
          </a>
        }
      />
      <div className="-mt-3 mb-5 flex flex-wrap items-center gap-2">
        <OrderStatusBadge status={o.status} deliveredAt={o.delivered_at ?? null} />
        {o.paid_at ? <Badge tone="ok">Paid {day(o.paid_at)}</Badge> : pay ? <Badge tone={PAYMENT_TONE[pay]}>{PAYMENT_LABEL[pay]}</Badge> : <Badge tone="neutral">Not invoiced yet</Badge>}
        {data.entitlement?.live ? <Badge tone="info">Plan granted</Badge> : null}
      </div>

      {data.cardNotCharged ? (
        <p className="mb-4 rounded-[var(--radius-sm)] border px-3 py-2 text-sm" style={{ borderColor: "var(--warn)", background: "var(--warn-weak)", color: "var(--ink)" }}>
          <strong>Card not charged — collect by invoice.</strong> This order was placed with a card before card payment was switched off; no money was taken.
          {o.invoice_number ? ` Invoice ${o.invoice_number} asks for a bank transfer.` : " Approving it issues the invoice, which asks for a bank transfer."}
        </p>
      ) : null}
      {reviewable && data.billingReady === false ? (
        <p className="mb-4 rounded-[var(--radius-sm)] border px-3 py-2 text-sm" style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink-2)" }}>
          The invoice this approval issues will say the bank details follow by e-mail: your seller and bank details are not complete yet.{" "}
          <a href="/workspace/settings#billing" className="font-medium hover:underline" style={{ color: "var(--accent)" }}>Add them in Settings</a>.
        </p>
      ) : null}

      {claimWaiting && disc ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2.5 text-sm" style={{ borderColor: "var(--info)", background: "var(--info-weak)", color: "var(--ink)" }}>
          <p className="flex min-w-0 max-w-2xl items-start gap-2">
            <GraduationCap size={16} className="mt-0.5 shrink-0" style={{ color: "var(--info)" }} />
            <span>
              <strong>The buyer claimed a discount: {disc.label}</strong> ({money(disc.minor, o.currency)} off
              {disc.claim?.institution ? <>, as <strong>{disc.claim.institution}</strong></> : ", no institution named"}).
              {disc.removable ? " Approving the order accepts it. If it does not apply, remove it first; the order goes back to the plan's price." : " The order is decided, so the discount stays."}
            </span>
          </p>
          {disc.removable && mode === null ? (
            <Button size="sm" icon={<X size={13} />} disabled={busy !== null} onClick={() => { setReason(""); setMode("discount"); }}>Remove discount…</Button>
          ) : null}
        </div>
      ) : null}

      {o.status_reason ? (
        <p className="mb-4 rounded-[var(--radius-sm)] border px-3 py-2 text-sm" style={{ borderColor: "var(--line)", background: "var(--surface)", color: "var(--ink)" }}>
          <span style={{ color: "var(--ink-3)" }}>Reason given to the buyer: </span>{o.status_reason}
        </p>
      ) : null}

      {/* What the owner can do now. */}
      <Card className="mb-5" style={reviewable ? { borderColor: "var(--warn)", background: "var(--warn-weak)" } : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-xl">
            <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
              {reviewable ? "This order is waiting for your review" : STAGE_LABEL[stage]}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--ink-2)" }}>
              {reviewable
                ? `Approve to activate the organisation, grant the plan and issue the invoice (due in 14 days)${data.setupDone ? "; the organisation is already set up, so no setup link is sent" : ", and e-mail the buyer a setup link"}. Refuse to cancel it; the buyer reads your reason.`
                : o.status === "delivered"
                  ? "The plan is granted. Record a payment when the money arrives."
                  : "No decision is waiting on this order."}
            </p>
          </div>
          {mode === null ? (
            <div className="flex flex-wrap gap-2">
              {reviewable ? (
                <Button variant="primary" icon={<Check size={14} />} loading={busy === "approve"} disabled={busy !== null} onClick={approve}>
                  Approve and activate
                </Button>
              ) : null}
              {o.status === "pending" ? <Button icon={<X size={14} />} disabled={busy !== null} onClick={() => setMode("refuse")}>Refuse…</Button> : null}
              {canPay ? <Button disabled={busy !== null} onClick={() => setMode("payment")}>Record payment…</Button> : null}
              {o.status === "delivered" ? (
                <Button icon={<Mail size={14} />} loading={busy === "link"} disabled={busy !== null} onClick={resend}>Send setup link again</Button>
              ) : null}
              {!o.invoice_number && o.amount_minor != null && o.status !== "cancelled" ? (
                <Button variant="ghost" icon={<FileText size={14} />} loading={busy === "invoice"} disabled={busy !== null} onClick={invoice}>Issue invoice</Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {mode === "refuse" ? (
          <div className="mt-4 flex max-w-xl flex-col gap-2">
            <label className="text-sm font-medium" style={{ color: "var(--ink)" }} htmlFor="refuse-reason">Why is it refused? The buyer reads this.</label>
            <textarea id="refuse-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={`${field} py-2`} style={fieldStyle} />
            <div className="flex gap-2">
              <Button variant="danger" size="sm" disabled={reason.trim().length < 3 || busy !== null} loading={busy === "refuse"} onClick={refuse}>Refuse order</Button>
              <Button variant="ghost" size="sm" onClick={() => setMode(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}

        {mode === "discount" && disc ? (
          <div className="mt-4 flex max-w-xl flex-col gap-2">
            <p className="text-sm" style={{ color: "var(--ink)" }}>
              Remove <strong>{disc.label}</strong>? The order goes from {money(o.amount_minor, o.currency)} back to {money(disc.listMinor, o.currency)} before VAT, and the discount&apos;s use is given back.
            </p>
            <label className="text-xs" style={{ color: "var(--ink-3)" }} htmlFor="discount-reason">Why (kept in the order history)</label>
            <input id="discount-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not a registered non-profit" className={field} style={fieldStyle} />
            <div className="flex gap-2">
              <Button variant="danger" size="sm" disabled={busy !== null} loading={busy === "discount"} onClick={removeDiscount}>Remove discount</Button>
              <Button variant="ghost" size="sm" onClick={() => setMode(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}

        {mode === "payment" ? (
          <div className="mt-4 flex max-w-xl flex-col gap-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-xs" style={{ color: "var(--ink-3)" }}>
                Method
                <select value={payment.method} onChange={(e) => setPayment((p) => ({ ...p, method: e.target.value }))} className={`${field} mt-1`} style={fieldStyle}>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="card">Card</option>
                  <option value="cash">Cash</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="text-xs" style={{ color: "var(--ink-3)" }}>
                Received on
                <input type="date" value={payment.paidAt} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPayment((p) => ({ ...p, paidAt: e.target.value }))} className={`${field} mt-1`} style={fieldStyle} />
              </label>
            </div>
            <label className="text-xs" style={{ color: "var(--ink-3)" }}>
              Reference (bank transaction, receipt)
              <input value={payment.reference} onChange={(e) => setPayment((p) => ({ ...p, reference: e.target.value }))} className={`${field} mt-1`} style={fieldStyle} />
            </label>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" disabled={busy !== null} loading={busy === "payment"} onClick={recordPayment}>Record payment</Button>
              <Button variant="ghost" size="sm" onClick={() => setMode(null)}>Cancel</Button>
            </div>
          </div>
        ) : null}

        {link ? (
          <div className="mt-4 max-w-xl rounded-[var(--radius-sm)] border p-3" style={{ borderColor: link.mailSent ? "var(--ok)" : "var(--warn)", background: "var(--surface)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
              {link.setupSkipped
                ? `${link.mailSent ? "Approval e-mailed to the buyer with the invoice." : `E-mail not sent${link.mailMessage ? `: ${link.mailMessage}` : ""}.`} The organisation is already set up, so no setup link was sent.`
                : link.mailSent ? "Setup link e-mailed to the buyer." : `E-mail not sent${link.mailMessage ? `: ${link.mailMessage}` : ""}. Send them this link yourself:`}
            </p>
            {link.setupUrl ? (
              <div className="mt-2 flex items-center gap-2">
                <input readOnly value={link.setupUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Setup link" className={`${field} font-mono text-xs`} style={fieldStyle} />
                <Button size="sm" onClick={() => copy(link.setupUrl!)} icon={<Copy size={13} />}>{copied ? "Copied" : "Copy"}</Button>
              </div>
            ) : null}
            {link.setupExpiresAt ? <p className="mt-1 text-xs" style={{ color: "var(--ink-3)" }}>Valid until {when(link.setupExpiresAt)}, once.</p> : null}
          </div>
        ) : null}
        {failed ? <p className="mt-3 text-sm" role="alert" style={{ color: "var(--danger)" }}>{failed}</p> : null}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="What was bought">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: "var(--line)" }}>
                  <th className="pb-2 text-xs font-medium" style={{ color: "var(--ink-3)" }}>Item</th>
                  <th className="pb-2 text-right text-xs font-medium" style={{ color: "var(--ink-3)" }}>Qty</th>
                  <th className="pb-2 text-right text-xs font-medium" style={{ color: "var(--ink-3)" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.label} className="border-b" style={{ borderColor: "var(--line)" }}>
                    <td className="py-2.5 pr-3" style={{ color: "var(--ink)" }}>
                      {l.label}
                      {l.detail ? <p className="text-xs" style={{ color: "var(--ink-3)" }}>{l.detail}</p> : null}
                    </td>
                    <td className="py-2.5 text-right" style={{ color: "var(--ink-2)" }}>{l.quantity}</td>
                    <td className="py-2.5 text-right" style={{ color: l.discount ? "var(--ok)" : "var(--ink)", fontVariantNumeric: "tabular-nums", fontWeight: l.discount ? 600 : undefined }}>
                      {l.discount && l.amountMinor != null ? `−${money(Math.abs(l.amountMinor), data.totals.currency)}` : money(l.amountMinor, data.totals.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="ml-auto mt-3 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
              {data.totals.discountMinor ? (
                <>
                  <dt style={{ color: "var(--ink-3)" }}>Plan price</dt>
                  <dd className="text-right" style={{ color: "var(--ink)" }}>{money(data.totals.listMinor ?? null, data.totals.currency)}</dd>
                  <dt style={{ color: "var(--ink-3)" }}>Discount</dt>
                  <dd className="text-right font-medium" style={{ color: "var(--ok)" }}>−{money(data.totals.discountMinor, data.totals.currency)}</dd>
                </>
              ) : null}
              <dt style={{ color: "var(--ink-3)" }}>Subtotal</dt>
              <dd className="text-right" style={{ color: "var(--ink)" }}>{money(data.totals.netMinor, data.totals.currency)}</dd>
              <dt style={{ color: "var(--ink-3)" }}>VAT</dt>
              <dd className="text-right" style={{ color: "var(--ink)" }}>{data.totals.taxMinor ? money(data.totals.taxMinor, data.totals.currency) : money(0, data.totals.currency)}</dd>
              <dt className="border-t pt-1.5 font-semibold" style={{ color: "var(--ink)", borderColor: "var(--line)" }}>Total</dt>
              <dd className="border-t pt-1.5 text-right font-semibold" style={{ color: "var(--ink)", borderColor: "var(--line)" }}>{money(data.totals.grossMinor, data.totals.currency)}</dd>
            </dl>
            {data.totals.vatNote ? <p className="mt-2 text-right text-xs" style={{ color: "var(--ink-3)" }}>{data.totals.vatNote}</p> : null}
            {o.event_id ? (
              <p className="mt-3 text-xs" style={{ color: "var(--ink-3)" }}>
                For the event <EventLink id={o.event_id} name={o.event_name} />.
              </p>
            ) : null}
          </Panel>

          {disc ? (
            <Panel title="Discount">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: "var(--ink)" }}>
                  <BadgePercent size={15} style={{ color: "var(--ok)" }} /> {disc.label}
                </span>
                <Badge tone={DISCOUNT_STATUS[disc.status][1]}>{DISCOUNT_STATUS[disc.status][0]}</Badge>
              </div>
              <KeyValues
                rows={[
                  { label: disc.code ? "Code" : "Campaign", value: disc.couponId ? <a href={`/workspace/pricing?tab=discounts&coupon=${disc.couponId}`} className="hover:underline" style={{ color: "var(--ink)" }}>{disc.code ?? disc.label}</a> : disc.code ?? "—" },
                  { label: disc.status === "removed" ? "Would have taken off" : "Taken off", value: money(disc.minor, o.currency) },
                  { label: "Plan price", value: money(disc.listMinor, o.currency) },
                  { label: "Charged, before VAT", value: money(o.amount_minor, o.currency) },
                  ...(disc.claim ? [{ label: "Claimed as", value: disc.claim.institution || "University or non-profit, not named" }] : []),
                ]}
              />
            </Panel>
          ) : null}

          <Panel title="Payment and invoice">
            <KeyValues
              rows={[
                {
                  label: "Method",
                  value: (
                    <span className="inline-flex items-center gap-1.5">
                      {o.payment_method === "card" ? <CreditCard size={13} /> : <Landmark size={13} />}
                      {paymentText(o)}
                    </span>
                  ),
                },
                { label: "State", value: o.paid_at ? `Paid ${when(o.paid_at)}` : "Not paid" },
                { label: "Reference", value: o.payment_reference || "—" },
                { label: "Invoice", value: o.invoice_number ? o.invoice_number : "Not issued" },
                { label: "Issued", value: day(o.invoice_issued_at) },
                { label: "Due", value: o.invoice_due_at ? <span style={{ color: overdue ? "var(--danger)" : undefined }}>{day(o.invoice_due_at)}{overdue ? " · overdue" : ""}</span> : "—" },
                {
                  label: "Terms accepted",
                  value: o.terms_accepted_at
                    ? `${when(o.terms_accepted_at)} · version ${o.terms_version ?? "—"}`
                    : o.purchaser_user_id ? "Not recorded (placed before terms acceptance was asked)" : "Not asked (raised by the owner)",
                },
              ]}
            />
            {o.notes ? (
              <div className="mt-4 rounded-[var(--radius-sm)] border px-3 py-2" style={{ borderColor: "var(--line)" }}>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.09em]" style={{ color: "var(--ink-3)" }}>Notes</p>
                <p className="whitespace-pre-line text-xs leading-relaxed" style={{ color: "var(--ink-2)" }}>{o.notes}</p>
              </div>
            ) : null}
          </Panel>

          <Panel title="Status history">
            {data.history.length === 0 ? (
              <p className="py-4 text-center text-sm" style={{ color: "var(--ink-3)" }}>No changes recorded.</p>
            ) : (
              <ol className="relative flex flex-col gap-3 border-l pl-4" style={{ borderColor: "var(--line-strong)" }}>
                {data.history.map((h) => (
                  <li key={h.id} className="relative text-sm">
                    <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: "var(--surface)", background: "var(--accent-solid)" }} />
                    <p style={{ color: "var(--ink)" }}>
                      {h.from_status && h.from_status !== h.to_status
                        ? `${STATUS_LABEL[h.from_status as OrderStatus] ?? h.from_status} → ${STATUS_LABEL[h.to_status as OrderStatus] ?? h.to_status}`
                        : STATUS_LABEL[h.to_status as OrderStatus] ?? h.to_status}
                    </p>
                    <p className="text-xs" style={{ color: "var(--ink-3)" }}>
                      {when(h.created_at)}
                      {h.changed_by ? <> · <PersonLink id={h.changed_by} name={h.changed_by_name} muted /></> : null}
                      {h.note ? ` · ${h.note}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Organisation">
            {data.customer ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium"><OrgLink id={data.customer.id} name={data.customer.name} /></span>
                  <CustomerStatusBadge status={data.customer.archived_at ? "archived" : data.customer.status} />
                  {data.customer.plan_exempt ? <Badge tone="neutral">Exempt</Badge> : null}
                </div>
                <KeyValues
                  rows={[
                    { label: "Legal name", value: data.customer.legal_name || "—" },
                    { label: "VAT / VÖEN", value: data.customer.vat_id || "—" },
                    { label: "Billing e-mail", value: data.customer.billing_email || "—" },
                    { label: "Location", value: [data.customer.city, data.customer.country].filter(Boolean).join(", ") || "—" },
                  ]}
                />
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--ink-3)" }}>Organisation #{o.customer_id}</p>
            )}
          </Panel>

          <Panel title="Placed by">
            {data.purchaser ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium"><PersonLink id={data.purchaser.id} name={data.purchaser.full_name} /></p>
                  <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>{data.purchaser.email}</p>
                </div>
                <span className="flex gap-1">
                  <RoleBadge role={data.purchaser.role} />
                  {!data.purchaser.email_verified ? <Badge tone="warn">Unconfirmed</Badge> : null}
                </span>
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--ink-3)" }}>Raised by the owner, not through the checkout.</p>
            )}
          </Panel>

          <Panel title="Plan granted">
            {data.entitlement ? (
              <KeyValues
                rows={[
                  { label: "Plan", value: `${PLAN_LABEL[data.entitlement.plan] ?? data.entitlement.plan} · ${data.entitlement.kind === "annual" ? "annual" : "one event"}` },
                  { label: "State", value: data.entitlement.live ? "Live" : data.entitlement.revoked_at ? `Revoked ${day(data.entitlement.revoked_at)}` : "Ended" },
                  { label: "From – to", value: `${day(data.entitlement.starts_at)} – ${day(data.entitlement.ends_at)}` },
                  { label: "Events", value: `${data.entitlement.events_used} of ${data.entitlement.events_allowed ?? "unlimited"}` },
                  { label: "Participants per event", value: data.entitlement.participant_limit ?? "No limit" },
                  { label: "Seats · storage", value: `${data.entitlement.seat_limit ?? "No limit"} · ${data.entitlement.storage_gb != null ? `${data.entitlement.storage_gb} GB` : "no limit"}` },
                ]}
              />
            ) : (
              <p className="text-sm" style={{ color: "var(--ink-3)" }}>Nothing is granted until the order is approved.</p>
            )}
          </Panel>

          <Panel title="Audit trail">
            <AuditList rows={data.audit} showOrg={false} empty="No actions recorded on this order yet." />
          </Panel>
        </div>
      </div>
    </>
  );
}
