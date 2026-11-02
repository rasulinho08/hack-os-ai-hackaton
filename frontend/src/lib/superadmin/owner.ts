/**
 * The owner console's server-side reads.
 *
 * `platform.ts` assembles platform figures in the browser, four requests per
 * event, and keeps doing so for the screens that still need per-event detail.
 * These endpoints answer in one round trip each, with totals counted over
 * every event on the server (GET /api/owner/overview, /health, /audit,
 * /settings/notice), so a total can no longer silently miss an event whose
 * request failed.
 *
 * The helpers below are pure — money in minor units, the language a notice
 * is read in, the query an audit filter becomes — and are unit tested.
 */

import { apiGet, apiPut } from "@/lib/api";

/* ── Overview ─────────────────────────────────────────────────────────── */

export type Phase = "running" | "upcoming" | "draft" | "finished" | "archived";

export const PHASES: Phase[] = ["running", "upcoming", "draft", "finished", "archived"];

export const PHASE_LABEL: Record<Phase, string> = {
  running: "Running",
  upcoming: "Upcoming",
  draft: "Draft",
  finished: "Finished",
  archived: "Archived",
};

export const PHASE_TONE: Record<Phase, "warn" | "info" | "neutral" | "ok"> = {
  running: "warn",
  upcoming: "info",
  draft: "neutral",
  finished: "ok",
  archived: "neutral",
};

export interface OverviewEvent {
  id: number;
  name: string;
  eventCode: string | null;
  slug: string | null;
  customerId: number | null;
  customerName: string | null;
  startDate: string | null;
  endDate: string | null;
  phase: Phase;
  participants: { total: number; approved: number; pending: number; waitlisted: number };
  teams: number;
  submissions: number;
  openTickets: number;
  escalated: number;
  openReports: number;
}

export interface OwnerOverview {
  customerId: number | null;
  /** Organisations by status (pending_review, pending_setup, active, suspended, cancelled). */
  customers: Record<string, number>;
  /** Orders by status (draft, pending, paid, delivered, cancelled, refunded). */
  orders: Record<string, number>;
  revenue: { currency: string; paidMinor: number; orders: number }[];
  users: { total: number; last7: number; unverified: number };
  events: { total: number; byPhase: Partial<Record<Phase, number>>; list: OverviewEvent[]; truncated: boolean };
  totals: { participants: number; teams: number; submissions: number; openTickets: number; openReports: number };
  /** The last thirty days, oldest first. */
  signups: { day: string; users: number; registrations: number }[];
}

/** `list: false` leaves out the event list (the console pages through /api/owner/events instead). */
export function loadOverview(customerId?: number | null, { list = true }: { list?: boolean } = {}): Promise<OwnerOverview> {
  const p = new URLSearchParams();
  if (customerId) p.set("customerId", String(customerId));
  if (!list) p.set("list", "false");
  const q = p.toString();
  return apiGet<OwnerOverview>(`/api/owner/overview${q ? `?${q}` : ""}`);
}

/* ── Health ───────────────────────────────────────────────────────────── */

export interface JobFailure {
  id: number;
  type: string;
  attempts: number;
  last_error: string | null;
  finished_at: string | null;
}

export interface OwnerHealth {
  checkedAt: string;
  version: string | null;
  environment: string;
  process: { uptimeS: number; node: string; rssMb: number; heapUsedMb: number };
  database: {
    ok: boolean;
    error: string | null;
    latencyMs: number;
    pool: { total: number; idle: number; waiting: number };
    migration: { version: string; name: string; applied_at: string } | null;
  };
  jobs: {
    counts: Record<string, number>;
    recentFailures: JobFailure[];
    due: number;
    lagSeconds: number;
    worker: { disabled: boolean; intervalMs: number };
  } | null;
  requests: {
    windowMinutes: number;
    requests: number;
    serverErrors: number;
    clientErrors: number;
    errorRate: number;
    avgMs: number | null;
    p95Ms: number | null;
    maxMs: number | null;
    series: { at: string; count: number; errors: number }[];
    since: string;
  };
  integrations: {
    mail: { configured: boolean; provider: string | null; problem: string | null };
    telegram: { configured: boolean; webhookReady: boolean };
    github: { tokenConfigured: boolean };
    autoArchive: boolean;
    chat: { crossInstance: boolean; listenEnabled: boolean; waiting: number };
  };
}

