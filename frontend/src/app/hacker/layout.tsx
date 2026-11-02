import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  fetchBackendSession,
  isAuthenticated,
  isHackerPendingOrRejected,
} from "@/lib/backendAuth";
import HackerShell from "./HackerShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hacker portal",
};

/**
 * SSR guard for the hacker portal.
 *
 * Edge middleware already blocks pending / rejected accounts, but we
 * repeat the check here so that even if middleware is bypassed (e.g.
 * a "network" fallback while the backend is cold) the unapproved
 * account never reaches the dashboard. Server components run before
 * any client code, so this happens before the dashboard skeleton even
 * paints on screen.
 *
 * Elimination (problem 11) is enforced by the edge middleware because
 * it is the only layer that knows the current pathname — an eliminated
 * hacker that tries to deep-link to /hacker/submit bounces straight to
 * /hacker/eliminated there. This layout only needs to cover
 * pending/rejected, which never reach the hacker panel at all.
 */
export default async function HackerLayout({
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

  if (session === null) {
    redirect("/login");
  }
  if (session === "network") {
    // Backend unreachable fallback: enforce the last known status from
    // cookie so pending/rejected/waitlisted hackers still cannot load the
    // hacker shell during transient outages.
    const statusCookie = String(cookieStore.get("hh_status")?.value || "")
      .trim()
      .toLowerCase();
    if (
      statusCookie === "pending" ||
      statusCookie === "rejected" ||
      statusCookie === "waitlisted"
    ) {
      redirect(`/login?status=${encodeURIComponent(statusCookie)}`);
    }
  }
  if (isAuthenticated(session) && isHackerPendingOrRejected(session)) {
    const waiting = String(session.status || "pending").toLowerCase();
    // Someone still waiting may open the chat, for their thread with the
    // organisers: the middleware, which sees the path, says so.
    const chatOnly =
      (waiting === "pending" || waiting === "waitlisted") &&
      (await headers()).get("x-hackos-pending-chat") === "1";
    if (!chatOnly) redirect(`/login?status=${encodeURIComponent(waiting)}`);
  }

  // What the shell shows first (its menu, the waiting notice): the same on
  // the server and in the browser, which then asks again.
  const initialStatus =
    isAuthenticated(session) && session.status
      ? String(session.status).toLowerCase()
      : String(cookieStore.get("hh_status")?.value || "approved").toLowerCase();

  return (
    <HackerShell initialStatus={initialStatus}>
      <ErrorBoundary>{children}</ErrorBoundary>
    </HackerShell>
  );
}
