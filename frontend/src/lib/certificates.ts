/**
 * Certificates as the screens use them: the kinds, the organiser's list and
 * plan, a person's own certificates, the public check by code, and the paths
 * the PDFs are served at.
 *
 * The API names the kinds the builder offers slightly differently from the
 * certificates it stores ("winners" is a choice, "winner" a certificate), so
 * both spellings come through here.
 */

import { ApiError } from "@/lib/api";

export const CERT_KINDS = ["participation", "winner", "special", "judge", "mentor", "volunteer"] as const;
export type CertKind = (typeof CERT_KINDS)[number];

/** The builder's names for the kinds (certificate_config.types). */
export const BUILDER_KIND: Record<CertKind, string> = {
  participation: "participation",
  winner: "winners",
  special: "special",
  judge: "judge",
  mentor: "mentor",
  volunteer: "volunteer",
};

export function kindOf(value: unknown): CertKind | null {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "winners") return "winner";
  return (CERT_KINDS as readonly string[]).includes(v) ? (v as CertKind) : null;
}

/** The plan's per-person states and the list's filters. */
export const PLAN_STATES = ["new", "issued", "revoked"] as const;
export type PlanState = (typeof PLAN_STATES)[number];
export const LIST_STATES = ["valid", "revoked"] as const;
export const MAIL_STATES = ["sent", "not_sent"] as const;

/** Reasons the API gives on these screens, each worded in the dictionaries (ct.err.*). */
export const CERT_ERRORS = [
  "EVENT_ARCHIVED", "CERTIFICATE_EXISTS", "NOT_FOUND", "VALIDATION_ERROR", "MODULE_DISABLED", "CERTIFICATE_REVOKED",
] as const;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v == null || v === "" || !Number.isFinite(n) ? null : n;
};
const list = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  const o = obj(raw);
  for (const k of ["items", "rows", "data"]) if (Array.isArray(o[k])) return o[k] as unknown[];
  return [];
};

/* ── The organiser's list ───────────────────────────────────────────────── */

export interface IssuedCertificate {
  id: number;
  code: string;
  kind: CertKind;
  place: number | null;
  title: string | null;
  name: string;
  email: string | null;
  teamName: string | null;
  userId: number | null;
  issuedAt: string | null;
  emailedAt: string | null;
  revokedAt: string | null;
}

export function normalizeCertificates(raw: unknown): IssuedCertificate[] {
  const out: IssuedCertificate[] = [];
  for (const r of list(raw)) {
    const o = obj(r);
    const id = num(o.id);
    const kind = kindOf(o.kind ?? o.type);
    const code = str(o.code);
    if (id == null || !kind || !code) continue;
    out.push({
      id,
      code,
      kind,
      place: num(o.place),
      title: str(o.title),
      name: str(o.name ?? o.recipient_name ?? o.full_name) ?? "—",
      email: str(o.email),
      teamName: str(o.teamName ?? o.team_name),
      userId: num(o.userId ?? o.user_id),
      issuedAt: str(o.issuedAt ?? o.issued_at),
      emailedAt: str(o.emailedAt ?? o.emailed_at),
      revokedAt: str(o.revokedAt ?? o.revoked_at),
    });
  }
  return out;
}

/* ── The plan: who would get which ──────────────────────────────────────── */

export interface PlanItem {
  kind: CertKind;
  userId: number;
  name: string;
  teamName: string | null;
  place: number | null;
  title: string | null;
  state: PlanState;
}

export interface CertificatePlan {
  kinds: CertKind[];
  needsResults: boolean;
  items: PlanItem[];
  byKind: Partial<Record<CertKind, { total: number; new: number }>>;
  toIssue: number;
}

export function normalizePlan(raw: unknown): CertificatePlan {
  const o = obj(raw);
  const kinds = (Array.isArray(o.kinds) ? o.kinds : []).map(kindOf).filter((k): k is CertKind => k != null);
  const items: PlanItem[] = [];
  for (const r of Array.isArray(o.items) ? o.items : []) {
    const x = obj(r);
    const kind = kindOf(x.kind);
    const userId = num(x.userId ?? x.user_id);
    if (!kind || userId == null) continue;
    const state = (PLAN_STATES as readonly string[]).includes(String(x.state)) ? (x.state as PlanState) : "new";
    items.push({ kind, userId, name: str(x.name) ?? "—", teamName: str(x.teamName ?? x.team_name), place: num(x.place), title: str(x.title), state });
  }
  // Counted from the items when the API did not count them itself.
  const byKind: CertificatePlan["byKind"] = {};
  const given = obj(o.byKind);
  for (const k of CERT_KINDS) {
    const g = obj(given[k]);
    const total = num(g.total);
    const fresh = num(g.new);
    const mine = items.filter((i) => i.kind === k);
    if (total != null || mine.length) {
      byKind[k] = { total: total ?? mine.length, new: fresh ?? mine.filter((i) => i.state === "new").length };
    }
  }
  return {
    kinds,
    needsResults: Boolean(o.needsResults),
    items,
    byKind,
    toIssue: num(o.toIssue) ?? items.filter((i) => i.state === "new").length,
  };
}

/* ── A person's own ─────────────────────────────────────────────────────── */