export const loadHealth = () => apiGet<OwnerHealth>("/api/owner/health");

export type HealthTone = "ok" | "warn" | "danger";

/** Jobs that wait longer than this behind their time mean the worker is falling behind. */
export const JOB_LAG_WARN_S = 120;
/** A share of server errors above this (percent, last 15 minutes) needs a look. */
export const ERROR_RATE_WARN = 5;

/**
 * One word for the whole instance and the reasons behind it. The database
 * being down is the only red; anything else that degrades what people get
 * (mail, the job queue, errors) is amber.
 */
export function healthVerdict(h: OwnerHealth): { tone: HealthTone; reasons: string[] } {
  const reasons: string[] = [];
  let tone: HealthTone = "ok";
  const amber = (why: string) => {
    reasons.push(why);
    if (tone === "ok") tone = "warn";
  };
  if (!h.database.ok) {
    tone = "danger";
    reasons.push("The database does not answer.");
  }
  if (h.database.pool.waiting > 0) amber(`${h.database.pool.waiting} request(s) waiting for a database connection.`);
  if (h.jobs) {
    if (h.jobs.worker.disabled) amber("The background worker is switched off on this instance (JOBS_DISABLED).");
    if (h.jobs.lagSeconds > JOB_LAG_WARN_S) amber(`Background jobs are ${formatDuration(h.jobs.lagSeconds)} behind.`);
    if ((h.jobs.counts.failed || 0) > 0) amber(`${h.jobs.counts.failed} job(s) failed in the last 7 days.`);
  }
  if (h.requests.requests > 0 && h.requests.errorRate > ERROR_RATE_WARN) {
    amber(`${h.requests.errorRate}% of requests in the last ${h.requests.windowMinutes} minutes ended in a server error.`);
  }
  if (!h.integrations.mail.configured) amber("No e-mail provider is configured: nothing is sent by e-mail.");
  return { tone, reasons };
}

/** 59 s · 4 min · 3 h 20 min · 2 d 5 h */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

/** Minute-by-minute request counts, labelled HH:MM in the viewer's time. */
export function requestSeries(series: OwnerHealth["requests"]["series"]) {
  return series.map((p) => {
    const d = new Date(p.at);
    const label = Number.isNaN(d.getTime())
      ? p.at
      : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return { label, requests: p.count, errors: p.errors };
  });
}

/* ── Money ────────────────────────────────────────────────────────────── */

