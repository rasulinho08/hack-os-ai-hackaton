/**
 * The owner console's lists, detail pages, search and insights.
 *
 * Every read here is one request to `/api/owner/*`, answered by the server
 * over the whole table: a list is a page plus the total, searched, filtered
 * and sorted there. The console used to assemble these in the browser, two to
 * four requests per row, which the rate limiter cut short.
 *
 * Money stays in minor units until it is printed (`formatMinor`), and a
 * `null` amount is "not priced", printed as a dash, never as zero.
 */

import { api, apiGet, apiPatch, apiPost } from "@/lib/api";
import type { Phase } from "./owner";

/* ── Lists ─────────────────────────────────────────────────────────────── */

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  sort?: string;
  dir?: "asc" | "desc";
}

export interface ListQuery {
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  /** 1-based, as the API counts. */
  page?: number;
  pageSize?: number;
  /** Filters: each value a comma list (`status=active,pending_review`). */
  filters?: Record<string, string | string[] | number | boolean | null | undefined>;
}

/** The query string of a list request. Empty values are left out. */
export function listQueryString(q: ListQuery): string {
  const p = new URLSearchParams();
  if (q.q && q.q.trim()) p.set("q", q.q.trim());
  if (q.sort) p.set("sort", q.sort);
  if (q.dir) p.set("dir", q.dir);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  if (q.pageSize) p.set("pageSize", String(q.pageSize));
  for (const [k, v] of Object.entries(q.filters || {})) {
    if (v == null || v === false || v === "") continue;
    const value = Array.isArray(v) ? v.filter(Boolean).join(",") : String(v);
    if (value) p.set(k, value);
  }
  return p.toString();
}

export function loadPage<T>(path: string, q: ListQuery, signal?: AbortSignal): Promise<Page<T> & Record<string, unknown>> {
  const qs = listQueryString(q);
  return api<Page<T> & Record<string, unknown>>(`${path}${qs ? `?${qs}` : ""}`, signal ? { signal } : {});
}

/* ── Organisations ─────────────────────────────────────────────────────── */

export type CustomerStatus = "pending_review" | "pending_setup" | "active" | "suspended" | "cancelled" | "archived";

export const CUSTOMER_STATUS: Record<CustomerStatus, [string, "ok" | "warn" | "neutral" | "danger" | "info"]> = {
  pending_review: ["Under review", "warn"],
  pending_setup: ["Setup pending", "info"],
  active: ["Active", "ok"],
  suspended: ["Suspended", "danger"],
  cancelled: ["Closed", "neutral"],
  archived: ["Archived", "neutral"],
};

export interface SeatFigures {
  limit: number | null;
  used: number;
  linked: number;
  pending: number;
  over?: boolean;
  remaining?: number | null;
}

export interface CustomerListRow {
  id: number;
  name: string;
  legal_name: string | null;
  sector: string | null;
  country: string | null;
  city: string | null;
  billing_email: string | null;
  slug: string | null;
  status: CustomerStatus;
  plan_exempt: boolean;
  seat_limit: number | null;
  archived_at: string | null;
  created_at: string;
  onboarded_at: string | null;
  seats: SeatFigures;
  events: number;
  events_running: number;
  events_upcoming: number;
  participants: number;
  orders: number;
  orders_to_review: number;
  paid_minor: number;
  currency: string;
  plan: string | null;
  plan_kind: "per_event" | "annual" | null;
  plan_ends_at: string | null;
  last_activity: string | null;
}

export interface AuditEntry {
  id: number | string;
  actor_user_id: number | null;
  actor_name: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  event_id: number | null;
  event_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
}

export interface CustomerOrder {
  id: number;
  order_code: string;
  plan: string;
  billing_period: "per_event" | "annual";
  status: string;
  currency: string;
  amount_minor: number | null;
  tax_minor: number | null;
  placed_at: string | null;
  paid_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  invoice_number: string | null;
  invoice_issued_at: string | null;
  invoice_due_at: string | null;
  payment_method: string | null;
  event_id: number | null;
  event_name: string | null;
  purchaser_user_id: number | null;
  purchaser_name: string | null;
}

