"use client";

import { usePathname } from "next/navigation";

/**
 * "/demo" while inside the public walkthrough, "" in the real console.
 *
 * The walkthrough re-exports the organiser screens under /demo, and every
 * link they draw has to stay under that prefix; a bare "/settings" sends a
 * prospect to the login screen. DashboardShell handles its own navigation
 * through `basePath`; this is for links drawn by the screens themselves.
 */
export function useDemoBasePath(): string {
  const pathname = usePathname() || "";
  return pathname === "/demo" || pathname.startsWith("/demo/") ? "/demo" : "";
}