/** How many minor units a major unit has (AZN 2, JPY 0, KWD 3), as Intl knows it. */
export function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** 123456 AZN minor → "AZN 1,234.56" (the code, never a guessed symbol). */
export function formatMinor(minor: number, currency: string, locale = "en-US"): string {
  const digits = minorDigits(currency);
  const major = Number(minor || 0) / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "code",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(digits)}`;
  }
}

/* ── Sign-ups ─────────────────────────────────────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-19" → "19 Oct", read as a calendar day (no time zone shift). */
export function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

/** The chart's rows and what a reader would say about them. */
export function signupSummary(rows: OwnerOverview["signups"]) {
  const data = rows.map((r) => ({ label: dayLabel(r.day), day: r.day, users: r.users, registrations: r.registrations }));
  const users = rows.reduce((n, r) => n + r.users, 0);
  const registrations = rows.reduce((n, r) => n + r.registrations, 0);
  let busiest: { day: string; registrations: number } | null = null;
  for (const r of rows) {
    if (r.registrations > 0 && (!busiest || r.registrations > busiest.registrations)) busiest = { day: r.day, registrations: r.registrations };
  }
  return { data, users, registrations, busiest };
}

/* ── Audit ────────────────────────────────────────────────────────────── */

/** No contact details: who acted is a name and an account id, never an address. */
export interface AuditRow {
  id: number;
  actor_user_id: number | null;
  actor_name: string | null;
  customer_id: number | null;
  customer_name: string | null;
  event_id: number | null;
  event_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
}

export interface AuditFilters {
  /** An action, or a prefix of one ("chat." finds every chat action). */
  action?: string;
  customerId?: string | number | null;
  eventId?: string | number | null;
  actorId?: string | number | null;
  /** Calendar days, YYYY-MM-DD, both included. */
  from?: string;
  to?: string;
}

export const AUDIT_PAGE = 100;

const positive = (v: unknown): string | null => {
  const n = Number.parseInt(String(v ?? "").trim(), 10);
  return Number.isInteger(n) && n > 0 ? String(n) : null;
};

/** The start of a local calendar day as an instant, or null. */
function dayStart(day: string | undefined, plusDays = 0): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + plusDays);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The query string a set of filters becomes. Empty and unusable values are
 * left out (the API ignores them too); the end day is included, so `until`
 * is the start of the day after it.
 */
export function auditQuery(
  filters: AuditFilters,
  { before, limit, format }: { before?: number | null; limit?: number; format?: "csv" } = {},
): string {
  const q = new URLSearchParams();
  const action = String(filters.action || "").trim().toLowerCase();
  if (action && /^[a-z0-9_.]{1,80}$/.test(action)) q.set("action", action);
  const customer = positive(filters.customerId);
  if (customer) q.set("customerId", customer);
  const event = positive(filters.eventId);
  if (event) q.set("eventId", event);
  const actor = positive(filters.actorId);
  if (actor) q.set("actorId", actor);
  const since = dayStart(filters.from);
  if (since) q.set("since", since);
  const until = dayStart(filters.to, 1);
  if (until) q.set("until", until);
  const b = positive(before);
  if (b) q.set("before", b);
  if (limit) q.set("limit", String(limit));
  if (format) q.set("format", format);
  return q.toString();
}

const UI_KEYS = ["action", "customerId", "eventId", "actorId", "from", "to"] as const;

/** The filters a console address carries (/workspace/audit?eventId=12…). */
export function auditFiltersFromSearch(search: string): AuditFilters {
  const p = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const out: AuditFilters = {};
  for (const k of UI_KEYS) {
    const v = p.get(k);
    if (v && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** The same filters written back into the address, so a view can be shared. */
export function auditSearchString(filters: AuditFilters): string {
  const p = new URLSearchParams();
  for (const k of UI_KEYS) {
    const v = filters[k];
    if (v != null && String(v).trim()) p.set(k, String(v).trim());
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function loadAudit(filters: AuditFilters, before?: number | null): Promise<AuditRow[]> {
  return apiGet<AuditRow[]>(`/api/owner/audit?${auditQuery(filters, { before, limit: AUDIT_PAGE })}`);
}

/** Where "Export CSV" points: the same filters, up to 5,000 rows, written by the API. */
export const auditCsvUrl = (filters: AuditFilters) => `/api/owner/audit?${auditQuery(filters, { format: "csv" })}`;

export const loadAuditActions = () => apiGet<{ action: string; n: number }[]>("/api/owner/audit/actions");

/**
 * The action filter's choices: every family ("chat." — all of its actions)
 * with its total, then each action. Families with a single action are left
 * out; the action itself is enough.
 */
export function actionChoices(actions: { action: string; n: number }[]) {
  const families = new Map<string, { n: number; kinds: number }>();
  for (const a of actions) {
    const dot = a.action.indexOf(".");
    if (dot <= 0) continue;
    const prefix = a.action.slice(0, dot + 1);
    const f = families.get(prefix) || { n: 0, kinds: 0 };
    f.n += a.n;
    f.kinds += 1;
    families.set(prefix, f);
  }
  return [
    ...[...families.entries()]
      .filter(([, f]) => f.kinds > 1)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([prefix, f]) => ({ value: prefix, label: `${prefix}* (all, ${f.n.toLocaleString("en-US")})` })),
    ...actions.map((a) => ({ value: a.action, label: `${a.action} (${a.n.toLocaleString("en-US")})` })),
  ];
}

/** An audit row's details on one line, for the table (the CSV keeps all of it). */
export function metaSummary(meta: unknown, max = 120): string {
  if (meta == null) return "";
  if (typeof meta !== "object") return String(meta).slice(0, max);
  const entries = Object.entries(meta as Record<string, unknown>);
  if (!entries.length) return "";
  const text = entries
    .map(([k, v]) => `${k}: ${v !== null && typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ── The notice on every page ─────────────────────────────────────────── */

export type NoticeLevel = "info" | "warning" | "critical";
export const NOTICE_LEVELS: NoticeLevel[] = ["info", "warning", "critical"];
export type NoticeLang = "az" | "en" | "ru";
export const NOTICE_LANGS: NoticeLang[] = ["az", "en", "ru"];
export const NOTICE_MAX = 300;

export interface NoticeSetting {
  active: boolean;
  level: NoticeLevel;
  message: Partial<Record<NoticeLang, string>>;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt?: string | null;
}

export const loadNoticeSetting = () => apiGet<NoticeSetting | null>("/api/owner/settings/notice");

export const saveNoticeSetting = (body: Omit<NoticeSetting, "updatedAt">) =>
  apiPut<NoticeSetting>("/api/owner/settings/notice", body);

/**
 * The words a reader sees: their language, then English, Azerbaijani,
 * Russian, then whatever was written. Null when nothing was.
 */
export function noticeText(message: Partial<Record<string, string>> | null | undefined, lang: string): string | null {
  const m = message || {};
  const pick = (k: string) => {
    const v = m[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  for (const k of [lang, "en", "az", "ru"]) {
    const v = pick(k);
    if (v) return v;
  }
  for (const v of Object.values(m)) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** What GET /api/public/notice answers while a notice shows. */
export interface PublicNotice {
  level: NoticeLevel;
  message: Partial<Record<string, string>>;
  endsAt: string | null;
  updatedAt: string | null;
}

/** The API's answer, or null for anything that is not a notice with words in it. */
export function parsePublicNotice(raw: unknown): PublicNotice | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const level = NOTICE_LEVELS.includes(o.level as NoticeLevel) ? (o.level as NoticeLevel) : "info";
  const message: Partial<Record<string, string>> = {};
  if (o.message && typeof o.message === "object") {
    for (const [k, v] of Object.entries(o.message as Record<string, unknown>)) {
      if (typeof v === "string") message[k] = v;
    }
  }
  if (!noticeText(message, "en")) return null;
  return {
    level,
    message,
    endsAt: typeof o.endsAt === "string" ? o.endsAt : null,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
  };
}

/** Whether a saved notice shows right now, and why not. */
export function noticeState(n: Pick<NoticeSetting, "active" | "startsAt" | "endsAt"> | null, now = Date.now()):
  "off" | "scheduled" | "live" | "ended" {
  if (!n || !n.active) return "off";
  if (n.startsAt && Date.parse(n.startsAt) > now) return "scheduled";
  if (n.endsAt && Date.parse(n.endsAt) <= now) return "ended";
  return "live";
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** An instant as the value of a datetime-local input, in the viewer's time ("" when none). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** A datetime-local value back to an instant (null when empty or unreadable). */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* ── Billing and invoices ──────────────────────────────────────────────── */

/**
 * The seller's legal and bank details and VAT status, printed on invoices and
 * in the bank-transfer instructions (GET|PUT /api/owner/settings/billing).
 * `ready` is false until legal name, VÖEN, address, bank, IBAN and SWIFT are
 * all filled in; `missing` names what is not.
 */
export interface BillingSetting {
  legalName: string;
  taxId: string;
  address: string;
  email: string;
  bankName: string;
  accountHolder: string;
  iban: string;
  ibanGrouped: string;
  swift: string;
  vatRegistered: boolean;
  vatRatePercent: number | null;
  ready: boolean;
  missing: string[];
  updatedAt: string | null;
}

export type BillingInput = Partial<Pick<BillingSetting,
  "legalName" | "taxId" | "address" | "email" | "bankName" | "accountHolder" | "iban" | "swift" | "vatRegistered" | "vatRatePercent">>;

export const loadBillingSetting = () => apiGet<BillingSetting>("/api/owner/settings/billing");
export const saveBillingSetting = (body: BillingInput) => apiPut<BillingSetting>("/api/owner/settings/billing", body);

/** The fields' names as the owner reads them, for "missing" lists. */
export const BILLING_FIELD_LABEL: Record<string, string> = {
  legalName: "Legal name",
  taxId: "VÖEN",
  address: "Address",
  email: "Billing e-mail",
  bankName: "Bank",
  accountHolder: "Account holder",
  iban: "IBAN",
  swift: "SWIFT",
};
