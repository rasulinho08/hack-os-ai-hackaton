"use client";

/**
 * The public walkthrough.
 *
 * This is not a rebuild of the console — it is the console. Every page under
 * /demo re-exports the real organiser screen, and the only difference is where
 * the data comes from: `enableDemoApi` points the API client at sample rows
 * instead of the backend, so a visitor with no account sees exactly the
 * product a customer buys, and the walkthrough cannot drift away from it.
 *
 * The reader is installed at module scope rather than in an effect on purpose.
 * Child effects run before a parent's, so a screen's first fetch would
 * otherwise reach a backend it has no session for. Importing this file is what
 * arms the demo, and leaving the route disarms it again — which matters for
 * the organiser who opens /demo in the tab their real console is in.
 */

import { useEffect, useState } from "react";
import { Info, Lock } from "lucide-react";
import { ActiveEventProvider } from "@/contexts/ActiveEventContext";
import { DashboardShell } from "@/components/DashboardShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { enableDemoApi, disableDemoApi } from "@/lib/api";
import { resolveDemoRead } from "@/lib/demo/resolve";

enableDemoApi(resolveDemoRead);

export default function DemoConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    enableDemoApi(resolveDemoRead);
    return () => disableDemoApi();
  }, []);

  /*
   * Each screen has its own wording for a failed write — "something went
   * wrong" — which in a walkthrough reads as a broken product. This says what
   * really happened, over the top of whatever the screen said.
   */
  useEffect(() => {
    const onBlocked = () => setBlocked(true);
    window.addEventListener("hackos:demo-write", onBlocked);
    return () => window.removeEventListener("hackos:demo-write", onBlocked);
  }, []);

  useEffect(() => {
    if (!blocked) return;
    const timer = window.setTimeout(() => setBlocked(false), 5000);
    return () => window.clearTimeout(timer);
  }, [blocked]);

  return (
    <ActiveEventProvider>
      <DashboardShell basePath="/demo" demo>
        <div
          className="mb-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: "rgba(225,0,60,0.25)",
            background: "rgba(225,0,60,0.07)",
          }}
        >
          <Info size={16} className="mt-0.5 shrink-0 text-[#E1003C]" />
          <p className="theme-text-muted leading-relaxed">
            This is the real organiser console running on sample data. Every
            participant, team and score below is invented, and nothing you press
            changes anything.{" "}
            <a href="/contact" className="font-medium text-[#E1003C] hover:underline">
              Talk to us about your event
            </a>
            .
          </p>
        </div>
        <ErrorBoundary>{children}</ErrorBoundary>

        {blocked && (
          <div
            role="status"
            className="fixed inset-x-4 bottom-4 z-[80] mx-auto flex max-w-md items-start gap-3 rounded-xl border p-4 shadow-2xl sm:inset-x-auto sm:left-6 sm:mx-0"
            style={{
              borderColor: "rgba(225,0,60,0.35)",
              background: "#14161C",
            }}
          >
            <Lock size={16} className="mt-0.5 shrink-0 text-[#E1003C]" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">
                Nothing changes in the walkthrough
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/70">
                This is a read-only tour of the real console. The error you just
                saw is that rule, not a fault — approving, editing and deleting
                all work on a real event.
              </p>
            </div>
          </div>
        )}
      </DashboardShell>
    </ActiveEventProvider>
  );
}
