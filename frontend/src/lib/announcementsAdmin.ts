/**
 * Announcements as the organiser works with them: who an announcement is
 * for, where it goes, when, and how its deliveries went. The API decides all
 * of it (see the backend's docs/ANNOUNCEMENTS.md); this file only names the
 * shapes and reads them defensively.
 */

export const AUDIENCES = [
  "everyone", "attendees", "participants", "waiting", "no_team", "no_submission", "track",
  "staff", "judges", "mentors", "volunteers",
] as const;
export type Audience = (typeof AUDIENCES)[number];

export type Channel = "platform" | "telegram" | "email";
export type DeliveryKind = "email" | "telegram" | "telegram_channel";
export const DELIVERY_KINDS: DeliveryKind[] = ["email", "telegram", "telegram_channel"];

export type Priority = "normal" | "high" | "urgent";
export const PRIORITIES: Priority[] = ["normal", "high", "urgent"];

export interface DeliveryCounts { sent: number; failed: number; pending: number; skipped: number }

export interface AdminAnnouncement {
  id: number;
  title: string;
  content: string;
  priority: Priority;
  audience: Audience;
  trackId: number | null;
  trackName: string | null;
  channels: Channel[];
  status: "scheduled" | "sent" | "cancelled";
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string | null;
  authorName: string | null;
  source: "app" | "auto" | "telegram";
  deliveries: Partial<Record<DeliveryKind, DeliveryCounts>>;
}

export interface DeliveryProblem {
  id: number;
  channel: DeliveryKind;
  status: "failed" | "skipped";
  attempts: number;
  lastError: string | null;
  name: string | null;
  email: string | null;
}

export interface AudienceSize {
  people: number;
  email: number;
  telegram: number;
  channel: { title: string | null; username: string | null } | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

function counts(raw: unknown): DeliveryCounts {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { sent: num(o.sent), failed: num(o.failed), pending: num(o.pending), skipped: num(o.skipped) };
}

export function normalizeAdminAnnouncement(raw: Record<string, unknown>): AdminAnnouncement {
  const priority = String(raw.priority ?? "normal").toLowerCase();
  const audience = String(raw.audience ?? "everyone");
  const status = String(raw.status ?? "sent");
  const source = String(raw.source ?? "app");
  const channels = Array.isArray(raw.channels) ? raw.channels.map(String) : ["platform"];
  const deliveriesRaw = (raw.deliveries && typeof raw.deliveries === "object" ? raw.deliveries : {}) as Record<string, unknown>;
  const deliveries: AdminAnnouncement["deliveries"] = {};
  for (const k of DELIVERY_KINDS) if (deliveriesRaw[k]) deliveries[k] = counts(deliveriesRaw[k]);
  return {
    id: num(raw.id),
    title: String(raw.title ?? ""),
    content: String(raw.content ?? ""),
    priority: (PRIORITIES as string[]).includes(priority) ? (priority as Priority) : priority === "low" ? "normal" : "normal",
    audience: (AUDIENCES as readonly string[]).includes(audience) ? (audience as Audience) : "everyone",
    trackId: raw.track_id != null ? num(raw.track_id) : null,
    trackName: str(raw.track_name),
    channels: (["platform", "telegram", "email"] as Channel[]).filter((c) => c === "platform" || channels.includes(c)),
    status: status === "scheduled" || status === "cancelled" ? status : "sent",
    scheduledAt: str(raw.scheduled_at),
    sentAt: str(raw.sent_at),
    createdAt: str(raw.created_at),
    authorName: str(raw.author_name),
    source: source === "auto" || source === "telegram" ? source : "app",
    deliveries,
  };
}

export function normalizeAdminList(data: unknown): AdminAnnouncement[] {
  if (!Array.isArray(data)) return [];
  return data
    .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    .map(normalizeAdminAnnouncement);
}

export function normalizeProblems(data: unknown): DeliveryProblem[] {
  const rows = (data && typeof data === "object" ? (data as { problems?: unknown }).problems : null) || [];
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const channel = String(o.channel ?? "email");
    return {
      id: num(o.id),
      channel: (DELIVERY_KINDS as string[]).includes(channel) ? (channel as DeliveryKind) : "email",
      status: o.status === "skipped" ? "skipped" : "failed",
      attempts: num(o.attempts),
      lastError: str(o.last_error),
      name: str(o.full_name),
      email: str(o.email),
    };
  });
}

/**
 * True while an announcement still has messages on their way (the page keeps
 * polling): scheduled, a delivery not finished, or just sent with e-mail or
 * Telegram and its deliveries not planned yet (the background job runs a
 * moment after publishing).
 */
export function hasPending(a: AdminAnnouncement, now: number = Date.now()): boolean {
  if (a.status === "scheduled") return true;
  if (Object.values(a.deliveries).some((c) => c && c.pending > 0)) return true;
  const justSent = a.status === "sent" && a.sentAt != null && now - new Date(a.sentAt).getTime() < 120_000;
  return justSent && a.channels.some((c) => c !== "platform") && Object.keys(a.deliveries).length === 0;
}

/** Map priority to the type the API stores alongside it. */
export function typeForPriority(p: Priority): string {
  return p === "urgent" ? "alert" : p === "high" ? "update" : "info";
}

/** The templates the composer offers, by key: title and body are translation keys. */
export const TEMPLATES = ["lunch", "room", "mentors", "deadline", "wifi", "judging", "closing"] as const;
export type TemplateKey = (typeof TEMPLATES)[number];
