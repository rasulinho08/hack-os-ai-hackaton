"use client";

/**
 * The customer account's front door, on the marketing site: sign in and
 * create an account on one page.
 *
 * Customers (people buying HackOS for an organisation) and the people inside
 * an event (participants, judges, mentors, volunteers) share one account
 * system, but not one entrance. This page leads to the account portal —
 * orders, the organisation, the way into its workspace — and looks like the
 * site it sits on. The platform's own sign-in at app.<domain>/login leads into
 * events and keeps the product's look, so nobody mistakes one for the other.
 *
 * The session cookie is set by the API on whichever host serves the request,
 * so signing in here gives a session for this host.
 *
 * `?mode=register` opens the second tab; `?plan=&period=&org=` (from pricing
 * or checkout) carries a chosen plan through to the order; `?next=` names a
 * same-site path to return to.
 */

import { Suspense, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  Eye,
  EyeOff,
  LayoutDashboard,
  ListChecks,
  Lock,
  Mail,
  ShoppingBag,
  User,
  Users,
} from "lucide-react";
import { ApiError, apiPost } from "@/lib/api";
import { Logo3D } from "@/components/brand/Logo3D";
import { appUrl } from "@/lib/hosts";
import { clearWorkspace, syncSession } from "@/lib/workspaces";
import { useTranslation } from "@/contexts/LanguageContext";
import { planById } from "../_plans";

type Mode = "login" | "register";

/** The API's floor for a password: eight characters, one of them a digit. */
const MIN_PASSWORD = 8;
const hasDigit = (v: string) => /\d/.test(v);

/** Only same-site paths, so a crafted ?next= cannot send anyone off-origin. */
function safeNext(raw: string | null): string | null {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\") ? raw : null;
}