export interface CustomerDetail {
  customer: {
    id: number;
    name: string;
    legal_name: string | null;
    sector: string | null;
    country: string | null;
    city: string | null;
    website: string | null;
    vat_id: string | null;
    billing_email: string | null;
    notes: string | null;
    archived_at: string | null;
    created_at: string;
    updated_at: string;
    seat_limit: number | null;
    status: CustomerStatus;
    slug: string | null;
    plan_exempt: boolean;
    onboarded_at: string | null;
    timezone: string | null;
    locale: string | null;
    logo_url: string | null;
    brand_color: string | null;
  };
  plan: import("./customers").CustomerPlan;
  seats: SeatFigures;
  members: {
    id: number;
    user_id: number | null;
    email: string;
    role_title: string | null;
    is_primary: boolean;
    member_role: string;
    created_at: string;
    full_name: string | null;
    platform_role: string | null;
    email_verified: boolean | null;
  }[];
  invites: {
    id: number;
    email: string;
    full_name: string | null;
    role_title: string | null;
    grant_role: string;
    created_at: string;
    expires_at: string;
    invited_by: number | null;
    invited_by_name: string | null;
  }[];
  events: { total: number; byPhase: Partial<Record<Phase, number>> };
  usage: {
    events: { used: number; allowed: number | null };
    participants: { total: number; people: number; largestEvent: number; perEventLimit: number | null };
    seats: { used: number; limit: number | null };
  };
  orders: CustomerOrder[];
  revenue: { currency: string; paidMinor: number; outstandingMinor: number; reviewMinor: number }[];
  audit: AuditEntry[];
}

export const loadCustomerDetail = (id: number) => apiGet<CustomerDetail>(`/api/owner/customers/${id}`);

/* ── Events ────────────────────────────────────────────────────────────── */

export interface EventListRow {
  id: number;
  name: string;
  event_code: string;
  slug: string | null;
  customer_id: number | null;
  customer_name: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  is_published: boolean;
  max_participants: number | null;
  format: string | null;
  city: string | null;
  phase: Phase;
  plan: string | null;
  participant_limit: number | null;
  participants: number;
  approved: number;
  pending: number;
  waitlisted: number;
  teams: number;
  submissions: number;
  open_tickets: number;
  escalated: number;
  open_reports: number;
}

/* ── People ────────────────────────────────────────────────────────────── */

export interface UserListRow {
  id: number;
  full_name: string;
  email: string;
  role: string;
  created_at: string;
  email_verified: boolean;
  participations: number;
  staff_roles: number;
  organisations: number;
}

export const PLATFORM_ROLES = ["hacker", "pending", "judge", "mentor", "volunteer", "org_admin", "admin", "superadmin"] as const;

export const ROLE_LABEL: Record<string, string> = {
  superadmin: "Platform owner",
  admin: "Admin",
  org_admin: "Organiser",
  hacker: "Participant",
  pending: "Pending",
  judge: "Judge",
  mentor: "Mentor",
  volunteer: "Volunteer",
};

export const ROLE_TONE: Record<string, "brand" | "ok" | "info" | "warn" | "neutral" | "danger"> = {
  superadmin: "danger",
  admin: "brand",
  org_admin: "brand",
  judge: "info",
  mentor: "ok",
  volunteer: "warn",
  hacker: "neutral",
  pending: "neutral",
};

export interface UserDetail {
  user: {
    id: number;
    full_name: string;
    email: string;
    role: string;
    avatar: string | null;
    country: string | null;
    university: string | null;
    github_link: string | null;
    linkedin: string | null;
    created_at: string;
    updated_at: string;
    email_verified_at: string | null;
    email_verified: boolean;
  };
  lastSignInAt: string | null;
  memberships: {
    id: number;
    customer_id: number;
    customer_name: string;
    customer_status: CustomerStatus;
    archived_at: string | null;
    member_role: string;
    role_title: string | null;
    is_primary: boolean;
    created_at: string;
  }[];
  invites: { id: number; customer_id: number; customer_name: string; grant_role: string; created_at: string; expires_at: string }[];
  roles: {
    role: "participant" | "judge" | "mentor" | "volunteer" | "creator";
    status: string | null;
    since: string | null;
    team_id: number | null;
    team_name: string | null;
    event_id: number;
    event_name: string;
    event_code: string;
    customer_id: number | null;
    customer_name: string | null;
    phase: Phase;
    start_date: string | null;
  }[];
  teams: {
    id: number;
    name: string;
    status: string;
    is_leader: boolean;
    joined_at: string;
    event_id: number;
    event_name: string;
    members: number;
    submissions: number;
  }[];
  orders: {
    id: number;
    order_code: string;
    customer_id: number;
    customer_name: string;
    plan: string;
    billing_period: string;
    status: string;
    currency: string;
    amount_minor: number | null;
    placed_at: string | null;
    paid_at: string | null;
    created_at: string;
  }[];
  auditBy: AuditEntry[];
  auditAbout: AuditEntry[];
}

