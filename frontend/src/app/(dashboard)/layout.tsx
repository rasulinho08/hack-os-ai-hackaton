import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  fetchBackendSession,
  isAuthenticated,
  isDashboardAdminRole,
  isHackerPendingOrRejected,
  normalizeRole,
} from "@/lib/backendAuth";
import { redirectPathForRole } from "@/lib/roleRedirect";
import { DashboardShell } from "@/components/DashboardShell";
import { ActiveEventProvider } from "@/contexts/ActiveEventContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EntitlementGate } from "@/components/EntitlementGate";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Organiser console",
};

/**
 * SSR role guard for the entire admin dashboard route group.
 *
 * Why this exists (mobile bug):
 *   On flaky / slow mobile networks, the Edge middleware's call to the
 *   backend `/api/auth/me` can time out or hit a 5xx, in which case
 *   `fetchBackendSession` returns `"network"` and the middleware falls
 *   through to `NextResponse.next()` so the request isn't bounced to
 *   `/login` mid-event. The unintended side-effect was that judges and
 *   mentors could land on `/`, `/participants`, etc. and see the full
 *   admin sidebar (`DashboardShell` does no role-based filtering).
 *
 * This SSR guard is the real fix when the backend answers: admin pages
 * must not render for a confirmed non-admin `session.role`.
 *
 * When the backend is temporarily unreachable (`"network"`), we only
 * allow past the gate if `access_token` exists and `hh_role` is absent
 * or admin-like — same trade-off as `middleware.ts` (non-admin cookies
 * still get sent to their own portal).
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const session = await fetchBackendSession(cookieHeader || null);

  // Real auth failure → bounce to /login.
  if (session === null) {
    redirect("/login");
  }

  // Backend hiccup ("network"): must match `middleware.ts` page handling.
  // Middleware already lets the request through on timeout/5xx so users
  // are not kicked off mid-hackathon; this layout used to always
  // `redirect("/login")` here, which blocked real admins whenever SSR's
  // single `/api/auth/me` fetch was slow or got 429/404 from the proxy.
  if (session === "network") {
    if (!cookieHeader.includes("access_token")) {
      redirect("/login");
    }
    const hhRole = cookieStore.get("hh_role")?.value;
    if (hhRole) {
      if (!isDashboardAdminRole(hhRole)) {
        redirect(redirectPathForRole(normalizeRole(hhRole)));
      }
    }
    // Token present and (no hh_role yet, or admin/org_admin cookie) → render;
    // `DashboardShell` still calls `/api/auth/me` client-side to evict stale cookies.
  } else if (isAuthenticated(session)) {
    // Pending / rejected hackers must never reach the admin shell, even
    // through stale cookies. Bounce them to /login with a status banner.
    if (isHackerPendingOrRejected(session)) {
      redirect(
        `/login?status=${encodeURIComponent(String(session.status || "pending").toLowerCase())}`,
      );
    }
    if (!isDashboardAdminRole(session.role)) {
      // Confirmed non-admin → send them to their own portal. This is the
      // primary line of defense against the "judge sees admin panel" bug.
      redirect(redirectPathForRole(normalizeRole(session.role)));
    }
  }

  return (
    <ActiveEventProvider>
      <DashboardShell>
        <EntitlementGate>
          <ErrorBoundary>{children}</ErrorBoundary>
        </EntitlementGate>
      </DashboardShell>
    </ActiveEventProvider>
  );
}