function SignInInner() {
  const { t } = useTranslation();
  const params = useSearchParams();

  // The tab lives in the URL, so a link to ?mode=register opens it and the
  // header's "Sign in" link brings the first tab back.
  const mode: Mode = params.get("mode") === "register" ? "register" : "login";
  const [form, setForm] = useState({ fullName: "", email: "", password: "", org: params.get("org") || "" });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginTab = useRef<HTMLButtonElement>(null);
  const registerTab = useRef<HTMLButtonElement>(null);

  const planId = params.get("plan");
  const plan = planId ? planById(planId) : null;
  const period = params.get("period");
  const next = safeNext(params.get("next"));

  /* After signing in: the page they came from, else the order when a plan
     was chosen (or an organisation typed), else the account portal. */
  const destination = useMemo(() => {
    if (next) return next;
    if (plan) {
      const q = new URLSearchParams({ plan: plan.id });
      if (period) q.set("period", period);
      if (form.org.trim()) q.set("org", form.org.trim());
      // Back to the organisation step; the plan was chosen before signing in.
      q.set("resume", "1");
      return `/checkout?${q.toString()}`;
    }
    // An organisation typed without a plan is kept too: on to choosing one for it.
    if (mode === "register" && form.org.trim()) return `/checkout?${new URLSearchParams({ org: form.org.trim() }).toString()}`;
    return "/account";
  }, [next, plan, period, form.org, mode]);

  const switchMode = (m: Mode, focusTab = false) => {
    if (m === mode) return;
    setError(null);
    const q = new URLSearchParams(params.toString());
    if (m === "register") q.set("mode", "register");
    else q.delete("mode");
    const qs = q.toString();
    // The router follows history.replaceState without a server round trip.
    window.history.replaceState(null, "", qs ? `/signin?${qs}` : "/signin");
    if (focusTab) (m === "login" ? loginTab : registerTab).current?.focus();
  };

  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      switchMode(mode === "login" ? "register" : "login", true);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setError(null);
  };

  const lengthOk = form.password.length >= MIN_PASSWORD;
  const digitOk = hasDigit(form.password);
  const ready =
    mode === "login"
      ? form.email.trim() !== "" && form.password !== ""
      : form.fullName.trim().length >= 2 && form.email.trim() !== "" && lengthOk && digitOk;

  const explain = (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.status === 401) return t("account.signin.err_credentials");
      if (err.status === 409) return t("account.signin.err_taken");
      if (err.status === 429) return t("account.signin.err_rate");
      if (err.status === 400 && err.message) return err.message;
      if (err.status === 0) return t("account.signin.err_network");
      return t("account.signin.err_generic");
    }
    return t("account.signin.err_network");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const email = form.email.trim().toLowerCase();
    let created = false;
    let signedIn = false;
    try {
      if (mode === "register") {
        await apiPost("/api/auth/register", {
          fullName: form.fullName.trim(),
          email,
          password: form.password,
        });
        created = true;
      }
      // A workspace chosen in an earlier session would otherwise decide the
      // role this one starts with.
      clearWorkspace();
      await apiPost("/api/auth/login", { email, password: form.password });
      signedIn = true;
      await syncSession();
      window.location.assign(destination);
    } catch (err) {
      // The account exists: offer the sign-in tab with the e-mail kept.
      if (created || (err instanceof ApiError && err.status === 409)) switchMode("login");
      // A 401 after the password was accepted is the session the browser did
      // not keep, not a wrong password.
      setError(signedIn && err instanceof ApiError && err.status === 401
        ? t("account.signin.err_session")
        : explain(err));
      setBusy(false);
    }
  };

  const field =
    "min-h-12 w-full rounded-[12px] border pl-10 pr-3 text-[15px] outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--hs-brand)] focus:shadow-[0_0_0_3px_var(--hs-brand-weak)]";
  const fieldStyle: React.CSSProperties = {
    borderColor: "var(--hs-line-2)",
    background: "var(--hs-surface)",
    color: "var(--hs-ink)",
  };
  const label = "mb-1.5 block text-[13px] font-medium";
  const icon = "pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2";

  const tab = (m: Mode, ref: React.RefObject<HTMLButtonElement | null>, text: string) => {
    const active = mode === m;
    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        id={`signin-tab-${m}`}
        aria-selected={active}
        aria-controls="signin-panel"
        tabIndex={active ? 0 : -1}
        onClick={() => switchMode(m)}
        onKeyDown={onTabKey}
        className="h-10 flex-1 rounded-full text-[14px] font-semibold transition-[background-color,color,box-shadow] duration-200"
        style={{
          background: active ? "var(--hs-surface)" : "transparent",
          color: active ? "var(--hs-ink)" : "var(--hs-ink-3)",
          boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08), 0 0 0 1px var(--hs-line)" : "none",
        }}
      >
        {text}
      </button>
    );
  };

  const rule = (ok: boolean, text: string) => (
    <li className="flex items-center gap-1.5" style={{ color: ok ? "var(--hs-ok)" : "var(--hs-ink-3)" }}>
      <span
        aria-hidden="true"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border"
        style={{
          borderColor: ok ? "var(--hs-ok)" : "var(--hs-line-2)",
          background: ok ? "var(--hs-ok-weak)" : "transparent",
        }}
      >
        {ok ? <Check size={10} strokeWidth={3} /> : null}
      </span>
      {text}
    </li>
  );

  const points = [
    { Icon: ShoppingBag, text: t("account.signin.point_order") },
    { Icon: ListChecks, text: t("account.signin.point_track") },
    { Icon: LayoutDashboard, text: t("account.signin.point_workspace") },
  ];

  const isRegister = mode === "register";

  return (
    <section className="relative" style={{ background: "var(--hs-bg)" }}>
      <div className="mx-auto grid max-w-6xl items-start gap-6 px-4 pb-20 pt-10 sm:px-5 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:gap-10 lg:pt-16">
        {/* ── Form ─────────────────────────────────────────────── */}
        <div className="mx-auto w-full max-w-[460px] lg:mx-0 lg:max-w-none lg:pr-6">
          <p
            className="hs-mono mb-3 text-[11.5px] font-medium uppercase tracking-[0.16em]"
            style={{ color: "var(--hs-brand)" }}
          >
            {t("account.signin.eyebrow")}
          </p>
          <h1
            className="text-balance text-[2rem] font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[2.5rem]"
            style={{ fontFamily: "var(--font-display)", color: "var(--hs-ink)" }}
          >
            {isRegister ? t("account.signin.title_register") : t("account.signin.title_login")}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed" style={{ color: "var(--hs-ink-2)" }}>
            {isRegister
              ? plan
                ? t("account.signin.sub_register_plan")
                : t("account.signin.sub_register")
              : t("account.signin.sub_login")}
          </p>

          <div
            className="mt-7 rounded-[22px] border p-5 sm:p-7"
            style={{
              background: "var(--hs-surface)",
              borderColor: "var(--hs-line)",
              boxShadow: "0 1px 2px rgba(20,22,28,0.04), 0 24px 48px -32px rgba(20,22,28,0.18)",
            }}
          >
            <div
              role="tablist"
              aria-label={t("account.signin.eyebrow")}
              className="flex gap-1 rounded-full p-1"
              style={{ background: "var(--hs-tint)" }}
            >
              {tab("login", loginTab, t("account.signin.tab_login"))}
              {tab("register", registerTab, t("account.signin.tab_register"))}
            </div>

            {plan && isRegister ? (
              <p
                className="mt-5 flex items-center gap-2 rounded-[12px] px-3 py-2 text-[13px]"
                style={{ background: "var(--hs-brand-weak)", color: "var(--hs-ink)" }}
              >
                <ShoppingBag size={14} style={{ color: "var(--hs-brand)" }} />
                {t("account.signin.plan_chosen")} <strong className="font-semibold">{plan.name}</strong>
              </p>
            ) : null}

            <form
              id="signin-panel"
              role="tabpanel"
              aria-labelledby={`signin-tab-${mode}`}
              onSubmit={submit}
              noValidate
              className="mt-5 flex flex-col gap-4"
            >
              {isRegister ? (
                <div>
                  <label htmlFor="si-name" className={label} style={{ color: "var(--hs-ink-2)" }}>
                    {t("account.signin.name")}
                  </label>
                  <div className="relative">
                    <User size={16} className={icon} style={{ color: "var(--hs-ink-3)" }} />
                    <input
                      id="si-name"
                      type="text"
                      required
                      autoComplete="name"
                      value={form.fullName}
                      onChange={set("fullName")}
                      className={field}
                      style={fieldStyle}
                    />
                  </div>
                </div>
              ) : null}

              <div>
                <label htmlFor="si-email" className={label} style={{ color: "var(--hs-ink-2)" }}>
                  {t("account.signin.email")}
                </label>
                <div className="relative">
                  <Mail size={16} className={icon} style={{ color: "var(--hs-ink-3)" }} />
                  <input
                    id="si-email"
                    type="email"
                    required
                    autoComplete={isRegister ? "email" : "username"}
                    inputMode="email"
                    value={form.email}
                    onChange={set("email")}
                    className={field}
                    style={fieldStyle}
                  />
                </div>
              </div>

              {isRegister ? (
                <div>
                  <label htmlFor="si-org" className={label} style={{ color: "var(--hs-ink-2)" }}>
                    {t("account.signin.org")}{" "}
                    <span className="font-normal" style={{ color: "var(--hs-ink-3)" }}>
                      ({t("account.signin.optional")})
                    </span>
                  </label>
                  <div className="relative">
                    <Building2 size={16} className={icon} style={{ color: "var(--hs-ink-3)" }} />
                    <input
                      id="si-org"
                      type="text"
                      autoComplete="organization"
                      value={form.org}
                      onChange={set("org")}
                      placeholder={t("account.signin.org_hint")}
                      className={field}
                      style={fieldStyle}
                    />
                  </div>
                </div>
              ) : null}

              <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <label htmlFor="si-password" className="block text-[13px] font-medium" style={{ color: "var(--hs-ink-2)" }}>
                    {t("account.signin.password")}
                  </label>
                  {!isRegister ? (
                    <Link
                      href="/forgot-password"
                      className="text-[13px] hover:underline"
                      style={{ color: "var(--hs-brand)" }}
                    >
                      {t("account.signin.forgot")}
                    </Link>
                  ) : null}
                </div>
                <div className="relative">
                  <Lock size={16} className={icon} style={{ color: "var(--hs-ink-3)" }} />
                  <input
                    id="si-password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={isRegister ? MIN_PASSWORD : undefined}
                    autoComplete={isRegister ? "new-password" : "current-password"}
                    value={form.password}
                    onChange={set("password")}
                    aria-describedby={isRegister ? "si-password-rules" : undefined}
                    className={`${field} pr-11`}
                    style={fieldStyle}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? t("account.signin.hide") : t("account.signin.show")}
                    aria-pressed={showPassword}
                    className="absolute right-1.5 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-[10px] transition-colors hover:bg-[var(--hs-tint)]"
                    style={{ color: "var(--hs-ink-3)" }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {isRegister ? (
                  <ul id="si-password-rules" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
                    {rule(lengthOk, t("account.signin.rule_length"))}
                    {rule(digitOk, t("account.signin.rule_digit"))}
                  </ul>
                ) : null}
              </div>

              {error ? (
                <p
                  role="alert"
                  className="rounded-[12px] border px-3 py-2.5 text-[13px] leading-relaxed"
                  style={{ borderColor: "var(--hs-danger)", background: "var(--hs-danger-weak)", color: "var(--hs-ink)" }}
                >
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={busy || !ready}
                className="group mt-1 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] px-5 text-[15px] font-semibold transition-[filter,opacity] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
                style={{ background: "var(--hs-brand-solid)", color: "#fff" }}
              >
                {busy
                  ? isRegister
                    ? t("account.signin.busy_register")
                    : t("account.signin.busy_login")
                  : isRegister
                    ? plan
                      ? t("account.signin.submit_register_plan")
                      : t("account.signin.submit_register")
                    : t("account.signin.submit_login")}
                {!busy ? <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" /> : null}
              </button>
            </form>

            <p className="mt-5 border-t pt-4 text-center text-[13.5px]" style={{ borderColor: "var(--hs-line)", color: "var(--hs-ink-2)" }}>
              {isRegister ? t("account.signin.have_account") : t("account.signin.no_account")}{" "}
              <button
                type="button"
                onClick={() => switchMode(isRegister ? "login" : "register")}
                className="font-semibold hover:underline"
                style={{ color: "var(--hs-brand)" }}
              >
                {isRegister ? t("account.signin.tab_login") : t("account.signin.tab_register")}
              </button>
            </p>
          </div>

          <a
            href={appUrl("/login")}
            className="group mt-4 flex items-center gap-3 rounded-[18px] border px-4 py-3.5 transition-colors hover:bg-[var(--hs-tint)]"
            style={{ borderColor: "var(--hs-line)" }}
          >
            <span
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
              style={{ background: "var(--hs-tint)", color: "var(--hs-ink-2)" }}
            >
              <Users size={17} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold" style={{ color: "var(--hs-ink)" }}>
                {t("account.signin.participant_title")}
              </span>
              <span className="block text-[13px]" style={{ color: "var(--hs-ink-3)" }}>
                {t("account.signin.participant_body")}
              </span>
            </span>
            <ArrowUpRight
              size={16}
              className="shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              style={{ color: "var(--hs-ink-3)" }}
            />
          </a>
        </div>

        {/* ── What the account is for ──────────────────────────── */}
        <aside
          className="relative overflow-hidden rounded-[28px] p-7 sm:p-9 lg:sticky lg:top-28"
          style={{ background: "var(--hs-deep)", color: "var(--hs-on-deep)" }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
            style={{ background: "radial-gradient(closest-side, rgba(225,0,60,0.38), rgba(225,0,60,0))" }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(var(--hs-on-deep) 1px, transparent 1px), linear-gradient(90deg, var(--hs-on-deep) 1px, transparent 1px)",
              backgroundSize: "36px 36px",
              maskImage: "linear-gradient(180deg, #000 0%, transparent 75%)",
              WebkitMaskImage: "linear-gradient(180deg, #000 0%, transparent 75%)",
            }}
          />
          <div className="relative">
            <span className="flex items-center gap-3">
              <Logo3D className="h-11 w-11" />
              <span className="text-[16px] font-semibold tracking-[-0.02em]">HackOS</span>
              <span
                className="hs-mono ml-1 rounded-full px-2 py-0.5 text-[10.5px] uppercase tracking-[0.12em]"
                style={{ background: "rgba(255,255,255,0.08)", color: "var(--hs-on-deep-2)" }}
              >
                {t("account.signin.panel_badge")}
              </span>
            </span>
            <h2
              className="mt-8 text-balance text-[1.6rem] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[1.9rem]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {t("account.signin.panel_title")}
            </h2>
            <ol className="mt-8 flex flex-col gap-5">
              {points.map(({ Icon, text }, i) => (
                <li key={i} className="flex items-start gap-3.5">
                  <span
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
                    style={{ background: "rgba(225,0,60,0.16)", color: "#FF6B85" }}
                  >
                    <Icon size={18} />
                  </span>
                  <span className="pt-2 text-[15px] leading-snug" style={{ color: "var(--hs-on-deep-2)" }}>
                    <span className="hs-mono mr-2 text-[12px]" style={{ color: "var(--hs-on-deep-3)" }}>
                      0{i + 1}
                    </span>
                    {text}
                  </span>
                </li>
              ))}
            </ol>
            <p
              className="mt-9 border-t pt-5 text-[13px] leading-relaxed"
              style={{ borderColor: "var(--hs-line-deep)", color: "var(--hs-on-deep-3)" }}
            >
              {t("account.signin.panel_note")}
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}
