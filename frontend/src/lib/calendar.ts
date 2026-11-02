/**
 * Calendar links: the personal feed (GET /api/me/calendar → { url, webcal })
 * and "add to calendar" for one event (a Google Calendar template link, and
 * the event's public .ics from the API).
 */

export interface CalendarFeed {
  /** https link, for copying and for Google Calendar's "add by URL". */
  url: string;
  /** The same link as webcal:, which Apple Calendar and Outlook subscribe to. */
  webcal: string;
}

export function normalizeFeed(raw: unknown): CalendarFeed | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === "string" && /^https?:\/\//.test(o.url) ? o.url : null;
  if (!url) return null;
  const webcal = typeof o.webcal === "string" && o.webcal.startsWith("webcal:") ? o.webcal : url.replace(/^https?:/, "webcal:");
  return { url, webcal };
}

/** Google Calendar's "subscribe to this calendar" link for a feed. */
export function googleSubscribeUrl(webcal: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
}

/** 2026-11-01T08:00:00Z → 20261101T080000Z (UTC, as Google's template wants it). */
export function calStamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * A Google Calendar "new event" link with the event filled in. Without an
 * end, the event is shown as two hours from its start.
 */
export function googleEventUrl(e: { name: string; start: string | null; end?: string | null; details?: string | null; location?: string | null }): string | null {
  const start = calStamp(e.start);
  if (!start) return null;
  const endDate = e.end ? new Date(e.end) : null;
  const end = calStamp(endDate && !Number.isNaN(endDate.getTime()) && endDate.getTime() > new Date(e.start as string).getTime()
    ? endDate
    : new Date(new Date(e.start as string).getTime() + 2 * 3600e3));
  const params = new URLSearchParams({ action: "TEMPLATE", text: e.name, dates: `${start}/${end}` });
  if (e.details) params.set("details", e.details);
  if (e.location) params.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** The event's public dates as a calendar file (served by the API). */
export function publicIcsPath(slug: string): string {
  return `/api/public/events/${encodeURIComponent(slug)}/calendar.ics`;
}
