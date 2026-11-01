"use client";

/**
 * The setup link from the approval e-mail.
 *
 * GET /api/setup/:token says whether the link is valid and which organisation
 * it is for (the address it was sent to comes back masked). Finishing setup
 * needs the account the link was sent to: the page signs that person in if
 * needed, takes the organisation's profile and spends the link, then opens
 * the organisation's dashboard.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRight, Building2, CircleCheck, Clock, Link2Off, Lock, LogOut, Mail, Users } from "lucide-react";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useTranslation } from "@/contexts/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { entriesFrom, enterWorkspace, fetchWorkspaces, signOut, syncSession } from "@/lib/workspaces";

interface SetupInfo {
  state: "valid" | "used" | "expired" | "revoked";
  email: string;
  expiresAt: string;
  organisation: {
    id: number;
    name: string;
    timezone: string;
    locale: string;
    logoUrl: string | null;
    brandColor: string | null;
    website: string | null;
  };
}

type Phase =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "info"; info: SetupInfo }
  | { kind: "done"; orgId: number; name: string };

const FALLBACK_ZONES = ["Asia/Baku", "Europe/Istanbul", "Europe/Moscow", "Asia/Tbilisi", "Europe/London", "Europe/Berlin", "Asia/Dubai", "UTC"];

function timeZones(): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (all && all.length) return all.includes("Asia/Baku") ? all : ["Asia/Baku", ...all];
  } catch {
    /* older browsers */
  }
  return FALLBACK_ZONES;
}

