/**
 * The owner console's events manager: the public page of any customer's
 * event, who can find it, its place in the directory and its lifecycle.
 *
 *   GET   /api/owner/events/:id/page     the page's fields, directory state, old addresses, checklist
 *   PATCH /api/owner/events/:id/page     some of EDITABLE_FIELDS (the builder's checks apply)
 *   PATCH /api/owner/events/:id/flags    { featured?, featuredRank?, isTest? }
 *   POST  /api/owner/events/:id/publish | unpublish | archive | unarchive
 *
 * The form keeps dates as wall-clock text in the event's own time zone
 * (what <input type="datetime-local"> shows) and turns them back into
 * instants only when it saves, with the zone the form has then.
 */

import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { fromZonedInput, toZonedInput } from "@/lib/builder/datetime";
import type { ChecklistItem } from "@/lib/builder/types";
import type { Phase } from "./owner";

export const EDITABLE_FIELDS = [
  "name", "slug", "tagline", "description",
  "start_date", "end_date", "timezone",
  "format", "venue_name", "venue_address", "city", "country", "map_url",
  "logo_file_id", "banner_file_id",
  "registration_start", "registration_end", "max_participants", "waitlist_enabled",
  "visibility", "directory_listed",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const DATE_FIELDS = ["start_date", "end_date", "registration_start", "registration_end"] as const;
export type DateField = (typeof DATE_FIELDS)[number];

export type Visibility = "public" | "private" | "invite";
export const VISIBILITIES: Visibility[] = ["public", "private", "invite"];
export type EventFormat = "online" | "offline" | "hybrid";
export const FORMATS: EventFormat[] = ["offline", "online", "hybrid"];

export type DirectoryBlocker =
  | "not_published" | "not_public" | "organiser_unlisted" | "archived" | "test" | "no_address" | "organisation_inactive";

export const BLOCKER_TEXT: Record<DirectoryBlocker, string> = {
  not_published: "it is not published",
  not_public: "only people with the link can open it",
  organiser_unlisted: "\"Show in HackOS directory\" is off",
  archived: "it is archived",
  test: "it is marked as a test",
  no_address: "it has no page address",
  organisation_inactive: "its organisation is not active",
};

/** A publish-checklist item that blocks publishing (the builder's own shape). */
export type ChecklistError = ChecklistItem;

export interface OwnerEventPage {
  id: number;
  event_code: string;
  name: string;
  slug: string | null;
  tagline: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: string;
  format: EventFormat;
  venue_name: string | null;
  venue_address: string | null;
  city: string | null;
  country: string | null;
  map_url: string | null;
  logo_file_id: string | null;
  logo_url: string | null;
  banner_file_id: string | null;
  banner_url: string | null;
  registration_start: string | null;
  registration_end: string | null;
  max_participants: number | null;
  waitlist_enabled: boolean;
  visibility: Visibility;
  directory_listed: boolean;
  directory_featured: boolean;
  directory_featured_rank: number | null;
  is_test: boolean;
  is_published: boolean;
  archived: boolean;
  archived_at: string | null;
  published_at: string | null;
  updated_at: string | null;
  phase: Phase;
  customer_id: number | null;
  customer_name: string | null;
  plan: string | null;
  participants: number;
  branded: boolean;
  directory: { listed: boolean; blockers: DirectoryBlocker[] };
  old_slugs: { slug: string; since: string | null }[];
  checklist: { ready: boolean; errors: ChecklistError[] };
}

/** The editor's state: every field as the control holds it. */
export interface EventForm {
  name: string;
  slug: string;
  tagline: string;
  description: string;
  start_date: string;
  end_date: string;
  timezone: string;
  format: EventFormat;
  venue_name: string;
  venue_address: string;
  city: string;
  country: string;
  map_url: string;
  logo_file_id: string | null;
  banner_file_id: string | null;
  registration_start: string;
  registration_end: string;
  max_participants: string;
  waitlist_enabled: boolean;
  visibility: Visibility;
  directory_listed: boolean;
}

export function formOf(e: OwnerEventPage): EventForm {
  const tz = e.timezone || "Asia/Baku";
  return {
    name: e.name ?? "",
    slug: e.slug ?? "",
    tagline: e.tagline ?? "",
    description: e.description ?? "",
    start_date: toZonedInput(e.start_date, tz),
    end_date: toZonedInput(e.end_date, tz),
    timezone: tz,
    format: e.format || "offline",
    venue_name: e.venue_name ?? "",
    venue_address: e.venue_address ?? "",
    city: e.city ?? "",
    country: e.country ?? "",
    map_url: e.map_url ?? "",
    logo_file_id: e.logo_file_id ?? null,
    banner_file_id: e.banner_file_id ?? null,
    registration_start: toZonedInput(e.registration_start, tz),
    registration_end: toZonedInput(e.registration_end, tz),
    max_participants: e.max_participants == null ? "" : String(e.max_participants),
    waitlist_enabled: Boolean(e.waitlist_enabled),
    visibility: e.visibility || "public",
    directory_listed: Boolean(e.directory_listed),
  };
}

/** What the API is sent for one field: text trimmed, '' → null, dates as instants in the form's zone. */
function valueOf(form: EventForm, key: EditableField): unknown {
  if ((DATE_FIELDS as readonly string[]).includes(key)) {
    const v = form[key as DateField];
    return v ? fromZonedInput(v, form.timezone) : null;
  }
  if (key === "max_participants") {
    const s = form.max_participants.trim();
    return s === "" ? null : Number(s);
  }
  if (key === "slug") return form.slug.trim().toLowerCase();
  if (key === "country") return form.country.trim().toUpperCase() || null;
  const v = form[key as keyof EventForm];
  if (typeof v === "string") return key === "name" || key === "timezone" ? v.trim() : v.trim() || null;
  return v;
}

/**
 * The fields that differ from what was loaded, ready to send. A changed time
 * zone re-sends the dates too: the same wall-clock time is another instant
 * in another zone.
 */
export function changedFields(form: EventForm, original: EventForm): Partial<Record<EditableField, unknown>> {
  const out: Partial<Record<EditableField, unknown>> = {};
  const zoneMoved = form.timezone !== original.timezone;
  for (const key of EDITABLE_FIELDS) {
    const a = valueOf(form, key);
    const b = valueOf(original, key);
    const isDate = (DATE_FIELDS as readonly string[]).includes(key);
    if (JSON.stringify(a) !== JSON.stringify(b) || (isDate && zoneMoved && a != null)) out[key] = a;
  }
  return out;
}

/** The page address as the field will accept it: lowercase letters, digits, single dashes. */
export function cleanSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, 80);
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/** Problems the browser can see before the API does (the API checks everything again). */
export function localProblems(form: EventForm): Partial<Record<EditableField, string>> {
  const out: Partial<Record<EditableField, string>> = {};
  if (!form.name.trim()) out.name = "The event needs a name.";
  if (!SLUG_RE.test(form.slug.trim())) out.slug = "Lowercase letters, digits and dashes; no dash at either end.";
  const t = (v: string) => (v ? new Date(fromZonedInput(v, form.timezone) || "").getTime() : null);
  const start = t(form.start_date);
  const end = t(form.end_date);
  const rs = t(form.registration_start);
  const re = t(form.registration_end);
  if (!form.start_date) out.start_date = "Required.";
  if (!form.end_date) out.end_date = "Required.";
  if (start != null && end != null && end <= start) out.end_date = "The event must end after it starts.";
  if (rs != null && re != null && re < rs) out.registration_end = "Registration must close after it opens.";
  else if (re != null && end != null && re > end) out.registration_end = "Registration cannot close after the event ends.";
  const cap = form.max_participants.trim();
  if (cap && (!/^\d+$/.test(cap) || Number(cap) < 1 || Number(cap) > 100000)) out.max_participants = "A whole number from 1 to 100,000, or empty for no limit.";
  if (form.country.trim() && !/^[A-Za-z]{2}$/.test(form.country.trim())) out.country = "A two-letter country code, like AZ.";
  return out;
}

