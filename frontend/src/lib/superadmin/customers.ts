/**
 * Customers, from the owner's side.
 *
 * Everything here reads `/api/customers`, which is superadmin-only at the
 * route — the console's own gate is convenience, this is what actually
 * refuses. `lib/tenancy.ts` is the customer-facing counterpart and never names
 * a customer id; this one does, because the owner is entitled to.
 *
 * Counts follow the rule the rest of the console uses: `null` means the read
 * failed, and a failed read is rendered as a dash, never as a zero. A customer
 * whose seat count did not load must not look like a customer with no seats.
 */

import { apiGet, apiPut } from "@/lib/api";
import type { Seats } from "@/lib/tenancy";

export interface Customer {
  id: number;
  name: string;
  legal_name?: string | null;
  sector?: string | null;
  country?: string | null;
  city?: string | null;
  website?: string | null;
  billing_email?: string | null;
  vat_id?: string | null;
  notes?: string | null;
  archived_at?: string | null;
  /** `null` means no limit was agreed — not unlimited-as-a-number, not zero. */
  seat_limit: number | null;
  created_at: string;
  /** pending_review until the first order is approved. */
  status?: "pending_review" | "pending_setup" | "active" | "suspended" | "cancelled";
  /** Organisations from before plans: every module, unlimited events. */
  plan_exempt?: boolean;
  onboarded_at?: string | null;
}

/** GET /api/customers/:id/plan (owner view: includes the switches' notes). */
export interface CustomerPlan {
  customerId: number;
  status: string;
  exempt: boolean;
  plan: string | null;
  eventsRemaining: number | null;
  limits: { participants: number | null; seats: number | null; storageGb: number | null };
  modules: string[];
  overrides: { module_key: string; enabled: boolean; note: string | null; set_at: string }[];
  entitlements: {
    id: number;
    orderId?: number | null;
    orderCode: string | null;
    plan: string;
    kind: "per_event" | "annual";
    startsAt: string;
    endsAt: string;
    eventsAllowed: number | null;
    eventsUsed: number;
    live: boolean;
    revokedAt: string | null;
  }[];
}

export const loadCustomerPlan = (customerId: number) => apiGet<CustomerPlan>(`/api/customers/${customerId}/plan`);

export const setModuleOverride = (customerId: number, key: string, enabled: boolean | null) =>
  apiPut<CustomerPlan>(`/api/customers/${customerId}/modules/${encodeURIComponent(key)}`, { enabled });

export const setPlanExempt = (customerId: number, exempt: boolean) =>
  apiPut<CustomerPlan>(`/api/customers/${customerId}/plan-exempt`, { exempt });

/**
 * Module keys in the order the console lists them, with the plans that include
 * each (C community, S starter, P professional, B business, E enterprise) — the
 * API's src/constants/modules.js.
 */
export const MODULE_CATALOG: { key: string; label: string; plans: string }[] = [
  { key: "events", label: "Events", plans: "CSPBE" },
  { key: "registration", label: "Registration", plans: "CSPBE" },
  { key: "participants", label: "Participants", plans: "CSPBE" },
  { key: "teams", label: "Teams", plans: "CSPBE" },
  { key: "submissions", label: "Submissions", plans: "CSPBE" },
  { key: "judging", label: "Judging", plans: "CSPBE" },
  { key: "results", label: "Results", plans: "CSPBE" },
  { key: "announcements", label: "Announcements", plans: "CSPBE" },
  { key: "telegram", label: "Telegram", plans: "CSPBE" },
  { key: "analytics", label: "Analytics", plans: "CSPBE" },
  { key: "export", label: "CSV export", plans: "CSPBE" },
  { key: "mentors", label: "Mentors & help tickets", plans: "PBE" },
  { key: "volunteers", label: "Volunteers", plans: "PBE" },
  { key: "presentations", label: "Presentations", plans: "PBE" },
  { key: "resources", label: "Resources", plans: "PBE" },
  { key: "certificates", label: "Certificates", plans: "CSPBE" },
  { key: "elimination", label: "Elimination rounds", plans: "PBE" },
  { key: "forms", label: "Custom registration fields", plans: "PBE" },
  { key: "automations", label: "Automations", plans: "PBE" },
  { key: "bigscreen", label: "Big screen", plans: "PBE" },
  { key: "reports", label: "Post-event report (PDF)", plans: "PBE" },
  { key: "analytics_adv", label: "Advanced analytics", plans: "PBE" },
  { key: "branding", label: "Branding", plans: "PBE" },
  { key: "calendar", label: "Calendar", plans: "BE" },
  { key: "chat", label: "Chat", plans: "BE" },
  { key: "checkin", label: "Check-in", plans: "BE" },
  { key: "gallery", label: "Gallery", plans: "BE" },
  { key: "webhooks", label: "Webhooks", plans: "BE" },
  { key: "support", label: "Priority support", plans: "E" },
  { key: "onprem", label: "On-premises", plans: "E" },
];

export interface CustomerEvent {
  id: number;
  event_code: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  is_published: boolean;
  participant_count: string | number;
}

/** A customer with the two figures the list needs, each independently failable. */
export interface CustomerRow extends Customer {
  seats: Seats | null;
  events: CustomerEvent[] | null;
}

export async function loadCustomers(): Promise<Customer[]> {
  const data = await apiGet<Customer[] | { customers?: Customer[] }>("/api/customers");
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.customers) ? data.customers : [];
}

export const setSeatLimit = (customerId: number, seatLimit: number | null) =>
  apiPut<{ id: number; name: string; seat_limit: number | null; seats: Seats }>(
    `/api/customers/${customerId}/seats`,
    { seatLimit },
  );

/** Put an event under a customer, or pass `null` to take it back out. */
export const assignEventCustomer = (eventId: number, customerId: number | null) =>
  apiPut<{ id: number; name: string; customer_id: number | null }>(
    `/api/events/${eventId}/customer`,
    { customerId },
  );
