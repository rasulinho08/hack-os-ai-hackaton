/**
 * A participant's own record across events ("My hackathons") and the public
 * profile they may share at /u/<handle>.
 *
 *   GET /api/me/hackathons            events (role, team, project, place, prizes) and certificates
 *   GET|PUT /api/me/public-profile    the profile's switches, every one off until the person ticks it
 *   GET /api/public/profiles/:handle  what /u/<handle> shows; 404 unless switched on
 *
 * The public answer carries only the parts the person ticked, and never an
 * e-mail address, a phone number or an id; these helpers read it as such.
 */

import { formatDateRange } from "@/lib/showcase";
import { localDay } from "@/lib/directory";

export type Role = "lead" | "member" | "solo" | "judge" | "mentor" | "volunteer";
export const ROLES: Role[] = ["lead", "member", "solo", "judge", "mentor", "volunteer"];

export interface Prize { name: string; kind: string; value: string | null }

export interface EventRef {
  id: number | null;
  name: string;
  slug: string | null;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  format: string | null;
  organiser: string | null;
  timezone: string;
}

export interface MyHackathon {
  event: EventRef;
  role: Role;
  status: string;
  team: string | null;
  project: { name: string; tech: string | null; publicUrl: string | null } | null;
  result: { published: boolean; place: number | null; of: number | null; prizes: Prize[] };
  shareable: boolean;
}

export interface MyCertificateRow {
  code: string;
  kind: string;
  place: number | null;
  title: string | null;
  issuedAt: string | null;
  eventName: string;
  eventId: number | null;
  teamName: string | null;
  verifyUrl: string;
  pdfUrl: string;
}

export interface ProfileSettings {
  enabled: boolean;
  handle: string | null;
  showName: boolean;
  showEvents: boolean;
  showProjects: boolean;
  showCertificates: boolean;
  headline: string | null;
  hiddenEventIds: number[];
  /** Search engines may index the page and find it in the sitemap (only while it is on). */
  indexable: boolean;
  path: string | null;
  suggestedHandle: string;
}

export interface PublicProfile {
  handle: string;
  name: string | null;
  headline: string | null;
  /** Its owner lets search engines index it. */
  indexable: boolean;
  updatedAt: string | null;
  events?: { event: EventRef; role: Role; team: string | null }[];
  projects?: { name: string; team: string | null; event: EventRef; tech: string | null; place: number | null; prizes: Prize[]; url: string | null }[];
  certificates?: { code: string; kind: string; place: number | null; title: string | null; issuedAt: string | null; eventName: string; verifyUrl: string }[];
}

export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
export const HEADLINE_MAX = 120;
const CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A handle as typed: lower case, dashes for anything else, trimmed to 30. */
export function cleanHandle(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").slice(0, 30);
}

export const isHandle = (h: string) => HANDLE_RE.test(h) && !h.includes("--");

/** Same-site paths only; an address from the API is never followed elsewhere. */
function localPath(v: unknown, re: RegExp): string | null {
  const s = str(v);
  return s && re.test(s) ? s : null;
}

function eventRef(v: unknown): EventRef {
  const e = obj(v);
  const slug = str(e.slug);
  return {
    id: num(e.id),
    name: str(e.name) ?? "",
    slug: slug && SLUG_RE.test(slug) ? slug : null,
    startDate: str(e.startDate),
    endDate: str(e.endDate),
    city: str(e.city),
    format: str(e.format),
    organiser: str(e.organiser),
    timezone: str(e.timezone) ?? "Asia/Baku",
  };
}

/** "18–20 October 2026" in the event's zone and the reader's language. */
export function eventDatesOf(e: EventRef, lang: string): string {
  return formatDateRange(localDay(e.startDate, e.timezone), localDay(e.endDate, e.timezone), lang);
}

const roleOf = (v: unknown): Role => (ROLES.includes(v as Role) ? (v as Role) : "member");
const prizes = (v: unknown): Prize[] => list(v).map((p) => ({ name: str(obj(p).name) ?? "", kind: str(obj(p).kind) ?? "special", value: str(obj(p).value) })).filter((p) => p.name);

/** A certificate's public check, on this site whatever host the API named. */
function verifyPath(code: string) {
  return `/verify/${encodeURIComponent(code)}`;
}

export function normalizeMyHackathons(raw: unknown): { events: MyHackathon[]; certificates: MyCertificateRow[] } {
  const d = obj(raw);
  const events = list(d.events).map((x) => {
    const r = obj(x);
    const project = obj(r.project);
    const result = obj(r.result);
    return {
      event: eventRef(r.event),
      role: roleOf(r.role),
      status: str(r.status) ?? "approved",
      team: str(obj(r.team).name),
      project: str(project.name)
        ? { name: String(project.name), tech: str(project.tech), publicUrl: localPath(project.publicUrl, /^\/e\/[a-z0-9-]+\/projects$/) }
        : null,
      result: { published: result.published === true, place: num(result.place), of: num(result.of), prizes: prizes(result.prizes) },
      shareable: r.shareable === true,
    };
  }).filter((x) => x.event.name);
  const certificates = list(d.certificates).map((x) => {
    const c = obj(x);
    const code = str(c.code) ?? "";
    return {
      code,
      kind: str(c.kind) ?? "participation",
      place: num(c.place),
      title: str(c.title),
      issuedAt: str(c.issuedAt),
      eventName: str(obj(c.event).name) ?? "",
      eventId: num(obj(c.event).id),
      teamName: str(c.teamName),
      verifyUrl: verifyPath(code),
      pdfUrl: `/api/public/certificates/${encodeURIComponent(code)}/pdf`,
    };
  }).filter((c) => CODE_RE.test(c.code));
  return { events, certificates };
}

