import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { normalizeRole } from "@/lib/backendAuth";

/**
 * Enforce role-specific URL zones on the server (middleware).
 * Uses real session role — not only the client `hh_role` cookie.
 */
const KNOWN_ROLES = new Set([
  "admin",
  "judge",
  "mentor",
  "hacker",
  "pending",
  "volunteer",
]);

export function redirectIfWrongRoleZone(
  sessionRole: string,
  pathname: string,
  req: NextRequest
): NextResponse | null {
  const r = normalizeRole(sessionRole);
  const base = req.nextUrl.clone();

  // Everyone may open the workspace picker; it is how roles are switched.
  if (pathname === "/workspaces") return null;

  if (!KNOWN_ROLES.has(r)) {
    base.pathname = "/login";
    return NextResponse.redirect(base);
  }

  if (r === "judge" && !(pathname === "/judge" || pathname.startsWith("/judge/"))) {
    base.pathname = "/judge";
    return NextResponse.redirect(base);
  }
  if (r === "mentor" && !(pathname === "/mentor" || pathname.startsWith("/mentor/"))) {
    base.pathname = "/mentor";
    return NextResponse.redirect(base);
  }
  if (r === "hacker" && !(pathname === "/hacker" || pathname.startsWith("/hacker/"))) {
    base.pathname = "/hacker";
    return NextResponse.redirect(base);
  }
  if (r === "pending" && !(pathname === "/hacker" || pathname.startsWith("/hacker/"))) {
    base.pathname = "/hacker";
    return NextResponse.redirect(base);
  }
  if (
    r === "volunteer" &&
    !(pathname === "/volunteer" || pathname.startsWith("/volunteer/"))
  ) {
    base.pathname = "/volunteer";
    return NextResponse.redirect(base);
  }

  /* Organizers: keep them out of mentor/hacker/judge user-facing portals.
     (Note: admins CAN go to /judges and /mentors for management) */
  if (r === "admin") {
    // A ticket's QR code opens the volunteers' scanner; organisers have their
    // own, and the ticket in the address comes along.
    if (pathname === "/volunteer/scan") {
      base.pathname = "/checkin/scan";
      return NextResponse.redirect(base);
    }
    if (
      pathname === "/mentor" || pathname.startsWith("/mentor/") ||
      pathname === "/hacker" || pathname.startsWith("/hacker/") ||
      pathname === "/judge" || pathname.startsWith("/judge/")
    ) {
      base.pathname = "/";
      return NextResponse.redirect(base);
    }
  }

  return null;
}
