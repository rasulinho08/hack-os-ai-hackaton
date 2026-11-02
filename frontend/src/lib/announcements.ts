import type { Lang } from "@/lib/i18n/types";
import { apiGet } from "@/lib/api";
import { formatRelativeTime } from "@/lib/relativeTime";

/** API may return mixed shapes (content vs message, created_at vs createdAt). */
export type AnnouncementSource = "WEBSITE" | "TELEGRAM" | "UNKNOWN";

export type NormalizedAnnouncement = {
  id: number;
  title: string;
  /** Main text (maps API `content` | `message` | `body`). */
  content: string;
  created_at: string;
  type: "info" | "warning" | "urgent";
  /** Origin of the announcement (WEBSITE, TELEGRAM, or UNKNOWN). */
  source: AnnouncementSource;
  /** Whether the announcement was successfully sent to Telegram. */
  telegramSent: boolean;
  /** Telegram message id if synced. */
  telegramMessageId: number | null;
  /** Telegram error message if send failed. */
  telegramError: string | null;
  /** Who it was for (announcementAudience on the API), when the API says. */
  audience: string | null;
  /** One of the automatic timeline posts (registration closes, coding starts…). */
  automatic: boolean;
  /** The event it belongs to, when the API says. */
  eventId: number | null;
};

/**
 * How loud an announcement is shown. The API stores a priority (normal,
 * high, urgent) beside a type (info, update, reminder, alert…); older rows
 * may carry only a type such as "warning".
 */
function coerceType(priority: unknown, type: unknown): NormalizedAnnouncement["type"] {
  const p = String(priority ?? "").toLowerCase();
  const t = String(type ?? "").toLowerCase();
  if (p === "urgent" || t === "urgent" || t === "alert") return "urgent";
  if (p === "high" || t === "warning") return "warning";
  return "info";
}

export function normalizeAnnouncement(
  raw: Record<string, unknown>
): NormalizedAnnouncement {
  const id = Number(raw.id ?? 0);
  const content = String(
    raw.content ?? raw.message ?? raw.body ?? raw.text ?? ""
  ).trim();
  let title = String(raw.title ?? raw.subject ?? "").trim();
  if (!title && content) {
    const first = content.split(/\n/)[0] ?? "";
    title =
      first.length > 90 ? `${first.slice(0, 87).trim()}…` : first || "—";
  }
  if (!title) title = "—";
  // A scheduled announcement is shown from when it went out, not when it was written.
  const created_at = String(
    raw.sent_at ?? raw.created_at ?? raw.createdAt ?? raw.timestamp ?? ""
  );
  const type = coerceType(raw.priority, raw.type);

  // The API says app / auto / telegram; older payloads said WEBSITE / TELEGRAM.
  const rawSource = String(raw.source ?? "").toUpperCase();
  const source: AnnouncementSource =
    rawSource === "TELEGRAM"
      ? "TELEGRAM"
      : rawSource === "WEBSITE" || rawSource === "APP" || rawSource === "AUTO"
        ? "WEBSITE"
        : "UNKNOWN";

  const telegramSent = raw.telegramSent === true;
  const telegramMessageId =
    typeof raw.telegramMessageId === "number" ? raw.telegramMessageId : null;
  const telegramError =
    typeof raw.telegramError === "string" ? raw.telegramError : null;

  const audience = typeof raw.audience === "string" && raw.audience.trim() ? raw.audience.trim().toLowerCase() : null;
  const eventId = Number(raw.event_id ?? raw.eventId);

  return {
    id,
    title,
    content,
    created_at,
    type,
    source,
    telegramSent,
    telegramMessageId,
    telegramError,
    audience,
    automatic: raw.automatic === true || String(raw.source ?? "").toLowerCase() === "auto",
    eventId: Number.isFinite(eventId) && eventId > 0 ? eventId : null,
  };
}

/** The audiences each staff role reads as their own. */
const STAFF_AUDIENCES: Record<"judge" | "mentor" | "volunteer", readonly string[]> = {
  judge: ["staff", "judges"],
  mentor: ["staff", "mentors"],
  volunteer: ["staff", "volunteers"],
};

/**
 * What a staff page shows: posts for the staff or for this role, and the
 * organisers' own posts to everyone in the event. The automatic reminders
 * written for participants ("tell friends who have not registered yet",
 * "coding has started") and posts for participants only are left out.
 */
export function forStaff(list: readonly NormalizedAnnouncement[], role: "judge" | "mentor" | "volunteer"): NormalizedAnnouncement[] {
  const own = STAFF_AUDIENCES[role];
  return list.filter((a) => {
    if (a.audience == null) return !a.automatic;
    if (own.includes(a.audience)) return true;
    return (a.audience === "everyone" || a.audience === "attendees") && !a.automatic;
  });
}

export function normalizeAnnouncementsList(data: unknown): NormalizedAnnouncement[] {
  if (!Array.isArray(data)) return [];
  return data.map((item) =>
    normalizeAnnouncement(
      item && typeof item === "object"
        ? (item as Record<string, unknown>)
        : {}
    )
  );
}

export function safeFormatAnnouncementTime(
  dateStr: string,
  lang: Lang
): string {
  if (!dateStr) return "";
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return "";
  return formatRelativeTime(dateStr, lang);
}

/**
 * Fetch announcements for multiple events in parallel, merge, de-dupe
 * by id, and sort newest-first. Used by mentor/judge dashboards so
 * they surface every announcement posted to any event the current
 * staff member is assigned to (problem 9).
 */
export async function fetchAnnouncementsForEvents(
  eventIds: readonly number[],
): Promise<NormalizedAnnouncement[]> {
  const ids = Array.from(new Set(eventIds.filter((n) => Number.isFinite(n) && n > 0)));
  if (ids.length === 0) return [];
  const results = await Promise.all(
    ids.map((eid) =>
      apiGet<unknown[]>(`/api/announcements?eventId=${eid}`).catch(
        () => [] as unknown[],
      ),
    ),
  );
  const merged: NormalizedAnnouncement[] = [];
  const seen = new Set<number>();
  for (const rows of results) {
    for (const a of normalizeAnnouncementsList(rows)) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      merged.push(a);
    }
  }
  merged.sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  });
  return merged;
}
