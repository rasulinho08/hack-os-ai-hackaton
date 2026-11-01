"use client";

/**
 * What the link in the confirmation e-mail opens: the address is confirmed
 * (POST /api/auth/verify-email), and the invitations that were waiting for
 * it open with it — the page names them. A link that is wrong, replaced or
 * older than three days says so and offers a new one (signed in) or the
 * sign-in that leads to one.
 *
 * The public site's look, with the visitor's language and theme switch.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BadgeCheck, Loader2, MailX, Moon, Sun } from "lucide-react";
import { Button, buttonLook } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { useSiteTheme } from "@/app/(site)/_theme";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import {
  inviteRoleKey, normalizeVerifyAnswer, readVerifyCache, retryAfterSeconds, writeVerifyCache, type VerifyAnswer,
} from "@/lib/emailVerification";
import { fill } from "@/lib/i18n/fill";
import type { Lang } from "@/lib/i18n";

const LANGS: { code: Lang; label: string }[] = [
  { code: "az", label: "AZ" },
  { code: "en", label: "EN" },
  { code: "ru", label: "RU" },
];

type Phase = "checking" | "ok" | "already" | "invalid" | "error";

/** Confirms the address with the link's token: the answer, or which failure it was. */
async function confirmToken(value: string): Promise<{ phase: Phase; answer: VerifyAnswer | null }> {
  try {
    const out = normalizeVerifyAnswer(await apiPost<unknown>("/api/auth/verify-email", { token: value }));
    // The notice above the app's pages knows at once, when it is this account.
    const cached = readVerifyCache();
    if (cached && out.email && cached.email.toLowerCase() === out.email.toLowerCase()) writeVerifyCache({ ...cached, verified: true, invites: [] });
    return { phase: out.alreadyVerified ? "already" : "ok", answer: out };
  } catch (err) {
    return { phase: err instanceof ApiError && err.status === 400 ? "invalid" : "error", answer: null };
  }
}