/** Whether the name reads like an automated run or a rehearsal (the list's hint; the server decides the filter). */
export function looksLikeTest(name: string): boolean {
  return /\b(?=[a-z0-9]*[0-9])(?=[a-z0-9]*[a-z])[a-z0-9]{8,}\b/.test(name)
    || /\d{5,}/.test(name)
    || /(^|[^\p{L}])(test|testing|demo|e2e|probe|sample|dummy|qa|verify|tmp|fixture|smoke|aud)([^\p{L}]|$)/iu.test(name);
}

/** The one-line answer to "is it in the directory, and if not, why". */
export function directoryLine(e: Pick<OwnerEventPage, "directory" | "directory_featured" | "directory_featured_rank">): string {
  if (e.directory.listed) {
    return e.directory_featured
      ? `Listed on /hackathons, pinned to the top${e.directory_featured_rank ? ` (position ${e.directory_featured_rank})` : ""}.`
      : "Listed on /hackathons.";
  }
  const why = e.directory.blockers.map((b) => BLOCKER_TEXT[b] ?? b);
  return `Not on /hackathons: ${why.join(", ")}.`;
}

/* ── Requests ──────────────────────────────────────────────────────────── */

const base = (id: number) => `/api/owner/events/${id}`;

export const ownerEvents = {
  page: (id: number) => apiGet<OwnerEventPage>(`${base(id)}/page`),
  save: (id: number, fields: Partial<Record<EditableField, unknown>>) =>
    apiPatch<{ event: OwnerEventPage; changed: EditableField[] }>(`${base(id)}/page`, fields),
  flags: (id: number, flags: { featured?: boolean; featuredRank?: number | null; isTest?: boolean }) =>
    apiPatch<{ event: OwnerEventPage }>(`${base(id)}/flags`, flags),
  publish: (id: number) => apiPost<{ event: OwnerEventPage }>(`${base(id)}/publish`, {}),
  unpublish: (id: number) => apiPost<{ event: OwnerEventPage }>(`${base(id)}/unpublish`, {}),
  archive: (id: number) => apiPost<{ event: OwnerEventPage }>(`${base(id)}/archive`, {}),
  unarchive: (id: number) => apiPost<{ event: OwnerEventPage }>(`${base(id)}/unarchive`, {}),
};