export const loadUserDetail = (id: number) => apiGet<UserDetail>(`/api/owner/users/${id}`);

export const resendVerification = (id: number) =>
  apiPost<{ sent: boolean; mailConfigured: boolean; expiresInHours: number }>(`/api/owner/users/${id}/verification`, {});

export const signOutEverywhere = (id: number) => apiPost<{ signedOut: boolean }>(`/api/owner/users/${id}/sign-out`, {});

/** The existing, guarded role change (only the owner may grant or remove platform ownership). */
export const changePlatformRole = (id: number, role: string) =>
  apiPatch<unknown>(`/api/users/${id}/role`, { role });

/* ── Orders ────────────────────────────────────────────────────────────── */

export interface OrderListRow {
  id: number;
  order_code: string;
  customer_id: number;
  customer_name: string;
  event_id: number | null;
  event_name: string | null;
  purchaser_user_id: number | null;
  purchaser_name: string | null;
  plan: string;
  billing_period: "per_event" | "annual";
  status: import("@/lib/commerce").OrderStatus;
  currency: string;
  amount_minor: number | null;
  tax_minor: number | null;
  placed_at: string | null;
  paid_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  invoice_number: string | null;
  invoice_due_at: string | null;
  payment_method: string | null;
  card_brand: string | null;
  card_last4: string | null;
  discount_code?: string | null;
  discount_label?: string | null;
  discount_minor?: number | null;
  discount_status?: "applied" | "claimed" | "approved" | "removed" | null;
}

export interface OrderTotals {
  status: string;
  currency: string;
  count: number;
  minor: number;
  unpriced: number;
  paidMinor: number;
  paidCount: number;
}

export interface OrderDetail {
  order: import("@/lib/commerce").Order & {
    purchaser_user_id: number | null;
    customer_billing_email?: string | null;
  };
  /** The plan at its price and, under it, the discount (`discount: true`, a negative amount). */
  lines: { label: string; detail: string | null; quantity: number; amountMinor: number | null; discount?: boolean }[];
  totals: {
    /** The plan's price before the discount, and the discount; `netMinor` is after it. */
    listMinor?: number | null;
    discountMinor?: number;
    netMinor: number | null;
    taxMinor: number | null;
    grossMinor: number | null;
    currency: string;
    vatNote: string | null;
  };
  /** The discount on the order, if any; `removable` while a claim waits for the owner. */
  discount?: {
    couponId: number | null;
    code: string | null;
    label: string;
    minor: number;
    status: "applied" | "claimed" | "approved" | "removed";
    claim: { type: string; institution: string | null } | null;
    listMinor: number | null;
    removable: boolean;
  } | null;
  history: { id: number; from_status: string | null; to_status: string; note: string | null; changed_by: number | null; changed_by_name: string | null; created_at: string }[];
  audit: AuditEntry[];
  entitlement: {
    id: number;
    plan: string;
    kind: "per_event" | "annual";
    starts_at: string;
    ends_at: string;
    events_allowed: number | null;
    events_used: number;
    participant_limit: number | null;
    seat_limit: number | null;
    storage_gb: number | null;
    revoked_at: string | null;
    live: boolean;
  } | null;
  purchaser: { id: number; full_name: string; email: string; role: string; email_verified: boolean } | null;
  customer: {
    id: number;
    name: string;
    legal_name: string | null;
    vat_id: string | null;
    billing_email: string | null;
    country: string | null;
    city: string | null;
    status: CustomerStatus;
    plan_exempt: boolean;
    archived_at: string | null;
    onboarded_at?: string | null;
  } | null;
  invoicePdf: string;
  /** A card order from before card payment was switched off: nothing was charged. */
  cardNotCharged?: boolean;
  /** The organisation has finished setup; approving again sends no setup link. */
  setupDone?: boolean;
  /** The seller's legal and bank details are complete (Settings → Billing and invoices). */
  billingReady?: boolean;
}

export const loadOrderDetail = (id: number) => apiGet<OrderDetail>(`/api/owner/orders/${id}`);

