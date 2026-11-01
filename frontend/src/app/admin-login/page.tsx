"use client";

/**
 * The owner console's own sign-in: password, then the 6-digit code.
 *
 * Served at admin.hack-os.app/login (the middleware rewrites it here) and at
 * /admin-login locally. Any account can type a password here, but only the
 * platform owner gets past it: everyone else is told so and signed out, and
 * the console's API refuses them regardless.
 */

import { useState } from "react";
import { Logo3D } from "@/components/brand/Logo3D";
import { Lock, Mail, ShieldCheck } from "lucide-react";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { OwnerPinForm } from "@/components/OwnerPinForm";
import { signOut } from "@/lib/workspaces";

interface Me {
  role?: string;
  email?: string;
  platformRole?: string | null;
  elevationRequired?: boolean;
}

function setCookie(name: string, value: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${14 * 86400}; SameSite=Lax${secure}`;
}

function consoleHome(): string {
  const host = (process.env.NEXT_PUBLIC_ADMIN_HOST || "").trim().toLowerCase();
  return host && window.location.host.toLowerCase() === host ? "/" : "/workspace";
}

export default function AdminLoginPage() {
  const [step, setStep] = useState<"password" | "pin">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    const me = await apiGet<Me>("/api/auth/me");
    setCookie("hh_role", String(me.role || "").toLowerCase());
    if (me.email) setCookie("hh_email", me.email);
    window.location.assign(consoleHome());
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/auth/login", { email: email.trim().toLowerCase(), password });
      const me = await apiGet<Me>("/api/auth/me");
      if (me.platformRole !== "superadmin") {
        await signOut();
        setError("This sign-in is for the platform owner only.");
        setBusy(false);
        return;
      }
      if (me.elevationRequired) {
        setStep("pin");
        setBusy(false);
        return;
      }
      await finish();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Could not sign in.");
      setBusy(false);
    }
  };

  const field =
    "h-11 w-full rounded-xl border pl-10 pr-3 text-sm outline-none focus:border-[#E1003C]";
  const fieldStyle = { background: "var(--app-surface-2)", borderColor: "var(--app-card-line)", color: "var(--app-heading)" };

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "var(--app-surface-2)" }}>
      <div className="w-full max-w-sm rounded-2xl border p-7" style={{ background: "var(--app-surface)", borderColor: "var(--app-card-line)" }}>
        <div className="mb-6 flex items-center gap-3">
          <Logo3D className="h-10 w-10" />
          <span className="text-[15px] font-semibold" style={{ color: "var(--app-heading)" }}>HackOS</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "rgba(225,0,60,0.12)", color: "#E1003C" }}>
            <ShieldCheck size={12} /> Owner
          </span>
        </div>

        {step === "password" ? (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <h1 className="text-lg font-semibold" style={{ color: "var(--app-heading)" }}>Owner console</h1>
              <p className="mt-1 text-[13px]" style={{ color: "var(--app-muted)" }}>Sign in with the platform owner account.</p>
            </div>
            <label className="relative block">
              <span className="sr-only">E-mail</span>
              <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--app-muted-2)" }} />
              <input id="owner-email" type="email" required autoComplete="username" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} className={field} style={fieldStyle} />
            </label>
            <label className="relative block">
              <span className="sr-only">Password</span>
              <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--app-muted-2)" }} />
              <input id="owner-password" type="password" required autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} style={fieldStyle} />
            </label>
            {error ? <p role="alert" className="text-[13px]" style={{ color: "var(--app-danger)" }}>{error}</p> : null}
            <button type="submit" disabled={busy} className="h-11 rounded-xl text-sm font-semibold text-white disabled:opacity-60" style={{ background: "#E1003C", color: "#fff" }}>
              {busy ? "Signing in…" : "Continue"}
            </button>
          </form>
        ) : (
          <OwnerPinForm onDone={() => void finish()} />
        )}
      </div>
    </div>
  );
}
