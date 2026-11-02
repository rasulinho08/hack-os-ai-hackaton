/**
 * The public directory of hackathons (/hackathons), read from
 * GET /api/public/directory: published, public events their organiser left
 * listed. Registration open first, then upcoming, running and finished.
 *
 *   ?status=open|upcoming|running|past  ("upcoming" is everything not started)
 *   &format=online|offline|hybrid &city=<name> &q=<search> &page=<n> &limit=<n>
 *
 * The cards hold only the event page's public facts; there is nothing about
 * people in the answer. These helpers turn it into words and links, and into
 * the schema.org Event markup search engines read.
 */

import { formatDateRange } from "@/lib/showcase";
import { formatDate } from "@/lib/i18n/dates";

export const DIRECTORY_STATUSES = ["open", "upcoming", "running", "past"] as const;
export type DirectoryStatus = (typeof DIRECTORY_STATUSES)[number];
export const DIRECTORY_FORMATS = ["online", "offline", "hybrid"] as const;
export type DirectoryFormat = (typeof DIRECTORY_FORMATS)[number];
export type Phase = "open" | "upcoming" | "running" | "past";

export const PAGE_SIZE = 12;

export interface DirectoryEvent {
  slug: string;
  url: string;
  name: string;
  tagline: string | null;
  category: string;
  language: string;
  organiser: { name: string; logoUrl: string | null } | null;
  startDate: string | null;
  endDate: string | null;
  timezone: string;
  phase: Phase;
  registration: { opensAt: string | null; closesAt: string | null; open: boolean };
  format: DirectoryFormat;
  city: string | null;
  country: string | null;
  venue: string | null;
  teamSize: { min: number; max: number | null };
  mode: string;
  /** Pinned to the top by HackOS. */
  featured: boolean;
  cover: string | null;
}

export interface DirectoryQuery {
  status: DirectoryStatus | null;
  format: DirectoryFormat | null;
  city: string | null;
  q: string | null;
  page: number;
}

export interface DirectoryPage {
  items: DirectoryEvent[];
  page: number;
  limit: number;
  total: number;
  pages: number;
  facets: {
    phases: Record<Phase, number>;
    formats: Record<DirectoryFormat, number>;
    cities: { name: string; count: number }[];
    total: number;
  };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const int = (v: unknown, fallback: number): number => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

function oneOf<T extends string>(v: unknown, list: readonly T[]): T | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (list as readonly string[]).includes(s) ? (s as T) : null;
}

/** A link the page may follow: an address on the API (uploads) or https. */
function safeImage(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^\/api\/files\/[0-9a-f-]{36}$/i.test(s)) return s;
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : null;
}

export function normalizeEvent(raw: unknown): DirectoryEvent | null {
  const e = obj(raw);
  const slug = str(e.slug);
  const name = str(e.name);
  if (!slug || !SLUG_RE.test(slug) || !name) return null;
  const reg = obj(e.registration);
  const team = obj(e.teamSize);
  const org = obj(e.organiser);
  return {
    slug,
    url: `/e/${slug}`,
    name,
    tagline: str(e.tagline),
    category: str(e.category) ?? "hackathon",
    language: str(e.language) ?? "az",
    organiser: str(org.name) ? { name: String(org.name), logoUrl: safeImage(org.logoUrl) } : null,
    startDate: str(e.startDate),
    endDate: str(e.endDate),
    timezone: str(e.timezone) ?? "Asia/Baku",
    phase: oneOf(e.phase, ["open", "upcoming", "running", "past"] as const) ?? "upcoming",
    registration: { opensAt: str(reg.opensAt), closesAt: str(reg.closesAt), open: reg.open === true },
    format: oneOf(e.format, DIRECTORY_FORMATS) ?? "offline",
    city: str(e.city),
    country: str(e.country),
    venue: str(e.venue),
    teamSize: { min: Math.max(1, int(team.min, 1)), max: team.max == null ? null : Math.max(1, int(team.max, 1)) },
    mode: str(e.mode) ?? "both",
    featured: e.featured === true,
    cover: safeImage(e.cover),
  };
}

export function normalizeDirectory(raw: unknown): DirectoryPage {
  const d = obj(raw);
  const f = obj(d.facets);
  const phases = obj(f.phases);
  const formats = obj(f.formats);
  const items = (Array.isArray(d.items) ? d.items : []).map(normalizeEvent).filter((x): x is DirectoryEvent => x != null);
  return {
    items,
    page: Math.max(1, int(d.page, 1)),
    limit: Math.max(1, int(d.limit, PAGE_SIZE)),
    total: Math.max(0, int(d.total, items.length)),
    pages: Math.max(1, int(d.pages, 1)),
    facets: {
      phases: { open: int(phases.open, 0), upcoming: int(phases.upcoming, 0), running: int(phases.running, 0), past: int(phases.past, 0) },
      formats: { online: int(formats.online, 0), offline: int(formats.offline, 0), hybrid: int(formats.hybrid, 0) },
      cities: (Array.isArray(f.cities) ? f.cities : [])
        .map((c) => ({ name: str(obj(c).name) ?? "", count: int(obj(c).count, 0) }))
        .filter((c) => c.name),
      total: int(f.total, 0),
    },
  };
}

/* ── The query in the address ─────────────────────────────────────────── */

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function param(sp: Params, key: string): string | null {
  const v = sp instanceof URLSearchParams ? sp.get(key) : sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" ? s : null;
}

