/**
 * An event's public projects page (/e/<slug>/projects): closed until the
 * organiser opens it, shown once the results are published, without the
 * projects whose team lead kept them off it.
 *
 *   GET /api/public/events/:slug/projects            anyone (404 while closed)
 *   GET /api/events/:eventId/results/projects        organiser: the switch and the counts
 *   PUT /api/events/:eventId/results/projects        organiser: { public: boolean }
 *   GET /api/events/:eventId/results/projects/mine   participant: their team's state
 *   PUT /api/events/:eventId/results/projects/mine   team lead: { hidden: boolean }
 *
 * The API already leaves out people, scores and anything but http(s) links;
 * the normalizers below check the same again before anything reaches a page.
 */

import { ApiError, apiGet, apiPut } from "@/lib/api";
import { appOrigin } from "@/lib/hosts";
import type { Lang } from "@/lib/i18n";

export interface ProjectAward {
  name: string;
  kind: string;
  value: string | null;
}

export interface PublicProject {
  id: number;
  title: string;
  teamName: string | null;
  description: string | null;
  techStack: string | null;
  trackId: number | null;
  track: string | null;
  links: { repo: string | null; demo: string | null; video: string | null };
  place: number | null;
  awards: ProjectAward[];
}

export interface PublicProjectsEvent {
  name: string;
  slug: string;
  tagline: string | null;
  language: Lang;
  startDate: string | null;
  endDate: string | null;
  timezone: string | null;
  organiser: string | null;
  archived: boolean;
  brandColor: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
}

export interface PublicProjectsPage {
  event: PublicProjectsEvent;
  resultsPublishedAt: string | null;
  /** "all": every project's place is public; "winners": only the prize winners'. */
  places: "all" | "winners";
  tracks: { id: number; name: string }[];
  projects: PublicProject[];
}

export interface OrganiserProjectsState {
  public: boolean;
  publicSince: string | null;
  resultsPublished: boolean;
  eventPublished: boolean;
  /** Open, the results out and the event page published: visitors see it. */
  live: boolean;
  slug: string | null;
  projects: { listed: number; hidden: number; eliminated: number };
}

export interface MyProjectState {
  public: boolean;
  live: boolean;
  slug: string | null;
  team: { id: number; name: string; isLead: boolean; hidden: boolean; hasProject: boolean; eliminated: boolean } | null;
}

const LANGS: Lang[] = ["az", "en", "ru"];
const LINK_MAX = 500;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const posInt = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const count = (v: unknown): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

/** An http(s) address the page may link to; anything else is dropped. */
export function safeLink(v: unknown): string | null {
  const s = str(v);
  if (!s || s.length > LINK_MAX || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? s : null;
  } catch {
    return null;
  }
}

/** A colour the page may paint with (it ends up in a style attribute). */
export function safeColor(v: unknown): string | null {
  const s = str(v);
  return s && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : null;
}

/** An image of the event's own: one of its uploaded files, or an https address. */
export function safeImage(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^\/api\/files\/[0-9a-f-]{36}$/i.test(s)) return s;
  const link = safeLink(s);
  return link && link.startsWith("https://") && !/["'()\\]/.test(link) ? link : null;
}

function normalizeAward(v: unknown): ProjectAward | null {
  const o = obj(v);
  const name = str(o.name);
  if (!name) return null;
  return { name, kind: str(o.kind) ?? "special", value: str(o.value) };
}

export function normalizeProject(v: unknown): PublicProject | null {
  const o = obj(v);
  const id = posInt(o.id);
  const title = str(o.title);
  if (id == null || !title) return null;
  const links = obj(o.links);
  const place = posInt(o.place);
  return {
    id,
    title,
    teamName: str(o.teamName),
    description: str(o.description),
    techStack: str(o.techStack),
    trackId: posInt(o.trackId),
    track: str(o.track),
    links: { repo: safeLink(links.repo), demo: safeLink(links.demo), video: safeLink(links.video) },
    place,
    awards: (Array.isArray(o.awards) ? o.awards : []).map(normalizeAward).filter((a): a is ProjectAward => a != null),
  };
}

