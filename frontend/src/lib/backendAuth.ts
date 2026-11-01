/**
 * Server-side session checks against the real backend (not client `hh_role` cookie alone).
 * Used by middleware (Edge) and optionally by Route Handlers.
 */

import { getBackendOrigin } from "./backendOrigin";

/** Same origin `next.config` rewrites use — required for JWT cookies to validate on `/api/auth/me`. */
export const DEFAULT_BACKEND_URL = getBackendOrigin();

export interface BackendUser {
  id?: number;
  email?: string;
  role: string;
  full_name?: string;
  /**
   * Hacker gate status from the backend (current events only), e.g.
   * approved | pending | rejected | eliminated | waitlisted.
   * Non-hackers always receive approved.
   */
  status?: string;
}

function unwrapMePayload(json: unknown): BackendUser | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (o.success === false) return null;
  const inner =
    o.data && typeof o.data === "object"
      ? (o.data as Record<string, unknown>)
      : o;
  const role = String(inner.role ?? "").trim();
  if (!role) return null;
  const rawStatus = inner.status;
  const status =
    typeof rawStatus === "string" && rawStatus.trim()
      ? rawStatus.trim().toLowerCase()
      : undefined;
  return {
    id: typeof inner.id === "number" ? inner.id : Number(inner.id),
    email: typeof inner.email === "string" ? inner.email : undefined,
    full_name:
      typeof inner.full_name === "string"
        ? inner.full_name
        : typeof inner.fullName === "string"
          ? inner.fullName
          : undefined,
    role,
    status,
  };
}

/**
 * Result of a backend session check.
 *  - `user`     : authenticated user payload, returned on a healthy 2xx /me.
 *  - `null`     : the backend explicitly said this request is unauthenticated
 *                 (no cookie at all, or 401/403). Caller should redirect to login.
 *  - `"network"`: the backend was unreachable / timed out / returned 5xx.
 *                 Caller should NOT log the user out — the access_token cookie
 *                 is still on their device and the next request might succeed.
 *                 Logging them out here is what made refresh on a slow Render
 *                 cold start kick people back to /login mid-event (problem 21).
 */
export type SessionResult = BackendUser | null | "network";

/** True when `r` is a real authenticated user payload. */
export function isAuthenticated(r: SessionResult): r is BackendUser {
  return r !== null && r !== "network";
}

/** Fetch current user from backend using Cookie header (same as browser → rewrite). */
export async function fetchBackendSession(
  cookieHeader: string | null
): Promise<SessionResult> {
  if (!cookieHeader || !cookieHeader.includes("access_token")) {
    return null;
  }
  const url = `${DEFAULT_BACKEND_URL.replace(/\/$/, "")}/api/auth/me`;
  try {
    // Edge runtime fetch doesn't support the standard `signal` AbortController
    // timeout pattern reliably, so we race against a manual timeout. 10s
    // accounts for Render's free-tier cold start without hanging the
    // middleware indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { cookie: cookieHeader },
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    // 5xx is a backend-side hiccup, not an auth failure → tell the caller
    // to keep the user on the page instead of bouncing them to /login.
    if (res.status >= 500) {
      return "network";
    }
    if (res.status === 401 || res.status === 403) {
      return null;
    }
    if (!res.ok) {
      // 404, 429, etc. — treat as a transient hiccup so refresh doesn't
      // dump the user on /login because the auth limiter just throttled
      // /api/auth/me.
      return "network";
    }
    const json: unknown = await res.json();
    return unwrapMePayload(json);
  } catch {
    // Abort, DNS failure, TLS error, server unreachable — any of these are
    // network problems, not "user is signed out". Keep them logged in.
    return "network";
  }
}

/** Normalize roles for comparison (dashboard admins). */
export function normalizeRole(role: string): string {
  const r = role.trim().toLowerCase();
  // Both are admin-shaped for routing purposes. The distinction that matters —
  // who owns the platform — is enforced by the API, not by this comparison.
  if (r === "org_admin" || r === "superadmin") return "admin";
  return r;
}

export function rolesMatch(a: string, b: string): boolean {
  return normalizeRole(a) === normalizeRole(b);
}

export function isDashboardAdminRole(role: string): boolean {
  const r = normalizeRole(role);
  return r === "admin";
}

export function isHackerRole(role: string): boolean {
  return normalizeRole(role) === "hacker";
}

/**
 * Block hackers from dashboards unless the backend explicitly reports
 * `approved`. Covers pending, rejected, eliminated, waitlisted, etc.
 * Empty status means an older backend without the field — do not block
 * (avoids locking everyone out before deploy).
 */
export function isHackerPendingOrRejected(user: BackendUser): boolean {
  if (!isHackerRole(user.role)) return false;
  const s = (user.status || "").trim().toLowerCase();
  if (!s) return false;
  if (s === "eliminated") return false; // handled separately by `isHackerEliminated`
  return s !== "approved";
}

/**
 * Problem 11: separate check for hackers whose team was eliminated by
 * the admin. These users still have a valid session and should see a
 * dedicated "you were eliminated" page — not the generic /login banner
 * we show for pending/rejected accounts.
 */