export function parseDirectoryQuery(sp: Params): DirectoryQuery {
  const q = (param(sp, "q") ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  const city = (param(sp, "city") ?? "").trim().slice(0, 100);
  const page = Number.parseInt(param(sp, "page") ?? "1", 10);
  return {
    status: oneOf(param(sp, "status"), DIRECTORY_STATUSES),
    format: oneOf(param(sp, "format"), DIRECTORY_FORMATS),
    city: city || null,
    q: q || null,
    page: Number.isInteger(page) && page > 1 ? Math.min(page, 500) : 1,
  };
}

/** "?status=open&city=Bakı" — only what is set; page 1 is left out. */
export function directorySearch(q: Partial<DirectoryQuery>): string {
  const sp = new URLSearchParams();
  if (q.status) sp.set("status", q.status);
  if (q.format) sp.set("format", q.format);
  if (q.city) sp.set("city", q.city);
  if (q.q) sp.set("q", q.q);
  if (q.page && q.page > 1) sp.set("page", String(q.page));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const isFiltered = (q: DirectoryQuery) => Boolean(q.status || q.format || q.city || q.q);

/* ── Words ─────────────────────────────────────────────────────────────── */

/** "YYYY-MM-DD" of a moment in a time zone (what the event's own page calls that day). */
export function localDay(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** "18–20 October 2026" in the event's zone, in the reader's language. */
export function eventDates(e: DirectoryEvent, lang: string): string {
  return formatDateRange(localDay(e.startDate, e.timezone), localDay(e.endDate, e.timezone), lang);
}

export interface StatusWords {
  openUntil: string; // "Registration open until {date}"
  open: string;
  opens: string; // "Registration opens {date}"
  closed: string;
  running: string;
  past: string;
}

export type StatusTone = "open" | "soon" | "live" | "done";

/** The line a card leads with, and how it is coloured. */
export function statusOf(e: DirectoryEvent, words: StatusWords, lang: string): { tone: StatusTone; label: string } {
  const day = (iso: string) => formatDate(iso, lang, { day: "numeric", month: "long", timeZone: e.timezone });
  if (e.phase === "running") return { tone: "live", label: words.running };
  if (e.phase === "past") return { tone: "done", label: words.past };
  if (e.phase === "open") {
    return { tone: "open", label: e.registration.closesAt ? words.openUntil.replace("{date}", day(e.registration.closesAt)) : words.open };
  }
  if (e.registration.opensAt && new Date(e.registration.opensAt).getTime() > Date.now()) {
    return { tone: "soon", label: words.opens.replace("{date}", day(e.registration.opensAt)) };
  }
  return { tone: "soon", label: words.closed };
}

/** "Bakı · Venue" for a place, "Online" for online, "Hybrid · Bakı". */
export function placeOf(e: DirectoryEvent, formats: Record<DirectoryFormat, string>): string {
  if (e.format === "online") return formats.online;
  const where = [e.city, e.venue].filter(Boolean).join(" · ");
  return e.format === "hybrid" ? [formats.hybrid, where].filter(Boolean).join(" · ") : where || formats.offline;
}

/** "2–4 people" / "Solo or up to 4" — only the numbers; the words come from the copy. */
export function teamSizeText(e: DirectoryEvent, words: { range: string; upTo: string; exactly: string; any: string }): string {
  const { min, max } = e.teamSize;
  if (max == null) return words.any;
  if (min === max) return words.exactly.replace("{n}", String(max));
  if (min <= 1) return words.upTo.replace("{n}", String(max));
  return words.range.replace("{min}", String(min)).replace("{max}", String(max));
}

/* ── Search engines ───────────────────────────────────────────────────── */

const ATTENDANCE: Record<DirectoryFormat, string> = {
  online: "https://schema.org/OnlineEventAttendanceMode",
  offline: "https://schema.org/OfflineEventAttendanceMode",
  hybrid: "https://schema.org/MixedEventAttendanceMode",
};

/**
 * schema.org markup for the listed events: an ItemList of Event, each with
 * its dates, place or online address (the event page), organiser and
 * picture. Only what the card shows; nothing about people.
 */
export function directoryJsonLd(items: DirectoryEvent[], siteUrl: string, pageUrl: string) {
  const abs = (path: string) => (path.startsWith("http") ? path : `${siteUrl}${path}`);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    url: abs(pageUrl),
    numberOfItems: items.length,
    itemListElement: items.map((e, i) => {
      const url = abs(e.url);
      const place = e.format === "online"
        ? { "@type": "VirtualLocation", url }
        : {
          "@type": "Place",
          name: e.venue || e.city || undefined,
          address: { "@type": "PostalAddress", addressLocality: e.city || undefined, addressCountry: e.country || undefined },
        };
      const event: Record<string, unknown> = {
        "@type": "Event",
        name: e.name,
        url,
        startDate: e.startDate || undefined,
        endDate: e.endDate || undefined,
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: ATTENDANCE[e.format],
        location: e.format === "hybrid" ? [place, { "@type": "VirtualLocation", url }] : place,
        description: e.tagline || undefined,
        inLanguage: e.language,
        image: e.cover ? [abs(e.cover)] : undefined,
        organizer: e.organiser ? { "@type": "Organization", name: e.organiser.name } : undefined,
      };
      return { "@type": "ListItem", position: i + 1, item: event };
    }),
  };
}

/** JSON for a <script> tag: `<` escaped so no value can close the tag. */
export const jsonForScript = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
