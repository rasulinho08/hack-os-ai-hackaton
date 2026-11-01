/**
 * A short memory of session checks for the middleware (middleware.ts).
 *
 * The middleware asks the API who is signed in (GET /api/auth/me) before
 * every page and every proxied API call — prefetches included — and the API
 * counts those against the account's rate limit. Remembering the answer for
 * a few seconds turns a burst of requests into one check.
 *
 * Why this is safe:
 *   - The key is a SHA-256 of exactly the cookies the API reads to answer
 *     /me (the session token, the workspace entered, the owner's second
 *     step). Another person's cookies, or the same person in another
 *     workspace, make another key: an answer is only ever reused for the
 *     very cookies it was given for. The token itself is never kept.
 *   - Memory only, per server instance, never shared between instances or
 *     written anywhere; at most MAX_ENTRIES answers, each for TTL_MS (and
 *     never past the token's own expiry).
 *   - Only "signed in as …" is remembered. "Signed out" and "the API could
 *     not be reached" are asked again every time.
 *   - Signing out forgets the answer for that browser's cookies at once;
 *     "sign out everywhere" forgets every answer for that account on this
 *     instance. On other instances such an answer lives at most TTL_MS.
 *     That only steers the middleware's own redirects: the API checks the
 *     session itself on every request it serves, so a revoked token gets no
 *     data either way.
 */

import type { BackendUser } from "./backendAuth";

export const TTL_MS = 15_000;
export const MAX_ENTRIES = 1000;

/** The cookies GET /api/auth/me depends on (authMw and effectiveRole on the API). */
const KEY_COOKIES = ["access_token", "hh_event", "hh_elev"] as const;

interface Entry { user: BackendUser; expires: number }
const entries = new Map<string, Entry>();
/*
 * After a sign-out, answers for those cookies (or that account) are not
 * remembered again for TTL_MS: a check that was already on its way when the
 * session ended — the sign-out request's own, a prefetch — must not put the
 * old answer back.
 */
const quietKeys = new Map<string, number>();
const quietAccounts = new Map<number, number>();

/** Keeps a "do not remember" list within MAX_ENTRIES: expired marks first, then the oldest. */
function bound(map: Map<string | number, number>, now: number): void {
  if (map.size < MAX_ENTRIES) return;
  for (const [k, until] of map) if (until <= now) map.delete(k);
  while (map.size >= MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function quiet(map: Map<string | number, number>, id: string | number, now: number): boolean {
  const until = map.get(id);
  if (until == null) return false;
  if (until > now) return true;
  map.delete(id);
  return false;
}

/** name → value of a Cookie header (the first of each name, as servers read it). */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in out) continue;
    out[name] = part.slice(i + 1).trim();
  }
  return out;
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The cache key for a request's cookies; null without a session token. */
export async function sessionKey(cookieHeader: string | null): Promise<string | null> {
  const c = parseCookies(cookieHeader);
  if (!c.access_token) return null;
  return sha256Hex(KEY_COOKIES.map((n) => `${n}=${c[n] ?? ""}`).join("\n"));
}

/** When the session token says it expires (ms), read without checking it: only ever used to shorten the TTL. */
export function tokenExpiry(cookieHeader: string | null): number | null {
  const token = parseCookies(cookieHeader).access_token;
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")));
    return typeof json?.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function getCachedSession(key: string | null, now = Date.now()): BackendUser | null {
  if (!key) return null;
  const hit = entries.get(key);
  if (!hit) return null;
  if (hit.expires <= now) {
    entries.delete(key);
    return null;
  }
  return hit.user;
}

export function cacheSession(key: string | null, user: BackendUser, { now = Date.now(), tokenExp = null as number | null } = {}): void {
  if (!key) return;
  if (quiet(quietKeys as Map<string | number, number>, key, now)) return;
  if (user.id != null && quiet(quietAccounts as Map<string | number, number>, user.id, now)) return;
  const expires = Math.min(now + TTL_MS, tokenExp ?? Infinity);
  if (expires <= now) return;
  if (entries.size >= MAX_ENTRIES) {
    // Drop what has expired; if still full, the oldest (Map keeps insertion order).
    for (const [k, v] of entries) if (v.expires <= now) entries.delete(k);
    while (entries.size >= MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
  }
  entries.delete(key);
  entries.set(key, { user, expires });
}

/** Forget the answer for these cookies (sign-out), and do not remember them again for a while. */
export function forgetSession(key: string | null, now = Date.now()): void {
  if (!key) return;
  entries.delete(key);
  bound(quietKeys as Map<string | number, number>, now);
  quietKeys.set(key, now + TTL_MS);
}

/** Forget every answer for one account (sign out everywhere, a password change). */
export function forgetAccount(userId: number | undefined | null, now = Date.now()): void {
  if (userId == null || !Number.isFinite(userId)) return;
  for (const [k, v] of entries) if (v.user.id === userId) entries.delete(k);
  bound(quietAccounts as Map<string | number, number>, now);
  quietAccounts.set(userId, now + TTL_MS);
}

/** API calls after which a remembered session may be wrong. */
export function endsSession(pathname: string): "this" | "account" | null {
  if (pathname === "/api/auth/logout") return "this";
  if (pathname === "/api/auth/logout-all" || pathname === "/api/auth/change-password" || pathname === "/api/auth/reset-password") return "account";
  return null;
}

/** For tests. */
export function clearSessionCache(): void {
  entries.clear();
  quietKeys.clear();
  quietAccounts.clear();
}

/**
 * The middleware's session check, remembered for TTL_MS (see above). On a
 * request that ends the session (sign-out, sign out everywhere, a new
 * password) the answer is forgotten first and not remembered again.
 */
export async function checkSessionCached(
  cookieHeader: string | null,
  pathname: string,
  fetchSession: (cookieHeader: string | null) => Promise<BackendUser | null | "network">,
  now = Date.now(),
): Promise<BackendUser | null | "network"> {
  const key = await sessionKey(cookieHeader);
  const ending = endsSession(pathname);
  if (ending) {
    const known = getCachedSession(key, now);
    forgetSession(key, now);
    const fresh = await fetchSession(cookieHeader);
    const who = fresh && fresh !== "network" ? fresh : known;
    if (ending === "account" && who?.id != null) forgetAccount(who.id, now);
    return fresh;
  }
  const hit = getCachedSession(key, now);
  if (hit) return hit;
  const fresh = await fetchSession(cookieHeader);
  if (fresh && fresh !== "network") cacheSession(key, fresh, { now: Date.now(), tokenExp: tokenExpiry(cookieHeader) });
  return fresh;
}