/** The public page's data; null when it is not a page (missing event name or slug). */
export function normalizePublicProjects(v: unknown): PublicProjectsPage | null {
  const o = obj(v);
  const e = obj(o.event);
  const name = str(e.name);
  const slug = str(e.slug);
  if (!name || !slug) return null;
  const language = LANGS.includes(e.language as Lang) ? (e.language as Lang) : "az";
  const projects = (Array.isArray(o.projects) ? o.projects : [])
    .map(normalizeProject)
    .filter((p): p is PublicProject => p != null);
  const tracks = (Array.isArray(o.tracks) ? o.tracks : [])
    .map((t) => {
      const x = obj(t);
      const id = posInt(x.id);
      const trackName = str(x.name);
      return id != null && trackName ? { id, name: trackName } : null;
    })
    .filter((t): t is { id: number; name: string } => t != null);
  return {
    event: {
      name,
      slug,
      tagline: str(e.tagline),
      language,
      startDate: str(e.startDate),
      endDate: str(e.endDate),
      timezone: str(e.timezone),
      organiser: str(e.organiser),
      archived: e.archived === true,
      brandColor: safeColor(e.brandColor),
      logoUrl: safeImage(e.logoUrl),
      bannerUrl: safeImage(e.bannerUrl),
    },
    resultsPublishedAt: str(o.resultsPublishedAt),
    places: o.places === "all" ? "all" : "winners",
    tracks,
    projects,
  };
}

export function normalizeOrganiserState(v: unknown): OrganiserProjectsState {
  const o = obj(v);
  const c = obj(o.projects);
  return {
    public: o.public === true,
    publicSince: str(o.publicSince),
    resultsPublished: o.resultsPublished === true,
    eventPublished: o.eventPublished === true,
    live: o.live === true,
    slug: str(o.slug),
    projects: { listed: count(c.listed), hidden: count(c.hidden), eliminated: count(c.eliminated) },
  };
}

export function normalizeMine(v: unknown): MyProjectState {
  const o = obj(v);
  const t = obj(o.team);
  const id = posInt(t.id);
  return {
    public: o.public === true,
    live: o.live === true,
    slug: str(o.slug),
    team: id != null ? {
      id,
      name: str(t.name) ?? "",
      isLead: t.isLead === true,
      hidden: t.hidden === true,
      hasProject: t.hasProject === true,
      eliminated: t.eliminated === true,
    } : null,
  };
}

/** A winner on this page: a place, or any prize. */
export const isWinner = (p: PublicProject) => p.place != null || p.awards.length > 0;

/**
 * The prizes to name on a project's card. A place prize says nothing the
 * place does not already say unless it carries a value ("1000 AZN").
 */
export const shownAwards = (p: PublicProject): ProjectAward[] =>
  p.awards.filter((a) => a.kind !== "place" || a.value != null || p.place == null);

/** The projects of one track (all of them when `trackId` is null), in the API's order. */
export function inTrack(projects: PublicProject[], trackId: number | null): PublicProject[] {
  return trackId == null ? projects : projects.filter((p) => p.trackId === trackId);
}

/** What the organiser's switch says about the page. */
export function organiserPhase(s: OrganiserProjectsState): "live" | "waiting" | "off" {
  if (!s.public) return "off";
  return s.live ? "live" : "waiting";
}

export function projectsPagePath(slug: string): string {
  return `/e/${encodeURIComponent(slug)}/projects`;
}

/** The event page a projects page belongs to: "/e/baku-ai/projects" → "/e/baku-ai"; null for any other path. */
export function eventPathOf(pathname: string | null): string | null {
  const m = /^\/e\/([^/]+)\/projects\/?$/.exec(pathname || "");
  return m ? `/e/${m[1]}` : null;
}

/** The page's address to share, absolute (the app's own origin when one is set). */
export function projectsPageUrl(slug: string): string {
  const origin = appOrigin() || (typeof window !== "undefined" ? window.location.origin : "");
  return `${origin}${projectsPagePath(slug)}`;
}

export const PROJECTS_ERROR_CODES = [
  "EVENT_ARCHIVED", "NOT_TEAM_LEAD", "NO_TEAM", "VALIDATION_ERROR", "FORBIDDEN", "NOT_FOUND", "RATE_LIMITED", "generic",
] as const;

/** The i18n key for a failed request. */
export function projectsErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    const code = String(err.code || "");
    if ((PROJECTS_ERROR_CODES as readonly string[]).includes(code) && code !== "generic") return `pj.err.${code}`;
    if (err.status === 403) return "pj.err.FORBIDDEN";
    if (err.status === 404) return "pj.err.NOT_FOUND";
    if (err.status === 429) return "pj.err.RATE_LIMITED";
  }
  return "pj.err.generic";
}

const base = (eventId: number) => `/api/events/${eventId}/results/projects`;

export const projectsApi = {
  organiser: async (eventId: number) => normalizeOrganiserState(await apiGet<unknown>(base(eventId))),
  setPublic: async (eventId: number, on: boolean) => normalizeOrganiserState(await apiPut<unknown>(base(eventId), { public: on })),
  mine: async (eventId: number) => normalizeMine(await apiGet<unknown>(`${base(eventId)}/mine`)),
  setHidden: async (eventId: number, hidden: boolean) => normalizeMine(await apiPut<unknown>(`${base(eventId)}/mine`, { hidden })),
};