/* ── Search ────────────────────────────────────────────────────────────── */

export interface SearchResult {
  q: string;
  organisations: { id: number; name: string; status: CustomerStatus; city: string | null; country: string | null; archived_at: string | null }[];
  people: { id: number; full_name: string; email: string; role: string }[];
  orders: { id: number; order_code: string; status: string; invoice_number: string | null; customer_name: string; amount_minor: number | null; currency: string }[];
  events: { id: number; name: string; event_code: string; phase: Phase; customer_name: string | null }[];
}

export const searchOwner = (q: string, signal?: AbortSignal) =>
  api<SearchResult>(`/api/owner/search?q=${encodeURIComponent(q)}`, signal ? { signal } : {});

/* ── Overview insights ─────────────────────────────────────────────────── */

export interface Insights {
  revenueByMonth: {
    currency: string;
    months: { month: string; paidMinor: number; paidOrders: number; pendingMinor: number; pendingOrders: number }[];
  }[];
  funnel: { key: string; label: string; value: number }[];
  topByParticipants: { id: number; name: string; participants: number; events: number }[];
  topByRevenue: { id: number; name: string; currency: string; paid_minor: number; orders: number }[];
  waiting: {
    ordersToReview: number;
    orgsAwaitingApproval: number;
    reportedMessages: number;
    failedJobs: number;
    escalatedTickets: number;
    overdueInvoices: number;
    runningEvents: number;
  };
}

export const loadInsights = () => apiGet<Insights>("/api/owner/insights");

export const loadActivity = (after?: number | string | null, limit = 15) =>
  apiGet<AuditEntry[]>(`/api/owner/activity?limit=${limit}${after ? `&after=${encodeURIComponent(String(after))}` : ""}`);

export interface Analytics {
  monthly: { month: string; accounts: number; registrations: number; events: number; teams: number; submissions: number }[];
  participantStatus: { status: string; n: number }[];
  topEvents: { id: number; name: string; event_code: string; phase: Phase; participants: number; teams: number; submissions: number }[];
  totals: { events: number; participants: number; teams: number; submissions: number; feedback: number; checkins: number };
}

export const loadAnalytics = () => apiGet<Analytics>("/api/owner/analytics");

/* ── Judging, support, feedback ────────────────────────────────────────── */

export interface JudgingRow {
  id: number;
  name: string;
  event_code: string;
  customer_id: number | null;
  customer_name: string | null;
  phase: Phase;
  start_date: string | null;
  judging_start: string | null;
  judging_end: string | null;
  judges: number;
  criteria: number;
  submissions: number;
  scores: number;
  coverage: number | null;
}

export interface TicketRow {
  id: number;
  event_id: number;
  event_name: string;
  customer_id: number | null;
  team_id: number | null;
  team_name: string | null;
  topic: string | null;
  status: string;
  priority: string | null;
  escalated_to_admin: boolean;
  created_at: string;
  claimed_at: string | null;
  resolved_at: string | null;
  mentor_id: number | null;
  mentor_name: string | null;
  requester_id: number | null;
  requester_name: string | null;
}

export interface FeedbackRow {
  id: number;
  event_id: number;
  event_name: string;
  customer_id: number | null;
  customer_name: string | null;
  rating: number | null;
  nps: number | null;
  comment: string | null;
  type: string | null;
  created_at: string;
}

/* ── Formatting ────────────────────────────────────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" → "Oct 2026" (or "Oct" when short). */
export function monthLabel(month: string, short = false): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const name = MONTHS[Number(m[2]) - 1] ?? m[2];
  return short ? name : `${name} ${m[1]}`;
}

