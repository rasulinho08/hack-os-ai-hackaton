"use client";

/**
 * Orders — where the owner decides.
 *
 * One request per page (`/api/owner/orders`), searched by order or invoice
 * number, organisation, buyer or payment reference, and filtered by status on
 * the server. The totals above the table count every matching order, not the
 * page. Opening an order goes to its own page, where it is approved, refused
 * or marked paid.
 *
 * `amount_minor` of `null` still renders as a dash: an order nobody has priced
 * is not an order worth zero.
 */

import Link from "next/link";
import { X } from "lucide-react";
import { Badge, ErrorState, Stat } from "@/components/ds/primitives";
import { DataTable, type Column } from "@/components/ds/DataTable";
import { PageHead } from "../_shell";
import { PAYMENT_METHOD_LABEL, PLAN_LABEL, STATUS_LABEL, type OrderStatus } from "@/lib/commerce";
import { BRAND_LABEL, type CardBrand } from "@/lib/card";
import { day, type OrderListRow, type OrderTotals } from "@/lib/superadmin/directory";
import { useServerTable } from "@/lib/superadmin/useServerTable";
import { OrderStatusBadge, OrgLink, PersonLink, hrefFor, money } from "../_ui";

function paymentText(o: OrderListRow): string {
  if (o.payment_method === "card") {
    const brand = BRAND_LABEL[(o.card_brand || "other") as CardBrand] ?? "Card";
    return `${brand} •••• ${o.card_last4 ?? "????"}${o.paid_at ? "" : " · not charged, collect by invoice"}`;
  }
  if (!o.payment_method) return "—";
  return PAYMENT_METHOD_LABEL[o.payment_method] ?? o.payment_method;
}

/** Totals by status, summed per currency (the platform sells in one today). */
function sum(totals: OrderTotals[], match: (t: OrderTotals) => boolean, paid = false) {
  const rows = totals.filter(match);
  const currency = rows[0]?.currency ?? "AZN";
  return {
    count: rows.reduce((n, t) => n + (paid ? t.paidCount : t.count), 0),
    minor: rows.reduce((n, t) => n + (paid ? t.paidMinor : t.minor), 0),
    unpriced: paid ? 0 : rows.reduce((n, t) => n + t.unpriced, 0),
    currency,
  };
}

const STATUSES: OrderStatus[] = ["pending", "paid", "delivered", "draft", "cancelled", "refunded"];

