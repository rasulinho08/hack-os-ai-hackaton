"use client";

/**
 * What the "your registration is in review" screen says about it: the event,
 * the team, when the person registered and whether their e-mail address is
 * confirmed yet (with a way to send the link again). The same facts the
 * registration e-mail gives, read from the API for the signed-in person;
 * nothing shows when they are not signed in or the API cannot say.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, MailWarning } from "lucide-react";
import { useTranslation } from "@/contexts/LanguageContext";
import { apiGet, apiPost } from "@/lib/api";
import { formatDate } from "@/lib/i18n/dates";
import { registrationFacts, type RegistrationFacts } from "@/lib/participantProgress";

export function RegistrationStatusDetails() {
  const { t, lang } = useTranslation();
  const [facts, setFacts] = useState<RegistrationFacts | null>(null);
  const [resend, setResend] = useState<"idle" | "busy" | "sent" | "failed">("idle");

  useEffect(() => {
    let live = true;
    Promise.all([
      apiGet<unknown>("/api/me/event-progress").catch(() => null),
      apiGet<unknown>("/api/auth/me").catch(() => null),
    ]).then(([progress, me]) => {
      if (live) setFacts(registrationFacts(progress, me));
    });
    return () => { live = false; };
  }, []);

  if (!facts) return null;
  const rows: { label: string; value: string }[] = [
    { label: t("login.facts.event"), value: facts.eventName },
    { label: t("login.facts.team"), value: facts.teamName ?? t("login.facts.no_team") },
    ...(facts.registeredAt ? [{ label: t("login.facts.registered"), value: formatDate(facts.registeredAt, lang, { day: "numeric", month: "long", year: "numeric" }) }] : []),
  ];

  return (
    <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11.5px]">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-white/60">{r.label}</dt>
            <dd className="min-w-0 break-words font-medium text-white">{r.value}</dd>
          </div>
        ))}
      </dl>
      {facts.emailVerified === true ? (
        <p className="flex items-center gap-1.5 text-[11.5px] text-[#00C853]">
          <CheckCircle2 size={13} aria-hidden="true" />{t("login.facts.email_ok")}
        </p>
      ) : facts.emailVerified === false ? (
        <div className="text-[11.5px] text-white/85">
          <p className="flex items-start gap-1.5"><MailWarning size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{t("login.facts.email_unconfirmed")}</p>
          <button type="button" disabled={resend === "busy" || resend === "sent"}
            onClick={async () => {
              setResend("busy");
              try { await apiPost("/api/auth/verify-email/resend", {}); setResend("sent"); } catch { setResend("failed"); }
            }}
            className="mt-1.5 min-h-9 rounded-md border border-white/20 px-3 text-[11.5px] font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-60">
            {resend === "sent" ? t("login.facts.resent") : resend === "failed" ? t("login.facts.resend_failed") : t("login.facts.resend")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
