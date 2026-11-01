"use client";

import { Logo3D } from "@/components/brand/Logo3D";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Lock,
  Mail,
  Code2,
  Users,
} from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { resolve as i18nResolve } from "@/lib/i18n";
import { ApiError, apiPost, apiGet } from "@/lib/api";
import { pickRegistrationEvent, type RegistrationEventCandidate } from "@/lib/registrationEvent";
import { postEventParticipantSelfSilent } from "@/lib/participantSelfEnroll";
import { isDuplicateRegistrationError } from "@/lib/registerErrors";
import { ROLE_REDIRECT } from "@/lib/roleRedirect";
import { entriesFrom, enterWorkspace, fetchWorkspaces, isEnterable, signOut } from "@/lib/workspaces";
import { PlatformNotice } from "@/components/notices/PlatformNotice";
import { RegistrationStatusDetails } from "@/components/notices/RegistrationStatusDetails";
import { INVITE_ROLES, inviteRoleKey } from "@/lib/emailVerification";
import { fill } from "@/lib/i18n/fill";
import { chatApi } from "@/lib/chat";

/** What POST /api/auth/register says besides the account. */
interface RegisterAnswer {
  /** A confirmation link was e-mailed (no invitation link that came by e-mail proved the address). */
  verificationRequired?: boolean;
  /** An invitation for this address that opens once it is confirmed. */
  pendingInvite?: { eventId?: number; role?: string } | null;
}

interface AuthUser {
  id: number;
  full_name: string;
  email: string;
  role: string;
  status?: string;
  github_link?: string;
}

