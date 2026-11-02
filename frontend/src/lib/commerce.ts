/**
 * The buyer's own commercial data.
 *
 * Everything here reads `/api/me/*`, which the backend scopes from the session
 * rather than from anything the caller passes. There is deliberately no
 * customer id parameter in this file: if the client could name a customer, the
 * scope would be the client's to choose.
 *
 * Money arrives as an integer of minor units — qəpik for AZN — and is
 * formatted, never arithmetic'd, on this side.
 */

import { apiGet } from "@/lib/api";

export type OrderStatus =
  | "draft"
  | "pending"
  | "paid"
  | "delivered"
  | "cancelled"
  | "refunded";

export interface Order {
  id: number;
  order_code: string;
  customer_id: number;
  customer_name?: string;
  event_id: number | null;
  event_name?: string | null;
  event_code?: string | null;
  event_start_date?: string | null;
  event_end_date?: string | null;
  plan: string;
  billing_period: "per_event" | "annual";
  status: OrderStatus;
  currency: string;
  /** Minor units. `null` means not priced, which is not the same as free. */
  amount_minor: number | null;
  tax_minor: number | null;
  placed_at?: string | null;
  paid_at?: string | null;
  delivered_at?: string | null;
  created_at: string;
  notes?: string | null;

  /** Set once, when the invoice is issued. Never regenerated. */
  invoice_number?: string | null;
  invoice_issued_at?: string | null;
  invoice_due_at?: string | null;
  /** How the buyer chose to pay at checkout, or how the money arrived. */
  payment_method?: "bank_transfer" | "card" | "cash" | "other" | null;
  payment_reference?: string | null;
  /** Card orders keep the brand and last four digits only. */
  card_brand?: string | null;
  card_last4?: string | null;
  /** Why an order was refused or withdrawn, in the owner's words. */
  status_reason?: string | null;
  cancelled_at?: string | null;
  /** When the buyer accepted the terms at checkout, and which version. */
  terms_accepted_at?: string | null;
  terms_version?: string | null;
  /** The language the buyer ordered in (its e-mails follow it). */
  locale?: string | null;

  /**
   * Discounts: the plan's price before it (`list_amount_minor`), what was
   * taken off and by which code or campaign; `amount_minor` is what is
   * charged. `discount_status`: applied, claimed (waiting for the owner's
   * review), approved, removed.
   */
  list_amount_minor?: number | null;
  discount_minor?: number | null;
  coupon_id?: number | null;
  discount_code?: string | null;
  discount_label?: string | null;
  discount_status?: "applied" | "claimed" | "approved" | "removed" | null;
  discount_claim?: { type: string; institution: string | null } | null;
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank transfer",
  card: "Card",
  cash: "Cash",
  other: "Other",
};

export interface CustomerSummary {
  id: number;
  name: string;
  legal_name?: string | null;
  sector?: string | null;
  country?: string | null;
  city?: string | null;
  billing_email?: string | null;
  vat_id?: string | null;
  /** pending_review until the owner approves the first order. */
  status?: "pending_review" | "pending_setup" | "active" | "suspended" | "cancelled";
  onboarded_at?: string | null;
  plan_exempt?: boolean;
  /** This account's role in the organisation: only an owner changes its billing details. */
  my_role?: "owner" | "admin" | "member" | string | null;
}

/** Where an invoice is paid: the seller's account, as the invoice prints it. */
export interface SellerPayTo {
  /** False while the owner has not filled in the legal and bank details. */
  ready: boolean;
  legalName: string | null;
  taxId: string | null;
  bankName: string | null;
  accountHolder: string | null;
  iban: string | null;
  ibanGrouped: string | null;
  swift: string | null;
  vat: { registered: boolean; ratePercent: number | null };
}

/** GET /api/me/organisations/:id/plan */
export interface OrganisationPlan {
  customerId: number;
  status: string;
  exempt: boolean;
  plan: string | null;
  /** null = unlimited. */
  eventsRemaining: number | null;
  limits: { participants: number | null; seats: number | null; storageGb: number | null };
  modules: string[];
  entitlements: {
    id: number;
    orderCode: string | null;
    plan: string;
    kind: "per_event" | "annual";
    startsAt: string;
    endsAt: string;
    eventsAllowed: number | null;
    eventsUsed: number;
    live: boolean;
  }[];
}

export async function loadOrganisationPlan(customerId: number): Promise<OrganisationPlan> {
  return apiGet<OrganisationPlan>(`/api/me/organisations/${customerId}/plan`);
}

export interface MyCommerce {
  orders: Order[];
  customers: CustomerSummary[];
  seller: SellerPayTo | null;
}