export default function OrdersPage() {
  const t = useServerTable<OrderListRow, { totals: OrderTotals[] }>({
    path: "/api/owner/orders",
    defaultSort: { id: "placed", dir: "desc" },
    facetKeys: ["status", "unpaid", "customerId", "discount"],
    syncUrl: true,
  });
  const totals = t.data?.totals ?? [];
  const review = sum(totals, (x) => x.status === "pending" || x.status === "paid");
  const active = sum(totals, (x) => x.status === "delivered");
  const paid = sum(totals, () => true, true);
  const hint = (s: ReturnType<typeof sum>) => `${s.count.toLocaleString("en-US")} order${s.count === 1 ? "" : "s"}${s.unpriced ? ` · ${s.unpriced} not priced` : ""}`;
  const customerId = t.state.facets.customerId?.[0];
  const customerName = customerId ? t.rows.find((r) => String(r.customer_id) === customerId)?.customer_name : null;

  const columns: Column<OrderListRow>[] = [
    {
      id: "code",
      header: "Order",
      sortable: true,
      value: (r) => r.order_code,
      cell: (r) => (
        <div className="min-w-0">
          <Link prefetch={false} href={hrefFor.order(r.id)} className="block truncate font-medium hover:underline" style={{ color: "var(--ink)" }}>
            {r.order_code}
          </Link>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>
            {PLAN_LABEL[r.plan] ?? r.plan} · {r.billing_period === "annual" ? "annual" : "per event"}
          </p>
        </div>
      ),
      width: "160px",
    },
    {
      id: "customer",
      header: "Organisation",
      sortable: true,
      value: (r) => r.customer_name,
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate"><OrgLink id={r.customer_id} name={r.customer_name} /></p>
          <p className="truncate text-xs" style={{ color: "var(--ink-3)" }}>
            {r.purchaser_user_id ? <>by <PersonLink id={r.purchaser_user_id} name={r.purchaser_name} muted /></> : "Raised by the owner"}
          </p>
        </div>
      ),
    },
    { id: "status", header: "Status", sortable: true, value: (r) => r.status, cell: (r) => <OrderStatusBadge status={r.status} deliveredAt={r.delivered_at} />, width: "170px" },
    {
      id: "amount",
      header: "Amount",
      sortable: true,
      value: (r) => r.amount_minor ?? -1,
      cell: (r) => (
        <span className="block whitespace-nowrap">
          <span style={{ color: r.amount_minor == null ? "var(--ink-3)" : "var(--ink)" }}>{money(r.amount_minor, r.currency)}</span>
          {r.discount_label && r.discount_status !== "removed" ? (
            <span className="block text-[11px]" style={{ color: r.discount_status === "claimed" ? "var(--info)" : "var(--ok)" }} title={r.discount_label}>
              {r.discount_status === "claimed" ? "claimed · " : ""}−{money(r.discount_minor ?? 0, r.currency)}
            </span>
          ) : null}
        </span>
      ),
      align: "right",
      width: "120px",
    },
    {
      id: "payment",
      header: "Payment",
      value: (r) => paymentText(r),
      cell: (r) => (
        <span className="block whitespace-nowrap text-xs">
          {paymentText(r)}
          {r.paid_at ? (
            <span className="block" style={{ color: "var(--ok)" }}>Paid {day(r.paid_at)}</span>
          ) : r.invoice_number ? (
            <span className="block" style={{ color: "var(--ink-3)" }}>{r.invoice_number}</span>
          ) : null}
        </span>
      ),
      width: "160px",
    },
    { id: "placed", header: "Placed", sortable: true, value: (r) => r.placed_at || r.created_at, cell: (r) => <span className="text-xs">{day(r.placed_at || r.created_at)}</span>, width: "110px" },
  ];

  return (
    <>
      <PageHead title="Orders" sub="Review what was ordered, approve or refuse it, and record payments." />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat label="Awaiting review" value={t.data ? money(review.minor, review.currency) : "—"} hint={t.data ? hint(review) : undefined} />
        <Stat label="Active" value={t.data ? money(active.minor, active.currency) : "—"} hint={t.data ? hint(active) : undefined} />
        <Stat label="Paid" value={t.data ? money(paid.minor, paid.currency) : "—"} hint={t.data ? `${paid.count.toLocaleString("en-US")} paid orders` : undefined} />
      </div>

      {customerId ? (
        <div className="mb-3 flex items-center gap-2 text-sm" style={{ color: "var(--ink-2)" }}>
          Showing the orders of
          <Badge tone="info">{customerName ?? `organisation #${customerId}`}</Badge>
          <button type="button" onClick={() => t.setFacet("customerId", [])} className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: "var(--ink-3)" }}>
            <X size={12} /> Show all
          </button>
        </div>
      ) : null}

      {t.error && !t.data ? (
        <ErrorState title="Could not load the orders" body={t.error} onRetry={t.reload} />
      ) : (
        <DataTable
          rows={t.rows}
          columns={columns}
          loading={t.loading}
          pageSize={t.pageSize}
          server={t.server}
          getHref={(r) => hrefFor.order(r.id)}
          searchPlaceholder="Search order or invoice number, organisation, buyer, code…"
          emptyTitle="No orders yet"
          emptyBody="An order appears here as soon as somebody places one through the website checkout."
          facets={[
            { id: "status", label: "Status", options: STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })), match: () => true },
            { id: "unpaid", label: "Payment", options: [{ value: "true", label: "Active but not paid" }], match: () => true },
            { id: "discount", label: "Discount", options: [{ value: "claimed", label: "Claimed, to review" }], match: () => true },
          ]}
        />
      )}
    </>
  );
}