export function VerifyEmailView({ token }: { token: string | null }) {
  const { t, lang, setLang } = useTranslation();
  const { theme, toggle } = useSiteTheme();
  const dark = theme === "dark";
  const [phase, setPhase] = useState<Phase>("checking");
  const [answer, setAnswer] = useState<VerifyAnswer | null>(null);
  const [me, setMe] = useState<{ email: string } | null | undefined>(undefined);
  const [resend, setResend] = useState<{ busy: boolean; text: string | null }>({ busy: false, text: null });
  const started = useRef(false);

  const confirm = useCallback((value: string) => {
    void confirmToken(value).then((o) => {
      setAnswer(o.answer);
      setPhase(o.phase);
    });
  }, []);

  useEffect(() => {
    // Once: the token is used up by the first answer.
    if (!token || started.current) return;
    started.current = true;
    confirm(token);
  }, [token, confirm]);

  // Signed in? Then the page can offer the workspaces, or a new link.
  useEffect(() => {
    let live = true;
    apiGet<{ email?: string }>("/api/auth/me")
      .then((m) => { if (live) setMe(m?.email ? { email: m.email } : null); })
      .catch(() => { if (live) setMe(null); });
    return () => { live = false; };
  }, []);

  const sendNew = async () => {
    setResend({ busy: true, text: null });
    try {
      const out = await apiPost<{ alreadyVerified?: boolean; email?: string }>("/api/auth/verify-email/resend", {});
      setResend({ busy: false, text: out?.alreadyVerified ? t("ve.already_confirmed") : fill(t("ve.resend_sent"), { email: out?.email || me?.email || "" }) });
    } catch (err) {
      const wait = err instanceof ApiError ? retryAfterSeconds(err) : null;
      setResend({ busy: false, text: wait != null ? fill(t("ve.resend_wait"), { s: wait }) : t("ve.resend_failed") });
    }
  };

  const shown: Phase | "missing" = token ? phase : "missing";
  const good = shown === "ok" || shown === "already";
  const title = {
    checking: t("ve.checking"),
    ok: t("ve.ok_title"),
    already: t("ve.already_title"),
    invalid: t("ve.invalid_title"),
    error: t("ve.error_title"),
    missing: t("ve.missing_title"),
  }[shown];
  const body = {
    checking: null,
    ok: fill(t("ve.ok_body"), { email: answer?.email || "" }),
    already: t("ve.already_body"),
    invalid: t("ve.invalid_body"),
    error: t("ve.error_body"),
    missing: t("ve.missing_body"),
  }[shown];
  const Icon = shown === "checking" ? Loader2 : good ? BadgeCheck : shown === "error" ? AlertTriangle : MailX;
  const tone = good ? { bg: "var(--ok-weak)", fg: "var(--ok)" } : shown === "checking" ? { bg: "var(--surface-sunken)", fg: "var(--ink-3)" } : { bg: "var(--warn-weak)", fg: "var(--warn)" };

  return (
    <div className={`hs ${dark ? "hs-night" : ""} flex min-h-dvh flex-col`} style={{ background: "var(--surface-sunken)", color: "var(--ink)" }}>
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 pb-2 pt-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="HackOS">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={26} height={26} />
          <span className="text-[17px] font-semibold tracking-[-0.02em]">HackOS</span>
        </Link>
        <div className="flex items-center gap-1.5">
          <div role="group" aria-label={t("ve.language")} className="flex rounded-full border p-0.5" style={{ borderColor: "var(--line-strong)" }}>
            {LANGS.map((l) => (
              <button key={l.code} type="button" onClick={() => setLang(l.code)} aria-pressed={lang === l.code}
                className="min-h-8 rounded-full px-2.5 text-[12px] font-semibold transition-colors"
                style={{ background: lang === l.code ? "var(--ink)" : "transparent", color: lang === l.code ? "var(--surface)" : "var(--ink-2)" }}>
                {l.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={toggle} aria-label={dark ? t("ve.theme_light") : t("ve.theme_dark")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--tint)]" style={{ color: "var(--ink-2)" }}>
            {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-12 pt-6 sm:px-6">
        <p className="text-[12px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--ink-3)" }}>{t("ve.eyebrow")}</p>

        <section className="mt-3 rounded-[var(--radius)] border p-6 sm:p-8" style={{ borderColor: "var(--line)", background: "var(--surface)" }} aria-live="polite">
          <span className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: tone.bg, color: tone.fg }}>
            <Icon size={24} aria-hidden="true" className={shown === "checking" ? "animate-spin" : undefined} />
          </span>
          <h1 className="mt-4 text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[30px]" style={{ textWrap: "balance" }}>{title}</h1>
          {body ? <p className="mt-2 max-w-prose break-words text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{body}</p> : null}

          {shown === "ok" && answer && answer.applied.length ? (
            <div className="mt-5 rounded-[var(--radius-sm)] border p-4" style={{ borderColor: "var(--line)", background: "var(--surface-sunken)" }}>
              <p className="text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--ink-3)" }}>{t("ve.applied_title")}</p>
              <ul className="mt-2 space-y-1.5 text-[14px]" style={{ color: "var(--ink)" }}>
                {answer.applied.map((a) => (
                  <li key={`${a.eventId}-${a.role}`} className="flex items-start gap-2">
                    <BadgeCheck size={15} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: "var(--ok)" }} />
                    {fill(t("ve.applied_item"), { role: t(inviteRoleKey(a.role)), event: a.eventName || t("nt.this_event") })}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {shown !== "checking" ? (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              {good ? (
                me ? (
                  <Link href="/workspaces" {...buttonLook("primary", "md")}>{t("ve.open_workspaces")}</Link>
                ) : (
                  <Link href="/login" {...buttonLook("primary", "md")}>{t("ve.sign_in")}</Link>
                )
              ) : null}
              {shown === "error" && token ? (
                <Button variant="primary" onClick={() => { setPhase("checking"); confirm(token); }}>{t("ve.try_again")}</Button>
              ) : null}
              {shown === "invalid" || shown === "missing" ? (
                me ? (
                  <Button variant="primary" onClick={() => void sendNew()} loading={resend.busy} disabled={resend.busy}>{t("ve.resend")}</Button>
                ) : me === null ? (
                  <Link href="/login" {...buttonLook("primary", "md")}>{t("ve.sign_in_for_new")}</Link>
                ) : null
              ) : null}
              <Link href="/" {...buttonLook("ghost", "md")}>{t("ve.home")}</Link>
            </div>
          ) : null}
          {resend.text ? <p role="status" className="mt-3 text-[13.5px]" style={{ color: "var(--ink-2)" }}>{resend.text}</p> : null}
        </section>

        <p className="mt-8 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-3)" }}>{t("ve.footer")}</p>
      </main>
    </div>
  );
}