function setCookie(name: string, value: string, days = 14) {
  const maxAge = days * 24 * 60 * 60;
  // Mobile browsers (iOS Safari especially) refuse to persist
  // `SameSite=Lax` cookies on https origins unless `Secure` is also
  // set. Without this, judges/mentors logging in on mobile would
  // sometimes end up without an `hh_role` cookie on the next request,
  // and the dashboard shell would render the admin nav by default.
  const secureFlag =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secureFlag}`;
}

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "";
  /** Query → register body: URL alone is not enough; we merge into POST /api/auth/register. */
  const eventIdRaw = searchParams.get("eventId")?.trim() ?? "";
  const parsedEventIdForRegister =
    eventIdRaw !== "" && /^\d+$/.test(eventIdRaw) ? Number(eventIdRaw) : null;
  const eventCodeRaw = searchParams.get("eventCode")?.trim() || null;
  const emailFromQuery = searchParams.get("email")?.trim() ?? "";
  const nameFromQuery =
    searchParams.get("name")?.trim() ||
    searchParams.get("fullName")?.trim() ||
    "";
  const openRegisterTab =
    searchParams.get("register") === "1" ||
    searchParams.get("invite") === "1";
  const justRegistered = searchParams.get("registered") === "1";
  // The join page could not create the lead's team because the account is
  // still awaiting approval; the lead names it from My Team afterwards.
  const pendingTeam = searchParams.get("pendingTeam") === "1";
  const teamJoinCode = searchParams.get("teamJoinCode")?.trim() || "";
  /*
   * The token of an event invitation's link (the invite e-mail, or a link the
   * organiser copied): signing up with it opens that invitation at once.
   * Without it an invitation for the address waits until the address is
   * confirmed — the API decides, the page only passes the token on.
   */
  const inviteTokenParam = searchParams.get("inviteToken")?.trim() || "";
  // After sign-up: a confirmation link was e-mailed (and an invitation waits for it).
  const confirmSent = searchParams.get("confirm") === "1";
  const pendingInviteRole = (() => {
    const r = searchParams.get("invite")?.trim() || "";
    return (INVITE_ROLES as readonly string[]).includes(r) ? r : "";
  })();
  /**
   * `?status=…` is appended by middleware / SSR when a hacker is not allowed
   * into the dashboard (pending, rejected, eliminated, waitlisted, etc.).
   */
  const accountStatusParam = (
    searchParams.get("status") || ""
  )
    .trim()
    .toLowerCase();
  const accountStatusBlocked =
    accountStatusParam === "pending" ||
    accountStatusParam === "rejected" ||
    accountStatusParam === "eliminated" ||
    accountStatusParam === "waitlisted";
  // Still waiting and signed in for the thread with the organisers (see handleLoginSuccess).
  const pendingChat =
    (accountStatusParam === "pending" || accountStatusParam === "waitlisted") &&
    searchParams.get("chat") === "1";
  const { t } = useTranslation();
  /**
   * Registration UI is English-only (Problem 8). This helper resolves keys
   * against the English dictionary regardless of the user's selected language.
   */
  const tEn = (keyOrText: string) => i18nResolve("en", keyOrText);
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeEventCode, setActiveEventCode] = useState<string | null>(null);

  useEffect(() => {
    // Which event the register link opens — see src/lib/registrationEvent.ts.
    apiGet<RegistrationEventCandidate[]>("/api/events")
      .then((events) => {
        const pick = pickRegistrationEvent(events);
        if (pick?.event_code) setActiveEventCode(pick.event_code);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (emailFromQuery) {
      setEmail(emailFromQuery.toLowerCase());
    }
    if (nameFromQuery) {
      setFullName(nameFromQuery);
    }
    // After register we replace to ?registered=1; without this, tab state can
    // stay "register" and the success banner (login tab only) never shows.
    if (justRegistered) {
      setTab("login");
      setError(null);
    } else if (openRegisterTab) {
      setTab("register");
    }
  }, [emailFromQuery, nameFromQuery, openRegisterTab, justRegistered]);

  const handleLoginSuccess = async (user: AuthUser) => {
    const normalizedRole = String(user.role || "").trim().toLowerCase();
    const normalizedStatus = String(user.status || "").trim().toLowerCase();
    const safeNext =
      nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")
        ? nextPath
        : null;

    // The sign-in answer carries the role the API will apply to this browser
    // (the same one /api/auth/me reports), so the middleware's role check
    // agrees with every request from here on, the team join included.
    setCookie("hh_role", normalizedRole);
    setCookie("hh_email", user.email);
    if (user.status) setCookie("hh_status", user.status);

    // Signing in to register for an event goes straight back to its form.
    if (safeNext && safeNext.startsWith("/e/")) {
      window.location.assign(safeNext);
      return;
    }

    // A team invite link (?teamJoinCode=…) joins the team first.
    let destOverride: string | null = null;
    if (teamJoinCode && (normalizedRole === "hacker" || normalizedRole === "pending")) {
      try {
        await apiPost("/api/teams/join", { joinCode: teamJoinCode });
        destOverride = "/hacker/team";
      } catch (joinErr) {
        const jm = joinErr instanceof Error ? joinErr.message.toLowerCase() : "";
        if (jm.includes("already in a team")) destOverride = "/hacker/team";
      }
    }

    /*
     * Where to go depends on everything the person can open, not on one
     * stored role: they may take part in one hackathon and judge another.
     * One place → straight in. Several → the workspace picker.
     */
    const ws = await fetchWorkspaces().catch(() => null);
    if (ws) {
      const entries = entriesFrom(ws);
      const enterable = entries.filter(isEnterable);
      if (entries.length > 1) {
        window.location.assign("/workspaces");
        return;
      }
      if (entries.length === 1 && enterable.length === 1) {
        const dest = await enterWorkspace(enterable[0]);
        const isOrg = enterable[0].kind === "org";
        window.location.assign(destOverride ?? (isOrg && safeNext ? safeNext : dest));
        return;
      }
      if (entries.length === 1 && enterable.length === 0 && entries[0].kind === "event") {
        // Their only workspace is an event that has not admitted them yet.
        // Someone still waiting may write to the organisers meanwhile, when
        // the event has that thread: they stay signed in for that one page.
        const ev = entries[0].event;
        const status = ev.participant_status || "pending";
        const waiting = status === "pending" || status === "waitlisted";
        const canWrite = waiting
          && await chatApi.list(ev.id).then((l) => l.channels.some((c) => c.kind === "support")).catch(() => false);
        if (!canWrite) await signOut();
        router.replace(`/login?status=${encodeURIComponent(status)}${canWrite ? "&chat=1" : ""}`);
        return;
      }
      if (entries.length === 0 && (normalizedRole === "hacker" || normalizedRole === "pending")) {
        // In no event at all: "awaiting approval" would be untrue. The
        // picker's empty state says what to do instead.
        window.location.assign("/workspaces");
        return;
      }
    }

    // The workspace list could not be read: fall back to the stored role.
    if (
      normalizedRole === "hacker" &&
      normalizedStatus &&
      normalizedStatus !== "approved"
    ) {
      await signOut();
      router.replace(`/login?status=${encodeURIComponent(normalizedStatus)}`);
      return;
    }

    // Resolve the post-login destination strictly from the user's real
    // role so a stale / malicious `?next=/` cannot drop a judge or
    // mentor onto the admin dashboard. We only honor `?next=` when the
    // role is admin / org_admin (their role home is `/` anyway).
    const roleHome = ROLE_REDIRECT[normalizedRole] || "/login";
    const isAdminLike =
      normalizedRole === "admin" || normalizedRole === "org_admin";
    const dest = destOverride ?? (isAdminLike && safeNext ? safeNext : roleHome);
    router.replace(dest);
  };

  const onSubmitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await apiPost<AuthUser>("/api/auth/login", {
        email: email.trim().toLowerCase(),
        password: password.trim(),
      });
      handleLoginSuccess(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.error_invalid"));
    } finally {
      setLoading(false);
    }
  };

  const onSubmitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (fullName.trim().length < 2) {
      setError(t("login.name_min_error"));
      return;
    }
    setLoading(true);
    try {
      let registered: RegisterAnswer | undefined;
      let eventIdToSend = parsedEventIdForRegister;
      let eventCodeToSend = eventCodeRaw;
      if (eventIdToSend == null) {
        try {
          const events = await apiGet<{ id: number; event_code?: string }[]>(
            "/api/events"
          );
          if (Array.isArray(events) && events.length === 1 && events[0]?.id != null) {
            eventIdToSend = Number(events[0].id);
            if (!eventCodeToSend && events[0].event_code) {
              eventCodeToSend = String(events[0].event_code).trim();
            }
          }
        } catch {
          /* ignore */
        }
      }

      try {
        registered = await apiPost<RegisterAnswer>("/api/auth/register", {
          fullName: fullName.trim(),
          email: email.trim().toLowerCase(),
          password: password.trim(),
          ...(eventIdToSend != null ? { eventId: eventIdToSend } : {}),
          ...(eventCodeToSend ? { eventCode: eventCodeToSend } : {}),
          ...(inviteTokenParam ? { inviteToken: inviteTokenParam } : {}),
        });
      } catch (registerErr) {
        if (!isDuplicateRegistrationError(registerErr)) throw registerErr;
      }

      const user = await apiPost<AuthUser>("/api/auth/login", {
        email: email.trim().toLowerCase(),
        password: password.trim(),
      });

      // Hacker-only: mentors/judges/volunteers are not event participants rows
      // and POST …/participants/self can fail after the account was already
      // created — surfacing a red error while the admin panel shows the user.
      const registeredRole = String(user?.role ?? "").trim().toLowerCase();
      if (eventIdToSend != null && registeredRole === "hacker") {
        await postEventParticipantSelfSilent(eventIdToSend, {
          is_solo: true,
          is_team_lead: false,
        });
      }

      // Mirror the /join/:eventCode solo flow: log the freshly-registered
      // user out and bounce them to the login screen so they sign in
      // explicitly. Without this, hackers skipped the login step entirely
      // and were dropped straight onto /hacker, which is confusing and
      // also bypasses any "registration successful, please sign in"
      // confirmation messaging.
      void user;
      try {
        await apiPost("/api/auth/logout", {});
      } catch {
        // ignore — cookies below clear client auth either way
      }
      if (typeof document !== "undefined") {
        document.cookie = "hh_role=; Path=/; Max-Age=0; SameSite=Lax";
        document.cookie = "hh_email=; Path=/; Max-Age=0; SameSite=Lax";
        document.cookie = "hh_status=; Path=/; Max-Age=0; SameSite=Lax";
      }
      const emailParam = encodeURIComponent(email.trim().toLowerCase());
      const confirmParams = registered?.verificationRequired
        ? `&confirm=1${registered.pendingInvite?.role ? `&invite=${encodeURIComponent(registered.pendingInvite.role)}` : ""}`
        : "";
      router.replace(`/login?registered=1&email=${emailParam}${confirmParams}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_INVITE_TOKEN") {
        setError(tEn("ve.err.INVALID_INVITE_TOKEN"));
        return;
      }
      setError(err instanceof Error ? err.message : t("login.register_error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-130 w-130 rounded-full bg-[#E1003C]/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-160 w-160 rounded-full bg-[#E1003C]/10 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(225,0,60,0.12),transparent_55%)]" />
      </div>

      {/* Language switcher */}
      <div className="absolute right-4 top-4 z-50">
        <LanguageSwitcher />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-md items-center px-4 py-12">
        <div className="w-full space-y-8">
          {/* The platform owner's notice (maintenance, an incident), when there is one. */}
          <PlatformNotice />
          {/* Branding */}
          <div className="animate-fade-in-up flex items-center justify-center gap-3">
            <Logo3D className="h-12 w-12" label="HackOS logo" />
            <div>
              <h1 className="text-xl font-bold text-white">
                {t("brand.platform_name")}
              </h1>
              <p className="mt-0.5 text-xs theme-text-muted">
                {t("brand.event_year")}
              </p>
            </div>
          </div>

          {/* Card */}
          <div className="animate-fade-in-up card-shadow glass rounded-2xl p-6 sm:p-7">
            <h2 className="text-lg font-semibold text-white">
              {t("login.title")}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t("login.subtitle")}
            </p>

            {/* Tabs */}
            <div className="mt-5 flex gap-1 rounded-xl bg-white/4 p-1">
              <button
                type="button"
                onClick={() => {
                  setTab("login");
                  setError(null);
                }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-medium transition-all ${
                  tab === "login"
                    ? "bg-[#E1003C] text-white shadow-lg"
                    : "text-muted hover:text-white"
                }`}
              >
                <Code2 size={14} /> {t("login.sign_in")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("register");
                  setError(null);
                }}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-medium transition-all ${
                  tab === "register"
                    ? "bg-[#E1003C] text-white shadow-lg"
                    : "text-muted hover:text-white"
                }`}
              >
                <Users size={14} /> {tEn("login.register_tab")}
              </button>
            </div>

            {tab === "login" ? (
              <form onSubmit={onSubmitLogin} className="mt-6 space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">
                    {t("login.email")}
                  </label>
                  <div className="relative">
                    <Mail
                      size={15}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError(null);
                      }}
                      placeholder="you@example.com"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/3 pl-10 pr-4 text-sm text-white placeholder-[#7a7a7a] outline-none focus:border-[#E1003C]/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">
                    {t("login.password")}
                  </label>
                  <div className="relative">
                    <Lock
                      size={15}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError(null);
                      }}
                      placeholder="••••••••"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/3 pl-10 pr-4 text-sm text-white placeholder-[#7a7a7a] outline-none focus:border-[#E1003C]/50"
                    />
                  </div>
                </div>

                {justRegistered && (
                  <p className="rounded-lg bg-[#00C853]/10 px-3 py-2 text-xs text-[#00C853]">
                    {t("login.registered_success") || "Registration successful! Please log in with your email and password."}
                    {pendingTeam ? ` ${t("login.registered_pending_team")}` : null}
                    {confirmSent ? <span className="mt-1 block">{t("ve.registered_confirm")}</span> : null}
                    {confirmSent && pendingInviteRole ? (
                      <span className="mt-1 block">{fill(t("ve.registered_invite"), { role: t(inviteRoleKey(pendingInviteRole)) })}</span>
                    ) : null}
                  </p>
                )}

                {accountStatusBlocked && (
                  <div
                    role="status"
                    className={`rounded-lg px-3 py-2.5 text-xs leading-relaxed ${
                      accountStatusParam === "rejected"
                        ? "border border-[#FF3B30]/30 bg-[#FF3B30]/10 text-[#FF3B30]"
                        : "border border-[#FFC107]/30 bg-[#FFC107]/10 text-[#FFC107]"
                    }`}
                  >
                    <p className="font-semibold">
                      {accountStatusParam === "rejected"
                        ? t("login.status_rejected_title")
                        : accountStatusParam === "eliminated"
                          ? t("login.status_eliminated_title")
                          : accountStatusParam === "waitlisted"
                            ? t("login.status_waitlisted_title")
                            : t("login.status_pending_title")}
                    </p>
                    <p className="mt-1 text-[11px] text-white/80">
                      {accountStatusParam === "rejected"
                        ? t("login.status_rejected_body")
                        : accountStatusParam === "eliminated"
                          ? t("login.status_eliminated_body")
                          : accountStatusParam === "waitlisted"
                            ? t("login.status_waitlisted_body")
                            : t("login.status_pending_body")}
                    </p>
                    {/* Which event, which team, since when, and whether the e-mail is confirmed. */}
                    <RegistrationStatusDetails />
                    {/* The status is the one of the event they were in: another
                        event they take part in may be open to them. */}
                    <Link
                      href="/workspaces"
                      className="mt-1.5 inline-block text-[11px] font-medium underline underline-offset-2"
                    >
                      {t("login.status_switch_event")}
                    </Link>
                    {pendingChat ? (
                      <div className="mt-2.5 border-t border-[#FFC107]/20 pt-2.5">
                        <p className="text-[11px] text-white/80">{t("login.pending_chat_hint")}</p>
                        <Link
                          href="/hacker/chat"
                          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[#FFC107] px-3 py-1.5 text-[12px] font-semibold transition-opacity hover:opacity-90"
                          // globals.css gives every link its parent's colour, above any text-* class.
                          style={{ color: "#1A1A1A" }}
                        >
                          {t("login.pending_chat_cta")}
                          <ArrowRight size={13} aria-hidden="true" />
                        </Link>
                      </div>
                    ) : null}
                  </div>
                )}

                {justRegistered && teamJoinCode && (
                  <div className="rounded-lg border border-[#E1003C]/30 bg-[#E1003C]/10 px-3 py-2.5 text-xs text-white">
                    <p className="mb-1.5 font-medium text-[#ffb3c1]">
                      {t("login.team_created") || "Your team was created."}
                    </p>
                    <p className="mb-2 text-[11px] leading-relaxed text-white/80">
                      {t("login.share_join_code") ||
                        "Share this join code with your teammates so they can join your team after they register as solo hackers:"}
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded-md bg-black/30 px-2.5 py-1.5 font-mono text-sm font-bold tracking-wider text-white">
                        {teamJoinCode}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof navigator !== "undefined" && navigator.clipboard) {
                            navigator.clipboard.writeText(teamJoinCode).catch(() => {
                              /* ignore copy errors */
                            });
                          }
                        }}
                        className="rounded-md border border-white/15 px-2.5 py-1.5 text-[11px] font-medium text-white/90 transition-colors hover:bg-white/10"
                      >
                        {t("login.copy") || "Copy"}
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <p className="rounded-lg bg-[#FF3B30]/10 px-3 py-2 text-xs text-[#FF3B30]">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#E1003C] text-sm font-semibold text-white transition-colors hover:bg-[#C00035] disabled:opacity-60"
                >
                  {loading ? t("login.wait") : t("login.sign_in")}{" "}
                  <ArrowRight size={16} />
                </button>

                <Link
                  href="/forgot-password"
                  className="mt-3 block text-center text-xs text-muted transition-colors hover:text-[#E1003C] hover:underline"
                >
                  {t("login.forgot_password")}
                </Link>

                {activeEventCode ? (
                  <Link
                    href={`/join/${activeEventCode}`}
                    className="mt-3 block text-center text-xs text-[#E1003C] hover:underline"
                  >
                    {t("login.register_link")}
                  </Link>
                ) : (
                  <p className="mt-3 text-center text-[11px] text-muted/80">
                    {t("login.join_hint")}
                  </p>
                )}
              </form>
            ) : (
              <form onSubmit={onSubmitRegister} className="mt-6 space-y-4">
                {(parsedEventIdForRegister != null ||
                  openRegisterTab ||
                  Boolean(emailFromQuery)) && (
                  <p className="rounded-lg bg-[#00C853]/10 px-3 py-2 text-[11px] leading-relaxed text-muted">
                    {tEn("login.register_invite_banner")}
                  </p>
                )}
                {inviteTokenParam ? (
                  <p className="rounded-lg bg-[#E1003C]/10 px-3 py-2 text-[11px] leading-relaxed text-muted">
                    {tEn("ve.invite_link_banner")}
                  </p>
                ) : null}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">
                    {tEn("login.full_name")}
                  </label>
                  <div className="relative">
                    <Users
                      size={15}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                      type="text"
                      required
                      minLength={2}
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        setError(null);
                      }}
                      placeholder="John Doe"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/3 pl-10 pr-4 text-sm text-white placeholder-[#7a7a7a] outline-none focus:border-[#E1003C]/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">
                    {tEn("login.email")}
                  </label>
                  <div className="relative">
                    <Mail
                      size={15}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError(null);
                      }}
                      placeholder="you@example.com"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/3 pl-10 pr-4 text-sm text-white placeholder-[#7a7a7a] outline-none focus:border-[#E1003C]/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted">
                    {tEn("login.password")}
                  </label>
                  <div className="relative">
                    <Lock
                      size={15}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError(null);
                      }}
                      placeholder="••••••••"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/3 pl-10 pr-4 text-sm text-white placeholder-[#7a7a7a] outline-none focus:border-[#E1003C]/50"
                    />
                  </div>
                </div>

                {error && (
                  <p className="rounded-lg bg-[#FF3B30]/10 px-3 py-2 text-xs text-[#FF3B30]">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#E1003C] text-sm font-semibold text-white transition-colors hover:bg-[#C00035] disabled:opacity-60"
                >
                  {loading ? tEn("login.wait") : tEn("login.register_cta")}{" "}
                  <ArrowRight size={16} />
                </button>
              </form>
            )}
          </div>

          <p className="animate-fade-in-up text-center text-xs text-[#7a7a7a]">
            <Link
              href="/faq"
              className="font-medium text-muted underline-offset-2 transition-colors hover:text-[#E1003C] hover:underline"
            >
              {t("login.link_faq")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