export function normalizeSettings(raw: unknown): ProfileSettings {
  const d = obj(raw);
  const handle = str(d.handle);
  return {
    enabled: d.enabled === true,
    handle: handle && HANDLE_RE.test(handle) ? handle : null,
    showName: d.showName === true,
    showEvents: d.showEvents === true,
    showProjects: d.showProjects === true,
    showCertificates: d.showCertificates === true,
    headline: str(d.headline),
    hiddenEventIds: list(d.hiddenEventIds).map(Number).filter((n) => Number.isInteger(n) && n > 0),
    indexable: d.enabled === true && d.indexable === true,
    path: localPath(d.path, /^\/u\/[a-z0-9-]{3,30}$/),
    suggestedHandle: str(d.suggestedHandle) ?? "",
  };
}

export function normalizePublicProfile(raw: unknown): PublicProfile | null {
  const d = obj(raw);
  const handle = str(d.handle);
  if (!handle || !HANDLE_RE.test(handle)) return null;
  const out: PublicProfile = { handle, name: str(d.name), headline: str(d.headline), indexable: d.indexable === true, updatedAt: str(d.updatedAt) };
  if (Array.isArray(d.events)) {
    out.events = d.events.map((x) => ({ event: eventRef(obj(x).event), role: roleOf(obj(x).role), team: str(obj(x).team) })).filter((x) => x.event.name);
  }
  if (Array.isArray(d.projects)) {
    out.projects = d.projects.map((x) => {
      const p = obj(x);
      return {
        name: str(p.name) ?? "",
        team: str(p.team),
        event: eventRef(p.event),
        tech: str(p.tech),
        place: num(p.place),
        prizes: prizes(p.prizes),
        url: localPath(p.url, /^\/e\/[a-z0-9-]+\/projects$/),
      };
    }).filter((p) => p.name);
  }
  if (Array.isArray(d.certificates)) {
    out.certificates = d.certificates.map((x) => {
      const c = obj(x);
      const code = str(c.code) ?? "";
      return { code, kind: str(c.kind) ?? "participation", place: num(c.place), title: str(c.title), issuedAt: str(c.issuedAt), eventName: str(c.eventName) ?? "", verifyUrl: verifyPath(code) };
    }).filter((c) => CODE_RE.test(c.code));
  }
  return out;
}

/** Newest first, then by name: the order a portfolio reads in. */
export function byDateDesc<T extends { event: EventRef }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => String(b.event.startDate ?? "").localeCompare(String(a.event.startDate ?? "")) || a.event.name.localeCompare(b.event.name));
}

/** The counts on the top of the page. */
export function summaryOf(events: MyHackathon[], certificates: MyCertificateRow[]) {
  const took = events.filter((e) => ["approved", "eliminated"].includes(e.status));
  return {
    events: took.length,
    projects: took.filter((e) => e.project).length,
    prizes: took.reduce((n, e) => n + e.result.prizes.length, 0),
    certificates: certificates.length,
  };
}

/* ── For search engines ──────────────────────────────────────────────────── */

type T = (key: string) => string;

/** The page's description: the person's headline, else what the page shows, counted. */
export function profileDescription(p: PublicProfile, t: T): string {
  if (p.headline) return p.headline;
  const parts = [
    p.events?.length ? t("pf.u.meta_events").replace("{n}", String(p.events.length)) : null,
    p.projects?.length ? t("pf.u.meta_projects").replace("{n}", String(p.projects.length)) : null,
    p.certificates?.length ? t("pf.u.meta_certificates").replace("{n}", String(p.certificates.length)) : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} — HackOS` : t("pf.u.meta_description");
}

/**
 * The page's structured data (schema.org ProfilePage about a Person), only
 * when its owner let search engines in, and only with what they chose to
 * show: the name (else the handle), the headline, prizes their projects won
 * and their certificates. Never an e-mail, a phone number or an id.
 */
export function profileJsonLd(p: PublicProfile, siteUrl: string): Record<string, unknown> | null {
  if (!p.indexable) return null;
  const url = `${siteUrl}/u/${p.handle}`;
  const awards = [...new Set((p.projects ?? []).flatMap((pr) => pr.prizes.map((z) => `${z.name} — ${pr.event.name}`)))].slice(0, 20);
  const credentials = (p.certificates ?? []).slice(0, 20).map((c) => ({
    "@type": "EducationalOccupationalCredential",
    name: c.title || c.eventName,
    ...(c.eventName ? { recognizedBy: { "@type": "Organization", name: c.eventName } } : {}),
    url: `${siteUrl}${c.verifyUrl}`,
  }));
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url,
    ...(p.updatedAt ? { dateModified: p.updatedAt } : {}),
    mainEntity: {
      "@type": "Person",
      ...(p.name ? { name: p.name } : { alternateName: `@${p.handle}` }),
      ...(p.headline ? { description: p.headline } : {}),
      url,
      ...(awards.length ? { award: awards } : {}),
      ...(credentials.length ? { hasCredential: credentials } : {}),
    },
  };
}
