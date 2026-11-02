"use client";

/**
 * The registration page around the form: who is signed in, whether they are
 * already part of this event, and what to say when registration is not open.
 * People with an invitation from the organisers can still register while it
 * is closed or full — the API recognises their address — so they get a way
 * through instead of a dead end.
 *
 * A personal invitation's link (?inviteToken=) is read first: its address is
 * filled in and fixed, its team offered, and a link that no longer works
 * (expired, withdrawn, used, or not valid) says so instead of a form. An
 * invite-only event opened without one says that registration is by
 * invitation, with a way through for someone invited who lost the e-mail.
 *
 * Every state shows the event at a glance first (dates, place, how people
 * take part, places left and the deadline), in the visitor's language and in
 * the public site's light or dark theme.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CalendarClock, CheckCircle2, Clock, Hourglass, Link2Off, Loader2, Lock, MailOpen, Moon, Sun, UserCheck, UserX, XCircle } from "lucide-react";
import { useSiteTheme } from "@/app/(site)/_theme";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { resolve, type Lang } from "@/lib/i18n";
import { formatInZone } from "@/lib/builder/datetime";
import type { PublicEvent } from "@/lib/builder/public";
import { enterEventWorkspace, type Workspaces } from "@/lib/workspaces";
import { eventTheme } from "./EventPublicView";
import { RegistrationForm, type InvitationPreview } from "./RegistrationForm";
import { EventSummary, RegisterLayout, panelClass, panelStyle, primaryButton, secondaryButton, secondaryStyle } from "./registerUi";

type Me = { email?: string; full_name?: string; name?: string } | null;
type Mine = { role: string; participant_status: string | null } | null;
/** The invitation the link carries: undefined while reading it, null without a link. */
type Invite =
  | (InvitationPreview & { status: "live"; expiresAt: string | null })
  | { status: "expired"; expiresAt: string | null }
  | { status: "revoked" | "used" | "invalid" };

function readInvite(raw: unknown): Invite {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const status = String(o.status ?? "");
  const at = typeof o.expiresAt === "string" ? o.expiresAt : null;
  if (status === "live" && typeof o.email === "string" && o.email) {
    const team = o.team && typeof o.team === "object" ? (o.team as Record<string, unknown>) : null;
    return {
      status: "live",
      email: o.email,
      fullName: typeof o.fullName === "string" && o.fullName ? o.fullName : null,
      team: team && typeof team.name === "string" && team.name ? { name: team.name, exists: team.exists === true } : null,
      expiresAt: at,
    };
  }
  if (status === "expired") return { status, expiresAt: at };
  if (status === "revoked" || status === "used") return { status };
  return { status: "invalid" };
}

const LANGS: Lang[] = ["az", "en", "ru"];

