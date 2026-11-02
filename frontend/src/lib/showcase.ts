/**
 * Stories from past hackathons ("showcase"): written by the platform owner in
 * the console in up to three languages, read on the public site.
 *
 *   Public  GET /api/public/showcase?limit=1..24      published stories, newest event first
 *           GET /api/public/showcase/:slug            one published story, or 404
 *   Owner   GET|POST /api/owner/showcase              every story (drafts first) / a new draft
 *           GET|PATCH|DELETE /api/owner/showcase/:id
 *           POST /api/owner/showcase/:id/publish | /unpublish
 *           POST /api/owner/showcase/files            raw image body, X-File-Name
 *
 * Words are text per language ({ az?, en?, ru? }), never rendered as HTML. A
 * body is 'plain' (paragraphs split by blank lines) or 'rich' (a small markup:
 * see lib/storyBody). A story is a draft, scheduled (public from publishAt)
 * or published.
 */

import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { sendFile } from "@/lib/upload";
import { adminHost, marketingHosts } from "@/lib/hosts";
import { SITE_URL } from "@/lib/site";
import type { BodyFormat } from "@/lib/storyBody";

export type StoryLang = "az" | "en" | "ru";
export const STORY_LANGS: StoryLang[] = ["az", "en", "ru"];
export type Words = Partial<Record<StoryLang, string>>;

export interface StoryFigures {
  participants?: number;
  teams?: number;
  projects?: number;
  hours?: number;
}
export const FIGURE_KEYS = ["participants", "teams", "projects", "hours"] as const;
export type FigureKey = (typeof FIGURE_KEYS)[number];

export interface StoryImage {
  id: string;
  url: string;
}
export interface StoryPhoto extends StoryImage {
  caption: string | null;
}

export interface Focus {
  x: number;
  y: number;
}
export const CENTER: Focus = { x: 50, y: 50 };

/** "30% 70%": the CSS object-position that keeps the cover's focus in frame. */
export const focusPosition = (f: Focus | null | undefined) => `${(f ?? CENTER).x}% ${(f ?? CENTER).y}%`;

export type StoryStatus = "draft" | "scheduled" | "published";

/** A story in a list (GET /api/public/showcase). */
export interface StoryCard {
  slug: string;
  title: Words;
  summary: Words;
  heldFrom: string | null;
  heldTo: string | null;
  location: string | null;
  organisers: string | null;
  figures: StoryFigures;
  cover: StoryImage | null;
  coverFocus: Focus;
  tags: string[];
  authorName: string | null;
  photoCount: number;
  publishedAt: string | null;
}

/** One story (GET /api/public/showcase/:slug). */
export interface Story extends Omit<StoryCard, "photoCount"> {
  body: Words;
  bodyFormat: BodyFormat;
  seoTitle: Words;
  seoDescription: Words;
  photos: StoryPhoto[];
  /** The HackOS event it was, when that event's page is public. */
  event: { name: string; slug: string } | null;
  updatedAt: string | null;
}

/** The owner's view of a story. */
export interface OwnerStory extends Story {
  id: number;
  status: StoryStatus;
  /** Readers can see it now (published, or scheduled and its time has come). */
  live: boolean;
  publishAt: string | null;
  eventId: number | null;
  createdAt: string | null;
}

export const LIMITS = {
  title: 160, summary: 400, body: 20000, location: 160, organisers: 240, caption: 200, photos: 60, slug: 80,
  tags: 12, tag: 40, author: 120, seoTitle: 90, seoDescription: 220,
} as const;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeWords(v: unknown): Words {
  const o = obj(v);
  const out: Words = {};
  for (const l of STORY_LANGS) {
    const s = o[l];
    if (typeof s === "string" && s.trim()) out[l] = s;
  }
  return out;
}

export function normalizeFigures(v: unknown): StoryFigures {
  const o = obj(v);
  const out: StoryFigures = {};
  for (const k of FIGURE_KEYS) {
    const n = Number(o[k]);
    if (o[k] != null && o[k] !== "" && Number.isInteger(n) && n >= 0) out[k] = n;
  }
  return out;
}

function image(v: unknown): StoryImage | null {
  const o = obj(v);
  const id = str(o.id);
  if (!id) return null;
  return { id, url: str(o.url) ?? `/api/files/${id}` };
}

const day = (v: unknown): string | null => (typeof v === "string" && DATE_RE.test(v) ? v : null);

export function normalizeFocus(v: unknown): Focus {
  const o = obj(v);
  const x = Number(o.x);
  const y = Number(o.y);
  const ok = (n: number) => Number.isFinite(n) && n >= 0 && n <= 100;
  return ok(x) && ok(y) ? { x, y } : { ...CENTER };
}

const tagList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).filter((t): t is string => typeof t === "string" && t.trim() !== "").slice(0, LIMITS.tags);

