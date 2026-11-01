/**
 * E-mail confirmation on the client: what /api/auth/me says about the
 * address, kept for the browser session, and the answers of
 * POST /api/auth/verify-email(/resend).
 *
 * The state is a tiny store over sessionStorage, read through
 * useSyncExternalStore (null on the server), so the notice never renders
 * on the server and then differently in the browser. It belongs to the
 * account named by the hh_email cookie: when someone else signs in on the
 * same tab, the old answer is not used.
 */

import { ApiError } from "@/lib/api";

export interface PendingInvite {
  eventId: number | null;
  role: string;
  eventName: string | null;
}

export interface VerifyState {
  email: string;
  verified: boolean;
  invites: PendingInvite[];
  /** "Hide for now": for this browser session. */
  dismissed: boolean;
}

export const INVITE_ROLES = ["judge", "mentor", "volunteer", "hacker"] as const;

const KEY = "hh_verify";
const listeners = new Set<() => void>();
let memo: { raw: string | null; cookie: string; value: VerifyState | null } = { raw: null, cookie: "", value: null };

function cookieEmail(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)hh_email=([^;]*)/);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]).trim().toLowerCase();
  } catch {
    return m[1].trim().toLowerCase();
  }
}

function normalizeInvites(raw: unknown): PendingInvite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      eventId: Number.isFinite(Number(x.eventId ?? x.event_id)) ? Number(x.eventId ?? x.event_id) : null,
      role: (INVITE_ROLES as readonly string[]).includes(String(x.role)) ? String(x.role) : "hacker",
      eventName: typeof (x.eventName ?? x.event_name) === "string" ? String(x.eventName ?? x.event_name) : null,
    }));
}

function sanitize(o: unknown): VerifyState | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  if (typeof r.email !== "string" || !r.email) return null;
  return { email: r.email, verified: Boolean(r.verified), invites: normalizeInvites(r.invites), dismissed: Boolean(r.dismissed) };
}

/** What this session knows about the signed-in account's address, or null. */
export function readVerifyCache(): VerifyState | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(KEY);
  } catch {
    raw = null;
  }
  const ck = cookieEmail();
  if (raw === memo.raw && ck === memo.cookie) return memo.value;
  let value: VerifyState | null = null;
  try {
    value = raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    value = null;
  }
  // Another account signed in since this was written.
  if (value && ck && value.email.toLowerCase() !== ck) value = null;
  memo = { raw, cookie: ck, value };
  return value;
}

export function writeVerifyCache(state: VerifyState) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: the notice simply asks again next time */
  }
  listeners.forEach((l) => l());
}

export function subscribeVerify(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * The state from GET /api/auth/me. An answer without `email_verified` (an
 * older API, the walkthrough) counts as confirmed: no notice is better than
 * a wrong one.
 */
export function verifyStateFromMe(raw: unknown): VerifyState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const email = typeof o.email === "string" ? o.email : "";
  if (!email) return null;
  return {
    email,
    verified: o.email_verified !== false,
    invites: normalizeInvites(o.pending_invites),
    dismissed: false,
  };
}

/** The seconds to wait before another link may be sent (429 VERIFY_COOLDOWN), or null. */
export function retryAfterSeconds(err: ApiError): number | null {
  if (err.status !== 429) return null;
  const field = err.fieldErrors.find((f) => f.field === "retryAfter");
  const fromField = Number(field?.message);
  if (Number.isFinite(fromField) && fromField > 0) return Math.ceil(fromField);
  const m = /(\d+)\s*s\b/.exec(err.summary || err.message || "");
  return m ? Number(m[1]) : err.code === "VERIFY_COOLDOWN" ? 60 : null;
}

export interface VerifyAnswer {
  verified: boolean;
  alreadyVerified: boolean;
  email: string | null;
  /** The invitations the confirmation opened, with their event's name (null: unnamed). */
  applied: { eventId: number; role: string; eventName: string | null }[];
}

export function normalizeVerifyAnswer(raw: unknown): VerifyAnswer {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const applied = Array.isArray(o.applied)
    ? o.applied
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((x) => ({
        eventId: Number(x.eventId),
        role: String(x.role || "hacker"),
        eventName: typeof x.eventName === "string" && x.eventName.trim() ? x.eventName.trim() : null,
      }))
      .filter((x) => Number.isInteger(x.eventId) && x.eventId > 0)
    : [];
  return {
    verified: o.verified !== false,
    alreadyVerified: Boolean(o.alreadyVerified),
    email: typeof o.email === "string" ? o.email : null,
    applied,
  };
}

/** A role from the API as a key of ve.role.* (judge, mentor, volunteer, participant). */
export function inviteRoleKey(role: string): string {
  return `ve.role.${(INVITE_ROLES as readonly string[]).includes(role) ? role : "hacker"}`;
}
