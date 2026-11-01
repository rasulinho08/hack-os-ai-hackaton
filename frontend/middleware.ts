import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  fetchBackendSession,
  isAuthenticated,
  isHackerEliminated,
  isHackerPendingOrRejected,
  isOrganizerChatRole,
  isPublicApiRoute,
  normalizeRole,
  rolesMatch,
} from "@/lib/backendAuth";
import { redirectIfWrongRoleZone } from "@/lib/roleRedirects";
import { adminHost, isAdminHost, isConsolePath, isMarketingHost } from "@/lib/hosts";
import { LOGIN_PATH, isPublicPagePath } from "@/lib/publicPaths";
import { isCrossSiteWrite } from "@/lib/originCheck";
import { checkSessionCached } from "@/lib/sessionCache";

const ELIMINATED_PATH = "/hacker/eliminated";
const PENDING_CHAT_PATH = "/hacker/chat";
/**
 * Set here, and only here, when someone still waiting opens the chat: the
 * hacker layout (app/hacker/layout.tsx) cannot see the path and would send
 * them back to the sign-in page otherwise. Whatever a browser sends under
 * this name is dropped.
 */
const PENDING_CHAT_HEADER = "x-hackos-pending-chat";

function nextWithoutPendingHeader(req: NextRequest) {
  if (!req.headers.has(PENDING_CHAT_HEADER)) return NextResponse.next();
  const headers = new Headers(req.headers);
  headers.delete(PENDING_CHAT_HEADER);
  return NextResponse.next({ request: { headers } });
}

function apiJsonError(message: string, status: number) {
  return NextResponse.json({ success: false, message }, { status });
}