export async function loadMyCommerce(): Promise<MyCommerce> {
  const data = await apiGet<Partial<MyCommerce>>("/api/me/orders");
  return {
    orders: Array.isArray(data?.orders) ? data.orders : [],
    customers: Array.isArray(data?.customers) ? data.customers : [],
    seller: data?.seller ?? null,
  };
}

/** Whether this account has anything paid for. A bare boolean, by design. */
export async function loadEntitlement(): Promise<boolean> {
  const data = await apiGet<{ entitled?: boolean }>("/api/me/entitlement");
  return Boolean(data?.entitled);
}

const SYMBOLS: Record<string, string> = { AZN: "₼", USD: "$", EUR: "€", GBP: "£" };

/**
 * Minor units to a readable amount.
 *
 * `null` is rendered as a dash by the caller, not as zero — an unpriced order
 * and a free one are different facts and must not look the same.
 */
/**
 * Money as a number, whatever the API sent.
 *
 * `amount_minor` is a Postgres BIGINT, and node-postgres returns those as
 * **strings** — it will not risk silently losing precision past 2^53. So the
 * value arrives as `"1490000"` while every type in this file calls it a
 * number. Displaying it works by accident (`/100` coerces); adding two of them
 * does not, and the owner console showed ₼14,900,004,900 owed because
 * `0 + "1490000" + "490000"` is string concatenation.
 *
 * Anything that does arithmetic on money must go through this first.
 */
export function minorOf(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(minor: number | string | null, currency = "AZN"): string | null {
  const value = minorOf(minor);
  if (value == null) return null;
  const symbol = SYMBOLS[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;
  return `${symbol}${(value / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const PLAN_LABEL: Record<string, string> = {
  community: "Community",
  starter: "Starter",
  professional: "Professional",
  business: "Business",
  enterprise: "Enterprise",
};

/*
 * One vocabulary for an order, everywhere it is shown — checkout, e-mail,
 * the buyer's account and the console:
 *
 *   received → under review → approved · active → paid, or refused / cancelled
 *
 * The status says where the order stands; payment is a separate chip
 * (awaiting payment once invoiced, paid once recorded). "Refused" is a
 * cancelled order that was never active; one cancelled after activation is
 * "cancelled". The buyer's pages translate the stage (order.stage.* in the
 * i18n maps); the console, which is in English, uses STAGE_LABEL.
 */
export type OrderStage = "draft" | "under_review" | "active" | "refused" | "cancelled" | "refunded";
export type PaymentState = "paid" | "awaiting" | "overdue" | null;

type StageSource = Pick<Order, "status"> & Partial<Pick<Order, "delivered_at" | "paid_at" | "invoice_number" | "invoice_due_at">>;

export function orderStage(o: StageSource): OrderStage {
  switch (o.status) {
    case "pending":
    case "paid":
      return "under_review";
    case "delivered":
      return "active";
    case "cancelled":
      return o.delivered_at ? "cancelled" : "refused";
    case "refunded":
      return "refunded";
    default:
      return "draft";
  }
}

/** Paid once recorded; awaiting (or overdue) once an invoice is out; else nothing to say yet. */
export function paymentState(o: StageSource, now = Date.now()): PaymentState {
  if (o.paid_at) return "paid";
  const stage = orderStage(o);
  if (!o.invoice_number || (stage !== "active" && stage !== "under_review")) return null;
  return o.invoice_due_at && new Date(o.invoice_due_at).getTime() < now ? "overdue" : "awaiting";
}

export const STAGE_LABEL: Record<OrderStage, string> = {
  draft: "Draft",
  under_review: "Under review",
  active: "Approved · active",
  refused: "Refused",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export const STAGE_TONE: Record<OrderStage, "neutral" | "warn" | "ok" | "info" | "danger"> = {
  draft: "neutral",
  under_review: "warn",
  active: "ok",
  refused: "danger",
  cancelled: "neutral",
  refunded: "danger",
};

export const PAYMENT_LABEL: Record<Exclude<PaymentState, null>, string> = {
  paid: "Paid",
  awaiting: "Awaiting payment",
  overdue: "Payment overdue",
};

export const PAYMENT_TONE: Record<Exclude<PaymentState, null>, "ok" | "info" | "danger"> = {
  paid: "ok",
  awaiting: "info",
  overdue: "danger",
};

/**
 * The raw status in the same words, where only the status is known (the
 * console's filters and the status history). "paid" here is a placed order
 * whose money arrived before approval.
 */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Draft",
  pending: "Under review",
  paid: "Under review · paid",
  delivered: "Approved · active",
  cancelled: "Refused / cancelled",
  refunded: "Refunded",
};

export const STATUS_TONE: Record<OrderStatus, "neutral" | "warn" | "ok" | "info" | "danger"> = {
  draft: "neutral",
  pending: "warn",
  paid: "warn",
  delivered: "ok",
  cancelled: "neutral",
  refunded: "danger",
};