export function normalizeStoryCard(v: unknown): StoryCard | null {
  const o = obj(v);
  const slug = str(o.slug);
  if (!slug) return null;
  return {
    slug,
    title: normalizeWords(o.title),
    summary: normalizeWords(o.summary),
    heldFrom: day(o.heldFrom),
    heldTo: day(o.heldTo),
    location: str(o.location),
    organisers: str(o.organisers),
    figures: normalizeFigures(o.figures),
    cover: image(o.cover),
    coverFocus: normalizeFocus(o.coverFocus),
    tags: tagList(o.tags),
    authorName: str(o.authorName),
    photoCount: Number.isFinite(Number(o.photoCount)) ? Math.max(0, Number(o.photoCount)) : 0,
    publishedAt: str(o.publishedAt),
  };
}

export function normalizeStoryList(v: unknown): StoryCard[] {
  const items = Array.isArray(v) ? v : Array.isArray(obj(v).items) ? (obj(v).items as unknown[]) : [];
  return items.map(normalizeStoryCard).filter((s): s is StoryCard => s != null);
}

export function normalizeStory(v: unknown): Story | null {
  const card = normalizeStoryCard(v);
  if (!card) return null;
  const o = obj(v);
  const photos = (Array.isArray(o.photos) ? o.photos : [])
    .map((p) => {
      const img = image(p);
      return img ? { ...img, caption: str(obj(p).caption) } : null;
    })
    .filter((p): p is StoryPhoto => p != null);
  const { photoCount: _count, ...rest } = card;
  void _count;
  const ev = obj(o.event);
  return {
    ...rest,
    body: normalizeWords(o.body),
    bodyFormat: o.bodyFormat === "rich" ? "rich" : "plain",
    seoTitle: normalizeWords(o.seoTitle),
    seoDescription: normalizeWords(o.seoDescription),
    photos,
    event: str(ev.slug) && str(ev.name) ? { name: str(ev.name)!, slug: str(ev.slug)! } : null,
    updatedAt: str(o.updatedAt),
  };
}

export function normalizeOwnerStory(v: unknown): OwnerStory | null {
  const story = normalizeStory(v);
  const o = obj(v);
  const id = Number(o.id);
  if (!story || !Number.isInteger(id) || id <= 0) return null;
  const eventId = Number(o.eventId);
  return {
    ...story,
    id,
    status: o.status === "published" || o.status === "scheduled" ? o.status : "draft",
    live: o.live === true || o.status === "published",
    publishAt: str(o.publishAt),
    eventId: Number.isInteger(eventId) && eventId > 0 ? eventId : null,
    createdAt: str(o.createdAt),
  };
}

export function normalizeOwnerList(v: unknown): OwnerStory[] {
  const items = Array.isArray(v) ? v : Array.isArray(obj(v).items) ? (obj(v).items as unknown[]) : [];
  return items.map(normalizeOwnerStory).filter((s): s is OwnerStory => s != null);
}

/**
 * The text in the reader's language, else English, else Azerbaijani, else
 * Russian — a story written only in one language still shows everywhere.
 */
export function pickWords(words: Words | null | undefined, lang: string): string {
  if (!words) return "";
  const order: StoryLang[] = [lang as StoryLang, "en", "az", "ru"];
  for (const l of order) {
    const s = words[l];
    if (typeof s === "string" && s.trim()) return s;
  }
  return "";
}

/** Which language pickWords used (for the lang attribute of the text). */
export function pickedLang(words: Words | null | undefined, lang: string): StoryLang | null {
  if (!words) return null;
  const order: StoryLang[] = [lang as StoryLang, "en", "az", "ru"];
  return order.find((l) => typeof words[l] === "string" && words[l]!.trim()) ?? null;
}

/**
 * The words a story is about, for the editor's list and search: its title in
 * every language, tags, place and organisers.
 */
export function storySearchText(s: Pick<OwnerStory, "title" | "summary" | "tags" | "location" | "organisers" | "slug">): string {
  return [...Object.values(s.title), ...Object.values(s.summary), ...s.tags, s.location, s.organisers, s.slug]
    .filter(Boolean).join(" ").toLowerCase();
}

/** The languages a story has words in (a title or a body). */
export function storyLangs(s: Pick<Story, "title" | "body">): StoryLang[] {
  return STORY_LANGS.filter((l) => (s.title[l] || "").trim() || (s.body[l] || "").trim());
}

/** Paragraphs of a story's body: split by blank lines, single line breaks kept inside. */
export function paragraphs(text: string): string[] {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const AZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
const LOCALE: Record<string, string> = { en: "en-GB", ru: "ru-RU" };

function parts(d: string): { y: number; m: number; d: number } | null {
  if (!DATE_RE.test(d)) return null;
  const [y, m, dd] = d.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, dd));
  return check.getUTCMonth() === m - 1 ? { y, m, d: dd } : null;
}

/** "27 April 2026" / "27 aprel 2026" / "27 апреля 2026 г." — or without the year. */
function dayMonth(p: { y: number; m: number; d: number }, lang: string, withYear: boolean): string {
  if (lang === "az") return `${p.d} ${AZ_MONTHS[p.m - 1]}${withYear ? ` ${p.y}` : ""}`;
  return new Intl.DateTimeFormat(LOCALE[lang] ?? "en-GB", {
    day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC",
  }).format(new Date(Date.UTC(p.y, p.m - 1, p.d)));
}