function redirectToLogin(req: NextRequest, pathname: string) {
  const url = req.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

/**
 * `hh_role` is a hint the web app keeps for drawing the right shell; the
 * session is the authority, and the API checks every request against it.
 * When the two disagree — another workspace was chosen, an order was
 * approved, an organiser changed someone's role — the cookie is corrected on
 * the way through. Refusing the request instead (as this used to) locked
 * people out of the very calls that would have fixed it.
 */
function withRole(res: NextResponse, req: NextRequest, role: string | undefined) {
  if (!role) return res;
  res.cookies.set("hh_role", String(role).trim().toLowerCase(), {
    path: "/",
    sameSite: "lax",
    maxAge: 14 * 24 * 60 * 60,
    secure: req.nextUrl.protocol === "https:",
  });
  return res;
}

function redirectToLoginWithStatus(req: NextRequest, status: string) {
  const url = req.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.searchParams.delete("next");
  url.searchParams.set("status", status);
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;

  /* ── Marketing host ────────────────────────────────────────────────────
   * The landing page is served from the apex domain while the product runs on
   * app.<domain>. Only the root path changes: it renders the landing page
   * instead of the organiser dashboard.
   *
   * Everything else deliberately falls through and is served by the app on
   * whichever host asked for it. Redirecting app paths to the app host was the
   * obvious alternative and it is not worth the risk — a mistake there is a
   * redirect loop on /login, which locks everyone out of the product, and it
   * cannot be reproduced locally where both hosts are the same server. Old
   * bookmarks continuing to work is a fine outcome; if a single canonical host
   * is wanted later, that belongs in the platform's domain settings, where a
   * loop is not possible.
   *
   * This engages only when NEXT_PUBLIC_MARKETING_HOSTS is set, so local
   * development behaves exactly as it did before any of this existed.
   */
  if (pathname === "/" && isMarketingHost(req.headers.get("host"))) {
    const url = req.nextUrl.clone();
    url.pathname = "/welcome";
    return NextResponse.rewrite(url);
  }

  /* ── Owner console host ────────────────────────────────────────────────
   * With NEXT_PUBLIC_ADMIN_HOST set, the console lives only on that host:
   * its root opens the console and /login is the owner's own sign-in. On
   * every other host the console's paths answer 404, so the console is not
   * something a visitor finds by typing /workspace on the main site. Unset
   * (local development), everything stays where it was.
   */
  if (adminHost()) {
    const onAdmin = isAdminHost(req.headers.get("host"));
    if (onAdmin && (pathname === "/" || pathname === "/login")) {
      const url = req.nextUrl.clone();
      url.pathname = pathname === "/" ? "/workspace" : "/admin-login";
      return NextResponse.rewrite(url);
    }
    if (!onAdmin && isConsolePath(pathname)) {
      const url = req.nextUrl.clone();
      url.pathname = "/__not-found";
      return NextResponse.rewrite(url);
    }
  }

  /* ── API ── */
  if (pathname.startsWith("/api")) {
    if (method === "OPTIONS") {
      return NextResponse.next();
    }

    // A write from a page on another site never reaches the API (src/lib/originCheck.ts).
    if (isCrossSiteWrite({
      method,
      pathname,
      origin: req.headers.get("origin"),
      hosts: [req.headers.get("x-forwarded-host"), req.headers.get("host"), req.nextUrl.host],
      secFetchSite: req.headers.get("sec-fetch-site"),
    })) {
      return apiJsonError("Cross-site request refused", 403);
    }

    if (isPublicApiRoute(pathname, method)) {
      return NextResponse.next();
    }

    const cookieHeader = req.headers.get("cookie");
    // Remembered for a few seconds per browser session (src/lib/sessionCache.ts),
    // so prefetches and bursts of API calls do not each ask the API who this is.
    const session = await checkSessionCached(cookieHeader, pathname, fetchBackendSession);

    // Network hiccup talking to the backend (cold start, 5xx, timeout).
    // Forwarding the request lets the real backend respond — if the cookie
    // really is invalid the backend will return its own 401 with the
    // proper message instead of us pre-emptively faking one (problem 21).
    if (session === "network") {
      return NextResponse.next();
    }

    if (!session) {
      return apiJsonError("Unauthorized", 401);
    }

    const hhRole = req.cookies.get("hh_role")?.value;
    const stale = Boolean(hhRole && !rolesMatch(hhRole, session.role));

    if (pathname === "/api/chat" || pathname.startsWith("/api/chat/")) {
      if (!isOrganizerChatRole(session.role)) {
        return apiJsonError("Forbidden: organizer role required", 403);
      }
    }

    return stale ? withRole(NextResponse.next(), req, session.role) : NextResponse.next();
  }

  if (pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  /* ── Pages: public (no session required) ── */
  if (isPublicPagePath(pathname)) {
    return NextResponse.next();
  }

  /* ── Pages: require real backend session + correct role zone ── */
  const cookieHeader = req.headers.get("cookie");
  const session = await checkSessionCached(cookieHeader, pathname, fetchBackendSession);

  // Backend was unreachable (cold start, 5xx, timeout). Don't bounce the
  // user to /login on a transient network blip — let the page render and
  // its client-side data fetches will retry on their own. This is what
  // was bouncing hackers to /login on F5 mid-event (problem 21).
  if (session === "network") {
    // Mobile / slow-network hardening:
    // Even when backend session check is temporarily unavailable, still
    // enforce role-zone isolation from the client cookie so a judge/mentor
    // cannot drift into the admin dashboard shell.
    const cookieRole = req.cookies.get("hh_role")?.value;
    const normalizedCookieRole = normalizeRole(String(cookieRole || ""));
    // Never redirect into admin zone from cookie-only data. A stale
    // `hh_role=admin` cookie (e.g. shared browser, old session) plus a
    // temporary backend outage previously could bounce a hacker/judge to
    // `/` and show admin UI. We only enforce cookie-zone redirects here for
    // non-admin roles; admin-like resolution is delegated to real backend
    // session checks once network recovers.
    if (
      cookieRole &&
      normalizedCookieRole &&
      normalizedCookieRole !== "admin"
    ) {
      const zoneRedirect = redirectIfWrongRoleZone(cookieRole, pathname, req);
      if (zoneRedirect) return zoneRedirect;
    }
    // Problem 13 hardening: if backend is temporarily unreachable, still
    // honor the last known hacker approval status from cookie and keep
    // unapproved hackers out of /hacker routes.
    if (pathname === "/hacker" || pathname.startsWith("/hacker/")) {
      const rawStatus = String(req.cookies.get("hh_status")?.value || "")
        .trim()
        .toLowerCase();
      if (
        rawStatus === "pending" ||
        rawStatus === "rejected" ||
        rawStatus === "waitlisted"
      ) {
        return redirectToLoginWithStatus(req, rawStatus);
      }
    }
    return nextWithoutPendingHeader(req);
  }

  if (!session) {
    return redirectToLogin(req, pathname);
  }

  // After this point we definitely have a real authenticated user.
  if (!isAuthenticated(session)) {
    return redirectToLogin(req, pathname);
  }

  // The workspace picker is open to every signed-in person, whatever their
  // role or approval status in any one event: it is where they choose.
  if (pathname === "/workspaces") {
    return NextResponse.next();
  }

  const hhRole = req.cookies.get("hh_role")?.value;
  const stale = Boolean(hhRole && !rolesMatch(hhRole, session.role));
  const fix = (res: NextResponse) => (stale ? withRole(res, req, session.role) : res);

  // Problem 11: hackers whose team was eliminated get their own
  // dedicated page that explains what happened (team name, admin
  // reason, contact info) instead of being punted to /login like
  // pending/rejected users. They stay logged in so they can read the
  // page, but every other /hacker/* route is off limits.
  if (isHackerEliminated(session)) {
    if (pathname !== ELIMINATED_PATH) {
      const url = req.nextUrl.clone();
      url.pathname = ELIMINATED_PATH;
      url.search = "";
      return fix(NextResponse.redirect(url));
    }
    // already on the eliminated page — let it render.
    return fix(NextResponse.next());
  }

  // Hacker accounts that the organiser hasn't approved yet (or has
  // rejected) must NOT reach any dashboard. Send them back to /login
  // with a banner explaining what's happening. Non-hackers are exempt
  // because their access is gated by the invite system, not by
  // participants.status.
  if (isHackerPendingOrRejected(session)) {
    const waiting = String(session.status || "pending").toLowerCase();
    // Someone still waiting (for review, or on the waiting list) may write
    // to the organisers: the chat shows them only that thread. Nothing else
    // of the portal is theirs yet.
    if (pathname === PENDING_CHAT_PATH && (waiting === "pending" || waiting === "waitlisted")) {
      const headers = new Headers(req.headers);
      headers.set(PENDING_CHAT_HEADER, "1");
      return fix(NextResponse.next({ request: { headers } }));
    }
    return fix(redirectToLoginWithStatus(req, waiting));
  }

  // Approved hackers should never land on /hacker/eliminated — if they
  // somehow deep-link to it, send them to their dashboard.
  if (pathname === ELIMINATED_PATH) {
    const url = req.nextUrl.clone();
    url.pathname = "/hacker";
    url.search = "";
    return fix(NextResponse.redirect(url));
  }

  const zoneRedirect = redirectIfWrongRoleZone(
    session.role,
    pathname,
    req
  );
  if (zoneRedirect) {
    return fix(zoneRedirect);
  }

  return fix(NextResponse.next());
}

/*
 * Everything but static files — and /api/files, the uploads. Middleware
 * buffers a request body before passing it on (10 MB by default) and would
 * cut a large upload short; it has nothing to do for these routes anyway: the
 * API checks every upload, read and delete itself (file.controller.js).
 */
export const config = {
  matcher: ["/((?!api/files|.*\\..*).*)"],
};