export function isHackerEliminated(user: BackendUser): boolean {
  if (!isHackerRole(user.role)) return false;
  const s = (user.status || "").trim().toLowerCase();
  return s === "eliminated";
}

export function isOrganizerChatRole(role: string): boolean {
  const r = normalizeRole(role);
  return r === "admin";
}

/**
 * API routes that must work without a session (login, join, public event list).
 * Everything else requires a valid backend session (see middleware).
 */
export function isPublicApiRoute(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  /* Uptime monitors must reach this without a session. */
  if (pathname === "/api/health" && (m === "GET" || m === "HEAD")) return true;
  if (pathname === "/api/auth/login" && m === "POST") return true;
  if (pathname === "/api/auth/register" && m === "POST") return true;
  if (pathname === "/api/auth/logout" && m === "POST") return true;
  /* Password reset: the whole point is that the caller has no session. */
  if (pathname === "/api/auth/forgot-password" && m === "POST") return true;
  if (pathname === "/api/auth/reset-password" && m === "POST") return true;
  if (pathname === "/api/events" && m === "GET") return true;
  if (m === "GET" && /^\/api\/events\/[^/]+$/.test(pathname)) {
    if (pathname === "/api/events/active") return false;
    return true;
  }
  /* Website contact form: the visitor has no account. */
  if (pathname === "/api/leads" && m === "POST") return true;
  /* Price list for /pricing and /checkout before sign-in. */
  if (pathname === "/api/checkout/plans" && m === "GET") return true;
  /* The setup link from the approval e-mail says what it is for before sign-in. */
  if (m === "GET" && /^\/api\/setup\/[^/]+$/.test(pathname)) return true;
  /* Telegram webhook – authenticated via its own secret header, not session */
  if (pathname === "/api/telegram/webhook" && m === "POST") return true;
  /*
   * An event's public page and its registration: visitors have no account
   * yet (registering creates it). The API applies its own rules — published
   * events only, registration window, capacity — so nothing is opened here
   * that the API does not decide on itself.
   */
  if (m === "GET" && /^\/api\/public\/events\/[^/]+$/.test(pathname)) return true;
  if (m === "POST" && /^\/api\/public\/events\/[^/]+\/register$/.test(pathname)) return true;
  if (m === "GET" && pathname === "/api/universities") return true;
  /*
   * Files: logos and banners appear on public pages; a registration form
   * uploads its attachments before the account exists. The API decides per
   * file who may read it and per purpose who may upload.
   */
  if (m === "GET" && /^\/api\/files\/[0-9a-f-]{36}$/i.test(pathname)) return true;
  if (m === "POST" && pathname === "/api/files") return true;
  /*
   * The check of a certificate by its code, and its PDF: opened by whoever
   * the holder shows it to. The API answers by code alone and shows no
   * e-mail address.
   */
  if (m === "GET" && /^\/api\/public\/certificates\/[A-Za-z0-9-]{1,20}(\/pdf)?$/.test(pathname)) return true;
  /*
   * The link in the confirmation e-mail: the token in the body is the proof,
   * whoever opens it. Sending a new link stays for the signed-in account.
   */
  if (m === "POST" && pathname === "/api/auth/verify-email") return true;
  /* The platform's notice above the sign-in page and the public site. */
  if (m === "GET" && pathname === "/api/public/notice") return true;
  /* The home page's figures. */
  if (m === "GET" && pathname === "/api/public/stats") return true;
  /*
   * Calendars: an event's public dates, and a person's own feed, which
   * calendar apps fetch with no cookie — the signed token in the path is the
   * key (<user>.<version>.<mac>), checked by the API.
   */
  if (m === "GET" && /^\/api\/public\/events\/[^/]+\/calendar\.ics$/.test(pathname)) return true;
  if (m === "GET" && /^\/api\/calendar\/[0-9]+\.[0-9]+\.[A-Za-z0-9_-]{32}\.ics$/.test(pathname)) return true;
  /*
   * An event's projects page (the API answers 404 until the organiser opens
   * it and the results are out) and the platform's status, for the /status
   * page and monitors: read by anyone, nothing written.
   */
  if (m === "GET" && /^\/api\/public\/events\/[^/]+\/projects$/.test(pathname)) return true;
  if ((m === "GET" || m === "HEAD") && pathname === "/api/public/status") return true;
  /*
   * The directory of hackathons (published, public, listed events only) and
   * a person's public profile, which the API shows only when they switched
   * it on, with only the parts they chose.
   */
  if (m === "GET" && /^\/api\/public\/directory(\/slugs)?$/.test(pathname)) return true;
  if (m === "GET" && /^\/api\/public\/profiles\/[a-z0-9-]{1,40}$/i.test(pathname)) return true;
  /*
   * A personal invitation's link, read by the registration page before the
   * person has an account: the token in the path is the proof (inviteToken.js
   * on the API), and a token that does not check out answers 404.
   */
  if (m === "GET" && /^\/api\/public\/invitations\/[ml]\.\d{1,12}\.[A-Za-z0-9_-]{32}$/.test(pathname)) return true;
  return false;
}