/** 23 Oct 2026 */
export function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** 23 Oct, 14:05 */
export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "3 min ago", "2 h ago", "5 d ago", then the date. */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} d ago`;
  return day(iso);
}

/** "order.approve" → "Order approve"; known actions get their own words. */
const ACTION_WORDS: Record<string, string> = {
  "order.approve": "approved an order",
  "order.reject": "refused an order",
  "order.payment": "recorded a payment",
  "order.status": "changed an order's status",
  "order.setup_link": "sent a setup link",
  "customer.module": "switched a module",
  "customer.plan_exempt": "changed plan exemption",
  "customer.setup": "finished setting up the organisation",
  "event.create": "created an event",
  "event.publish": "published an event",
  "event.unpublish": "unpublished an event",
  "event.delete": "deleted an event",
  "event.archived": "archived an event",
  "event.unarchived": "restored an event",
  "event.staff.add": "added event staff",
  "participant.status": "changed a registration",
  "participant.bulk_status": "changed registrations in bulk",
  "team.created": "created a team",
  "results.published": "published results",
  "user.role.change": "changed a platform role",
  "user.email.verify": "confirmed their e-mail",
  "user.password.change": "changed their password",
  "user.password.set": "had a password set",
  "session.revoke_all": "ended every session",
  "owner.user.verification_sent": "sent a confirmation link",
  "owner.notice.update": "updated the site notice",
  "owner.billing.update": "updated the billing details",
  "owner.price.update": "changed a plan's prices",
  "owner.coupon.create": "created a discount",
  "owner.coupon.update": "edited a discount",
  "owner.coupon.pause": "paused a discount",
  "owner.coupon.resume": "resumed a discount",
  "owner.coupon.delete": "deleted a discount",
  "coupon.redeem": "used a discount on an order",
  "order.discount.remove": "removed a claimed discount",
  "customer.community.grant": "granted the free Community plan",
  "owner.event.update": "edited an event page",
  "owner.event.publish": "published an event",
  "owner.event.unpublish": "unpublished an event",
  "owner.event.archive": "archived an event",
  "owner.event.unarchive": "brought an event back from the archive",
  "owner.event.feature": "pinned an event in the directory",
  "owner.event.unfeature": "unpinned an event in the directory",
  "owner.event.feature_rank": "moved a pinned event",
  "owner.event.mark_test": "marked an event as a test",
  "owner.event.unmark_test": "took the test mark off an event",
  "owner.showcase.create": "started a story",
  "owner.showcase.update": "edited a story",
  "owner.showcase.publish": "published a story",
  "owner.showcase.unpublish": "unpublished a story",
  "owner.showcase.schedule": "scheduled a story",
  "owner.showcase.publish_scheduled": "published a scheduled story",
  "owner.showcase.delete": "deleted a story",
  "owner.showcase.upload": "uploaded a story photo",
  "chat.report.remove": "removed a reported message",
};

export function actionWords(action: string): string {
  if (ACTION_WORDS[action]) return ACTION_WORDS[action];
  const words = action.replace(/[._]/g, " ").trim();
  return words ? words[0].toLowerCase() + words.slice(1) : action;
}

/* ── One event ─────────────────────────────────────────────────────────── */

export interface EventDetail {
  event: {
    id: number;
    name: string;
    event_code: string;
    slug: string | null;
    tagline: string | null;
    category: string | null;
    format: string | null;
    city: string | null;
    country: string | null;
    venue_name: string | null;
    timezone: string | null;
    start_date: string | null;
    end_date: string | null;
    registration_start: string | null;
    registration_end: string | null;
    submission_deadline: string | null;
    judging_start: string | null;
    judging_end: string | null;
    results_at: string | null;
    is_published: boolean;
    status: string | null;
    max_participants: number | null;
    registration_mode: string | null;
    team_size_limit: number | null;
    created_at: string;
    updated_at: string;
    customer_id: number | null;
    customer_name: string | null;
    customer_status: CustomerStatus | null;
    customer_archived_at: string | null;
    created_by: number | null;
    creator_name: string | null;
    entitlement_id: number | null;
    plan: string | null;
    plan_kind: string | null;
    participant_limit: number | null;
    phase: Phase;
    visibility?: "public" | "private" | "invite";
    directory_listed?: boolean;
    directory_featured?: boolean;
    directory_featured_rank?: number | null;
    is_test?: boolean;
    archived_at?: string | null;
  };
  participants: Record<string, number>;
  counts: {
    teams: number;
    submissions: number;
    judges: number;
    mentors: number;
    volunteers: number;
    criteria: number;
    scores: number;
    open_reports: number;
    checkins: number;
    feedback: number;
    rating: number | null;
  };
  coverage: number | null;
  tickets: Record<string, number>;
  escalated: number;
  order: { id: number; order_code: string; status: string; plan: string; billing_period: string; amount_minor: number | null; currency: string; paid_at: string | null } | null;
  audit: AuditEntry[];
}

export const loadEventDetail = (id: number) => apiGet<EventDetail>(`/api/owner/events/${id}`);