export interface MyCertificate {
  code: string;
  kind: CertKind;
  place: number | null;
  title: string | null;
  issuedAt: string | null;
  eventId: number | null;
  eventName: string;
  teamName: string | null;
  url: string | null;
}

export function normalizeMine(raw: unknown): MyCertificate[] {
  const out: MyCertificate[] = [];
  for (const r of list(raw)) {
    const o = obj(r);
    const kind = kindOf(o.kind);
    const code = str(o.code);
    if (!kind || !code) continue;
    const ev = obj(o.event);
    out.push({
      code,
      kind,
      place: num(o.place),
      title: str(o.title),
      issuedAt: str(o.issuedAt ?? o.issued_at),
      eventId: num(ev.id ?? o.eventId ?? o.event_id),
      eventName: str(ev.name ?? o.eventName ?? o.event_name) ?? "",
      teamName: str(o.teamName ?? o.team_name),
      url: str(o.url),
    });
  }
  return out;
}

/* ── The public check ───────────────────────────────────────────────────── */

export interface PublicCertificate {
  code: string;
  kind: CertKind;
  name: string;
  team: string | null;
  project: string | null;
  place: number | null;
  title: string | null;
  issuedAt: string | null;
  revoked: boolean;
  event: { name: string; slug: string | null; city: string | null; startDate: string | null; endDate: string | null };
}

export function normalizePublic(raw: unknown): PublicCertificate | null {
  const o = obj(raw);
  const kind = kindOf(o.kind);
  const code = str(o.code);
  if (!kind || !code) return null;
  const ev = obj(o.event);
  return {
    code,
    kind,
    name: str(o.name) ?? "",
    team: str(o.team),
    project: str(o.project),
    place: num(o.place),
    title: str(o.title),
    issuedAt: str(o.issuedAt),
    revoked: Boolean(o.revoked),
    event: {
      name: str(ev.name) ?? "",
      slug: str(ev.slug),
      city: str(ev.city),
      startDate: str(ev.startDate),
      endDate: str(ev.endDate),
    },
  };
}

/* ── Places ─────────────────────────────────────────────────────────────── */

const AZ_UNITS: Record<number, string> = { 1: "ci", 2: "ci", 3: "cü", 4: "cü", 5: "ci", 6: "cı", 7: "ci", 8: "ci", 9: "cu" };
const AZ_TENS: Record<number, string> = { 1: "cu", 2: "ci", 3: "cu", 4: "cı", 5: "ci", 6: "cı", 7: "ci", 8: "ci", 9: "cı" };

/**
 * "1st", "1-ci", "1-е" — the number a place sentence ("{n} place") takes,
 * worded as the certificate PDF words it.
 */
export function ordinal(lang: string, n: number): string {
  if (lang === "az") {
    let suffix: string;
    if (n % 10) suffix = AZ_UNITS[n % 10];
    else if (n % 100) suffix = AZ_TENS[(n % 100) / 10];
    else suffix = n % 1000 ? "cü" : "ci";
    return `${n}-${suffix}`;
  }
  if (lang === "ru") return `${n}-е`;
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] || "th";
  return `${n}${s}`;
}

/* ── Codes and paths ────────────────────────────────────────────────────── */

const CODE_SHAPE = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/**
 * A code as typed — lower case, spaces, missing or extra dashes — in the
 * XXXX-XXXX-XXXX shape the certificates carry; anything else comes back
 * cleaned but unchanged in length, so the check can say it was not found.
 */
export function normaliseCode(input: string | null | undefined): string {
  const clean = String(input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return clean.length === 12 ? `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8)}` : clean;
}

export const isCodeShape = (code: string) => CODE_SHAPE.test(code);

export const verifyPath = (code: string) => `/verify/${encodeURIComponent(code)}`;
export const publicPdfPath = (code: string) => `/api/public/certificates/${encodeURIComponent(code)}/pdf`;
export const certificatePdfPath = (eventId: number, id: number) => `/api/events/${eventId}/certificates/${id}/pdf`;

/** The full address of a certificate's check page, on the site the reader is on. */
export function verifyUrl(code: string, origin?: string): string {
  const base = (origin ?? (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
  return `${base}${verifyPath(code)}`;
}

/**
 * LinkedIn's "add a licence or certification" form, filled in. The holder
 * still confirms it on LinkedIn; nothing is posted for them.
 */
export function linkedInAddUrl(c: { name: string; organisation: string; issuedAt: string | null; code: string; url: string }): string {
  const d = c.issuedAt ? new Date(c.issuedAt) : null;
  const p = new URLSearchParams({ startTask: "CERTIFICATION_NAME", name: c.name, organizationName: c.organisation, certUrl: c.url, certId: c.code });
  if (d && !Number.isNaN(d.getTime())) {
    p.set("issueYear", String(d.getUTCFullYear()));
    p.set("issueMonth", String(d.getUTCMonth() + 1));
  }
  return `https://www.linkedin.com/profile/add?${p.toString()}`;
}

/** The key of the sentence for an API refusal on the certificate screens. */
export function certErrorKey(err: unknown): string {
  if (err instanceof ApiError && err.code && (CERT_ERRORS as readonly string[]).includes(err.code)) return `ct.err.${err.code}`;
  if (err instanceof ApiError && err.status === 410) return "ct.err.CERTIFICATE_REVOKED";
  return "ct.err.generic";
}