/**
 * When a story's hackathon took place, in the reader's language:
 * "25–27 April 2026", "30 April – 2 May 2026", "30 December 2025 – 2 January 2026".
 * Empty when neither date is known.
 */
export function formatDateRange(from: string | null, to: string | null, lang: string): string {
  const a = from ? parts(from) : null;
  const b = to ? parts(to) : null;
  if (!a && !b) return "";
  if (!a || !b || (a.y === b.y && a.m === b.m && a.d === b.d)) return dayMonth((a ?? b)!, lang, true);
  if (a.y === b.y && a.m === b.m) {
    const end = dayMonth(b, lang, true);
    return `${a.d}–${end}`;
  }
  if (a.y === b.y) return `${dayMonth(a, lang, false)} – ${dayMonth(b, lang, true)}`;
  return `${dayMonth(a, lang, true)} – ${dayMonth(b, lang, true)}`;
}

/**
 * A story's public page. From the owner console on its own host the link
 * goes to the site: the configured marketing host on this page's scheme and
 * port (so a local console opens the local site), else SITE_URL; without an
 * admin host the page is on the same host.
 */
export function publicStoryUrl(slug: string): string {
  return `${sitePrefix()}/stories/${encodeURIComponent(slug)}`;
}

/** Where the public site is, seen from this page: "" when it is this host. */
export function sitePrefix(): string {
  if (!adminHost()) return "";
  const host = marketingHosts()[0];
  if (host && typeof window !== "undefined") {
    const port = window.location.port ? `:${window.location.port}` : "";
    return `${window.location.protocol}//${host}${port}`;
  }
  return SITE_URL;
}

/* ── Public reads ───────────────────────────────────────────────────────── */

/** The latest published stories (with one tag, when given), or null when the API does not answer. */
export async function fetchStories(limit = 12, signal?: AbortSignal, tag?: string | null): Promise<StoryCard[] | null> {
  try {
    const t = tag ? `&tag=${encodeURIComponent(tag)}` : "";
    const res = await fetch(`/api/public/showcase?limit=${Math.min(24, Math.max(1, limit))}${t}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return normalizeStoryList(json?.data);
  } catch {
    return null;
  }
}

/* ── Owner ──────────────────────────────────────────────────────────────── */

export interface StoryInput {
  title?: Words;
  summary?: Words;
  body?: Words;
  heldFrom?: string | null;
  heldTo?: string | null;
  location?: string | null;
  organisers?: string | null;
  figures?: StoryFigures;
  photos?: { fileId: string; caption?: string }[];
  coverFileId?: string | null;
  eventId?: number | null;
  slug?: string;
  bodyFormat?: BodyFormat;
  coverFocus?: Focus;
  tags?: string[];
  authorName?: string | null;
  seoTitle?: Words;
  seoDescription?: Words;
}

const base = "/api/owner/showcase";

export const ownerShowcase = {
  list: async () => normalizeOwnerList(await apiGet<unknown>(base)),
  get: async (id: number) => normalizeOwnerStory(await apiGet<unknown>(`${base}/${id}`)),
  create: async (input: StoryInput) => normalizeOwnerStory(await apiPost<unknown>(base, input)),
  update: async (id: number, input: StoryInput) => normalizeOwnerStory(await apiPatch<unknown>(`${base}/${id}`, input)),
  publish: async (id: number) => normalizeOwnerStory(await apiPost<unknown>(`${base}/${id}/publish`, {})),
  unpublish: async (id: number) => normalizeOwnerStory(await apiPost<unknown>(`${base}/${id}/unpublish`, {})),
  /** Publish at a time (ISO); a time already past publishes now. */
  schedule: async (id: number, publishAt: string) => normalizeOwnerStory(await apiPost<unknown>(`${base}/${id}/schedule`, { publishAt })),
  remove: (id: number) => apiDelete<unknown>(`${base}/${id}`),
  /** A story photo (already resized). */
  async upload(blob: Blob, name: string, onProgress?: (fraction: number) => void): Promise<StoryImage> {
    const img = image(await sendFile(`${base}/files`, blob, name, onProgress));
    if (!img) throw new ApiError("Upload failed", 500);
    return img;
  },
};

/** An owner-console message for a failed story request. */
export function storyErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "TITLE_REQUIRED") return "Give the story a title (in any language) before publishing it.";
    if (err.code === "ALREADY_PUBLISHED") return "This story is already published. Unpublish it first to schedule it.";
    if (err.code === "SLUG_TAKEN") return "Another story already has this address. Choose a different one.";
    if (err.code === "FILE_TOO_LARGE") return "This photo is larger than 5 MB.";
    if (err.code === "FILE_TYPE_NOT_ALLOWED") return "Only JPEG, PNG or WebP photos can be added.";
    if (err.code === "STORAGE_FULL") return "File storage is full. Free some space or raise STORAGE_DB_MAX_MB.";
    if (err.code === "EMPTY_FILE") return "This file is empty.";
    if (err.status === 404) return "This story is not there any more.";
    if (err.status === 401 || err.status === 403) return "Sign in again as the platform owner.";
    if (err.status === 429) return "Too many requests. Wait a moment and try again.";
    return err.summary || err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