export function RegisterClient({
  event, teamCode, refParam, invited, inviteToken = null,
}: {
  event: PublicEvent;
  teamCode: string | null;
  refParam: string | null;
  invited: boolean;
  /** The token of an invitation's own link, passed on with the registration. */
  inviteToken?: string | null;
}) {
  const [lang, setLang] = useState<Lang>(event.language || "az");
  const t = (k: string) => resolve(lang, k);
  const f = (k: string, p: Record<string, string | number>) => Object.entries(p).reduce((s, [a, b]) => s.split(`{${a}}`).join(String(b)), t(k));
  const { theme, toggle } = useSiteTheme();
  const dark = theme === "dark";
  const [me, setMe] = useState<Me | undefined>(undefined);
  const [mine, setMine] = useState<Mine>(null);
  const [registered, setRegistered] = useState(false);
  const [joining, setJoining] = useState<{ busy: boolean; done: string | null; error: string | null }>({ busy: false, done: null, error: null });
  const [invite, setInvite] = useState<Invite | null | undefined>(inviteToken ? undefined : null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    let live = true;
    apiGet<unknown>(`/api/public/invitations/${encodeURIComponent(inviteToken)}`)
      .then((d) => { if (live) setInvite(readInvite(d)); })
      .catch(() => { if (live) setInvite({ status: "invalid" }); });
    return () => { live = false; };
  }, [inviteToken]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const m = await apiGet<Me>("/api/auth/me");
        if (!live) return;
        if (!m?.email) { setMe(null); return; }
        // Already part of this event? Say so before anyone fills in a form.
        const ws = await apiGet<Workspaces>("/api/me/workspaces").catch(() => null);
        if (!live) return;
        const here = ws?.events.find((e) => e.id === event.id);
        setMine(here ? { role: here.role, participant_status: here.participant_status } : null);
        setMe(m);
      } catch {
        if (live) setMe(null);
      }
    })();
    return () => { live = false; };
  }, [event.id]);

  const reg = event.registration;
  const blocked = reg.state === "not_open" ? "not_open" : reg.state === "closed" ? "closed" : reg.full && !reg.waitlistEnabled ? "full" : null;
  const summary = (heading: "h1" | "p") => <EventSummary event={event} lang={lang} t={t} f={f} heading={heading} />;

  const shell = (body: React.ReactNode) => (
    <div className={`hs ${dark ? "hs-night" : ""} min-h-dvh`} style={eventTheme(event)}>
      <div className="mx-auto max-w-2xl px-4 pb-10 pt-4 sm:px-6 sm:pb-16 sm:pt-6 lg:max-w-6xl" style={{ paddingLeft: "max(16px, env(safe-area-inset-left))", paddingRight: "max(16px, env(safe-area-inset-right))" }}>
        <div className="flex items-center justify-between gap-3">
          <Link href={`/e/${event.slug}${refParam ? `?ref=${encodeURIComponent(refParam)}` : ""}`}
            className="-ml-2 inline-flex min-h-10 min-w-0 items-center gap-1.5 rounded-[10px] px-2 text-[13.5px] font-medium transition-colors hover:bg-[var(--tint)]" style={{ color: "var(--ink-2)" }}>
            <ArrowLeft size={15} className="shrink-0" aria-hidden="true" /><span className="truncate">{event.name}</span>
          </Link>
          <div className="flex shrink-0 items-center gap-1.5">
            <div role="group" aria-label={t("ep.language")} className="inline-flex rounded-full border p-0.5" style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}>
              {LANGS.map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
                  className="min-h-8 rounded-full px-2.5 text-[12px] font-semibold uppercase transition-colors"
                  style={{ background: lang === l ? "var(--ink)" : "transparent", color: lang === l ? "var(--surface)" : "var(--ink-2)" }}>{l}</button>
              ))}
            </div>
            <button type="button" onClick={toggle} aria-label={dark ? t("ve.theme_light") : t("ve.theme_dark")}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--tint)]" style={{ color: "var(--ink-2)" }}>
              {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
          </div>
        </div>
        <div className="mt-4 sm:mt-6">{body}</div>
      </div>
    </div>
  );

  const notice = (tone: "neutral" | "ok" | "warn" | "danger", icon: React.ReactNode, title: string, text: string, actions?: React.ReactNode, extra?: React.ReactNode) => {
    const colors = {
      neutral: { bg: "var(--tint)", fg: "var(--ink-2)" },
      ok: { bg: "var(--ok-weak)", fg: "var(--ok)" },
      warn: { bg: "var(--warn-weak)", fg: "var(--warn)" },
      danger: { bg: "var(--danger-weak)", fg: "var(--danger)" },
    }[tone];
    return shell(
      <RegisterLayout aside={summary("p")}>
        <div className={`${panelClass} hs-rise px-5 py-8 text-center sm:px-10 sm:py-10`} style={panelStyle}>
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: colors.bg, color: colors.fg, boxShadow: `0 0 0 8px color-mix(in srgb, ${colors.fg} 6%, transparent)` }}>{icon}</span>
          <h1 className="mt-5 text-[24px] font-semibold leading-tight tracking-tight sm:text-[28px]" style={{ color: "var(--ink)", fontFamily: "var(--font-display)", textWrap: "balance" }}>{title}</h1>
          <p className="mx-auto mt-2.5 max-w-md text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{text}</p>
          <div className="mx-auto mt-7 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:flex-wrap sm:justify-center">
            {actions}
            <Link href={`/e/${event.slug}`} className={secondaryButton} style={secondaryStyle}>{t("rg.back_to_event")}</Link>
          </div>
          {extra}
        </div>
      </RegisterLayout>,
    );
  };

  if (me === undefined || invite === undefined) {
    return shell(
      <RegisterLayout aside={summary("h1")}>
        <div className="space-y-5" role="status" aria-live="polite">
          <span className="sr-only">{t("rg.loading")}</span>
          {[180, 300, 240].map((h) => (
            <div key={h} className={`${panelClass} flex items-center justify-center`} style={{ ...panelStyle, height: h }}>
              {h === 180 ? <Loader2 size={20} className="animate-spin" style={{ color: "var(--ink-3)" }} aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
      </RegisterLayout>,
    );
  }

  // Signed in and already part of this event (and not just registered here).
  if (mine && !registered) {
    if (mine.role !== "participant") {
      return notice("neutral", <UserCheck size={24} aria-hidden="true" />, t("rg.state.staff"), t("rg.state.staff_body"),
        <button type="button" onClick={async () => { await enterEventWorkspace(event.id); window.location.assign("/"); }} className={primaryButton} style={{ background: "var(--accent-solid)" }}>{t("rg.state.open_workspace")}</button>);
    }
    const s = String(mine.participant_status || "pending");
    const Icon = s === "approved" ? CheckCircle2 : s === "waitlisted" ? Hourglass : s === "rejected" ? XCircle : Clock;
    // A team invite link opened by someone already registered: join that team from here.
    const joinTeam = async () => {
      if (!teamCode) return;
      setJoining({ busy: true, done: null, error: null });
      try {
        await enterEventWorkspace(event.id);
        const team = await apiPost<{ name?: string }>("/api/teams/join", { joinCode: teamCode });
        setJoining({ busy: false, done: f("rg.state.joined", { team: team?.name || teamCode }), error: null });
      } catch (err) {
        const code = err instanceof ApiError ? err.code : undefined;
        const known = code && ["ALREADY_IN_TEAM", "TEAM_FULL", "TEAM_NOT_FOUND", "TEAM_FORMATION_CLOSED", "TEAM_ELIMINATED"].includes(code);
        setJoining({ busy: false, done: null, error: known ? t(`rg.join.${code}`) : err instanceof Error ? err.message : t("rg.err.generic") });
      }
    };
    const text = f("rg.state.mine_body", { email: me?.email || "" })
      + (teamCode && s !== "approved" ? ` ${t("rg.state.team_after_approval")}` : "");
    const tone = s === "approved" ? "ok" : s === "rejected" ? "danger" : "warn";
    return notice(tone, <Icon size={24} aria-hidden="true" />, t(`rg.state.mine_${["approved", "waitlisted", "rejected"].includes(s) ? s : "pending"}`), text,
      s === "approved" ? (
        <>
          {teamCode && !joining.done ? (
            <button type="button" disabled={joining.busy} onClick={joinTeam} className={primaryButton} style={{ background: "var(--accent-solid)" }}>
              {joining.busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}{t("rg.state.join_team")}
            </button>
          ) : null}
          <button type="button" onClick={async () => { await enterEventWorkspace(event.id); window.location.assign("/hacker"); }}
            className={teamCode && !joining.done ? secondaryButton : primaryButton}
            style={teamCode && !joining.done ? secondaryStyle : { background: "var(--accent-solid)" }}>{t("rg.done.dashboard")}</button>
        </>
      ) : null,
      joining.done || joining.error ? (
        <p role="status" className="mx-auto mt-4 max-w-md rounded-[12px] px-4 py-3 text-[14px]" style={{ background: joining.done ? "var(--ok-weak)" : "var(--danger-weak)", color: joining.done ? "var(--ok)" : "var(--danger)" }}>{joining.done || joining.error}</p>
      ) : null);
  }

  // A personal invitation's link that no longer works: said plainly, no form.
  if (invite && invite.status !== "live" && !registered) {
    const signIn = <Link href={`/login?next=${encodeURIComponent(`/e/${event.slug}`)}`} className={primaryButton} style={{ background: "var(--accent-solid)" }}>{t("rg.inv.sign_in")}</Link>;
    if (invite.status === "expired") {
      return notice("warn", <Hourglass size={24} aria-hidden="true" />, t("rg.inv.expired_t"), f("rg.inv.expired_b", { date: formatInZone(invite.expiresAt, event.timezone, lang) }));
    }
    if (invite.status === "revoked") return notice("danger", <UserX size={24} aria-hidden="true" />, t("rg.inv.revoked_t"), t("rg.inv.revoked_b"));
    if (invite.status === "used") return notice("neutral", <CheckCircle2 size={24} aria-hidden="true" />, t("rg.inv.used_t"), t("rg.inv.used_b"), me ? null : signIn);
    return notice("neutral", <Link2Off size={24} aria-hidden="true" />, t("rg.inv.bad_t"), t("rg.inv.bad_b"));
  }

  // Signed in as someone else than the invited address: the link is theirs only.
  if (invite && invite.status === "live" && me?.email && me.email.trim().toLowerCase() !== invite.email && !registered) {
    const signOut = async () => {
      setSigningOut(true);
      await apiPost("/api/auth/logout", {}).catch(() => null);
      window.location.reload();
    };
    return notice("warn", <UserCheck size={24} aria-hidden="true" />, t("rg.inv.other_account_t"), f("rg.inv.other_account", { email: invite.email, me: me.email }),
      <button type="button" disabled={signingOut} onClick={signOut} className={primaryButton} style={{ background: "var(--accent-solid)" }}>
        {signingOut ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}{t("rg.inv.sign_out")}
      </button>);
  }

  // Invite-only, and no invitation in the address: nothing to fill in here.
  if (event.visibility === "invite" && !inviteToken && !invited) {
    return notice("neutral", <MailOpen size={24} aria-hidden="true" />, t("rg.state.invite_only"), f("rg.state.invite_only_body", { event: event.name }), null,
      <p className="mt-6 border-t pt-5 text-[13.5px]" style={{ borderColor: "var(--line)" }}>
        <Link href={`/e/${event.slug}/register?invited=1${teamCode ? `&team=${encodeURIComponent(teamCode)}` : ""}`} className="inline-flex min-h-10 items-center font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("rg.state.invite_only_lost")}</Link>
      </p>);
  }

  const invitation = invite && invite.status === "live" ? invite : null;

  if (blocked && !invited) {
    const withInvite = (
      <p className="mt-6 border-t pt-5 text-[13.5px]" style={{ borderColor: "var(--line)" }}>
        <Link href={`/e/${event.slug}/register?invited=1${teamCode ? `&team=${encodeURIComponent(teamCode)}` : ""}`} className="inline-flex min-h-10 items-center font-semibold underline underline-offset-2" style={{ color: "var(--accent)" }}>{t("rg.state.have_invite")}</Link>
      </p>
    );
    if (blocked === "not_open") {
      return notice("neutral", <CalendarClock size={24} aria-hidden="true" />, t("rg.state.not_open"), f("rg.state.not_open_body", { date: formatInZone(event.registration_start, event.timezone, lang) }), null, withInvite);
    }
    if (blocked === "full") return notice("warn", <Lock size={24} aria-hidden="true" />, t("rg.state.full"), t("rg.state.full_body"), null, withInvite);
    return notice("neutral", <Lock size={24} aria-hidden="true" />, t("rg.state.closed"), t("rg.state.closed_body"), null, withInvite);
  }

  return shell(
    <RegistrationForm
      event={event}
      lang={lang}
      signedIn={me?.email ? { email: me.email, name: me.full_name || me.name } : null}
      initialTeamCode={teamCode}
      refParam={refParam}
      inviteToken={inviteToken}
      invitation={invitation}
      onDone={() => setRegistered(true)}
      summary={summary}
      banner={invitation ? (
        <div className="mb-5 flex items-start gap-3 rounded-[16px] px-4 py-3.5" style={{ background: "var(--info-weak)", color: "var(--ink)" }}>
          <MailOpen size={18} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: "var(--info)" }} />
          <p className="min-w-0 text-[14px] leading-relaxed">
            <span className="block font-semibold">{t("rg.inv.banner_t")}</span>
            <span className="break-words">{f("rg.inv.banner", { event: event.name, email: invitation.email })}</span>
          </p>
        </div>
      ) : blocked && invited ? (
        <p className="mb-5 rounded-[16px] px-4 py-3.5 text-[14px] leading-relaxed" style={{ background: "var(--info-weak)", color: "var(--ink)" }}>{t("rg.state.invite_note")}</p>
      ) : null}
    />,
  );
}
