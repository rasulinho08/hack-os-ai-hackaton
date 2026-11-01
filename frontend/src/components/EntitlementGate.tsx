"use client";

/**
 * Keeps the organiser console behind a paid order.
 *
 * Off unless `NEXT_PUBLIC_REQUIRE_ENTITLEMENT` is `true`, and that default is
 * the important part: switching this on while the orders table is empty would
 * lock every existing organiser out of an event they are in the middle of
 * running. It is meant to be enabled deliberately, once the customers who
 * should be through it have orders recorded.
 *
 * Who it applies to:
 *   - organisers (admin, org_admin) — the people who buy the product
 *   - nobody else. Judges, mentors, volunteers and participants were invited
 *     to somebody else's event; billing is not their relationship.
 *   - not the platform owner, who would otherwise need to sell to themselves.
 *
 * It fails open. If `/api/me/entitlement` cannot be reached the console
 * renders: a billing check that is down must not become an outage on the
 * morning of a hackathon.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Receipt } from "lucide-react";
import { apiGet } from "@/lib/api";

const ENABLED = String(process.env.NEXT_PUBLIC_REQUIRE_ENTITLEMENT).toLowerCase() === "true";

/** The roles that buy the product, and therefore the ones a sale gates. */
const BILLED_ROLES = new Set(["admin", "org_admin"]);

type State = "checking" | "allowed" | "blocked";

export function EntitlementGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(ENABLED ? "checking" : "allowed");

  useEffect(() => {
    if (!ENABLED) return;
    let cancelled = false;

    (async () => {
      try {
        const me = await apiGet<{ role?: string; email?: string; platformRole?: string | null }>("/api/auth/me");
        const role = String(me?.role ?? "").trim().toLowerCase();

        if (!BILLED_ROLES.has(role) || me?.platformRole === "superadmin") {
          if (!cancelled) setState("allowed");
          return;
        }
        const { entitled } = await apiGet<{ entitled?: boolean }>("/api/me/entitlement");
        if (!cancelled) setState(entitled ? "allowed" : "blocked");
      } catch {
        // Fail open — see the note above.
        if (!cancelled) setState("allowed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "allowed") return <>{children}</>;

  if (state === "checking") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-5">
        <p className="text-[15px] text-[var(--app-muted)]">Checking your subscription…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-5">
      <div
        className="w-full max-w-md rounded-2xl border p-8 text-center"
        style={{ borderColor: "var(--app-card-line)", background: "var(--app-card-a)" }}
      >
        <span
          className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "rgba(225,0,60,0.14)", color: "#E1003C" }}
        >
          <Receipt size={20} />
        </span>
        <h1 className="text-lg font-semibold text-[var(--app-heading)]">
          No active plan on this account
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--app-muted)]">
          Your organisation does not have a paid order yet, so the workspace is
          not open. If you believe this is wrong, your order may still be
          awaiting payment — the account page shows where it stands.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <a
            href="/account"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-[15px] font-semibold text-white"
            style={{ background: "#E1003C" }}
          >
            See your orders <ArrowRight size={15} />
          </a>
          <Link
            href="/pricing"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border px-4 text-[15px] font-medium text-[var(--app-muted)]"
            style={{ borderColor: "var(--app-card-line)" }}
          >
            Compare the plans
          </Link>
        </div>
      </div>
    </div>
  );
}
