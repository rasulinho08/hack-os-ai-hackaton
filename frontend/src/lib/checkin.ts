/**
 * Check-in at the door (plan module 'checkin').
 *
 *   GET    /api/events/:eventId/checkin/me                 the participant's own ticket
 *   POST   /api/events/:eventId/checkin/scan               { code, eventId? } organisers, volunteers
 *   GET    /api/events/:eventId/checkin/stats              counts, organisers and volunteers
 *   GET    /api/events/:eventId/checkin                    ?q=&filter=&limit=&offset= organisers
 *   GET    /api/events/:eventId/checkin/export.csv         organisers
 *   POST   /api/events/:eventId/checkin/participants/:pid  by hand, organisers
 *   DELETE /api/events/:eventId/checkin/participants/:pid  undo, organisers
 *
 * The ticket's QR code carries the volunteer scanner's address with the event
 * and the code, so a phone's own camera app opens the scanner with the ticket
 * already filled in (Safari has no in-page barcode reader).
 */

import { ApiError, apiDelete, apiGet, apiPost } from "@/lib/api";
import { appUrl } from "@/lib/hosts";

export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_LENGTH = 8;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** The scanner people reach from a ticket's QR code (organisers are sent on to theirs). */
export const VOLUNTEER_SCAN_PATH = "/volunteer/scan";
export const ORGANISER_SCAN_PATH = "/checkin/scan";

export type ScanOutcome = "checked_in" | "already" | "not_approved";
export const SCAN_OUTCOMES: ScanOutcome[] = ["checked_in", "already", "not_approved"];
export type Filter = "all" | "in" | "out";
export const FILTERS: Filter[] = ["all", "in", "out"];

export interface CheckinPerson {
  participantId: number;
  name: string | null;
  email?: string | null;
  team: string | null;
  status: string;
  checkedIn: boolean;
  checkedInAt: string | null;
  checkedInBy: { id: number | null; name: string | null } | null;
  method: "qr" | "manual" | null;
  code?: string | null;
}

export interface Ticket extends CheckinPerson {
  eventId: number;
  eventName: string;
  code: string;
}

export interface CheckinStats {
  admitted: number;
  checkedIn: number;
  remaining: number;
  /** Sent with the scanner's counts: the caller is an organiser and may open the list. */
  canManage: boolean;
}

export interface CheckinList {
  stats: CheckinStats;
  total: number;
  limit: number;
  offset: number;
  items: CheckinPerson[];
}

