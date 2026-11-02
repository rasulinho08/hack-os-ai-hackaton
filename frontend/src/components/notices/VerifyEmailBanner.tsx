"use client";

/**
 * Asks an account that has not confirmed its e-mail to do so, above every
 * signed-in page (ShellNotices). It names the invitations that wait for the
 * confirmation (GET /api/auth/me → email_verified, pending_invites) and
 * sends a new link on request (POST /api/auth/verify-email/resend: one a
 * minute — the answer says how long to wait).
 *
 * /api/auth/me is asked once per browser session and the answer kept for
 * the account (src/lib/emailVerification.ts), so a confirmed account never
 * sees the notice flash in; an unconfirmed one asks again when the tab
 * comes back to the front — which is when someone returns from opening the
 * link in their mailbox.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { MailCheck, X } from "lucide-react";
import { Button } from "@/components/ds/primitives";
import { useTranslation } from "@/contexts/LanguageContext";
import { ApiError, apiGet, apiPost, isDemoApiEnabled } from "@/lib/api";
import {
  inviteRoleKey, readVerifyCache, retryAfterSeconds, subscribeVerify, verifyStateFromMe, writeVerifyCache,
} from "@/lib/emailVerification";
import { fill } from "@/lib/i18n/fill";

export function VerifyEmailBanner() {
  const { t } = useTranslation();
  const state = useSyncExternalStore(subscribeVerify, readVerifyCache, () => null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string; devUrl?: string } | null>(null);

  const check = useCallback(async () => {
    try {
      const next = verifyStateFromMe(await apiGet<unknown>("/api/auth/me"));
      if (!next) return;
      const prev = readVerifyCache();
      writeVerifyCache({ ...next, dismissed: Boolean(prev && prev.email === next.email && prev.dismissed) });
    } catch {
      /* no notice rather than a wrong one */
    }
  }, []);

  useEffect(() => {
    if (isDemoApiEnabled()) return;
    if (!state) void check();
    if (state?.verified) return;
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [state, check]);

  if (!state || state.verified || state.dismissed || isDemoApiEnabled()) return null;

  const dismiss = () => writeVerifyCache({ ...state, dismissed: true });

  const resend = async () => {
    setSending(true);
    setNote(null);
    try {
      const out = await apiPost<{ sent?: boolean; alreadyVerified?: boolean; email?: string; verifyUrl?: string }>("/api/auth/verify-email/resend", {});
      if (out?.alreadyVerified) {
        writeVerifyCache({ ...state, verified: true });
        return;
      }
      setNote({ tone: "ok", text: fill(t("ve.resend_sent"), { email: out?.email || state.email }), devUrl: out?.verifyUrl });
    } catch (err) {
      const wait = err instanceof ApiError ? retryAfterSeconds(err) : null;
      setNote(wait != null ? { tone: "warn", text: fill(t("ve.resend_wait"), { s: wait }) } : { tone: "warn", text: t("ve.resend_failed") });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-[var(--radius)] border px-4 py-3"
      style={{ borderColor: "color-mix(in srgb, var(--warn) 45%, transparent)", background: "var(--warn-weak)", color: "var(--ink)" }}
    >
      <MailCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: "var(--warn)" }} />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{t("ve.banner_title")}</p>
        <p className="mt-0.5 break-words text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{fill(t("ve.banner_body"), { email: state.email })}</p>
        {state.invites.length ? (
          <ul className="mt-1 space-y-0.5 text-[13px]" style={{ color: "var(--ink-2)" }}>
            {state.invites.map((inv) => (
              <li key={`${inv.eventId}-${inv.role}`}>
                {fill(t("ve.banner_invite"), { role: t(inviteRoleKey(inv.role)), event: inv.eventName || t("nt.this_event") })}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button size="sm" onClick={() => void resend()} loading={sending} disabled={sending}>{t("ve.resend")}</Button>
          {note ? (
            <span className="text-[12.5px]" style={{ color: note.tone === "ok" ? "var(--ok)" : "var(--ink-2)" }}>
              {note.text}
              {note.devUrl ? <> <a href={note.devUrl} className="underline">{t("ve.dev_link")}</a></> : null}
            </span>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 transition-colors hover:bg-[var(--tint)]"
        aria-label={t("ve.dismiss")}
        title={t("ve.dismiss")}
        style={{ color: "var(--ink-3)" }}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
