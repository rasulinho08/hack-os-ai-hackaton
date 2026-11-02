"use client";

/**
 * Who is allowed into the owner console.
 *
 * The API is the lock. `/api/customers` and `/api/orders` require the
 * `superadmin` role server-side, so a customer administrator who guesses this
 * URL gets a 403 from every request the page makes, whatever this component
 * decides to draw. That was not true before: the role did not exist and this
 * check was the only thing standing between an admin account and the whole
 * commercial record.
 *
 * What this component does is decide what to render, which is worth doing well
 * — a screen that loads and then fills with permission errors is worse than
 * one that says plainly you are in the wrong place.
 *
 * The API alone decides who the owner is (SUPERADMIN_EMAILS, and the second
 * step when SUPERADMIN_PIN is set). The e-mail fallback that used to sit here
 * put the owner's address in every visitor's JavaScript; it is gone. When the
 * owner still owes the second step, the code is asked for right here.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, LogIn } from "lucide-react";
import { apiGet } from "@/lib/api";
import { OwnerPinForm } from "@/components/OwnerPinForm";

type State =
  | { phase: "checking" }
  | { phase: "allowed"; email: string; name: string }
  | { phase: "anonymous" }
  | { phase: "pin" }
  | { phase: "refused"; email: string };

export function OwnerGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ phase: "checking" });

  useEffect(() => {
    let cancelled = false;
    apiGet<{ email?: string; full_name?: string; name?: string; role?: string; platformRole?: string | null; elevationRequired?: boolean }>("/api/auth/me")
      .then((me) => {
        if (cancelled) return;
        const email = String(me?.email ?? "").trim().toLowerCase();
        if (!email) {
          setState({ phase: "anonymous" });
          return;
        }
        const role = String(me?.role ?? "").trim().toLowerCase();
        if (me?.platformRole === "superadmin" && me?.elevationRequired) {
          setState({ phase: "pin" });
          return;
        }
        const allowed = role === "superadmin";
        setState(
          allowed
            ? {
                phase: "allowed",
                email,
                name: String(me?.full_name ?? me?.name ?? "").trim() || email,
              }
            : { phase: "refused", email },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ phase: "anonymous" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase === "allowed") return <>{children}</>;

  if (state.phase === "pin") {
    return (
      <div className="flex min-h-screen items-center justify-center px-5" style={{ background: "var(--app-surface-2)" }}>
        <div className="w-full max-w-sm rounded-2xl border p-7" style={{ background: "var(--app-surface)", borderColor: "var(--app-card-line)" }}>
          <OwnerPinForm onDone={() => window.location.reload()} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-5"
      style={{ background: "var(--hs-bg)" }}
    >
      <div
        className="w-full max-w-md rounded-[var(--hs-radius)] border p-8 text-center"
        style={{ borderColor: "var(--hs-line)", background: "var(--hs-surface)" }}
      >
        {state.phase === "checking" ? (
          <p className="text-sm" style={{ color: "var(--hs-ink-3)" }}>
            Checking your account…
          </p>
        ) : (
          <>
            <span
              className="mx-auto mb-4 inline-flex h-11 w-11 items-center justify-center rounded-full"
              style={{ background: "var(--hs-brand-weak)", color: "var(--hs-brand)" }}
            >
              <ShieldAlert size={20} />
            </span>
            <h1
              className="text-lg font-semibold"
              style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}
            >
              Owner console
            </h1>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
              {state.phase === "anonymous"
                ? "Sign in with the platform owner account to open this console."
                : `${state.email} is signed in, but this console is limited to the platform owner account.`}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <a
                href="/admin-login"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--hs-radius-sm)] px-4 text-sm font-semibold"
                style={{ background: "var(--hs-ink)", color: "var(--hs-bg)" }}
              >
                <LogIn size={15} /> Sign in
              </a>
              <Link prefetch={false}
                href="/"
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--hs-radius-sm)] border px-4 text-sm font-medium"
                style={{ borderColor: "var(--hs-line-2)", color: "var(--hs-ink-2)" }}
              >
                Back to hack-os.app
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
