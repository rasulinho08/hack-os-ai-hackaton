/**
 * An organisation's outgoing webhooks (/account/webhooks): its endpoints,
 * their deliveries, and the calls that manage them (the API is
 * /api/account/webhooks; the backend's docs/WEBHOOKS.md is the guide for
 * whoever builds the receiving end).
 *
 * The signing secret is only ever in the answer to creating an endpoint or
 * rotating its secret. Nothing here keeps it: the page shows it once and lets
 * it go.
 */

import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";

/** What an endpoint can hear about, in the order the API lists them. */
export const WEBHOOK_EVENT_TYPES = [
  "registration.created",
  "participant.approved",
  "participant.rejected",
  "team.created",
  "submission.created",
  "results.published",
  "certificate.issued",
  "event.published",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** A delivery's type: one of the above, or the test. */
export const DELIVERY_TYPES = [...WEBHOOK_EVENT_TYPES, "ping"] as const;

export const DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Why the API refused a field (the `code` of its validation error). */
export const FIELD_CODES = [
  "URL_REQUIRED",
  "URL_TOO_LONG",
  "URL_INVALID",
  "URL_NOT_HTTPS",
  "URL_CREDENTIALS",
  "URL_NO_HOST",
  "URL_LOCAL_NAME",
  "URL_PRIVATE_ADDRESS",
  "URL_BLOCKED_ADDRESS",
  "URL_NOT_FOUND",
  "EVENTS_REQUIRED",
  "EVENTS_UNKNOWN",
  "TOO_LONG",
] as const;

/** The API's answers this page says in its own words. */
export const ERROR_CODES = ["TOO_MANY_ENDPOINTS", "DELIVERY_PENDING", "RATE_LIMITED", "NOT_FOUND"] as const;

export interface Organisation {
  id: number;
  name: string;
}

export interface WebhookEndpoint {
  id: number;
  url: string;
  urlHost: string;
  description: string | null;
  /** The types it receives; ["*"] for all of them. */
  events: string[];
  active: boolean;
  /** "failing" (switched off after failures) or "manual"; null while on. */
  disabledReason: string | null;
  disabledAt: string | null;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: "delivered" | "retrying" | "failed" | null;
  secretRotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: number;
  /** Sent as X-HackOS-Delivery. */
  deliveryId: string;
  endpointId: number;
  eventId: number | null;
  type: string;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  lastResponse: string | null;
  lastDurationMs: number | null;
  nextAttemptAt: string | null;
  redeliveryOf: number | null;
  createdAt: string;
  deliveredAt: string | null;
  payload: unknown;
}

export interface WebhooksView {
  organisation: Organisation;
  /** The organisations this person manages webhooks for. */
  organisations: Organisation[];
  /** Whether the organisation's plan includes webhooks. */
  enabled: boolean;
  eventTypes: string[];
  maxEndpoints: number;
  endpoints: WebhookEndpoint[];
}

export interface DeliveryPage {
  items: WebhookDelivery[];
  /** Pass as `before` for the next, older page; null on the last one. */
  nextBefore: number | null;
}

export interface EndpointInput {
  url: string;
  events: string[];
  description: string;
}

const BASE = "/api/account/webhooks";

/** `path` with `?customerId=` when an organisation was picked. */
export function scoped(path: string, customerId: number | null | undefined, extra: Record<string, string | number | null | undefined> = {}): string {
  const q = new URLSearchParams();
  if (customerId != null) q.set("customerId", String(customerId));
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export const loadWebhooks = (customerId?: number | null) =>
  apiGet<WebhooksView>(scoped(BASE, customerId));

export const createEndpoint = (customerId: number | null, input: EndpointInput) =>
  apiPost<{ endpoint: WebhookEndpoint; secret: string }>(scoped(BASE, customerId), input);

export const updateEndpoint = (customerId: number | null, id: number, patch: Partial<EndpointInput> & { active?: boolean }) =>
  apiPatch<{ endpoint: WebhookEndpoint; changed: string[] }>(scoped(`${BASE}/${id}`, customerId), patch);

export const deleteEndpoint = (customerId: number | null, id: number) =>
  apiDelete<{ id: number }>(scoped(`${BASE}/${id}`, customerId));

export const rotateSecret = (customerId: number | null, id: number) =>
  apiPost<{ endpoint: WebhookEndpoint; secret: string }>(scoped(`${BASE}/${id}/rotate`, customerId), {});

export const sendTest = (customerId: number | null, id: number) =>
  apiPost<{ delivery: WebhookDelivery }>(scoped(`${BASE}/${id}/test`, customerId), {});

export const loadDeliveries = (customerId: number | null, id: number, { before = null, limit = 20 }: { before?: number | null; limit?: number } = {}) =>
  apiGet<DeliveryPage>(scoped(`${BASE}/${id}/deliveries`, customerId, { limit, before }));

export const redeliver = (customerId: number | null, endpointId: number, deliveryId: number) =>
  apiPost<{ delivery: WebhookDelivery }>(scoped(`${BASE}/${endpointId}/deliveries/${deliveryId}/redeliver`, customerId), {});

/** How an endpoint is doing, for its badge. */
export type Health = "off_failing" | "off_manual" | "failing" | "retrying" | "ok" | "new";

export function healthOf(e: Pick<WebhookEndpoint, "active" | "disabledReason" | "consecutiveFailures" | "lastDeliveryStatus">): Health {
  if (!e.active) return e.disabledReason === "failing" ? "off_failing" : "off_manual";
  if (e.consecutiveFailures > 0) return "failing";
  if (e.lastDeliveryStatus === "retrying") return "retrying";
  if (e.lastDeliveryStatus === "delivered") return "ok";
  if (e.lastDeliveryStatus === "failed") return "failing";
  return "new";
}

export const HEALTH_TONE: Record<Health, "ok" | "warn" | "danger" | "neutral" | "info"> = {
  ok: "ok",
  new: "info",
  retrying: "warn",
  failing: "warn",
  off_failing: "danger",
  off_manual: "neutral",
};

export const STATUS_TONE: Record<DeliveryStatus, "ok" | "warn" | "danger"> = {
  delivered: "ok",
  pending: "warn",
  failed: "danger",
};

/** Whether an endpoint receives everything. */
export const receivesAll = (events: string[]) => events.includes("*");

/**
 * The i18n key for why the API refused something: a field's code
 * (wh.code.URL_NOT_HTTPS), an answer this page knows (wh.err.TOO_MANY_ENDPOINTS),
 * or null to show the API's own sentence.
 */
export function errorKey(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const field = err.fieldErrors.find((f) => f.code && (FIELD_CODES as readonly string[]).includes(f.code));
  if (field?.code) return `wh.code.${field.code}`;
  if (err.code && (ERROR_CODES as readonly string[]).includes(err.code)) return `wh.err.${err.code}`;
  if (err.status === 429) return "wh.err.RATE_LIMITED";
  return null;
}

/** The field a refusal is about ("url", "events", "description"), or null. */
export function errorField(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  return err.fieldErrors.find((f) => f.field && f.field !== "(root)")?.field ?? null;
}

/** A payload as indented JSON, for the log. */
export function prettyPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2) ?? "";
  } catch {
    return String(payload);
  }
}