export default function SetupPage() {
  const { t } = useTranslation();
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);

  const [creds, setCreds] = useState({ email: "", password: "" });
  const [profile, setProfile] = useState({ name: "", website: "", logoUrl: "", brandColor: "#C8102E", timezone: "Asia/Baku", locale: "az" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renewed, setRenewed] = useState<{ ok: boolean; text: string } | null>(null);
  const zones = useMemo(timeZones, []);

  const loadSession = useCallback(() => {
    apiGet<{ email?: string }>("/api/auth/me")
      .then((me) => setSignedInEmail(me?.email || null))
      .catch(() => setSignedInEmail(null))
      .finally(() => setCheckedSession(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet<SetupInfo>(`/api/setup/${encodeURIComponent(token)}`)
      .then((info) => {
        if (cancelled) return;
        setPhase({ kind: "info", info });
        const o = info.organisation;
        setProfile((p) => ({
          ...p,
          name: o.name || "",
          website: o.website || "",
          logoUrl: o.logoUrl || "",
          brandColor: o.brandColor || p.brandColor,
          timezone: o.timezone || p.timezone,
          locale: o.locale || p.locale,
        }));
      })
      .catch(() => { if (!cancelled) setPhase({ kind: "missing" }); });
    loadSession();
    return () => { cancelled = true; };
  }, [token, loadSession]);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/auth/login", { email: creds.email.trim().toLowerCase(), password: creds.password });
      await syncSession();
      loadSession();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t("account.signin.err_credentials") : t("account.signin.err_generic"));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase.kind !== "info") return;
    setBusy(true);
    setError(null);
    try {
      const org = await apiPost<{ id: number; name: string }>(`/api/setup/${encodeURIComponent(token)}`, {
        name: profile.name.trim(),
        website: profile.website.trim() || null,
        logoUrl: profile.logoUrl.trim() || null,
        brandColor: profile.brandColor,
        timezone: profile.timezone,
        locale: profile.locale,
      });
      setPhase({ kind: "done", orgId: org.id, name: org.name });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setError(t("setup.wrong_account"));
      else setError(err instanceof ApiError && err.message ? err.message : t("account.signin.err_generic"));
    } finally {
      setBusy(false);
    }
  };

  const openDashboard = async (orgId: number) => {
    setBusy(true);
    try {
      const ws = await fetchWorkspaces();
      const entry = entriesFrom(ws).find((x) => x.kind === "org" && x.org.id === orgId);
      window.location.assign(entry ? await enterWorkspace(entry) : "/workspaces");
    } catch {
      window.location.assign("/workspaces");
    }
  };

  const renew = async () => {
    setBusy(true);
    setRenewed(null);
    try {
      const out = await apiPost<{ email: string }>(`/api/setup/${encodeURIComponent(token)}/renew`, {});
      setRenewed({ ok: true, text: t("setup.renew_sent").split("{email}").join(out.email) });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setRenewed({ ok: false, text: code === "SETUP_RECENT" ? t("setup.renew_recent") : code === "SETUP_DONE" ? t("setup.used_body") : t("setup.renew_failed") });
    } finally {
      setBusy(false);
    }
  };

  const field = "h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-[#E1003C]";
  const fieldStyle: React.CSSProperties = { background: "var(--app-surface-2)", borderColor: "var(--app-card-line)", color: "var(--app-heading)" };
  const label = "mb-1.5 block text-[13px] font-medium";
  const primary = "inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white disabled:opacity-60";

  const notice = (Icon: typeof Clock, title: string, body: string, action?: React.ReactNode) => (
    <div className="flex flex-col items-start gap-3">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: "rgba(225,0,60,0.12)", color: "#E1003C" }}>
        <Icon size={20} />
      </span>
      <h1 className="text-xl font-semibold" style={{ color: "var(--app-heading)" }}>{title}</h1>
      <p className="text-sm leading-relaxed" style={{ color: "var(--app-muted)" }}>{body}</p>
      {action}
    </div>
  );

  let content: React.ReactNode;
  if (phase.kind === "loading" || (phase.kind === "info" && phase.info.state === "valid" && !checkedSession)) {
    content = <p className="text-sm" style={{ color: "var(--app-muted)" }}>{t("setup.loading")}</p>;
  } else if (phase.kind === "missing") {
    content = notice(Link2Off, t("setup.invalid_title"), t("setup.invalid_body"),
      <a href="/contact" className="text-sm font-medium" style={{ color: "#E1003C" }}>{t("setup.contact")}</a>);
  } else if (phase.kind === "done") {
    content = (
      <div className="flex flex-col items-start gap-3">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "rgba(0,200,83,0.14)", color: "var(--app-ok)" }}>
          <CircleCheck size={26} />
        </span>
        <h1 className="text-xl font-semibold" style={{ color: "var(--app-heading)" }}>{t("setup.done_title")}</h1>
        <p className="text-sm leading-relaxed" style={{ color: "var(--app-muted)" }}>{t("setup.done_body")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => openDashboard(phase.orgId)} className={primary} style={{ background: "#E1003C" }}>
            {t("setup.open_dashboard")} <ArrowRight size={16} />
          </button>
          <a href="/account/team" className="inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium" style={{ borderColor: "var(--app-card-line)", color: "var(--app-heading)" }}>
            <Users size={16} /> {t("setup.invite")}
          </a>
        </div>
      </div>
    );
  } else {
    const { info } = phase;
    if (info.state === "used") {
      content = notice(CircleCheck, t("setup.used_title"), t("setup.used_body"),
        <Link href="/login?next=%2Fworkspaces" className={primary} style={{ background: "#E1003C" }}>{t("setup.signin")} <ArrowRight size={16} /></Link>);
    } else if (info.state !== "valid") {
      // Expired, or replaced by a newer link: either way the buyer can ask for
      // a new one, which goes to the address this one was sent to.
      const revoked = info.state === "revoked";
      content = notice(Clock, t(revoked ? "setup.revoked_title" : "setup.expired_title"), t(revoked ? "setup.revoked_body" : "setup.expired_body"),
        <div className="flex flex-col items-start gap-2">
          {renewed?.ok ? (
            <p role="status" className="text-sm font-medium" style={{ color: "var(--app-ok)" }}>{renewed.text}</p>
          ) : (
            <button type="button" disabled={busy} onClick={renew} className={primary} style={{ background: "#E1003C" }}>
              <Mail size={16} /> {t("setup.renew")}
            </button>
          )}
          {renewed && !renewed.ok ? <p role="alert" className="text-sm" style={{ color: "#E1003C" }}>{renewed.text}</p> : null}
          <a href="/contact" className="text-sm font-medium" style={{ color: "#E1003C" }}>{t("setup.contact")}</a>
        </div>);
    } else if (!signedInEmail) {
      content = (
        <form onSubmit={signIn} className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--app-heading)" }}>{t("setup.signin_title")}</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--app-muted)" }}>
              {t("setup.signin_body")} <span className="font-mono" style={{ color: "var(--app-heading)" }}>{info.email}</span>
            </p>
          </div>
          <label className="block">
            <span className={label} style={{ color: "var(--app-muted)" }}>{t("setup.email")}</span>
            <span className="relative block">
              <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--app-muted-2)" }} />
              <input type="email" required autoComplete="username" value={creds.email} onChange={(e) => setCreds((c) => ({ ...c, email: e.target.value }))} className={`${field} pl-9`} style={fieldStyle} />
            </span>
          </label>
          <label className="block">
            <span className={label} style={{ color: "var(--app-muted)" }}>{t("setup.password")}</span>
            <span className="relative block">
              <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--app-muted-2)" }} />
              <input type="password" required autoComplete="current-password" value={creds.password} onChange={(e) => setCreds((c) => ({ ...c, password: e.target.value }))} className={`${field} pl-9`} style={fieldStyle} />
            </span>
          </label>
          {error ? <p role="alert" className="text-[13px]" style={{ color: "var(--app-danger)" }}>{error}</p> : null}
          <div className="flex items-center justify-between gap-3">
            <a href="/forgot-password" className="text-[13px]" style={{ color: "var(--app-muted)" }}>{t("setup.forgot")}</a>
            <button type="submit" disabled={busy} className={primary} style={{ background: "#E1003C" }}>
              {t("setup.signin")} <ArrowRight size={16} />
            </button>
          </div>
        </form>
      );
    } else {
      content = (
        <form onSubmit={finish} className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl"
              style={{ background: profile.brandColor || "#C8102E", color: "#fff" }}
            >
              {profile.logoUrl.startsWith("https://") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.logoUrl} alt="" className="h-full w-full object-contain" />
              ) : (
                <Building2 size={22} />
              )}
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-semibold" style={{ color: "var(--app-heading)" }}>{t("setup.profile_title")}</h1>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--app-muted)" }}>{t("setup.profile_body")}</p>
            </div>
          </div>
          <label className="block">
            <span className={label} style={{ color: "var(--app-muted)" }}>{t("setup.name")}</span>
            <input required minLength={2} maxLength={200} value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} className={field} style={fieldStyle} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={label} style={{ color: "var(--app-muted)" }}>{t("setup.timezone")}</span>
              <select value={profile.timezone} onChange={(e) => setProfile((p) => ({ ...p, timezone: e.target.value }))} className={field} style={fieldStyle}>
                {zones.map((z) => <option key={z} value={z}>{z}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={label} style={{ color: "var(--app-muted)" }}>{t("setup.language")}</span>
              <select value={profile.locale} onChange={(e) => setProfile((p) => ({ ...p, locale: e.target.value }))} className={field} style={fieldStyle}>
                <option value="az">Azərbaycan</option>
                <option value="en">English</option>
                <option value="ru">Русский</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className={label} style={{ color: "var(--app-muted)" }}>
              {t("setup.website")} <span style={{ color: "var(--app-muted-2)" }}>({t("setup.optional")})</span>
            </span>
            <input type="url" placeholder="https://" value={profile.website} onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))} className={field} style={fieldStyle} />
          </label>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_150px]">
            <label className="block">
              <span className={label} style={{ color: "var(--app-muted)" }}>
                {t("setup.logo")} <span style={{ color: "var(--app-muted-2)" }}>({t("setup.optional")})</span>
              </span>
              <input type="url" placeholder="https://" value={profile.logoUrl} onChange={(e) => setProfile((p) => ({ ...p, logoUrl: e.target.value }))} className={field} style={fieldStyle} />
              <span className="mt-1 block text-[12px]" style={{ color: "var(--app-muted-2)" }}>{t("setup.logo_hint")}</span>
            </label>
            <label className="block">
              <span className={label} style={{ color: "var(--app-muted)" }}>{t("setup.color")}</span>
              <span className="flex items-center gap-2">
                <input type="color" value={profile.brandColor} onChange={(e) => setProfile((p) => ({ ...p, brandColor: e.target.value.toUpperCase() }))} className="h-11 w-12 cursor-pointer rounded-xl border p-1" style={{ background: "var(--app-surface-2)", borderColor: "var(--app-card-line)" }} aria-label={t("setup.color")} />
                <span className="font-mono text-sm" style={{ color: "var(--app-heading)" }}>{profile.brandColor}</span>
              </span>
            </label>
          </div>
          {error ? <p role="alert" className="text-[13px]" style={{ color: "var(--app-danger)" }}>{error}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--app-card-line)" }}>
            <span className="truncate text-[12.5px]" style={{ color: "var(--app-muted-2)" }}>{signedInEmail}</span>
            <button type="submit" disabled={busy || profile.name.trim().length < 2} className={primary} style={{ background: "#E1003C" }}>
              {busy ? t("setup.saving") : t("setup.save")} {!busy ? <ArrowRight size={16} /> : null}
            </button>
          </div>
        </form>
      );
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--app-surface-2)", color: "var(--app-heading)" }}>
      <header className="border-b" style={{ borderColor: "var(--app-card-line)" }}>
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <span className="flex items-center gap-2">
            <Image src="/logo.svg" alt="" width={28} height={28} />
            <span className="text-[15px] font-semibold">HackOS</span>
          </span>
          <span className="flex items-center gap-2">
            <LanguageSwitcher />
            {signedInEmail ? (
              <button
                type="button"
                onClick={async () => { await signOut(); setSignedInEmail(null); }}
                className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[13px] font-medium"
                style={{ borderColor: "var(--app-card-line)", color: "var(--app-heading)" }}
              >
                <LogOut size={14} /> {t("setup.sign_out")}
              </button>
            ) : null}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="mb-4 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--app-muted-2)" }}>
          {t("setup.eyebrow")}
          {phase.kind === "info" ? ` · ${phase.info.organisation.name}` : ""}
        </p>
        <div className="rounded-2xl border p-6 sm:p-8" style={{ background: "var(--app-surface)", borderColor: "var(--app-card-line)" }}>
          {content}
        </div>
      </main>
    </div>
  );
}