/* ── The list ──────────────────────────────────────────────────────────── */

/** The extra columns the console's events list carries (on top of EventListRow). */
export interface EventDirectoryColumns {
  visibility: Visibility;
  directory_listed: boolean;
  directory_featured: boolean;
  directory_featured_rank: number | null;
  is_test: boolean;
  test_looking: boolean;
  archived_at: string | null;
  updated_at: string | null;
  timezone: string | null;
}

/** Whether a list row is on /hackathons right now (the server's rule, minus the organisation's status). */
export function inDirectory(r: { is_published: boolean; visibility: Visibility; directory_listed: boolean; is_test: boolean; archived_at: string | null; phase: Phase; slug: string | null }): boolean {
  return r.is_published && r.visibility === "public" && r.directory_listed && !r.is_test && !r.archived_at && r.phase !== "archived" && Boolean(r.slug);
}

/**
 * "19–21 Nov 2026", "30 Nov – 2 Dec 2026", "30 Dec 2026 – 2 Jan 2027" in the
 * event's own zone (the browser's when it has none); "—" without a start.
 */
export function dateRange(startIso: string | null, endIso: string | null, timeZone?: string | null): string {
  if (!startIso) return "—";
  const tz = timeZone || undefined;
  const parts = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const f = (o: Intl.DateTimeFormatOptions) => {
      try { return new Intl.DateTimeFormat("en-GB", { ...o, timeZone: tz }).format(d); } catch { return new Intl.DateTimeFormat("en-GB", o).format(d); }
    };
    return { d: f({ day: "numeric" }), m: f({ month: "short" }), y: f({ year: "numeric" }) };
  };
  const a = parts(startIso);
  const b = endIso ? parts(endIso) : null;
  if (!a) return "—";
  if (!b || (a.d === b.d && a.m === b.m && a.y === b.y)) return `${a.d} ${a.m} ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${b.m} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`;
  return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
}

/** Ready-made views of the list: each is a set of filters. */
export const EVENT_VIEWS: { id: string; label: string; facets: Record<string, string[]> }[] = [
  { id: "all", label: "All", facets: {} },
  { id: "live", label: "Live & listed", facets: { phase: ["running", "upcoming"], listed: ["yes"], visibility: ["public"], test: ["clean", "looks"], archived: ["hide"] } },
  { id: "pinned", label: "Pinned", facets: { featured: ["yes"] } },
  { id: "real", label: "Real events", facets: { test: ["clean"], archived: ["hide"] } },
  { id: "tests", label: "Look like tests", facets: { test: ["looks"] } },
  { id: "marked", label: "Marked as tests", facets: { test: ["marked"] } },
  { id: "archived", label: "Archived", facets: { archived: ["only"] } },
];

/** Which ready-made view the filters are (null when they are a custom mix). */
export function viewOf(facets: Record<string, string[]>): string | null {
  const norm = (f: Record<string, string[]>) =>
    JSON.stringify(Object.entries(f).filter(([k, v]) => k !== "customerId" && v.length).map(([k, v]) => [k, [...v].sort()]).sort());
  const mine = norm(facets);
  return EVENT_VIEWS.find((v) => norm(v.facets) === mine)?.id ?? null;
}
