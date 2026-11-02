/**
 * Personal invitations to register (the organiser's Invitations screen):
 * reading what the organiser pastes or uploads into a list of people, the
 * API's answers read defensively, and the small rules the screen shows.
 *
 * The API checks every address again and decides who is skipped (already
 * registered, already invited, on the staff); nothing here is trusted by it.
 * See the backend's participantInvite.service.js.
 */

import { parseRows } from "@/lib/csvImport";

export const INVITE_STATUSES = ["not_sent", "sent", "opened", "registered", "expired", "revoked"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

/** Why the API left an address out of a batch (the answer's `skipped[].reason`). */
export const SKIP_REASONS = ["registered", "already_invited", "staff", "other_role", "cooldown", "revoked", "not_open"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Refusals the screen says in its own words (iv.err.*). */
export const INVITE_ERRORS = [
  "EVENT_NOT_PUBLISHED", "EVENT_ARCHIVED", "TOO_MANY", "DAILY_LIMIT", "RATE_LIMITED", "VALIDATION_ERROR",
  "INVITE_REVOKED", "INVITE_USED", "INVITE_EXPIRED", "NOT_FOUND",
] as const;

/** How long a link works, as offered on the screen (days). */
export const LINK_DAYS = [7, 14, 30, 60] as const;

/** The most addresses one send takes (the API's limit). */
export const MAX_BATCH = 500;

export interface Invitee {
  email: string;
  fullName: string | null;
  team: string | null;
}

export interface ParsedList {
  valid: Invitee[];
  /** What was typed where an address should be, as typed. */
  invalid: string[];
  /** Addresses given more than once (kept once). */
  duplicates: string[];
}

export interface Invitation {
  id: number;
  email: string;
  fullName: string | null;
  team: string | null;
  status: InviteStatus;
  createdAt: string | null;
  sentAt: string | null;
  sendCount: number;
  openedAt: string | null;
  registeredAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  invitedBy: string | null;
  participantStatus: string | null;
}

export interface InviteCapacity {
  limit: number | null;
  taken: number;
  /** Invitations still open: they get their people in whatever the limit says. */
  outstanding: number;
  remaining: number | null;
  /** How far over the limit the event would go if every invited person registered. */
  overBy: number;
}

export interface InvitationsPage {
  event: { id: number; name: string; slug: string | null; visibility: "public" | "private" | "invite"; published: boolean; archived: boolean; language: string };
  items: Invitation[];
  counts: Record<InviteStatus, number> & { total: number };
  capacity: InviteCapacity;
  limits: { batch: number; defaultDays: number; maxDays: number; dailySends: number };
}

export interface SendResult {
  created: number[];
  reinvited: number[];
  sent: number;
  failed: number;
  skipped: { email?: string; id?: number; reason: string }[];
  invalid: { value: string; reason: string }[];
  duplicates: number;
  renewed?: number;
}

/* ── Reading what the organiser gives ────────────────────────────────── */

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export const isEmail = (v: string) => v.length <= 255 && EMAIL_RE.test(v);

/** Checks a list: addresses trimmed and lower-cased, each kept once, the bad ones said. */
export function checkInvitees(list: { email: string; fullName?: string | null; team?: string | null }[]): ParsedList {
  const valid: Invitee[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const email = String(raw.email ?? "").trim().toLowerCase();
    if (!email) continue;
    if (!isEmail(email)) { invalid.push(String(raw.email).trim()); continue; }
    if (seen.has(email)) { duplicates.push(email); continue; }
    seen.add(email);
    const fullName = clean(raw.fullName, 200);
    const team = clean(raw.team, 80);
    if (/[<>]/.test(fullName) || /[<>]/.test(team)) { invalid.push(email); continue; }
    valid.push({ email, fullName: fullName || null, team: team || null });
  }
  return { valid, invalid, duplicates };
}

/**
 * What is pasted into the box: addresses separated by new lines, commas,
 * semicolons or spaces, as an e-mail program copies them too —
 * `Aysel Məmmədova <aysel@example.com>` keeps the name.
 */
export function parsePasted(text: string): ParsedList {
  const out: { email: string; fullName: string | null }[] = [];
  const src = String(text || "");
  // "Name <address>" first, then whatever is left.
  const named = /(?:"?([^"<>,;\n]*?)"?\s*)<([^<>\s]+)>/g;
  let rest = src;
  for (const m of src.matchAll(named)) {
    out.push({ email: m[2], fullName: m[1]?.trim() || null });
    rest = rest.replace(m[0], " ");
  }
  for (const piece of rest.split(/[\s,;]+/)) {
    const token = piece.trim().replace(/^mailto:/i, "");
    if (token) out.push({ email: token, fullName: null });
  }
  return checkInvitees(out);
}

const NAME_HEADERS = ["name", "full name", "fullname", "full_name", "ad", "ad soyad", "ad və soyad", "adı", "имя", "фио", "имя и фамилия"];
const EMAIL_HEADERS = ["email", "e-mail", "e-mail address", "email address", "mail", "e-poçt", "epoçt", "poçt", "почта", "эл. почта", "электронная почта"];
const TEAM_HEADERS = ["team", "team name", "komanda", "komandanın adı", "команда", "название команды"];

/**
 * A CSV with a header row: a name, an e-mail and, optionally, a team column
 * (in English, Azerbaijani or Russian). Without a header that names an
 * e-mail column, the cells that look like addresses are taken, each with the
 * text cell before it as the name.
 */
export function parseInviteCsv(text: string): ParsedList & { columns: { name: boolean; team: boolean } } {
  const rows = parseRows(text);
  if (!rows.length) return { valid: [], invalid: [], duplicates: [], columns: { name: false, team: false } };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const find = (names: string[]) => head.findIndex((h) => names.includes(h));
  const emailCol = find(EMAIL_HEADERS);
  if (emailCol >= 0) {
    const nameCol = find(NAME_HEADERS);
    const teamCol = find(TEAM_HEADERS);
    const list = rows.slice(1).map((r) => ({
      email: r[emailCol] ?? "",
      fullName: nameCol >= 0 ? r[nameCol] ?? null : null,
      team: teamCol >= 0 ? r[teamCol] ?? null : null,
    }));
    return { ...checkInvitees(list), columns: { name: nameCol >= 0, team: teamCol >= 0 } };
  }
  const list = rows.map((r) => {
    const at = r.findIndex((c) => c.includes("@"));
    return { email: at >= 0 ? r[at] : r.join(" "), fullName: at > 0 ? r[at - 1] : null, team: at >= 0 ? r[at + 1] ?? null : null };
  });
  return { ...checkInvitees(list), columns: { name: list.some((x) => x.fullName), team: list.some((x) => x.team) } };
}

/** The header row of the template the screen offers to download. */
export const CSV_TEMPLATE = "name,email,team\r\n";

/* ── Reading the API ──────────────────────────────────────────────────── */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => ((list as readonly string[]).includes(String(v)) ? (v as T) : fallback);

export function normalizeInvitation(raw: unknown): Invitation | null {
  const o = obj(raw);
  const id = int(o.id);
  const email = str(o.email);
  if (id == null || !email) return null;
  return {
    id,
    email: email.toLowerCase(),
    fullName: str(o.fullName),
    team: str(o.team),
    status: oneOf(INVITE_STATUSES, o.status, "not_sent"),
    createdAt: str(o.createdAt),
    sentAt: str(o.sentAt),
    sendCount: Math.max(0, int(o.sendCount) ?? 0),
    openedAt: str(o.openedAt),
    registeredAt: str(o.registeredAt),
    expiresAt: str(o.expiresAt),
    revokedAt: str(o.revokedAt),
    invitedBy: str(o.invitedBy),
    participantStatus: str(o.participantStatus),
  };
}

export function normalizeCapacity(raw: unknown): InviteCapacity {
  const c = obj(raw);
  return {
    limit: int(c.limit),
    taken: Math.max(0, int(c.taken) ?? 0),
    outstanding: Math.max(0, int(c.outstanding) ?? 0),
    remaining: int(c.remaining),
    overBy: Math.max(0, int(c.overBy) ?? 0),
  };
}

export function normalizeInvitationsPage(raw: unknown): InvitationsPage {
  const r = obj(raw);
  const e = obj(r.event);
  const items = (Array.isArray(r.items) ? r.items : []).map(normalizeInvitation).filter((x): x is Invitation => x != null);
  const counts = Object.fromEntries(INVITE_STATUSES.map((s) => [s, 0])) as Record<InviteStatus, number>;
  for (const it of items) counts[it.status] += 1;
  const l = obj(r.limits);
  return {
    event: {
      id: int(e.id) ?? 0,
      name: str(e.name) ?? "",
      slug: str(e.slug),
      visibility: oneOf(["public", "private", "invite"] as const, e.visibility, "public"),
      published: e.published !== false,
      archived: e.archived === true,
      language: str(e.language) ?? "az",
    },
    items,
    counts: { ...counts, total: items.length },
    capacity: normalizeCapacity(r.capacity),
    limits: {
      batch: int(l.batch) ?? MAX_BATCH,
      defaultDays: int(l.defaultDays) ?? 14,
      maxDays: int(l.maxDays) ?? 60,
      dailySends: int(l.dailySends) ?? 2000,
    },
  };
}

export function normalizeSendResult(raw: unknown): SendResult {
  const r = obj(raw);
  const ids = (v: unknown) => (Array.isArray(v) ? v.map(int).filter((n): n is number => n != null) : []);
  return {
    created: ids(r.created),
    reinvited: ids(r.reinvited),
    sent: Math.max(0, int(r.sent) ?? 0),
    failed: Math.max(0, int(r.failed) ?? 0),
    skipped: (Array.isArray(r.skipped) ? r.skipped : []).map((x) => {
      const o = obj(x);
      return { email: str(o.email) ?? undefined, id: int(o.id) ?? undefined, reason: str(o.reason) ?? "other_role" };
    }),
    invalid: (Array.isArray(r.invalid) ? r.invalid : []).map((x) => ({ value: str(obj(x).value) ?? "", reason: str(obj(x).reason) ?? "invalid_email" })),
    duplicates: Math.max(0, int(r.duplicates) ?? 0),
    renewed: int(r.renewed) ?? undefined,
  };
}

/** How many of each reason, for one sentence per reason. */
export function skipCounts(skipped: { reason: string }[]): { reason: SkipReason; n: number }[] {
  const by = new Map<SkipReason, number>();
  for (const s of skipped) {
    const reason = oneOf(SKIP_REASONS, s.reason, "other_role");
    by.set(reason, (by.get(reason) ?? 0) + 1);
  }
  return SKIP_REASONS.filter((r) => by.has(r)).map((reason) => ({ reason, n: by.get(reason) as number }));
}

/** What an organiser may still do with an invitation. */
export function actionsFor(inv: Pick<Invitation, "status">): { resend: boolean; revoke: boolean; copy: boolean } {
  const open = inv.status === "not_sent" || inv.status === "sent" || inv.status === "opened";
  return { resend: open || inv.status === "expired", revoke: open || inv.status === "expired", copy: open };
}

/** The invitations a bulk action can act on: the ones it applies to, and how many it leaves out. */
export function bulkTargets(items: Invitation[], ids: (string | number)[], action: "resend" | "revoke"): { ids: number[]; skipped: number } {
  const want = new Set(ids.map(Number));
  const chosen = items.filter((x) => want.has(x.id));
  const ok = chosen.filter((x) => actionsFor(x)[action]).map((x) => x.id);
  return { ids: ok, skipped: chosen.length - ok.length };
}
