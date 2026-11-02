"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, LogOut, Loader2 } from "lucide-react";
import { Button, Card } from "@/components/ds/primitives";
import { MyCertificates } from "@/components/wrapup/MyCertificates";
import { NpsPrompt } from "@/components/wrapup/NpsPrompt";
import { apiGet } from "@/lib/api";
import { useTranslation } from "@/contexts/LanguageContext";
import { formatDate } from "@/lib/i18n/dates";
import { participantEventId } from "@/lib/participantEvent";

/**
 * The page an eliminated participant sees — the only one (decision E9: the
 * middleware locks eliminated hackers to this URL, no announcement is sent).
 * It says which team, when and why, and keeps what is still theirs: their
 * certificates (a participation certificate when their team handed in a
 * project) and the "would you recommend it" question once the event ends.
 * Logging out is the way off the page.
 */

interface EliminatedTeamInfo {
  name?: string | null;
  reason?: string | null;
  eliminated_at?: string | null;
  event_name?: string | null;
}

interface MeWithElimination {
  status?: string;
  eliminated_team?: EliminatedTeamInfo | null;
  full_name?: string | null;
  email?: string | null;
}

function formatDateForLang(iso: string | null | undefined, lang: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatDate(d, lang, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--danger)" }}>{label}</p>
      <div className="mt-0.5 text-[15px]" style={{ color: "var(--ink)" }}>{children}</div>
    </div>
  );
}

export default function HackerEliminatedPage() {
  const { t, lang } = useTranslation();
  const router = useRouter();
  const [info, setInfo] = useState<EliminatedTeamInfo | null>(null);
  const [eventId, setEventId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet<MeWithElimination>("/api/auth/me")
      .then((me) => {
        if (cancelled) return;
        // Safety net: if the team was brought back while this page was
        // open, go to the dashboard instead of staying here.
        if (me?.status && me.status !== "eliminated") {
          router.replace("/hacker");
          return;
        }
        setInfo(me?.eliminated_team ?? null);
      })
      .catch(() => {
        // Leave info=null → generic copy will show.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    participantEventId()
      .then((id) => { if (!cancelled) setEventId(id); })
      .catch(() => { /* the event-bound sections stay hidden */ });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const doLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* ignore */
    }
    document.cookie = "hh_role=; Path=/; Max-Age=0; SameSite=Lax";
    document.cookie = "hh_email=; Path=/; Max-Age=0; SameSite=Lax";
    document.cookie = "hh_status=; Path=/; Max-Age=0; SameSite=Lax";
    router.replace("/login");
  };

  const teamName = info?.name?.trim() || "";
  const reason = info?.reason?.trim() || "";
  const when = formatDateForLang(info?.eliminated_at, lang);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-6">
      <div className="text-center">
        <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full" style={{ background: "var(--danger-weak)", color: "var(--danger)" }}>
          <Ban size={38} aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-[-0.01em] [text-wrap:balance] sm:text-3xl" style={{ color: "var(--ink)" }}>
          {t("hacker.eliminated.title")}
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-[15px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          {t("hacker.eliminated.description")}
        </p>
      </div>

      {loading ? (
        <p role="status" className="flex items-center justify-center gap-2 text-[13px]" style={{ color: "var(--ink-3)" }}>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t("hacker.eliminated.loading")}
        </p>
      ) : (
        <Card className="space-y-3" style={{ borderColor: "var(--danger-weak)" }}>
          {teamName ? <Row label={t("hacker.eliminated.team_label")}><span className="font-semibold">{teamName}</span></Row> : null}
          {info?.event_name ? <Row label={t("hacker.eliminated.event_label")}>{info.event_name}</Row> : null}
          {when ? <Row label={t("hacker.eliminated.when_label")}>{when}</Row> : null}
          {reason ? (
            <Row label={t("hacker.eliminated.reason_label")}><span className="whitespace-pre-wrap">{reason}</span></Row>
          ) : (
            <p className="text-[13px] italic" style={{ color: "var(--ink-3)" }}>{t("hacker.eliminated.no_reason")}</p>
          )}
        </Card>
      )}

      <Card>
        <p className="text-[12px] font-medium" style={{ color: "var(--ink-3)" }}>{t("hacker.eliminated.next_steps_title")}</p>
        <ul className="mt-1.5 space-y-1 text-[13.5px]" style={{ color: "var(--ink-2)" }}>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--ink-3)" }} />
            {t("hacker.eliminated.tip_contact")}
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--ink-3)" }} />
            {t("hacker.eliminated.tip_email")}
          </li>
        </ul>
      </Card>

      {eventId != null ? <MyCertificates eventId={eventId} /> : null}
      {eventId != null ? <NpsPrompt eventId={eventId} /> : null}

      <div className="flex justify-center">
        <Button variant="danger" onClick={doLogout} disabled={loggingOut} loading={loggingOut} icon={<LogOut size={16} />}>
          {t("shell.logout")}
        </Button>
      </div>
    </div>
  );
}