export interface ScanResult {
  result: ScanOutcome;
  participant: CheckinPerson;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** "ABCDEFGH" → "ABCD-EFGH": easier to read aloud and to type. */
export function formatCode(code: string | null | undefined): string {
  const c = String(code ?? "");
  return c.length === CODE_LENGTH ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/**
 * Whatever reaches the scanner — a typed code with dashes or spaces, small
 * letters, or a ticket's whole QR address (…?e=12&c=ABCDEFGH) — as the code
 * and the event it names. The API reads it the same way.
 */
export function parseScanInput(raw: string): { code: string | null; eventId: number | null } {
  const text = String(raw ?? "").trim();
  if (!text) return { code: null, eventId: null };
  let codePart = text;
  let eventId: number | null = null;
  const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : /[=&]/.test(text) ? text : "";
  if (query) {
    const params = new URLSearchParams(query.split("#")[0]);
    if (params.get("c")) codePart = String(params.get("c"));
    const e = Number.parseInt(String(params.get("e") ?? ""), 10);
    if (Number.isInteger(e) && e > 0) eventId = e;
  }
  const code = codePart.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return { code: CODE_RE.test(code) ? code : null, eventId };
}

/** What a ticket's QR code holds: the scanner's address with the event and the code. */
export function ticketQrValue(eventId: number, code: string, origin?: string): string {
  const path = `${VOLUNTEER_SCAN_PATH}?e=${eventId}&c=${encodeURIComponent(code)}`;
  const absolute = appUrl(path);
  if (/^https?:\/\//.test(absolute)) return absolute;
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}${path}`;
}

/**
 * The ticket a QR code opened the scanner with (…/scan?e=12&c=ABCDEFGH), as
 * the text to scan and the event it names; null when the address has none.
 */
export function ticketFromSearch(search: string): { text: string; eventId: number | null } | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const c = params.get("c");
  if (!c || !c.trim()) return null;
  const e = Number.parseInt(String(params.get("e") ?? ""), 10);
  const eventId = Number.isInteger(e) && e > 0 ? e : null;
  return { text: eventId ? `?e=${eventId}&c=${c.trim()}` : c.trim(), eventId };
}

/** Takes the ticket off the address once it is scanned, so a reload does not scan it again. */
export function clearTicketFromUrl(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("c") && !url.searchParams.has("e")) return;
  url.searchParams.delete("c");
  url.searchParams.delete("e");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function normalizePerson(v: unknown): CheckinPerson | null {
  const o = obj(v);
  const id = Number(o.participantId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const by = obj(o.checkedInBy);
  const method = o.method === "qr" || o.method === "manual" ? o.method : null;
  return {
    participantId: id,
    name: str(o.name),
    ...("email" in o ? { email: str(o.email) } : {}),
    team: str(o.team),
    status: String(o.status ?? ""),
    checkedIn: o.checkedIn === true,
    checkedInAt: str(o.checkedInAt),
    checkedInBy: o.checkedInBy ? { id: Number.isInteger(Number(by.id)) ? Number(by.id) : null, name: str(by.name) } : null,
    method,
    ...("code" in o ? { code: str(o.code) } : {}),
  };
}

export function normalizeTicket(v: unknown): Ticket | null {
  const o = obj(v);
  const person = normalizePerson(o);
  const code = str(o.code);
  const eventId = Number(o.eventId);
  if (!person || !code || !Number.isInteger(eventId)) return null;
  return { ...person, eventId, eventName: String(o.eventName ?? ""), code };
}

export function normalizeStats(v: unknown): CheckinStats {
  const o = obj(v);
  return { admitted: num(o.admitted), checkedIn: num(o.checkedIn), remaining: num(o.remaining), canManage: o.canManage === true };
}

export function normalizeList(v: unknown): CheckinList {
  const o = obj(v);
  return {
    stats: normalizeStats(o.stats),
    total: num(o.total),
    limit: num(o.limit) || 50,
    offset: num(o.offset),
    items: (Array.isArray(o.items) ? o.items : []).map(normalizePerson).filter((p): p is CheckinPerson => p != null),
  };
}

export function normalizeScan(v: unknown): ScanResult | null {
  const o = obj(v);
  const result = (SCAN_OUTCOMES as string[]).includes(String(o.result)) ? (o.result as ScanOutcome) : null;
  const participant = normalizePerson(o.participant);
  return result && participant ? { result, participant } : null;
}

export const CHECKIN_ERROR_CODES = [
  "TICKET_NOT_FOUND", "WRONG_EVENT", "VALIDATION_ERROR", "NOT_APPROVED", "NOT_CHECKED_IN", "NOT_REGISTERED",
  "MODULE_DISABLED", "EVENT_ARCHIVED", "FORBIDDEN", "NOT_FOUND", "RATE_LIMITED", "generic",
] as const;

/** The i18n key for a refused check-in request. */
export function checkinErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    const code = String(err.code ?? "");
    if ((CHECKIN_ERROR_CODES as readonly string[]).includes(code) && code !== "generic") return `ci.err.${code}`;
    if (err.status === 403) return "ci.err.FORBIDDEN";
    if (err.status === 404) return "ci.err.NOT_FOUND";
    if (err.status === 429) return "ci.err.RATE_LIMITED";
  }
  return "ci.err.generic";
}

const base = (eventId: number) => `/api/events/${eventId}/checkin`;

export const checkinApi = {
  mine: async (eventId: number) => normalizeTicket(await apiGet<unknown>(`${base(eventId)}/me`)),
  stats: async (eventId: number) => normalizeStats(await apiGet<unknown>(`${base(eventId)}/stats`)),
  list: async (eventId: number, query: { q?: string; filter?: Filter; limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.filter && query.filter !== "all") params.set("filter", query.filter);
    if (query.limit) params.set("limit", String(query.limit));
    if (query.offset) params.set("offset", String(query.offset));
    const qs = params.toString();
    return normalizeList(await apiGet<unknown>(`${base(eventId)}${qs ? `?${qs}` : ""}`));
  },
  scan: async (eventId: number, input: string) => {
    const parsed = parseScanInput(input);
    // The whole text goes to the API, which reads it the same way; the event the
    // QR code names lets it say "another event" instead of "unknown".
    return normalizeScan(await apiPost<unknown>(`${base(eventId)}/scan`, { code: input, ...(parsed.eventId ? { eventId: parsed.eventId } : {}) }));
  },
  checkIn: async (eventId: number, participantId: number) =>
    normalizeScan(await apiPost<unknown>(`${base(eventId)}/participants/${participantId}`, {})),
  undo: (eventId: number, participantId: number) => apiDelete<unknown>(`${base(eventId)}/participants/${participantId}`),
  csvPath: (eventId: number) => `${base(eventId)}/export.csv`,
};
